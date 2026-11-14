// Collect and re-check. Live sources and the demo source share every step except how the page is read.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { extractionInstructions, extractionSchema, hasPrices, normalise, pricingCandidates, type Domain, type PricingModel, type RawModel } from "./domain";
import { brand, cd, ContextDevError, scrape } from "./contextdev";
import { confirmed, diffModels, verdict } from "./diff";
import { BRAND_PENDING, brandPending, runSignature, type Kit, type KitState } from "./kit";
import { confirmChanges, diffWeb, guard, pageHash, webInstructions, webSchema, WEB_LIMITS, type WebChange, type WebRead, type WebSource, type WebState } from "./web";
import { endWork, insertPlayground, load, newPlayground, publicBase, sourceArrived, startWork, update, workStatus, type ChangeEvent, type Playground, type Snapshot, type Source, type Work } from "./store";

export const DEMO_PATH = "/demo-vendor/pricing";
const hash = (text: string) => createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");

/** Context.dev cannot reach localhost. Without a public base URL the demo page is read by the app itself; on a deployment Context.dev reads it like any other source. */
const demoIsLocal = () => !publicBase();
const demoUrl = (origin: string) => (publicBase() ?? origin) + DEMO_PATH;

// ---- Evidence: is each extracted fact visible in the page text of the same capture?

