// The ONE file that knows Clay's tool names, tool result shapes and page markup. Everything else in evals/ goes through it.
// It reads both shapes of the create tool: the spec ({ data: { price_pages }, view, controls, outputs }, since the kit) and
// the earlier price config ({ metrics, vendors }). When tools or markup change, change this file only.
import type { Page } from "playwright-core";

// ---- The agent's side: MCP endpoint and tools.
export const MCP_PATH = "/api/mcp";
/** Name of the MCP server in the agent's config. Tool names in transcripts are `mcp__clay__<tool>` (claude) or server "clay" (codex). */
export const SERVER = "clay";
export const TOOL = { create: "create_playground", read: "read_playground", recheck: "recheck_playground", revise: "revise_playground" } as const;
/** Tools whose result describes a build (the URL, what was read, the problems list). */
export const BUILD_TOOLS: string[] = [TOOL.create, TOOL.revise];

/** How the agent authenticates: the owner key or a per-person agent key (/connect), both as a bearer token. */
export const authHeader = (key: string) => ({ Authorization: `Bearer ${key}` });

type ToolInfo = { name: string; description?: string; inputSchema?: unknown };
/** Does this server have the kit? Its create tool takes a spec with a view, controls and outputs; before the kit it took a price config. */
export const kitAvailable = (tools: ToolInfo[]) => /"(spec|views|preview|outputs)"/.test(JSON.stringify(tools.find((t) => t.name === TOOL.create)?.inputSchema ?? {}));

export type Build = { id: string | null; url: string | null; problems: string[]; stopped: string | null };
/** Read the result text of a build tool. Tool results are untrusted data: only these fields are used. */
export function parseBuild(resultText: string): Build {
  try {
    const r = JSON.parse(resultText) as Record<string, unknown>;
    return { id: typeof r.playground_id === "string" ? r.playground_id : null, url: typeof r.url === "string" ? r.url : null, problems: Array.isArray(r.problems) ? r.problems.map(String) : [], stopped: typeof r.stopped === "string" ? r.stopped : null };
  } catch {
    return { id: null, url: null, problems: [], stopped: null };
  }
}
/** The problems that mean a broken build, which the agent must repair or tell the person. The others are true findings about a page. */
export const isBuildError = (problem: string) => /^BROKEN BUILD|was not read|no plan was found|no row was found|none states a quantity|no page states a price|no page says whether|could not be read/.test(problem);
/**
 * The problems list of a read result once the build has ended, or null while it runs (or for a playground without one).
 * A build answers the agent before every page is read, so the last create or revise result may hold an empty list that
 * says nothing: the truth is what the server reports when the reading has ended.
 */
export function finalProblems(readResultText: string): string[] | null {
  try {
    const r = JSON.parse(readResultText) as { build?: { status?: string }; problems?: unknown };
    return r.build && r.build.status !== "running" && Array.isArray(r.problems) ? r.problems.map(String) : null;
  } catch {
    return null;
  }
}
/** Who a problem is about: "resend: ..." gives "resend", "metric emails: ..." gives "emails". */
export const problemSubject = (problem: string) => problem.split(":")[0].replace(/^(metric|feature)\s+/, "").replace(/^data\.web\./, "").trim();
/** The playground id a tool call works on. */
export const callTarget = (input: Record<string, unknown>) => (typeof input.playground_id === "string" ? input.playground_id : typeof input.id === "string" ? input.id : null);
/** The create tool refused because the server already has a playground with that id. In an eval that is a leftover of an earlier run. */
export const isIdCollision = (resultText: string) => /^A playground with id ".*" already exists|^The id ".*" is taken/.test(resultText);
/** The id a create call asks for. Used when the call's result never reached the agent (a client-side timeout). */
export const createdId = (input: Record<string, unknown>) => (typeof input.id === "string" ? input.id : null);
const pricePages = (input: Record<string, unknown>) => ((input.data as Record<string, unknown> | undefined)?.price_pages as Record<string, unknown> | undefined) ?? null;
/** The id of the vendor with this display name, from the vendor lists of the build calls. The agent may name either. */
export function vendorId(calls: { input: Record<string, unknown> }[], name: string): string | null {
  for (const c of [...calls].reverse()) {
    const hit = ((pricePages(c.input)?.vendors ?? c.input.vendors ?? c.input.add_vendors ?? []) as Record<string, unknown>[]).find((v) => v?.name === name);
    if (hit && typeof hit.id === "string") return hit.id;
  }
  return null;
}
/** The vendors a revise call gives: the new vendor list of data.price_pages (or add_vendors before the kit). */
export const addedNames = (input: Record<string, unknown>) => ((pricePages(input)?.vendors ?? input.add_vendors ?? []) as Record<string, unknown>[]).map((v) => `${v.id} ${v.name} ${v.domain ?? ""} ${v.pricing_url ?? ""}`);

