// Persistence is one JSON document behind load() and update(). Local development keeps it in .data/store.json.
// On Vercel (BLOB_STORE_ID is set by the connected private Blob store) it is one private blob: reads bypass the CDN cache,
// and every write is conditional on the ETag that was read, so a concurrent writer never loses an update.
// The webhook secrets in `monitor.secret` live only in this server-side document.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { DOMAIN, type Domain, type PricingModel } from "./domain.ts";
import type { Decision, FieldChange, Verdict } from "./diff.ts";
import type { KitState } from "./kit.ts";
import { boundStorage, currentUserId, isExample, keepPublished, StorageRefused, playgroundCapMessage, type Account, type Discarded, deploymentCapMessage } from "./accounts.ts";

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
  foundVia: "context.dev search" | "site /pricing page" | "app route" | "playground config" | null;
  snapshot: Snapshot | null;
  lastCheckedAt: string | null;
  error: string | null;
  /** When the page of the last successful read was captured, an unchanged page included. lastCheckedAt is the time of the attempt; a cached answer is older than it. */
  readAt?: string | null;
  /** The last read succeeded and the page states no price: `error` is then the explanation of that, not a failed read (fullRead() in lib/record.ts). */
  unpriced?: boolean;
  /** Since when the page has been read without a price. Kept over a failed read; cleared when a read finds a price. */
  unpricedSince?: string | null;
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

/**
 * Web reads in progress for a price playground: a first build, a revision or a re-check. The call that started them
 * answers before they end (an agent's client cuts a tool call at about 60 s), and the sources fill in while this stands.
 */
export type Work = { id: string; kind: "build" | "recheck"; startedAt: string; pending: string[]; finishedAt: string | null; stop: string | null };
/** A function instance lives at most 300 s (maxDuration). Work that is older and not finished was cut off. */
const WORK_STALE_MS = 330_000;
/** Where the web reads of a playground stand: running, stalled (cut off before the end), done, or null when none were tracked. */
export function workStatus(p: Pick<Playground, "work">, now = Date.now()) {
  const w = p.work;
  if (!w) return null;
  const status = w.finishedAt ? ("done" as const) : now - Date.parse(w.startedAt) > WORK_STALE_MS ? ("stalled" as const) : ("running" as const);
  return { status, kind: w.kind, startedAt: w.startedAt, pending: w.finishedAt ? [] : w.pending, stop: w.stop };
}

/**
 * Start tracked work on some sources. Work that still runs on the playground (a build that a revision overlaps) keeps
 * its sources in the pending list: they are still being read, and the report must not call them "not read".
 */
export function startWork(p: Pick<Playground, "work">, id: string, kind: Work["kind"], ids: string[], now = Date.now()): void {
  const carried = workStatus(p, now)?.status === "running" ? p.work!.pending.filter((x) => !ids.includes(x)) : [];
  p.work = { id, kind, startedAt: new Date(now).toISOString(), pending: [...ids, ...carried], finishedAt: null, stop: null };
}
/** One source has arrived (read, or failed). The work has ended when none is pending. */
export function sourceArrived(p: Pick<Playground, "work"> | undefined, source: string, now = Date.now()): void {
  const w = p?.work;
  if (!w || w.finishedAt) return;
  w.pending = w.pending.filter((x) => x !== source);
  if (!w.pending.length) w.finishedAt = new Date(now).toISOString();
}
/** The run that started the work `id` has ended: its own sources are no longer pending, whatever became of them. */
export function endWork(p: Pick<Playground, "work"> | undefined, id: string, ids: string[], stop: string | null, now = Date.now()): void {
  const w = p?.work;
  if (!w || w.id !== id) return; // newer work on the same playground keeps its own mark
  w.pending = w.pending.filter((x) => !ids.includes(x));
  w.stop = stop ?? w.stop;
  if (!w.pending.length) w.finishedAt ??= new Date(now).toISOString();
}

export type Playground = {
  domain: Domain;
  createdAt: string;
  sources: Record<string, Source>;
  decision: Decision | null;
  events: ChangeEvent[];
  exploration: Exploration | null;
  /** The web reads that last ran, or that run now (workStatus()). */
  work?: Work | null;
  /** A preview playground (lib/kit.ts): controls, a sandboxed preview and outputs. Its `domain` holds only the id and the title. */
  kit?: KitState;
  /** The Clerk user id of the person whose agent created it. Missing: the admin's (lib/accounts.ts). */
  owner?: string | null;
  /** Marked by the admin as an example: anyone may open and use it without signing in. Missing: only the seed is one. */
  example?: boolean;
  /** The one example that the landing page embeds under "Try it here" (lib/accounts.ts, markExample). At most one playground has it. */
  featured?: boolean;
  /** When a revision by its owner cleared the example mark (lib/accounts.ts, unpublishOnRevision); gone when marked again. */
  exampleCleared?: string | null;
  /** What the agent left out of this playground and why, as it said (spec left_out). Text from the agent: shown as text. */
  leftOut?: { name: string; reason: string; at: string }[];
  /** Writes that arrived on this playground while it was a published example and were discarded (accounts.ts, keepPublished). Owner only. */
  discardedWrites?: Discarded[];
  /** Results of a webhook monitor's re-check that the owner's storage bounds kept out (accounts.ts, boundOwners). Owner only. */
  storageKept?: { at: string }[];
};