const squash = (s: string) => s.toLowerCase().replace(/<br\s*\/?>/g, "").replace(/[\\*_`#|\s]/g, "");
function numberForms(n: number): string[] {
  const forms = [String(n), n.toLocaleString("en-US", { maximumFractionDigits: 6 })];
  if (n > 0 && n < 1) forms.push(String(n).replace(/^0/, ""));
  if (n >= 1000 && n % 1000 === 0) forms.push(`${n / 1000}k`);
  if (n >= 1_000_000 && n % 100_000 === 0) forms.push(`${n / 1_000_000}m`, `${n / 1_000_000}million`);
  return forms;
}
const parts = (quote: string) => quote.split(/<br\s*\/?>|[|;]/).map(squash).filter(Boolean);

/**
 * Check every extracted fact against the page text of the same capture.
 * A number that is not in the page text is quarantined: it becomes null (unknown) and is listed, never used.
 * Facts without numbers (feature status) are only flagged when their quote is not on the page.
 */
export function verify(model: PricingModel, pageText: string): Pick<Snapshot, "model" | "evidence" | "quarantined"> {
  const page = squash(pageText);
  const onPage = (n: number) => numberForms(n).some((f) => page.includes(f.toLowerCase()));
  const quoted = (q: string | null) => !!q && parts(q).every((x) => page.includes(x));
  const evidence: Record<string, boolean> = {};
  const quarantined: Snapshot["quarantined"] = [];
  const keep = (path: string, n: number | null): number | null => {
    if (n == null || onPage(n)) return n;
    quarantined.push({ path, value: n });
    return null;
  };
  const plans = (model.plans ?? []).map((p) => {
    const before = quarantined.length;
    const base_price = quoted(p.price_quote) ? p.base_price : keep(`${p.name} / base price`, p.base_price);
    if (base_price != null || p.custom_pricing) evidence[`${p.name}/base`] = quarantined.length === before;
    const meters = (p.meters ?? []).map((m) => {
      const start = quarantined.length;
      const path = `${p.name} / ${m.metric}`;
      const out = {
        ...m,
        included: keep(`${path} / included`, m.included),
        tiers: (m.tiers ?? []).map((t, i) => ({ ...t, price: keep(`${path} / tier ${i + 1} price`, t.price) })),
      };
      evidence[`${p.name}/meter/${m.metric}`] = quarantined.length === start;
      return out;
    });
    const features = (p.features ?? []).map((f) => {
      const addon_price = keep(`${p.name} / ${f.feature} / add-on price`, f.addon_price);
      evidence[`${p.name}/feature/${f.feature}`] = quoted(f.quote) && addon_price === f.addon_price;
      return { ...f, addon_price };
    });
    return { ...p, base_price, meters, features };
  });
  return { model: { ...model, plans }, evidence, quarantined };
}

// ---- Reading a page

/** Cheap read: page text only. Used as the gate before a paid structured extraction. */
async function readText(src: Source, origin: string): Promise<string> {
  if (src.demo && demoIsLocal()) return (await fetch(demoUrl(origin), { cache: "no-store" })).text();
  const r = await scrape(src.url!);
  if (!r.markdown.success || r.markdown.data == null) throw new Error(`Page text not readable: ${r.markdown.error_code ?? "unknown"} ${r.markdown.message ?? ""}`);
  return r.markdown.data;
}

/** Full read: structured extraction plus the page text of the same capture. */
async function readModel(d: Domain, src: Source, origin: string): Promise<Snapshot> {
  if (src.demo && demoIsLocal()) {
    // Demo source on localhost: the page embeds its pricing as JSON (as JSON-LD does on real sites) and the app parses it.
    const t0 = Date.now();
    const html = await (await fetch(demoUrl(origin), { cache: "no-store" })).text();
    const m = html.match(/<script type="application\/json" id="pricing-model">([\s\S]*?)<\/script>/);
    if (!m) throw new Error("Demo page has no embedded pricing model");
    const model = JSON.parse(m[1]) as PricingModel;
    const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
    return { url: demoUrl(origin), fetchedAt: new Date().toISOString(), extractor: "local-demo-parser", textHash: hash(html), ...verify(model, text), truncated: false, latencyMs: Date.now() - t0, requestId: null };
  }
  const r = await scrape(src.url!, { schema: extractionSchema(d), instructions: extractionInstructions(d) });
  // HTTP 200 does not mean every output succeeded: check each one.
  if (!r.json.success || !r.json.data) throw new Error(`Extraction failed: ${r.json.error_code ?? "unknown"} ${r.json.message ?? ""}`);
  const text = r.markdown.success && r.markdown.data ? r.markdown.data : "";
  const model = normalise(r.json.data as RawModel);
  try {
    mkdirSync(".data/pages", { recursive: true });
    writeFileSync(`.data/pages/${d.id}--${src.id}.md`, text);
  } catch {}
  return {
    url: r.url,
    fetchedAt: new Date(Date.now() - (r.cache_metadata?.age_ms ?? 0)).toISOString(),
    extractor: "context.dev",
    ...verify(model, text),
    textHash: hash(text),
    truncated: r.json.isTruncated === true,
    latencyMs: r._ms,
    requestId: r.request_id ?? null,
  };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Thrown when a playground or vendor id is not known. */
export class NotFound extends Error {}
const playground = async (pg: string): Promise<Playground> => {
  const p = (await load()).playgrounds[pg];
  if (!p) throw new NotFound(`Playground "${pg}" does not exist.`);
  return p;
};

/** Why a read gave nothing to compute with, in words for the person and the agent. */
const PAGE_GAP = {
  interactive: "the page shows its prices only through an interactive slider or calculator, so they cannot be read from its text",
  configuration: "the prices on the page depend on a configuration that its text does not list",
  not_pricing: "it is not a pricing page",
  contact_sales: "the page states no prices, only a way to contact sales",
} as const;
const emptyReason = (m: PricingModel): string => (m.page_gap ? PAGE_GAP[m.page_gap] : m.plans?.length ? "plans were found, but no price or included quantity is stated for them" : "no plan was found on it");

/** The pages a search finds on the vendor's own domain (POST /web/search), best first. */
async function searchPricing(name: string, domain: string): Promise<{ url: string }[]> {
  const r = await cd<{ results?: { url: string }[] }>("POST", "/web/search", { query: `${name} pricing`, numResults: 5, includeDomains: [domain] });
  return r.results ?? [];
}

/**
 * Collect one vendor of one playground: find its pricing page, then extract it.
 * The first page is the one the config names, else the one found before. When it cannot be read, or gives nothing to
 * compute with, the next ones are tried (domain.ts, pricingCandidates): the search results that look like a pricing page,
 * then the site's own /pricing page; at most three pages per vendor. When none gives a price, the best read is kept and the
 * source says what was tried and why each page failed. No number is ever guessed.
 */
export async function collect(pg: string, id: string, origin: string): Promise<void> {
  const p = await playground(pg);
  const v = p.domain.vendors.find((x) => x.id === id);
  if (!v) throw new NotFound(`Playground "${pg}" has no vendor "${id}".`);
  const asked = readSig(p.domain, id);
  const prev = p.sources[id];
  const src: Source = prev ?? { id, name: v.name, demo: !!v.demo, url: null, foundVia: null, snapshot: null, lastCheckedAt: null, error: null, monitor: null };
  src.name = v.name;
  try {
    if (v.demo) {
      Object.assign(src, { url: demoUrl(origin), foundVia: "app route" });
      src.snapshot = await readModel(p.domain, src, origin);
      src.error = null;
    } else {
      const tried: { url: string; why: string }[] = [];
      let best: { snapshot: Snapshot; url: string; via: Source["foundVia"] } | null = null;
      /** Read one page. True when it gives prices; else the page and the reason are noted. */
      const attempt = async (url: string, via: Source["foundVia"]): Promise<boolean> => {
        try {
          const snapshot = await readModel(p.domain, { ...src, url }, origin);
          if (hasPrices(snapshot.model)) {
            Object.assign(src, { url, foundVia: via, snapshot, error: null });
            return true;
          }
          tried.push({ url, why: emptyReason(snapshot.model) });
          if (!best || (snapshot.model.plans?.length ?? 0) > (best.snapshot.model.plans?.length ?? 0)) best = { snapshot, url, via };
        } catch (e) {
          if (e instanceof ContextDevError && e.stop) throw e;
          tried.push({ url, why: message(e).slice(0, 120) });
        }
        return false;
      };
      const first = v.url ? ([v.url, "playground config"] as const) : src.url ? ([src.url, src.foundVia] as const) : null;
      let ok = first ? await attempt(first[0], first[1]) : false;
      // A page that gave prices before and fails now (a timeout, a bad day) is not replaced: the old read stays, with the
      // error, as before. Other pages are tried only for a vendor that has no usable read yet.
      const hadPrices = hasPrices(prev?.snapshot?.model);
      if (!ok && !hadPrices) {
        const results = await searchPricing(v.name, v.domain).catch((e) => {
          if (e instanceof ContextDevError && e.stop) throw e;
          tried.push({ url: `a search on ${v.domain}`, why: message(e).slice(0, 120) });
          return [] as { url: string }[];
        });
        for (const url of pricingCandidates(results, v.domain, tried.map((t) => t.url), 3 - tried.filter((t) => t.url.startsWith("https://")).length)) {
          ok = await attempt(url, results.some((r) => r.url === url) ? "context.dev search" : "site /pricing page");
          if (ok) break;
        }
      }
      if (!ok) {
        const said = `No price could be read for ${v.name}. Tried: ${tried.map((t) => `${t.url} (${t.why})`).join("; ") || `a search on ${v.domain}, which found no page`}.`;
        // The best read is kept, so the page can show the plan names it did find; the source says what is missing.
        const kept = best as { snapshot: Snapshot; url: string; via: Source["foundVia"] } | null;
        if (kept && !hadPrices) Object.assign(src, { url: kept.url, foundVia: kept.via, snapshot: kept.snapshot });
        src.error = hadPrices ? `${v.name}'s pricing page could not be read again (${tried[0]?.why ?? "unknown reason"}). The earlier read is kept.` : said;
      }
    }
  } catch (e) {
    src.error = message(e);
    if (e instanceof ContextDevError && e.stop) throw e;
  } finally {
    src.lastCheckedAt = new Date().toISOString();
    await update((s) => {
      const now = s.playgrounds[pg];
      // The playground may have been revised while the page was read (a build answers the agent before it ends, so a
      // revision can overlap it). A read that was made for other metrics, features or another page is dropped: the
      // revision reads the vendor itself, and its pending mark is its own.
      if (!now || readSig(now.domain, id) !== asked) return;
      now.sources[id] = { ...src, monitor: now.sources[id]?.monitor ?? src.monitor };
      arrived(now, id);
    });
  }
}