/** Arguments for the create tool that prepares the playground of the return-visit cases. */
export const preparedPlayground = (id: string) => ({
  id,
  title: "Which email service should our app use?",
  view: { type: "price_ranking" },
  data: {
    price_pages: {
      product: "transactional email API",
      metrics: [{ id: "emails_per_month", label: "Emails per month", unit: "emails", describe: "Emails sent per month (also called messages or sends), included in the plan and billed as overage.", min: 5000, max: 300000, initial: 30000 }],
      features: [],
      vendors: [
        { id: "resend", name: "Resend", pricing_url: "https://resend.com/pricing" },
        { id: "postmark", name: "Postmark", pricing_url: "https://postmarkapp.com/pricing" },
        { id: "mailgun", name: "Mailgun", pricing_url: "https://www.mailgun.com/pricing/" },
      ],
    },
  },
});
/** The numeric dimensions of the prepared playground. */
export const preparedDimensions = (id: string): Dimension[] => preparedPlayground(id).data.price_pages.metrics;

// ---- The stored playground, as far as the checker needs it.
export type Dimension = { id: string; label: string; unit: string; min: number; max: number; initial: number };
type BuildCall = { tool: string; mcp: boolean; input: Record<string, unknown>; isError: boolean; result?: string };
/** The id a create call got: the one in its result (a taken id gets a suffix), else the one it asked for. */
const builtId = (c: BuildCall) => parseBuild(c.result ?? "").id ?? createdId(c.input);
/** The numeric dimensions in one create or revise input, or null when the call does not state them. */
function statedDimensions(input: Record<string, unknown>): Dimension[] | null {
  const metrics = (pricePages(input)?.metrics ?? input.metrics) as Dimension[] | undefined; // a price playground: one slider per metric
  if (metrics) return metrics.map((m) => ({ id: m.id, label: m.label, unit: m.unit, min: m.min, max: m.max, initial: m.initial }));
  const controls = input.controls as (Partial<Dimension> & { type?: string })[] | undefined; // a preview playground: its slider controls
  if (controls) return controls.filter((c) => c.type === "slider").map((c) => ({ id: String(c.id), label: String(c.label ?? c.id), unit: String(c.unit ?? ""), min: Number(c.min), max: Number(c.max), initial: Number(c.initial) }));
  return null;
}
/**
 * The numeric dimensions of a playground after every repair: those of the create call, then each successful revise applied
 * in order (a revise replaces the whole list). The public state route does not return them, so they come from the calls.
 */
export function dimensions(calls: BuildCall[], id: string): Dimension[] | null {
  let dims: Dimension[] | null = null;
  for (const c of calls.filter((x) => x.mcp && !x.isError)) {
    if (c.tool === TOOL.create && builtId(c) === id) dims = statedDimensions(c.input) ?? [];
    else if (c.tool === TOOL.revise && c.input.playground_id === id && dims) {
      const add = (c.input.add_metrics as Dimension[] | undefined) ?? []; // before the kit: entries were added and removed by id
      const remove = (c.input.remove_metric_ids as string[] | undefined) ?? [];
      dims = statedDimensions(c.input) ?? [...dims.filter((d: Dimension) => !remove.includes(d.id) && !add.some((x) => x.id === d.id)), ...add];
    }
  }
  return dims;
}

// ---- The person's side: the playground page.
export const PAGE = {
  /** Present when the playground has rendered. */
  ready: "h1",
  /** Error states that a person sees: a page or source error, "preview failed" (also p.alert), and a playground with no data. */
  errors: ["p.alert", "section.card.empty"],
  /** The area that holds the controls, on both kinds of playground. */
  controls: "section.controls",
  /** Areas that must react when a control moves: the ranking and the decision panel (price), the output texts (preview). */
  reacts: ["section.results", "aside.side", "[data-output]"],
  /** The sandboxed preview of a preview playground. Compared by screenshot, and checked for content. */
  preview: 'iframe[src$="/frame"]',
  /** Rows of the ranking of a price playground, best first. */
  ranked: "ol.rank li.vendor",
  /** Milliseconds a preview needs after load before it reports that it ran. */
  previewSettleMs: 2500,
  /** Present while the agent's build still reads pricing pages: sources arrive one by one, and the person waits and watches. */
  building: "[data-building]",
  /** How long the checker waits for a build to end, like a person would. A build that takes longer fails the page check. */
  buildWaitMs: 240_000,
};

