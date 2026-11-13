// Persistence is one JSON document behind load() and update(). Local development keeps it in .data/store.json.
// On Vercel (BLOB_STORE_ID is set by the connected private Blob store) it is one private blob: reads bypass the CDN cache,
// and every write is conditional on the ETag that was read, so a concurrent writer never loses an update.
// The webhook secrets in `monitor.secret` live only in this server-side document.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { DOMAIN, type Domain, type PricingModel } from "./domain.ts";
import type { Decision, FieldChange, Verdict } from "./diff.ts";

export type Snapshot = {
  url: string;
  /** When the page content was captured (request time minus cache age). */
  fetchedAt: string;
  extractor: "context.dev" | "local-demo-parser";
  model: PricingModel;
  textHash: string;
  /** Per fact: was its quote or its numbers found in the page text of the same capture? Keys: "<plan>/base", "<plan>/meter/<id>", "<plan>/feature/<id>". */
  evidence: Record<string, boolean>;
  /** Numbers the extraction returned that are not in the page text. They are set to null in `model` and never used. */
  quarantined: { path: string; value: number }[];
  truncated: boolean;
  latencyMs: number;
  requestId: string | null;
};

export type Source = {
  id: string;
  name: string;
  demo: boolean;
  url: string | null;
  foundVia: "context.dev search" | "app route" | "playground config" | null;
  snapshot: Snapshot | null;
  lastCheckedAt: string | null;
  error: string | null;
  monitor: { id: string; secret: string; webhookUrl: string } | null;
};

export type ChangeEvent = {
  id: string;
  at: string;
  sourceId: string;
  trigger: "manual" | "webhook" | "auto";
  changes: FieldChange[];
  /** Differences that only one of the two confirming extractions reported. They are not counted as changes. */
  unconfirmed?: number;
  verdict: Verdict | null;
};

/** What the person tried, per control. "Tried 100 to 300, settled on 200" tells the agent more than "200". */
export type Exploration = {
  metrics: Record<string, { start: number; min: number; max: number; final: number }>;
  features: Record<string, { final: boolean; toggles: number }>;
  /** The vendor selected in the ranking now (not the saved decision). */
  selected: string | null;
  updatedAt: string;
};

export type Playground = {
  domain: Domain;
  createdAt: string;
  sources: Record<string, Source>;
  decision: Decision | null;
  events: ChangeEvent[];
  exploration: Exploration | null;
};

export type Store = {
  playgrounds: Record<string, Playground>;
  /** Webhook event ids already handled (deduplication on X-Context-Id). */
  webhookEventIds: string[];
  /** The editable content of the demo vendor's pricing page. */
  demoPage: PricingModel | null;
  /** Context.dev requests sent on one UTC day (the daily cap). */
  budget: Budget | null;
};

export type Budget = { day: string; used: number };
/** Count one Context.dev request against the daily cap. Returns the new budget, or null when the cap of that UTC day is reached. */
export function spend(b: Budget | null, day: string, cap: number): Budget | null {
  const used = b?.day === day ? b.used : 0;
  return used >= cap ? null : { day, used: used + 1 };
}

/** The public https origin of this deployment, or null on localhost. Vercel sets VERCEL_PROJECT_PRODUCTION_URL (a host name). */
export const publicBase = (): string | null => process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);

const FILE = ".data/store.json";
const BLOB = "clay/store.json";
const onBlob = () => !!process.env.BLOB_STORE_ID || !!process.env.BLOB_READ_WRITE_TOKEN;
export const newPlayground = (domain: Domain): Playground => ({ domain, createdAt: new Date().toISOString(), sources: {}, decision: null, events: [], exploration: null });

function parse(text: string | null): Store {
  let raw: Partial<Store> & Partial<Pick<Playground, "sources" | "decision" | "events">> = {};
  try {
    raw = JSON.parse(text ?? "");
  } catch {}
  // No prototype: an id such as "__proto__" or "constructor" from a URL must not look like a playground.
  const s: Store = { playgrounds: Object.assign(Object.create(null), raw.playgrounds), webhookEventIds: raw.webhookEventIds ?? [], demoPage: raw.demoPage ?? null, budget: raw.budget ?? null };
  // The auth-provider playground is the seed: it always exists and its domain comes from the code.
  // A store written before playgrounds existed has its sources at the top level; they belong to the seed.
  const seed = (s.playgrounds[DOMAIN.id] ??= { ...newPlayground(DOMAIN), sources: raw.sources ?? {}, decision: raw.decision ?? null, events: raw.events ?? [] });
  seed.domain = DOMAIN;
  return s;
}

/** The stored text and its version (the blob's ETag; null for the local file or when nothing is stored yet). */
async function read(): Promise<{ text: string | null; etag: string | null }> {
  if (!onBlob()) {
    try {
      return { text: readFileSync(FILE, "utf8"), etag: null };
    } catch {
      return { text: null, etag: null };
    }
  }
  const { get } = await import("@vercel/blob");
  const r = await get(BLOB, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return { text: null, etag: null };
  return { text: await new Response(r.stream).text(), etag: r.blob.etag };
}

export const load = async (): Promise<Store> => parse((await read()).text);

let queue: Promise<unknown> = Promise.resolve();
/**
 * Read-modify-write. Calls of one process run one after the other. On Vercel the write is conditional on the version that
 * was read; when another instance wrote in between, the store is read again and `fn` runs again, so `fn` must only depend
 * on the store it is given.
 */
export function update<T>(fn: (s: Store) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    if (!onBlob()) {
      const s = parse((await read()).text);
      const out = await fn(s);
      mkdirSync(".data", { recursive: true });
      writeFileSync(FILE + ".tmp", JSON.stringify(s, null, 1));
      renameSync(FILE + ".tmp", FILE);
      return out;
    }
    const { put, BlobPreconditionFailedError } = await import("@vercel/blob");
    for (let attempt = 0; ; attempt++) {
      const { text, etag } = await read();
      const s = parse(text);
      const out = await fn(s);
      try {
        // With an ETag: write only if nobody wrote since the read. Without one: create only (an existing blob is an error).
        await put(BLOB, JSON.stringify(s), { access: "private", contentType: "application/json", addRandomSuffix: false, ...(etag ? { ifMatch: etag } : { allowOverwrite: false }) });
        return out;
      } catch (e) {
        const lost = e instanceof BlobPreconditionFailedError || (!etag && /already exists/i.test(String((e as Error)?.message)));
        if (!lost || attempt >= 12) throw e;
        await new Promise((r) => setTimeout(r, 40 + Math.random() * 60 * (attempt + 1)));
      }
    }
  });
  queue = run.catch(() => {});
  return run;
}

/** State of one playground for the browser: no webhook secrets. */
export function publicState(s: Store, id: string, owner = true) {
  const p = s.playgrounds[id];
  const sources = Object.fromEntries(Object.entries(p.sources).map(([k, src]) => [k, { ...src, monitor: src.monitor ? { id: src.monitor.id, webhookUrl: src.monitor.webhookUrl } : null }]));
  return { id, sources, decision: p.decision, events: p.events, demoPage: s.demoPage, publicBaseUrl: publicBase(), owner };
}
export type PublicState = ReturnType<typeof publicState>;
