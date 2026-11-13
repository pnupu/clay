// lean: local persistence is one JSON file in .data/. Vercel's filesystem is read-only and not shared between
// function instances, so a deployment needs a real store behind these two functions (Vercel KV / Upstash Redis
// or Postgres such as Neon). The webhook secrets in `monitor.secret` must then live in that server-side store too.
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
};

const FILE = ".data/store.json";
export const newPlayground = (domain: Domain): Playground => ({ domain, createdAt: new Date().toISOString(), sources: {}, decision: null, events: [], exploration: null });

export function load(): Store {
  let raw: Partial<Store> & Partial<Pick<Playground, "sources" | "decision" | "events">> = {};
  try {
    raw = JSON.parse(readFileSync(FILE, "utf8"));
  } catch {}
  // No prototype: an id such as "__proto__" or "constructor" from a URL must not look like a playground.
  const s: Store = { playgrounds: Object.assign(Object.create(null), raw.playgrounds), webhookEventIds: raw.webhookEventIds ?? [], demoPage: raw.demoPage ?? null };
  // The auth-provider playground is the seed: it always exists and its domain comes from the code.
  // A store written before playgrounds existed has its sources at the top level; they belong to the seed.
  const seed = (s.playgrounds[DOMAIN.id] ??= { ...newPlayground(DOMAIN), sources: raw.sources ?? {}, decision: raw.decision ?? null, events: raw.events ?? [] });
  seed.domain = DOMAIN;
  return s;
}

let queue: Promise<unknown> = Promise.resolve();
/** Serialised read-modify-write, so parallel requests in this process do not overwrite each other. */
export function update<T>(fn: (s: Store) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const s = load();
    const out = await fn(s);
    mkdirSync(".data", { recursive: true });
    writeFileSync(FILE + ".tmp", JSON.stringify(s, null, 1));
    renameSync(FILE + ".tmp", FILE);
    return out;
  });
  queue = run.catch(() => {});
  return run;
}

/** State of one playground for the browser: no webhook secrets. */
export function publicState(s: Store, id: string) {
  const p = s.playgrounds[id];
  const sources = Object.fromEntries(Object.entries(p.sources).map(([k, src]) => [k, { ...src, monitor: src.monitor ? { id: src.monitor.id, webhookUrl: src.monitor.webhookUrl } : null }]));
  return { id, sources, decision: p.decision, events: p.events, demoPage: s.demoPage, publicBaseUrl: process.env.PUBLIC_BASE_URL ?? null };
}
export type PublicState = ReturnType<typeof publicState>;