/** The request with which the page reports the person's exploration to the agent. The checker's own control moves must not be stored as the person's. */
export const EXPLORATION_REPORT = "**/api/p/*/explore";

/** The requests with which the page reports to the server (the person's exploration, how the preview ran). A probe that feeds the preview altered data must not send them. */
export const PAGE_REPORTS = ["**/api/p/*/explore", "**/api/p/*/preview"];
/** The request for the preview's frame document. */
export const FRAME_REQUEST = "**/p/*/frame";
/**
 * The frame document with every number of the web data replaced by null: what the preview gets when nothing could be
 * read. Returns null when the document has no web data. The config sits in the document as `var cfg = {...};`.
 */
export function withoutWebNumbers(frameHtml: string): string | null {
  const start = frameHtml.indexOf("var cfg = ");
  const end = frameHtml.indexOf(";\nfunction check(", start);
  if (start < 0 || end < 0) return null;
  try {
    const cfg = JSON.parse(frameHtml.slice(start + 10, end)) as { data?: { web?: unknown } };
    if (!cfg.data?.web || !Object.keys(cfg.data.web as object).length) return null;
    const strip = (v: unknown): unknown => (typeof v === "number" ? null : Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)])) : v);
    cfg.data.web = strip(cfg.data.web);
    return frameHtml.slice(0, start + 10) + JSON.stringify(cfg).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029") + frameHtml.slice(end);
  } catch {
    return null;
  }
}

/** One web source as the page lists it under "Where the data comes from". */
export type WebSourceOnPage = { id: string; link: boolean; read: number; unknown: number; failed: boolean };
/** The web sources of a preview playground on the page: is there a link to the page, how many values are shown as read, how many as unknown. */
export async function webSources(page: Page): Promise<WebSourceOnPage[]> {
  const out: WebSourceOnPage[] = [];
  for (const el of await page.locator("[data-web-source]").all()) {
    const cells = await el.locator("td").allInnerTexts();
    const unknown = cells.filter((t) => /^unknown\b/.test(t.trim())).length;
    out.push({ id: (await el.getAttribute("data-web-source")) ?? "", link: (await el.locator('a[href^="https://"]').count()) > 0, read: cells.length - unknown, unknown, failed: /could not be read|No row was found/.test(await el.innerText()) });
  }
  return out;
}
/** The visible text of the preview, or null when the page has none. */
export async function previewText(page: Page): Promise<string | null> {
  const frame = await (await page.$(PAGE.preview))?.contentFrame();
  return frame ? frame.locator("body").innerText().then((t) => t.replace(/\s+/g, " ").trim(), () => "") : null;
}
/**
 * From a read result after the settle: the choices the person made (the values of select controls: every settled text
 * value that is not a colour), and whether the server holds unknown values for a web source.
 */
