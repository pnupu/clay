// Collect and re-check. Live sources and the demo source share every step except how the page is read.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { DOMAIN, EXTRACTION_INSTRUCTIONS, extractionSchema, normalise, type PricingModel, type RawModel } from "./domain";
import { ContextDevError, scrape, searchTopUrl } from "./contextdev";
import { agreed, diffModels, verdict } from "./diff";
import { load, update, type ChangeEvent, type Snapshot, type Source } from "./store";

export const DEMO_PATH = "/demo-vendor/pricing";
const hash = (text: string) => createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");

/** Context.dev cannot reach localhost. Without PUBLIC_BASE_URL the demo page is read by the app itself. */
const demoIsLocal = () => !process.env.PUBLIC_BASE_URL;
const demoUrl = (origin: string) => (process.env.PUBLIC_BASE_URL ?? origin) + DEMO_PATH;

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
async function readModel(src: Source, origin: string): Promise<Snapshot> {
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
  const r = await scrape(src.url!, { schema: extractionSchema(DOMAIN), instructions: EXTRACTION_INSTRUCTIONS });
  // HTTP 200 does not mean every output succeeded: check each one.
  if (!r.json.success || !r.json.data) throw new Error(`Extraction failed: ${r.json.error_code ?? "unknown"} ${r.json.message ?? ""}`);
  const text = r.markdown.success && r.markdown.data ? r.markdown.data : "";
  const model = normalise(r.json.data as RawModel);
  try {
    mkdirSync(".data/pages", { recursive: true });
    writeFileSync(`.data/pages/${src.id}.md`, text);
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

/** First collection of one vendor: find its pricing page with Search, then extract it. */
export async function collect(id: string, origin: string): Promise<void> {
  const v = DOMAIN.vendors.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown vendor ${id}`);
  const prev = load().sources[id];
  const src: Source = prev ?? { id, name: v.name, demo: !!v.demo, url: null, foundVia: null, snapshot: null, lastCheckedAt: null, error: null, monitor: null };
  try {
    if (v.demo) Object.assign(src, { url: demoUrl(origin), foundVia: "app route" });
    else if (!src.url) Object.assign(src, { url: (await searchTopUrl(DOMAIN.searchQuery(v), v.domain)).url, foundVia: "context.dev search" });
    if (!src.url) throw new Error(`Search found no page on ${v.domain}`);
    src.snapshot = await readModel(src, origin);
    src.error = null;
  } catch (e) {
    src.error = message(e);
    if (e instanceof ContextDevError && e.stop) throw e;
  } finally {
    src.lastCheckedAt = new Date().toISOString();
    await update((s) => void (s.sources[id] = { ...src, monitor: s.sources[id]?.monitor ?? src.monitor }));
  }
}

/**
 * Re-check one source. Step 1 reads the page text and compares its hash (1 credit). Only when the text changed,
 * step 2 extracts again (5 credits), diffs the facts and judges the saved decision. Webhook, button and timer all end here.
 */
export function recheck(id: string, trigger: ChangeEvent["trigger"], origin: string): Promise<ChangeEvent | null> {
  const run = (inFlight.get(id) ?? Promise.resolve()).then(() => recheckOnce(id, trigger, origin));
  inFlight.set(id, run.catch(() => {}));
  return run;
}
/** Per source: the tail of its re-check chain. In-process only, like the store queue. */
const inFlight = new Map<string, Promise<unknown>>();

async function recheckOnce(id: string, trigger: ChangeEvent["trigger"], origin: string): Promise<ChangeEvent | null> {
  const before = load();
  const src = before.sources[id];
  if (!src?.url || !src.snapshot) {
    await collect(id, origin);
    return null;
  }
  let event: ChangeEvent | null = null;
  let snapshot = src.snapshot;
  let error: string | null = null;
  let unconfirmed = 0;
  try {
    if (hash(await readText(src, origin)) !== src.snapshot.textHash) {
      const first = await readModel(src, origin);
      let changes = diffModels(src.snapshot.model, first.model);
      snapshot = first;
      if (changes.length && first.extractor === "context.dev") {
        // Extraction is not deterministic. A change on a real source counts only when a second fresh extraction reports it too.
        const second = await readModel(src, origin);
        const again = diffModels(src.snapshot.model, second.model);
        const both = agreed(changes, again);
        unconfirmed = changes.length + again.length - 2 * both.length;
        // Nothing confirmed: keep the facts as they were and remember the new page text, so the same text is not extracted again.
        snapshot = both.length === 0 ? { ...src.snapshot, textHash: second.textHash } : again.length <= changes.length ? second : first;
        changes = both;
      }
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
      // The demo page lives on this app's origin, which changes with the port.
      Object.assign(s.sources[id], { snapshot: src.demo ? { ...snapshot, url: demoUrl(origin) } : snapshot, error, lastCheckedAt: new Date().toISOString(), ...(src.demo ? { url: demoUrl(origin) } : {}) });
      if (event) s.events = [event, ...s.events].slice(0, 30);
    });
  }
  return event;
}

export const originOf = (req: Request) => new URL(req.url).origin;