/** What an extraction depends on: the product, the guidance and the metrics and features it looks for. */
const extractionSig = (d: Domain) => JSON.stringify([d.product, d.notes ?? "", d.metrics.map((m) => [m.id, m.describe]), d.features.map((f) => [f.id, f.describe])]);
/** What one vendor's read depends on: the extraction and that vendor's page. Null when the vendor is gone. */
const readSig = (d: Domain, id: string): string | null => {
  const v = d.vendors.find((x) => x.id === id);
  return v ? `${extractionSig(d)}|${v.url ?? ""}|${v.domain}` : null;
};

/** One source of tracked work has arrived (read, or failed): it is no longer pending. */
const arrived = (p: Playground | undefined, id: string) => sourceArrived(p, id);

/**
 * Run web reads for some vendors of a playground as tracked work (store.ts, Work): the playground says which sources are
 * still pending while `run` runs, and how it ended. The mark is set before this returns its promise's first await ends, so
 * a caller that answers early leaves a playground that says "running". Never rejects: an error becomes the stop text.
 */
export async function tracked(pg: string, kind: Work["kind"], ids: string[], run: () => Promise<string | null>): Promise<string | null> {
  const id = randomUUID();
  let stop: string | null = null;
  try {
    await update((s) => {
      const p = s.playgrounds[pg];
      if (p) startWork(p, id, kind, ids);
    });
    stop = await run();
  } catch (e) {
    stop = message(e);
  }
  await update((s) => {
    endWork(s.playgrounds[pg], id, ids, stop);
  }).catch(() => {});
  return stop;
}

/** Wait until the web reads of a playground have ended (the tracked work of a price playground, the brand read of a preview), at most `ms`. Returns the playground as stored now. */
export async function settled(pg: string, ms: number, every = 1500): Promise<Playground | undefined> {
  const until = Date.now() + ms;
  for (;;) {
    const p = (await load()).playgrounds[pg];
    const reading = p && (workStatus(p)?.status === "running" || (p.kit && brandPending(p.kit)));
    if (!p || !reading || Date.now() + every > until) return p;
    await new Promise((r) => setTimeout(r, every));
  }
}