export type Store = {
  playgrounds: Record<string, Playground>;
  /** Webhook event ids already handled (deduplication on X-Context-Id). */
  webhookEventIds: string[];
  /** The editable content of the demo vendor's pricing page. */
  demoPage: PricingModel | null;
  /** Context.dev requests sent on one UTC day (the daily cap). */
  budget: Budget | null;
  /** A random value per write of the blob store, so a writer can tell its own write from an equal one of another instance. */
  rev: string | null;
  /** Per Clerk user id: the agent key hash and the request count of the day (lib/accounts.ts). */
  users: Record<string, Account>;
};

export type Budget = { day: string; used: number };
/** The daily cap from CONTEXT_DEV_DAILY_CAP. Only an explicit 0 turns it off; a missing, empty or malformed value gives the default, so a typo cannot switch the cap off. */
export function dailyCap(raw: string | undefined, fallback = 300): number {
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
/** Count one Context.dev request (`units` of it) against the daily cap. Returns the new budget, or null when it would go over the cap of that UTC day. */
export function spend(b: Budget | null, day: string, cap: number, units = 1): Budget | null {
  // Work that started before midnight on a slow instance must not replace the newer day's counter: it counts on that day.
  // Only a day just ahead (another instance passed midnight a moment earlier); a stored day further ahead is a wrong
  // clock, not a reason to pile today's requests onto a future day.
  const on = b && b.day > day && Date.parse(b.day) - Date.parse(day) <= 86_400_000 ? b.day : day;
  const used = b?.day === on ? b.used : 0;
  return used + units > cap ? null : { day: on, used: used + units };
}

/** The public https origin of this deployment, or null on localhost. Vercel sets VERCEL_PROJECT_PRODUCTION_URL (a host name). */
export const publicBase = (): string | null => process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);

const FILE = ".data/store.json";
const BLOB = "clay/store.json";
const onBlob = () => !!process.env.BLOB_STORE_ID || !!process.env.BLOB_READ_WRITE_TOKEN;
/** A new playground belongs to the signed-in person of the current request; the admin's has no owner. */
export const newPlayground = (domain: Domain): Playground => ({ domain, createdAt: new Date().toISOString(), sources: {}, decision: null, events: [], exploration: null, ...(currentUserId() ? { owner: currentUserId() } : {}) });

function parse(text: string | null): Store {
  let raw: Partial<Store> & Partial<Pick<Playground, "sources" | "decision" | "events">> = {};
  try {
    raw = JSON.parse(text ?? "");
  } catch {}
  // No prototype: an id such as "__proto__" or "constructor" from a URL must not look like a playground.
  const s: Store = { playgrounds: Object.assign(Object.create(null), raw.playgrounds), webhookEventIds: raw.webhookEventIds ?? [], demoPage: raw.demoPage ?? null, budget: raw.budget ?? null, rev: raw.rev ?? null, users: Object.assign(Object.create(null), raw.users) };
  // The auth-provider playground is the seed: it always exists and its domain comes from the code.
  // A store written before playgrounds existed has its sources at the top level; they belong to the seed.
  const seed = (s.playgrounds[DOMAIN.id] ??= { ...newPlayground(DOMAIN), owner: null, sources: raw.sources ?? {}, decision: raw.decision ?? null, events: raw.events ?? [] });
  seed.domain = DOMAIN;
  return s;
}

/** The stored text and its version (the blob's ETag; null for the local file or when nothing is stored yet). */
async function read(): Promise<{ text: string | null; etag: string | null; header?: string }> {
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
  // The version is computed, not taken from the response: a blob's ETag is the MD5 of its bytes (checked against the Blob
  // API on 2026-11-13), and the ETag header of a read can be a weak or re-encoded form that a conditional write never matches.
  // A stale read gives a stale MD5, so the conditional write fails and the update runs again: it cannot overwrite silently.
  // lean: this rests on "ETag = MD5 of the bytes" for a single-part upload. If Vercel changes that, every write fails after
  // 13 attempts with an error that names both values (it fails closed, nothing is overwritten); then take the version from head().
  const bytes = Buffer.from(await new Response(r.stream).arrayBuffer());
  return { text: bytes.toString("utf8"), etag: version(bytes), header: r.blob.etag };
}