export function readFacts(readResultText: string): { choices: string[]; anyUnknown: boolean } {
  try {
    const r = JSON.parse(readResultText) as { settled?: { values?: Record<string, unknown> } | string; data?: { source?: string; status?: string; unknown?: unknown[] }[] };
    const values = typeof r.settled === "object" && r.settled ? (r.settled.values ?? {}) : {};
    return {
      choices: Object.values(values).filter((v): v is string => typeof v === "string" && v.trim() !== "" && !/^#[0-9a-f]{6}$/i.test(v)),
      anyUnknown: (r.data ?? []).some((s) => s.source === "web" && (s.status === "failed" || (Array.isArray(s.unknown) && s.unknown.length > 0))),
    };
  } catch {
    return { choices: [], anyUnknown: false };
  }
}

/** How many visible elements the preview shows, or null when the page has no preview. Zero means a blank preview. */
export async function previewContent(page: Page): Promise<number | null> {
  const el = await page.$(PAGE.preview);
  const frame = await el?.contentFrame();
  if (!frame) return null;
  return frame.evaluate(() => [...document.body.querySelectorAll("*")].filter((e) => !["SCRIPT", "STYLE", "LINK"].includes(e.tagName) && e.getBoundingClientRect().width > 1 && e.getBoundingClientRect().height > 1).length).catch(() => 0);
}

/**
 * Become the person. The owner link puts the owner key in a cookie, which makes the browser the admin.
 * lean: a per-person agent key (clay_ak...) cannot sign a browser in; that needs a Clerk session. Until the harness has a
 * test account, run the evals with the owner key. With a per-person key the agent legs work and the person's writes fail.
 */
export async function signIn(page: Page, baseUrl: string, key: string | undefined) {
  if (!key) return; // a local development server without Clerk keys needs no key
  // The error of a failed sign-in must not carry the address: its fragment is the key, and the error is saved with the run.
  // So only the kind of error is kept. A TimeoutError is usually a cold development server compiling /enter.
  try {
    await page.goto(`${baseUrl}/enter#key=${key}`);
    await page.waitForURL((u) => u.pathname === "/" && !u.hash, { timeout: 20000 });
  } catch (e) {
    throw new Error(`the browser could not sign in at /enter (${e instanceof Error ? e.name : "error"}; the address is left out, it holds the key)`);
  }
}

/** Dimensions that the playground declares but the page does not show as a control ("its slider is hidden"). */
export async function missingControls(page: Page, dims: Dimension[]): Promise<string[]> {
  const out: string[] = [];
  for (const d of dims) if ((await page.locator(`[id="${d.id}"], [data-control="${d.id}"]`).count()) === 0) out.push(d.id);
  return out;
}

/** The person settles: move the sliders, then press Settle (preview) or pick the second-ranked vendor and save (price). */
export async function settle(page: Page, dims: Dimension[]): Promise<{ chosen: string | null; outputs: Record<string, unknown> | null; error: string | null }> {
  // A price playground: move every slider to 1.5 times its start, through the exact-value field.
  for (const d of dims) {
    const price = page.locator(`.control:has([id="${d.id}"]) input.value`);
    if (await price.count()) await price.fill(String(Math.min(d.max, Math.round(d.initial * 1.5))));
    await page.waitForTimeout(150);
  }
  // A preview playground: move EVERY control off its start value, so the settled outputs differ from the code as it is.
  for (const c of await page.locator("[data-control]").all()) {
    const range = c.locator('input[type="range"]');
    const option = c.locator('[role="group"] button[aria-pressed="false"]');
    if (await range.count()) {
      // Halfway from the value now to the top, on the slider's step grid; from the top, one step down.
      const [min, max, step, now] = await range.evaluate((el) => { const r = el as HTMLInputElement; return [Number(r.min), Number(r.max), Number(r.step) || 1, Number(r.value)]; });
      const snap = (n: number) => Number((min + Math.round((n - min) / step) * step).toFixed(6));
      const to = snap((now + max) / 2) !== now ? snap((now + max) / 2) : now + step <= max ? snap(now + step) : snap(now - step);
      await range.fill(String(to));
    } else if (await option.count()) await option.first().click();
    else if (await c.locator('input[type="checkbox"]').count()) await c.locator('input[type="checkbox"]').click();
    await page.waitForTimeout(150);
  }
  // A preview playground: press Settle and read the named outputs as the page shows them.
  const settleButton = page.getByRole("button", { name: /^Settle/ });
  if (await settleButton.count()) {
    if (await settleButton.first().isDisabled()) return { chosen: null, outputs: null, error: "the Settle button is disabled (no owner access, or already settled)" };
    await page.waitForTimeout(1600); // the exploration summary is sent after a pause
    await settleButton.first().click();
    try {
      await page.waitForSelector("[data-settled]", { timeout: 15000 });
    } catch {
      return { chosen: null, outputs: null, error: "the page did not confirm the settle" };
    }
    const outputs = Object.fromEntries(await page.locator("[data-output]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-output"), e.textContent ?? ""])));
    return { chosen: null, outputs, error: Object.keys(outputs).length ? null : "the page shows no outputs after settle" };
  }
  const rows = page.locator(PAGE.ranked);
  const n = await rows.count();
  if (n === 0) return { chosen: null, outputs: null, error: "no vendor is ranked, so nothing can be selected" };
  const row = rows.nth(n > 1 ? 1 : 0);
  const chosen = (await row.locator(".name").innerText()).replace(/^\d+\.\s*/, "").trim();
  await row.getByRole("button", { name: /^Select/ }).click();
  await page.waitForTimeout(1800); // the exploration summary is sent after a pause
  const save = page.getByRole("button", { name: /Save decision|Replace saved decision|Update saved decision/ });
  if ((await save.count()) === 0 || (await save.first().isDisabled())) return { chosen, outputs: null, error: "the save button is missing or disabled (no owner access?)" };
  await save.first().click();
  try {
    await page.waitForSelector(".verdict", { timeout: 15000 });
  } catch {
    return { chosen, outputs: null, error: "no verdict appeared after saving the decision" };
  }
  return { chosen, outputs: null, error: null };
}