/** Collect every vendor of a playground in parallel, as tracked work. Returns the stop error (rate limit or quota) when one occurred. */
export async function collectAll(pg: string, origin: string, ids?: string[]): Promise<string | null> {
  const all = ids ?? (await playground(pg)).domain.vendors.map((v) => v.id);
  return tracked(pg, "build", all, async () => {
    const results = await Promise.allSettled(all.map((id) => collect(pg, id, origin)));
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    return failed ? message(failed.reason) : null;
  });
}

/**
 * Create a playground from a validated Domain and start collecting its sources. `work` is the running collection: it
 * resolves to the stop error or null. A caller with a short deadline (the MCP tools) answers before it ends and must
 * keep the function alive for it (after() in the route); a caller without one awaits it.
 */
export async function createPlayground(domain: Domain, origin: string): Promise<{ id: string; work: Promise<string | null> | null; existed?: boolean } | { refused: string }> {
  const r = await insertPlayground(domain, (d) => newPlayground(d));
  if ("refused" in r) return r;
  if (!r.existed) return { id: r.id, work: collectAll(r.id, origin) };
  // The caller already has exactly this playground (a repeated call after a lost answer or a failed build). Pages that
  // were read stay; pages that are missing and that nothing reads now (a build that failed, stopped or was cut off) are
  // read again, so a retry repairs instead of returning a broken playground.
  const p = await playground(r.id);
  const reading = new Set(workStatus(p)?.status === "running" ? p.work!.pending : []);
  const missing = p.domain.vendors.filter((v) => !p.sources[v.id]?.snapshot && !reading.has(v.id)).map((v) => v.id);
  return { id: r.id, work: missing.length ? collectAll(r.id, origin, missing) : null, existed: true };
}

// ---- Preview playgrounds (lib/kit.ts). The only web read is the brand of data.brand, once, at creation or when its domain changes.

async function readBrand(kit: Kit): Promise<Pick<KitState, "brandData" | "brandError">> {
  if (!kit.brand) return { brandData: null, brandError: null };
  try {
    return { brandData: await brand(kit.brand.domain), brandError: null };
  } catch (e) {
    return { brandData: null, brandError: message(e) };
  }
}

/**
 * Read the brand of a stored preview playground and store the result. The playground was stored with the brand marked
 * as pending since `since`; the result fills in only a kit that still waits for exactly this read (a later revision that
 * asked for another brand, or started its own read, keeps its own). Never rejects: a read that cannot store its result
 * leaves the mark, which counts as failed once it is older than a function can live (brandPending()).
 */
function readBrandLater(id: string, kit: Kit, since: string): Promise<void> {
  return readBrand(kit)
    .then((read) =>
      update((s) => {
        const k = s.playgrounds[id]?.kit;
        if (k && k.brandError === BRAND_PENDING && k.brandSince === since && k.kit.brand?.domain === kit.brand?.domain) Object.assign(k, read, { brandSince: null });
      }),
    )
    .then(() => {}, () => {});
}

/**
 * Create a preview playground from a validated kit. The preview stays "unverified" until the page has run it once.
 * The playground is stored (and the owner's allowance reserved) before the brand is read; `brand` is that read, and it
 * stores its result when it ends. A playground without data.brand is complete at once. `existed`: the caller already has
 * exactly this playground (a repeated call): nothing was created or read.
 */
export async function createPreview(domain: Domain, kit: Kit): Promise<{ id: string; brand: Promise<void> | null; web: Promise<string | null> | null; existed?: boolean } | { refused: string }> {
  const since = new Date().toISOString();
  const r = await insertPlayground(domain, (d) => ({ ...newPlayground(d), kit: { kit, rev: randomUUID(), brandData: null, brandError: kit.brand ? BRAND_PENDING : null, brandSince: kit.brand ? since : null, preview: { status: "unverified", error: null, at: null }, settled: null, exploration: null } }));
  if ("refused" in r) return r;
  // A repeated create reads only the web sources that are missing and that nothing reads now.
  const p = r.existed ? await playground(r.id) : null;
  const reading = new Set(p && workStatus(p)?.status === "running" ? p.work!.pending : []);
  const missing = (kit.web ?? []).filter((s) => !p || (!p.kit?.web?.[s.id]?.read && !reading.has(webWorkId(s.id)))).map((s) => s.id);
  return { id: r.id, brand: kit.brand && !r.existed ? readBrandLater(r.id, kit, since) : null, web: missing.length ? collectWeb(r.id, missing) : null, existed: r.existed };
}

// ---- data.web: live facts from web pages for a preview playground (lib/web.ts has the validation and the guard).

/** The id of a web source in the tracked work of its playground. */
const webWorkId = (id: string) => `web:${id}`;