const version = (bytes: Buffer | string) => `"${createHash("md5").update(bytes).digest("hex")}"`;

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
      const keep = keepPublished(s.playgrounds), bound = boundStorage(s.playgrounds);
      const out = await fn(s);
      keep(s.playgrounds);
      bound(s.playgrounds, () => JSON.stringify(s).length);
      mkdirSync(".data", { recursive: true });
      writeFileSync(FILE + ".tmp", JSON.stringify(s, null, 1));
      renameSync(FILE + ".tmp", FILE);
      return out;
    }
    const { put, BlobPreconditionFailedError } = await import("@vercel/blob");
    for (let attempt = 0; ; attempt++) {
      const { text, etag, header } = await read();
      const s = parse(text);
      const keep = keepPublished(s.playgrounds), bound = boundStorage(s.playgrounds);
      const out = await fn(s);
      keep(s.playgrounds);
      bound(s.playgrounds, () => JSON.stringify(s).length);
      if (JSON.stringify(s) === text) return out; // `fn` changed nothing: no write, and no new version for the other writers
      s.rev = randomUUID();
      const body = JSON.stringify(s);
      try {
        // With an ETag: write only if nobody wrote since the read. Without one: create only (an existing blob is an error).
        await put(BLOB, body, { access: "private", contentType: "application/json", addRandomSuffix: false, ...(etag ? { ifMatch: etag } : { allowOverwrite: false }) });
        return out;
      } catch (e) {
        // Another writer won: the ETag no longer matches, two conditional writes collided, or the blob was created meanwhile.
        const lost = e instanceof BlobPreconditionFailedError || /precondition|conditional request|already exists/i.test(String((e as Error)?.message));
        if (!lost) throw e;
        // The SDK retries a write whose answer was lost, and the retry then fails its own precondition. When the stored
        // document is exactly what this call sent (`rev` is unique per write), the write landed: `fn` must not run a second
        // time on its own result. lean: when a third writer has already written on top of it, `fn` does run twice.
        if ((await read()).etag === version(body)) return out;
        if (attempt >= 12) throw new Error(`The store could not be written: 13 conditional writes failed in a row (computed version ${etag}, read header ${header}).`);
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
  return { id, sources, decision: p.decision, events: p.events, work: workStatus(p), leftOut: p.leftOut ?? [], demoPage: s.demoPage, publicBaseUrl: publicBase(), owner };
}
export type PublicState = ReturnType<typeof publicState>;

/**
 * The id a new playground gets: the wanted one, or, when it is taken, the wanted one with a short random suffix. A create
 * never fails on a taken id, so its answer cannot tell a caller that somebody else's playground exists.
 */
export function freeId(wanted: string, taken: (id: string) => boolean, random = () => randomBytes(3).toString("hex")): string {
  for (let id = wanted; ; id = `${wanted.slice(0, 33)}-${random()}`) if (!taken(id)) return id;
}

/**
 * Insert a new playground in ONE store update: the owner's allowance is checked, a free id is taken and the playground is
 * stored together, so parallel creates by one person cannot pass the cap side by side. Nothing slow (a web read) happens
 * before it: a refused create has spent nothing.
 */
export async function insertPlayground(domain: Domain, make: (d: Domain) => Playground): Promise<{ id: string; existed?: boolean } | { refused: string }> {
  // The storage bounds are checked on the size the insert leaves (update(), boundStorage): their refusal is an answer.
  return update((s) => {
    // A repeated create (the answer of the first one was lost): the caller's own playground with exactly this spec, under
    // the id asked for or under that id with a suffix (the first create may have been renamed), is the one they mean.
    // Nothing is inserted. "Own" is the same owner, not "may write": the admin may write everything, and must not be
    // handed somebody else's playground.
    const owner = currentUserId();
    const wanted = make(domain);
    const spec = (p: Playground) => JSON.stringify([{ ...p.domain, id: "" }, p.kit?.kit ?? null]);
    const renamed = `${domain.id.slice(0, 33)}-`;
    const mine = Object.values(s.playgrounds).find((p) => (p.domain.id === domain.id || (p.domain.id.startsWith(renamed) && /^[0-9a-f]{6}$/.test(p.domain.id.slice(renamed.length)))) && !isExample(p) && (p.owner ?? null) === owner && spec(p) === spec(wanted));
    if (mine) return { id: mine.domain.id, existed: true };
    const refused = playgroundCapMessage(s.playgrounds) ?? deploymentCapMessage(Object.keys(s.playgrounds).length, JSON.stringify(s).length, undefined, Object.values(s.playgrounds).some((p) => owner && p.owner === owner));
    if (refused) return { refused };
    const id = freeId(domain.id, (x) => !!s.playgrounds[x]);
    s.playgrounds[id] = make({ ...domain, id });
    return { id };
  }).catch((e) => {
    if (e instanceof StorageRefused) return { refused: e.message };
    throw e;
  });
}
