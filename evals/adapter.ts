// The ONE file that knows Clay's tool names, tool result shapes and page markup. Everything else in evals/ goes through it.
// When the kit (spec, preview, named outputs, settle) or accounts (per-person agent keys, sign-in) land, change this file only.
// Lines marked "kit:" are written from the kit's description and are not yet proven against a server that has it.
import type { Page } from "playwright-core";

// ---- The agent's side: MCP endpoint and tools.
export const MCP_PATH = "/api/mcp";
/** Name of the MCP server in the agent's config. Tool names in transcripts are `mcp__clay__<tool>` (claude) or server "clay" (codex). */
export const SERVER = "clay";
export const TOOL = { create: "create_playground", read: "read_playground", recheck: "recheck_playground", revise: "revise_playground" } as const;
/** Tools whose result describes a build (the URL, what was read, the problems list). */
export const BUILD_TOOLS: string[] = [TOOL.create, TOOL.revise];

/** How the agent authenticates. Today: one owner key as a bearer token. Accounts: a per-person agent key, same header. */
export const authHeader = (key: string) => ({ Authorization: `Bearer ${key}` });

type ToolInfo = { name: string; description?: string; inputSchema?: unknown };
/** Does this server have the kit? Today's create tool takes a price config; the kit's takes a spec with views such as `preview`. */
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
export const isBuildError = (problem: string) => /was not read|no plan was found|none states a quantity|no page states a price|no page says whether/.test(problem);
/** Who a problem is about: "resend: ..." gives "resend", "metric emails: ..." gives "emails". */
export const problemSubject = (problem: string) => problem.split(":")[0].replace(/^(metric|feature)\s+/, "").trim();
/** The playground id a tool call works on. */
export const callTarget = (input: Record<string, unknown>) => (typeof input.playground_id === "string" ? input.playground_id : typeof input.id === "string" ? input.id : null);
/** The create tool refused because the server already has a playground with that id. In an eval that is a leftover of an earlier run. */
export const isIdCollision = (resultText: string) => /^A playground with id ".*" already exists/.test(resultText);
/** The id a create call asks for. Used when the call's result never reached the agent (a client-side timeout). */
export const createdId = (input: Record<string, unknown>) => (typeof input.id === "string" ? input.id : null);
/** Names that a revise call adds (vendors today; kit: also controls and views). */
export const addedNames = (input: Record<string, unknown>) => (Array.isArray(input.add_vendors) ? (input.add_vendors as Record<string, unknown>[]).map((v) => `${v.id} ${v.name} ${v.domain ?? ""} ${v.pricing_url ?? ""}`) : []);

/** Arguments for the create tool that prepares the playground of the return-visit cases. */
export const preparedPlayground = (id: string) => ({
  id,
  question: "Which email service should our app use?",
  product: "transactional email API",
  metrics: [{ id: "emails_per_month", label: "Emails per month", unit: "emails", describe: "Emails sent per month (also called messages or sends), included in the plan and billed as overage.", min: 5000, max: 300000, initial: 30000 }],
  features: [],
  vendors: [
    { id: "resend", name: "Resend", pricing_url: "https://resend.com/pricing" },
    { id: "postmark", name: "Postmark", pricing_url: "https://postmarkapp.com/pricing" },
    { id: "mailgun", name: "Mailgun", pricing_url: "https://www.mailgun.com/pricing/" },
  ],
});

// ---- The stored playground, as far as the checker needs it.
export type Dimension = { id: string; label: string; unit: string; min: number; max: number; initial: number };
type BuildCall = { tool: string; mcp: boolean; input: Record<string, unknown>; isError: boolean };
/**
 * The numeric dimensions of a playground after every repair: the create call's metrics, then each successful revise applied
 * in order (an entry with an existing id replaces it). The public state route does not return them, so they come from the calls.
 */
export function dimensions(calls: BuildCall[], id: string): Dimension[] | null {
  let dims: Dimension[] | null = null;
  for (const c of calls.filter((x) => x.mcp && !x.isError)) {
    // kit: map the spec's slider controls here: { id, label, unit, min, max, initial }.
    if (c.tool === TOOL.create && c.input.id === id) dims = ((c.input.metrics as Dimension[] | undefined) ?? []).map((m) => ({ ...m }));
    else if (c.tool === TOOL.revise && c.input.playground_id === id && dims) {
      const add = (c.input.add_metrics as Dimension[] | undefined) ?? [];
      const remove = (c.input.remove_metric_ids as string[] | undefined) ?? [];
      dims = [...dims.filter((d: Dimension) => !remove.includes(d.id) && !add.some((a) => a.id === d.id)), ...add];
    }
  }
  return dims;
}

// ---- The person's side: the playground page.
export const PAGE = {
  /** Present when the playground has rendered. */
  ready: "h1",
  /** Error states that a person sees. */
  errors: ["p.alert", "section.card.empty", "[data-preview-error]" /* kit: the preview's error box */],
  /** The area that holds the controls. */
  controls: "section.controls, [data-controls]",
  /** Areas that must react when a control moves: the ranking and the decision panel today; kit: the outputs. */
  reacts: ["section.results", "aside.side", "[data-outputs]"],
  /** kit: the sandboxed preview. Compared by screenshot, and checked for an error and for a blank frame. */
  preview: "iframe[data-preview], [data-preview] iframe",
  /** Rows of the ranking, best first. */
  ranked: "ol.rank li.vendor",
};

/** Become the person. Today: the owner link puts the owner key in a cookie. Accounts: replace with the sign-in flow or a session cookie. */
export async function signIn(page: Page, baseUrl: string, key: string | undefined) {
  if (!key) return; // a local development server needs no key
  await page.goto(`${baseUrl}/enter#key=${key}`);
  await page.waitForURL((u) => u.pathname === "/" && !u.hash, { timeout: 20000 });
}

/** Dimensions that the playground declares but the page does not show as a control ("its slider is hidden"). */
export async function missingControls(page: Page, dims: Dimension[]): Promise<string[]> {
  const out: string[] = [];
  for (const d of dims) if ((await page.locator(`[id="${d.id}"], [data-control="${d.id}"]`).count()) === 0) out.push(d.id);
  return out;
}

/** The person settles: pick the second-ranked vendor when there is one (so the choice cannot be guessed), then save. */
export async function settle(page: Page, dims: Dimension[]): Promise<{ chosen: string | null; outputs: Record<string, unknown> | null; error: string | null }> {
  // Move every dimension to a value 1.5 times its start, clamped to the range, through the exact-value field.
  for (const d of dims) {
    const field = page.locator(`.control:has([id="${d.id}"]) input.value`);
    if (await field.count()) {
      await field.fill(String(Math.min(d.max, Math.round(d.initial * 1.5))));
      await page.waitForTimeout(150);
    }
  }
  // kit: click the settle button and read the named outputs, for example from a JSON script element.
  const settleButton = page.locator("button[data-settle]");
  if (await settleButton.count()) {
    await settleButton.click();
    await page.waitForTimeout(1500);
    const raw = await page.locator("[data-outputs-json]").first().textContent().catch(() => null);
    try {
      return { chosen: null, outputs: raw ? (JSON.parse(raw) as Record<string, unknown>) : null, error: raw ? null : "the page shows no outputs after settle" };
    } catch {
      return { chosen: null, outputs: null, error: "the outputs on the page are not JSON" };
    }
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