/** One structured read of a page: the facts the source asks for, guarded against the page text of the same capture. */
async function extractWeb(src: WebSource, url: string): Promise<WebRead> {
  const r = await scrape(url, { schema: webSchema(src), instructions: webInstructions(src) });
  if (!r.json.success || !r.json.data) throw new Error(`Extraction failed: ${r.json.error_code ?? "unknown"} ${r.json.message ?? ""}`.trim());
  // Without the page text no number can be checked: that is a failed read, not a page full of unknown values.
  if (!r.markdown.success || !r.markdown.data) throw new Error("Page text not readable: the numbers could not be checked against the page.");
  const text = r.markdown.data;
  try {
    // The page text of the capture, kept locally so a quarantined number can be checked by hand (skipped on a read-only filesystem).
    mkdirSync(".data/pages", { recursive: true });
    writeFileSync(`.data/pages/web--${src.id}--${new URL(url).hostname}.md`, text);
  } catch {}
  return guard(src, r.json.data, text, { url, fetchedAt: new Date(Date.now() - (r.cache_metadata?.age_ms ?? 0)).toISOString(), truncated: r.json.isTruncated === true });
}

/** Read one web source: find its page (the spec's URL, else Search on its domain), then extract. An error is stored, not thrown, except a stop (rate limit, cap). */
async function readWeb(src: WebSource, was: WebState | undefined): Promise<{ state: WebState; stop: string | null }> {
  const state: WebState = { url: src.url ?? was?.url ?? null, foundVia: src.url ? "spec" : (was?.foundVia ?? null), read: was?.read ?? null, error: null, lastCheckedAt: null, changes: was?.changes ?? [] };
  let stop: string | null = null;
  try {
    // The top result on the site for what the source asks to find. (The price engine prefers pages named "pricing"; a web
    // source may ask for any page, so it takes the first result.)
    if (!state.url) Object.assign(state, { url: (await cd<{ results?: { url?: string }[] }>("POST", "/web/search", { query: src.find ?? src.id, numResults: 3, includeDomains: [src.domain!] })).results?.[0]?.url ?? null, foundVia: "context.dev search" });
    if (!state.url) throw new Error(`Search found no page on ${src.domain} for "${src.find}"`);
    state.read = await extractWeb(src, state.url);
  } catch (e) {
    state.error = message(e);
    if (e instanceof ContextDevError && e.stop) stop = state.error;
  }
  state.lastCheckedAt = new Date().toISOString();
  return { state, stop };
}

/** Store what was read for one source, unless a revision changed that source meanwhile, and take it off the pending list. */
const storeWeb = (pg: string, src: WebSource, state: WebState) =>
  update((s) => {
    const p = s.playgrounds[pg];
    const k = p?.kit;
    if (k && JSON.stringify(k.kit.web?.find((x) => x.id === src.id)) === JSON.stringify(src)) (k.web ??= {})[src.id] = state;
    sourceArrived(p, webWorkId(src.id));
  });

/** Read some web sources of a preview playground in parallel, as tracked work. Resolves to the stop error or null. */
export async function collectWeb(pg: string, ids: string[]): Promise<string | null> {
  return tracked(pg, "build", ids.map(webWorkId), async () => {
    const k = (await playground(pg)).kit;
    const stops = await Promise.all(
      (k?.kit.web ?? []).filter((s) => ids.includes(s.id)).map(async (src) => {
        const r = await readWeb(src, k?.web?.[src.id]);
        await storeWeb(pg, src, r.state);
        return r.stop;
      }),
    );
    return stops.find((x) => x) ?? null;
  });
}

/**
 * Re-check the web sources of a preview playground. Per source: read the page text and compare its fingerprint; only
 * when the text changed, extract again; a fact changes only when a second fresh extraction states the same thing
 * (confirmChanges). The changes are stored on the source and returned.
 */
export function recheckWeb(pg: string): Promise<{ changes: WebChange[]; stop: string | null }> {
  // Re-checks of one playground in this instance run one after the other: each starts from what the one before stored.
  const run = (webRechecks.get(pg) ?? Promise.resolve()).then(() => recheckWebOnce(pg));
  webRechecks.set(pg, run.then(() => {}, () => {}));
  return run;
}
const webRechecks = new Map<string, Promise<void>>();

