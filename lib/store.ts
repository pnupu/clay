// lean: local persistence is one JSON file in .data/. Vercel's filesystem is read-only and not shared between
// function instances, so a deployment needs a real store behind these two functions (Vercel KV / Upstash Redis
// or Postgres such as Neon). The webhook secrets in `monitor.secret` must then live in that server-side store too.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { PricingModel } from "./domain";
import type { Decision, FieldChange, Verdict } from "./diff";

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
  foundVia: "context.dev search" | "app route" | null;
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
  verdict: Verdict | null;
};

export type Store = {
  sources: Record<string, Source>;
  decision: Decision | null;
  events: ChangeEvent[];
  /** Webhook event ids already handled (deduplication on X-Context-Id). */
  webhookEventIds: string[];
  /** The editable content of the demo vendor's pricing page. */
  demoPage: PricingModel | null;
};

const FILE = ".data/store.json";
const empty = (): Store => ({ sources: {}, decision: null, events: [], webhookEventIds: [], demoPage: null });

export function load(): Store {
  try {
    return { ...empty(), ...JSON.parse(readFileSync(FILE, "utf8")) };
  } catch {
    return empty();
  }
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

/** State for the browser: no webhook secrets. */
export function publicState(s: Store) {
  const sources = Object.fromEntries(Object.entries(s.sources).map(([id, src]) => [id, { ...src, monitor: src.monitor ? { id: src.monitor.id, webhookUrl: src.monitor.webhookUrl } : null }]));
  return { sources, decision: s.decision, events: s.events, demoPage: s.demoPage, publicBaseUrl: process.env.PUBLIC_BASE_URL ?? null };
}
export type PublicState = ReturnType<typeof publicState>;
