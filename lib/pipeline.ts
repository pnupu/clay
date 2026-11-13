// Collect and re-check. Live sources and the demo source share every step except how the page is read.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { extractionInstructions, extractionSchema, normalise, type Domain, type PricingModel, type RawModel } from "./domain";
import { ContextDevError, scrape, searchTopUrl } from "./contextdev";
import { confirmed, diffModels, verdict } from "./diff";
import { load, newPlayground, update, type ChangeEvent, type Playground, type Snapshot, type Source } from "./store";

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
const playground = (pg: string): Playground => {
  const p = load().playgrounds[pg];
  if (!p) throw new NotFound(`Playground "${pg}" does not exist.`);
  return p;
};

/** Collect one vendor of one playground: find its pricing page (the config's URL, else Search), then extract it. */
export async function collect(pg: string, id: string, origin: string): Promise<void> {
  const p = playground(pg);
  const v = p.domain.vendors.find((x) => x.id === id);
  if (!v) throw new NotFound(`Playground "${pg}" has no vendor "${id}".`);
  const prev = p.sources[id];
  const src: Source = prev ?? { id, name: v.name, demo: !!v.demo, url: null, foundVia: null, snapshot: null, lastCheckedAt: null, error: null, monitor: null };
  src.name = v.name;
  try {
    if (v.demo) Object.assign(src, { url: demoUrl(origin), foundVia: "app route" });
    else if (v.url) Object.assign(src, { url: v.url, foundVia: "playground config" });
    else if (!src.url) Object.assign(src, { url: (await searchTopUrl(`${v.name} pricing`, v.domain)).url, foundVia: "context.dev search" });
    if (!src.url) throw new Error(`Search found no page on ${v.domain}`);
    src.snapshot = await readModel(p.domain, src, origin);
    src.error = null;
  } catch (e) {
    src.error = message(e);
    if (e instanceof ContextDevError && e.stop) throw e;
  } finally {
    src.lastCheckedAt = new Date().toISOString();
    await update((s) => {
      const now = s.playgrounds[pg];
      // The playground may have been revised while the page was read: only store a vendor that is still part of it.
      if (now?.domain.vendors.some((x) => x.id === id)) now.sources[id] = { ...src, monitor: now.sources[id]?.monitor ?? src.monitor };
    });
  }
}

/** Collect every vendor of a playground in parallel. Returns the stop error (rate limit or quota) when one occurred. */
export async function collectAll(pg: string, origin: string, ids?: string[]): Promise<string | null> {
  const results = await Promise.allSettled((ids ?? playground(pg).domain.vendors.map((v) => v.id)).map((id) => collect(pg, id, origin)));
  const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  return failed ? message(failed.reason) : null;
}

/** Create a playground from a validated Domain and collect its sources. */
export async function createPlayground(domain: Domain, origin: string): Promise<{ created: boolean; error: string | null }> {
  const created = await update((s) => {
    if (s.playgrounds[domain.id]) return false;
    s.playgrounds[domain.id] = newPlayground(domain);
    return true;
  });
  return created ? { created, error: await collectAll(domain.id, origin) } : { created, error: null };
}

/**
 * Replace the domain of a playground. Vendors that are gone lose their source. When the metrics, features or extraction
 * guidance changed, every page is extracted again; else only new vendors and vendors with a new page are collected.
 * The saved decision is kept only while its vendor and every control it names still exist.
 */
export async function revisePlayground(domain: Domain, origin: string): Promise<{ recollected: string[]; decisionCleared: boolean; error: string | null }> {
  const sig = (d: Domain) => JSON.stringify([d.product, d.notes ?? "", d.metrics.map((m) => [m.id, m.describe]), d.features.map((f) => [f.id, f.describe])]);
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
  return { ...plan, error: plan.recollected.length ? await collectAll(domain.id, origin, plan.recollected) : null };
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
/** Per playground and source: the tail of its re-check chain. In-process only, like the store queue. */
const inFlight = new Map<string, Promise<unknown>>();

async function recheckOnce(pg: string, id: string, trigger: ChangeEvent["trigger"], origin: string): Promise<ChangeEvent | null> {
  const before = playground(pg);
  const src = before.sources[id];
  if (!src?.url || !src.snapshot) {
    await collect(pg, id, origin);
    return null;
  }
  let event: ChangeEvent | null = null;
  let snapshot = src.snapshot;
  let error: string | null = null;
  let unconfirmed = 0;
  try {
    if (hash(await readText(src, origin)) !== src.snapshot.textHash) {
      const first = await readModel(before.domain, src, origin);
      let next = first;
      if (first.extractor === "context.dev" && diffModels(src.snapshot.model, first.model).length) {
        // Extraction is not deterministic. A fact of a real source changes only when a second fresh extraction states the same thing.
        // Nothing of the first read is stored before the second one is back: when it fails, the facts stay as they were.
        const second = await readModel(before.domain, src, origin);
        const { model, kept } = confirmed(src.snapshot.model, first.model, second.model);
        const old = src.snapshot.evidence;
        next = { ...second, model, evidence: { ...second.evidence, ...Object.fromEntries(kept.filter((k) => k in old).map((k) => [k, old[k]])) } };
        const paths = new Set([...diffModels(src.snapshot.model, first.model), ...diffModels(src.snapshot.model, second.model)].map((c) => c.path));
        unconfirmed = [...paths].filter((p) => !diffModels(src.snapshot!.model, model).some((c) => c.path === p)).length;
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
      if (!p?.sources[id]) return; // revised or removed while the page was read
      // The demo page lives on this app's origin, which changes with the port.
      Object.assign(p.sources[id], { snapshot: src.demo ? { ...snapshot, url: demoUrl(origin) } : snapshot, error, lastCheckedAt: new Date().toISOString(), ...(src.demo ? { url: demoUrl(origin) } : {}) });
      if (event) p.events = [event, ...p.events].slice(0, 30);
    });
  }
  return event;
}

export const originOf = (req: Request) => new URL(req.url).origin;