async function recheckWebOnce(pg: string): Promise<{ changes: WebChange[]; stop: string | null }> {
  const k = (await playground(pg)).kit;
  const sources = k?.kit.web ?? [];
  const changes: WebChange[] = [];
  const stop = await tracked(pg, "recheck", sources.map((s) => webWorkId(s.id)), async () => {
    const stops = await Promise.all(
      sources.map(async (src) => {
        const was = k?.web?.[src.id];
        // A source that was never read is read now; nothing can have changed.
        if (!was?.read || !was.url) {
          const r = await readWeb(src, was);
          await storeWeb(pg, src, r.state);
          return r.stop;
        }
        const state: WebState = { ...was, error: null };
        let halted: string | null = null;
        try {
          const page = await scrape(was.url);
          if (!page.markdown.success || !page.markdown.data) throw new Error("Page text not readable: the page was not re-checked.");
          state.recheckedAt = new Date().toISOString();
          if (pageHash(page.markdown.data) !== was.read.textHash) {
            const first = await extractWeb(src, was.url);
            if (!diffWeb(src, was.read, first).length) state.read = first;
            else {
              const c = confirmChanges(src, was.read, first, await extractWeb(src, was.url));
              const at = new Date().toISOString();
              const found = c.changes.map((x) => ({ ...x, at, source: src.id }));
              changes.push(...found);
              state.read = c.read;
              state.changes = [...found, ...was.changes].slice(0, WEB_LIMITS.changes);
              if (c.unconfirmed) state.error = `Two reads of this page disagreed on ${c.unconfirmed} fact(s). They keep their earlier values, and the next re-check reads the page again.`;
            }
          }
        } catch (e) {
          state.error = message(e);
          state.recheckedAt = was.recheckedAt ?? null; // a re-read that failed is not a re-check
          if (e instanceof ContextDevError && e.stop) halted = state.error;
        }
        state.lastCheckedAt = new Date().toISOString();
        // Conditional write: when something else stored a newer read of this source meanwhile (another instance, a
        // revision), that result stands and this one is dropped, with the changes it found.
        const stored = await update((s) => {
          const p = s.playgrounds[pg];
          const cur = p?.kit?.web?.[src.id];
          const mine = !!cur && JSON.stringify(p!.kit!.kit.web?.find((x) => x.id === src.id)) === JSON.stringify(src) && cur.read?.fetchedAt === was.read!.fetchedAt && cur.read?.textHash === was.read!.textHash;
          if (mine) p!.kit!.web![src.id] = state;
          sourceArrived(p, webWorkId(src.id));
          return mine;
        });
        if (!stored) for (let i = changes.length - 1; i >= 0; i--) if (changes[i].source === src.id) changes.splice(i, 1);
        return halted;
      }),
    );
    return stops.find((x) => x) ?? null;
  });
  return { changes, stop };
}

/**
 * Replace the kit of a preview playground. When the preview code, the data or a control's values change, the preview is
 * unverified again, the settled result is cleared, and the exploration is kept for the controls whose definition did not
 * change. A new brand is read after the kit is stored: `brand` is that read (the tool answers within its deadline).
 */
export async function revisePreview(domain: Domain, kit: Kit): Promise<{ previewKept: boolean; outputsKept: boolean; settledCleared: boolean; brand: Promise<void> | null; web: Promise<string | null> | null }> {
  const since = new Date().toISOString();
  const r = await update((s) => {
    const p = s.playgrounds[domain.id];
    if (!p?.kit) throw new NotFound(`Playground "${domain.id}" does not exist.`);
    const same = (id: string) => JSON.stringify(p.kit!.kit.controls.find((c) => c.id === id)) === JSON.stringify(kit.controls.find((c) => c.id === id));
    const kept = Object.fromEntries(Object.entries(p.kit.exploration?.controls ?? {}).filter(([id]) => same(id)));
    // The brand that is stored is reused, and a read of the same brand that still runs is left to end. Another brand, or
    // one whose read failed, is read (again) after this update.
    const sameBrand = (p.kit.kit.brand?.domain ?? null) === (kit.brand?.domain ?? null);
    const waiting = sameBrand && brandPending(p.kit);
    const reread = !!kit.brand && !waiting && !(sameBrand && p.kit.brandData);
    const read = !kit.brand ? { brandData: null, brandError: null, brandSince: null } : waiting ? { brandData: null, brandError: BRAND_PENDING, brandSince: p.kit.brandSince } : reread ? { brandData: null, brandError: BRAND_PENDING, brandSince: since } : { brandData: p.kit.brandData, brandError: null, brandSince: null };
    // A revision of words only (title, notes, labels, meanings) runs the same code with the same values: the preview that
    // was verified stays verified. While the outputs also render the same text, the page that is open keeps working (same
    // rev) and the settled result stands. Changed outputs get a new rev: an open page shows the old output text, so its
    // settle must be refused until it is reloaded.
    // The brand's domain is part of the signature; whether its colours have arrived does not change how the preview runs.
    const previewKept = runSignature(p.kit.kit) === runSignature(kit);
    const outputsKept = previewKept && JSON.stringify(p.kit.kit.outputs.map((o) => [o.id, o.template])) === JSON.stringify(kit.outputs.map((o) => [o.id, o.template]));
    const settledCleared = !!p.kit.settled && !outputsKept;
    // A web source that did not change keeps what was read; a new or changed one is read after this update.
    const sameSource = (x: WebSource) => JSON.stringify(p.kit!.kit.web?.find((y) => y.id === x.id)) === JSON.stringify(x);
    const web = Object.fromEntries((kit.web ?? []).filter((x) => sameSource(x) && p.kit!.web?.[x.id]).map((x) => [x.id, p.kit!.web![x.id]]));
    // A source that the running build still reads (and that did not change) arrives by itself: it is not read twice.
    const arriving = new Set(workStatus(p)?.status === "running" ? p.work!.pending : []);
    const webToRead = (kit.web ?? []).filter((x) => !web[x.id]?.read && !(sameSource(x) && arriving.has(webWorkId(x.id)))).map((x) => x.id);
    p.domain = domain;
    p.kit = previewKept
      ? { ...p.kit, kit, ...read, web, rev: outputsKept ? p.kit.rev : randomUUID(), settled: outputsKept ? p.kit.settled : null }
      : { kit, rev: randomUUID(), ...read, web, preview: { status: "unverified", error: null, at: null }, settled: null, exploration: p.kit.exploration && Object.keys(kept).length ? { controls: kept, updatedAt: p.kit.exploration.updatedAt } : null };
    return { previewKept, outputsKept, settledCleared, reread, webToRead };
  });
  return { previewKept: r.previewKept, outputsKept: r.outputsKept, settledCleared: r.settledCleared, brand: r.reread ? readBrandLater(domain.id, kit, since) : null, web: r.webToRead.length ? collectWeb(domain.id, r.webToRead) : null };
}

/**
 * Replace the domain of a playground. Vendors that are gone lose their source. When the metrics, features or extraction
 * guidance changed, every page is extracted again; else only new vendors and vendors with a new page are collected.
 * The saved decision is kept only while its vendor and every control it names still exist.
 */
export async function revisePlayground(domain: Domain, origin: string): Promise<{ recollected: string[]; decisionCleared: boolean; work: Promise<string | null> | null }> {
  const sig = extractionSig;
  const plan = await update((s) => {
    const p = s.playgrounds[domain.id];
    if (!p) throw new NotFound(`Playground "${domain.id}" does not exist.`);
    const schemaChanged = sig(p.domain) !== sig(domain);
    const was = new Map(p.domain.vendors.map((v) => [v.id, v]));
    const moved = domain.vendors.filter((v) => !was.has(v.id) || was.get(v.id)!.url !== v.url || was.get(v.id)!.domain !== v.domain).map((v) => v.id);
    const dropped = Object.keys(p.sources).filter((id) => !domain.vendors.some((v) => v.id === id) || moved.includes(id));
    // A dropped source would leave its Context.dev monitor running with nothing that can stop it.
    if (dropped.some((id) => p.sources[id].monitor)) throw new Error("A webhook monitor watches a vendor that this change removes or moves. Stop the webhook monitors on the playground page first.");
    for (const id of dropped) delete p.sources[id];
    for (const v of domain.vendors) if (p.sources[v.id]) p.sources[v.id].name = v.name;
    const controls = new Set([...domain.metrics, ...domain.features].map((x) => x.id));
    const d = p.decision;
    const decisionCleared = !!d && !(domain.vendors.some((v) => v.id === d.chosen) && [...Object.keys(d.usage), ...d.required].every((k) => controls.has(k)));
    if (decisionCleared) p.decision = null;
    if (p.exploration) {
      // When this revision changes a range and the settled value falls outside it, that control starts again from its initial value.
      // A value the person typed beyond an unchanged range stays: the number field allows it.
      const stays = (k: string, x: number) => domain.metrics.some((m) => m.id === k && ((x >= m.min && x <= m.max) || p.domain.metrics.some((w) => w.id === k && w.min === m.min && w.max === m.max)));
      p.exploration.metrics = Object.fromEntries(Object.entries(p.exploration.metrics).filter(([k, x]) => stays(k, x.final)));
      if (!domain.vendors.some((v) => v.id === p.exploration!.selected)) p.exploration.selected = null;
      p.exploration.features = Object.fromEntries(Object.entries(p.exploration.features).filter(([k]) => controls.has(k)));
    }
    p.domain = domain;
    return { recollected: schemaChanged ? domain.vendors.map((v) => v.id) : moved, decisionCleared };
  });
  return { ...plan, work: plan.recollected.length ? collectAll(domain.id, origin, plan.recollected) : null };
}

/**
 * Re-check one source. Step 1 reads the page text and compares its hash (1 credit). Only when the text changed,
 * step 2 extracts again (5 credits), diffs the facts and judges the saved decision. Webhook, button and timer all end here.
 */
export function recheck(pg: string, id: string, trigger: ChangeEvent["trigger"], origin: string): Promise<ChangeEvent | null> {
  const key = `${pg}/${id}`;
  const run = (inFlight.get(key) ?? Promise.resolve()).then(() => recheckOnce(pg, id, trigger, origin));
  inFlight.set(key, run.catch(() => {}));
  return run;
}
// Per playground and source: the tail of its re-check chain, so re-checks of one source in this instance run in turn.
// lean: there is no lock across function instances. Two instances that re-check the same source at the same time both read
// the page (double spend of requests), and the conditional write in recheckOnce keeps only one of the two results, so a
// change gives one event. Add a lease in the store if concurrent triggers become common.
const inFlight = new Map<string, Promise<unknown>>();

async function recheckOnce(pg: string, id: string, trigger: ChangeEvent["trigger"], origin: string): Promise<ChangeEvent | null> {
  const before = await playground(pg);
  const src = before.sources[id];
  if (!src?.url || !src.snapshot) {
    await collect(pg, id, origin);
    return null;
  }
  let event: ChangeEvent | null = null;
  let snapshot = src.snapshot;
  let error: string | null = null;
  let unconfirmed = 0;
  /** Shown on the source like an error, until a re-check settles it. */
  let note: string | null = null;
  try {
    if (hash(await readText(src, origin)) !== src.snapshot.textHash) {
      const first = await readModel(before.domain, src, origin);
      let next = first;
      if (first.extractor === "context.dev" && diffModels(src.snapshot.model, first.model).length) {
        // Extraction is not deterministic. A fact of a real source changes only when a second fresh extraction states the same thing.
        // Nothing of the first read is stored before the second one is back: when it fails, the facts stay as they were.
        const second = await readModel(before.domain, src, origin);
        const { model, kept } = confirmed(src.snapshot.model, first.model, second.model);
        const was = src.snapshot;
        // Parts kept from the old model keep their old evidence mark and quarantine entries; the rest comes from the second read.
        const evidence = { ...second.evidence };
        for (const k of kept) {
          if (k.evidence in was.evidence) evidence[k.evidence] = was.evidence[k.evidence];
          else delete evidence[k.evidence];
        }
        const ofKept = (q: { path: string }) => kept.some((k) => q.path.startsWith(k.prefix));
        const quarantined = [...second.quarantined.filter((q) => !ofKept(q)), ...was.quarantined.filter(ofKept)];
        unconfirmed = kept.length;
        // While the reads disagree on a part, the old page hash stays, so the next re-check reads the page again.
        next = { ...second, model, evidence, quarantined, textHash: unconfirmed ? was.textHash : second.textHash };
        if (unconfirmed) note = `Two reads of this page disagreed on ${unconfirmed} ${unconfirmed === 1 ? "part" : "parts"} of the pricing. ${unconfirmed === 1 ? "It keeps its" : "They keep their"} earlier values, and the next re-check reads the page again.`;
      }
      const changes = diffModels(src.snapshot.model, next.model);
      snapshot = next;
      if (changes.length) {
        const models = (s: typeof before, own: PricingModel) => Object.fromEntries(Object.entries(s.sources).map(([k, x]) => [k, k === id ? own : (x.snapshot?.model ?? null)]));
        event = {
          id: randomUUID(),
          at: new Date().toISOString(),
          sourceId: id,
          trigger,
          changes,
          ...(unconfirmed ? { unconfirmed } : {}),
          verdict: before.decision ? verdict(before.decision, models(before, src.snapshot.model), models(before, snapshot.model)) : null,
        };
      }
    }
  } catch (e) {
    error = message(e);
    if (e instanceof ContextDevError && e.stop) throw e;
  } finally {
    await update((s) => {
      const p = s.playgrounds[pg];
      arrived(p, id);
      if (!p?.sources[id]) return; // revised or removed while the page was read
      // Conditional write: another re-check stored a newer read of this source while this one ran. Its result stands.
      const cur = p.sources[id].snapshot;
      if (cur?.textHash !== src.snapshot!.textHash || cur?.fetchedAt !== src.snapshot!.fetchedAt) return void (event = null);
      // The demo page lives on this app's origin, which changes with the port.
      // A read that gives no price keeps its explanation (collect(): what was tried and why) until a read gives one.
      Object.assign(p.sources[id], { snapshot: src.demo ? { ...snapshot, url: demoUrl(origin) } : snapshot, error: error ?? note ?? (hasPrices(snapshot.model) ? null : p.sources[id].error), lastCheckedAt: new Date().toISOString(), ...(src.demo ? { url: demoUrl(origin) } : {}) });
      if (event) p.events = [event, ...p.events].slice(0, 30);
    });
  }
  return event;
}

/** Re-check every source of a playground as tracked work. Resolves to the per-source results, in the order of `ids`. */
export async function recheckAll(pg: string, ids: string[], trigger: ChangeEvent["trigger"], origin: string): Promise<PromiseSettledResult<ChangeEvent | null>[]> {
  let results: PromiseSettledResult<ChangeEvent | null>[] = [];
  await tracked(pg, "recheck", ids, async () => {
    results = await Promise.allSettled(ids.map((id) => recheck(pg, id, trigger, origin)));
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    return failed ? message(failed.reason) : null;
  });
  return results;
}

/** The origin for URLs the app emits: the public base URL of a deployment, else the origin of the request (localhost). */
export const originOf = (req: Request) => publicBase() ?? new URL(req.url).origin;
