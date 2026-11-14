// Thin Context.dev client. Shapes verified against https://docs.context.dev/openapi.json on 2026-11-13.
// Node builtins and the store only, so scripts can import it without a bundler.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BrandData } from "./kit.ts";
import { dailyCap, spend, update } from "./store.ts";
import { currentUserId, limit, userCapMessage, userDailyCap } from "./accounts.ts";

// CONTEXT_DEV_BASE_URL points the client at the local fixture API (scripts/fixture-api.ts) for checks that must not spend requests.
const FIXTURE = process.env.CONTEXT_DEV_BASE_URL;
const BASE = FIXTURE ?? "https://api.context.dev/v1";

// Two limits of the Context.dev account, both enforced here per function instance (README, Limits, gives the values for
// each kind of account):
// - requests per minute (CONTEXT_DEV_REQUESTS_PER_MINUTE, default 10, 0 turns the wait off): new free accounts allow 10
//   per minute across the organisation;
// - requests in flight (CONTEXT_DEV_CONCURRENCY, default 4, 0 turns the cap off): the answers' x-ratelimit-mode
//   "concurrency" limit (500 today; 10 on the Developer plan).
// lean: one function instance cannot see the others, so the real ceiling across instances is (instances) x each limit.
// Context.dev then answers 429, and the call waits as the answer says and sends again (cd()). Move the counts into the
// store if that happens in practice.
// Only an explicit 0 turns a limit off; a missing, empty or malformed value gives the default (accounts.ts, limit()).
const env = (name: string, fallback: number) => limit(process.env[name], fallback);
/** Milliseconds until the next request may start, given the start times of earlier requests (oldest first). */
export function waitFor(starts: number[], now: number, perMinute: number): number {
  const recent = starts.filter((t) => now - t < 60_000);
  return recent.length < perMinute ? 0 : recent[recent.length - perMinute] + 60_000 - now;
}
/**
 * The slot of one request: first a place among the requests in flight (at most `concurrency()`, first come first served),
 * then its turn in the per-minute pacing, taken while holding that place, so the send is never earlier than either limit
 * allows. Resolves to the function that gives the place back (once). An urgent request (one a person waits for) skips the
 * pacing queue, and may take one place more than the cap, so it never waits behind paced requests that hold their places
 * while they sleep for their turn in the minute. `concurrency()` and `perMinute()` are read at each request; 0 turns a
 * limit off.
 */
export function limiter(o: { concurrency: () => number; perMinute: () => number; now?: () => number; sleep?: (ms: number) => Promise<void> }) {
  const now = o.now ?? (() => Date.now());
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let active = 0;
  const queue: (() => void)[] = [];
  const starts: number[] = [];
  let gate: Promise<void> = Promise.resolve();
  const give = () => {
    const next = queue.shift();
    if (next) next(); // the place passes straight to the next waiting request
    else active--;
  };
  const pace = () => {
    const turn = gate.then(async () => {
      const perMinute = o.perMinute();
      const wait = perMinute > 0 ? waitFor(starts, now(), perMinute) : 0;
      if (wait > 0) await sleep(wait + 100);
      starts.push(now());
      if (starts.length > 200) starts.splice(0, 100);
    });
    gate = turn.catch(() => {}); // a failed turn does not block the ones after it
    return turn;
  };
  return {
    inFlight: () => active,
    async acquire(urgent = false): Promise<() => void> {
      const cap = o.concurrency();
      if (cap > 0 && active >= cap + (urgent ? 1 : 0)) await new Promise<void>((r) => queue.push(r));
      else active++;
      let given = false;
      const done = () => void (given || ((given = true), give()));
      try {
        if (urgent) starts.push(now());
        else await pace();
      } catch (e) {
        done();
        throw e;
      }
      return done;
    },
  };
}
const slots = limiter({ concurrency: () => env("CONTEXT_DEV_CONCURRENCY", 4), perMinute: () => env("CONTEXT_DEV_REQUESTS_PER_MINUTE", 10) });
const LOG = FIXTURE ? "run/fixture-requests.jsonl" : "run/requests.jsonl";
/** Requests sent and not yet written to LOG. */
let pending = 0;

export class ContextDevError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
  /** Rate limit or quota: callers must stop calling and report. */
  get stop() {
    return this.status === 429 || this.status === 402 || this.code === "USAGE_EXCEEDED" || this.code === "RATE_LIMITED";
  }
}

type Json = Record<string, unknown>;

const RATE_LIMIT_RETRIES = 3;
/** The longest one call waits for its retries in all. */
const RETRY_WAIT_MS = 120_000;
/**
 * How long to wait before a rate-limited request is sent again: the answer's Retry-After header (seconds, or an HTTP
 * date), else the "Retry in N seconds" of its message, else 5 s; plus 1 to 3 s, at least 1 s and at most 65 s (a
 * per-minute limit frees a request within a minute; 43 s was measured).
 */
export function retryAfterMs(message: string, jitter = Math.random(), header: string | null = null, now = Date.now()): number {
  const h = header?.trim() ?? "";
  const fromHeader = /^\d+(\.\d+)?$/.test(h) ? Number(h) : h && Number.isFinite(Date.parse(h)) ? (Date.parse(h) - now) / 1000 : NaN;
  const stated = Number.isFinite(fromHeader) ? fromHeader : Number(/retry in (\d+(?:\.\d+)?) second/i.exec(message)?.[1] ?? 5);
  return Math.round(Math.min(65, Math.max(1, stated + 1 + 2 * jitter)) * 1000);
}

/** One API call. Records method, path, status, latency and credits (never the key or the body) in run/requests.jsonl. */
export async function cd<T = Json>(method: string, path: string, body?: unknown, opts: { urgent?: boolean } = {}): Promise<T & { _ms: number }> {
  const key = process.env.CONTEXT_DEV_API_KEY;
  if (!key) throw new ContextDevError(0, "NO_KEY", "CONTEXT_DEV_API_KEY is not set");
  // Optional hard cap on the number of logged requests (CONTEXT_DEV_REQUEST_CAP), so an agent in a loop cannot spend the budget.
  // Checked before the wait, so a refused call returns at once, and again after it with nothing awaited before the request
  // counts as pending, so parallel requests cannot pass it together.
  const overCap = () => {
    const cap = Number(process.env.CONTEXT_DEV_REQUEST_CAP ?? 0);
    if (!(cap > 0)) return;
    let used = pending;
    try {
      used += readFileSync(LOG, "utf8").split("\n").filter(Boolean).length;
    } catch {}
    if (used >= cap) throw new ContextDevError(429, "RATE_LIMITED", `Local request cap reached: ${used} of ${cap} Context.dev requests are used (CONTEXT_DEV_REQUEST_CAP). No request was sent.`);
  };
  overCap();
  // Daily budget of a deployment (CONTEXT_DEV_DAILY_CAP, default 300 requests per UTC day, 0 turns it off), counted in the store.
  // A DELETE is not counted: it spends nothing, and stopping a monitor must work when the budget is used up.
  // lean: the counter lives in the one store document, so each request costs one more read and conditional write of it.
  // Move it to its own blob if playgrounds grow large or many requests run at once.
  const daily = dailyCap(process.env.CONTEXT_DEV_DAILY_CAP);
  // A signed-in person (their page or their agent) also has their own daily cap (CLAY_USER_DAILY_REQUESTS, lib/accounts.ts).
  const user = currentUserId();
  const personal = user ? userDailyCap() : 0;
  // A brand read costs 10 credits and a price extraction 5: a brand read counts as 2 requests in both caps.
  const units = path.startsWith("/brand/") ? 2 : 1;
  // The caps count requests SENT to Context.dev: every attempt, a retry after a 429 included, is reserved right before it
  // is sent. At the cap nothing more is sent, also in the middle of retries.
  // The UTC day is taken at each reservation, right before the send it is for, so a retry after midnight counts on the new
  // day; spend() never lets an older day replace a newer one. Returns the day each counter was charged on (the global and
  // the personal counter separately: they can be on different days), or null when nothing was charged.
  type Reservation = { global: string | null; personal: string | null } | null;
  const today = () => new Date().toISOString().slice(0, 10);
  const reserve = async (): Promise<Reservation> => {
  if (!((daily > 0 || personal > 0) && method !== "DELETE")) return null;
  // The day is read inside the update: an update can wait in the store's queue across midnight.
  let day = today();
  let charged: Reservation = null;
  const refusal = await update((s) => {
    day = today();
    const b = daily > 0 ? spend(s.budget, day, daily, units) : s.budget;
    if (!b && daily > 0) return "global";
    const u = user && personal > 0 ? spend(s.users[user]?.usage ?? null, day, personal, units) : null;
    if (user && personal > 0 && !u) return "user";
    s.budget = b;
    if (user && u) s.users[user] = { ...(s.users[user] ?? { keyHash: null, keyCreatedAt: null }), usage: u };
    charged = { global: daily > 0 ? b!.day : null, personal: user && personal > 0 && u ? u.day : null };
    return null;
  });
  if (refusal === "global") throw new ContextDevError(429, "DAILY_CAP", `The daily budget of this Clay deployment is used up: ${daily} Context.dev requests were counted today (CONTEXT_DEV_DAILY_CAP; a brand read counts as 2). No request was sent. The budget resets at 00:00 UTC.`);
  if (refusal === "user") throw new ContextDevError(429, "USER_DAILY_CAP", userCapMessage(personal));
  return charged;
  };
  /** Give back a reservation whose request was NOT sent (the local request cap refused it). A sent request is never given back. */
  const release = (r: Reservation) =>
    r == null ? Promise.resolve() : update((s) => {
      if (r.global && s.budget?.day === r.global) s.budget = { day: r.global, used: Math.max(0, s.budget.used - units) };
      const u = user ? s.users[user]?.usage : null;
      if (r.personal && user && u?.day === r.personal) s.users[user] = { ...s.users[user], usage: { day: r.personal, used: Math.max(0, u.used - units) } };
    });
  // The account's rate limits are shared by every function instance and every person, so the slots of this instance
  // (limiter()) cannot always prevent a 429. Builds run in the background (lib/mcp.ts answers the agent early), so a wait
  // is cheap and a stopped build is not: a rate-limited 429 is sent again after the wait the answer states (Retry-After),
  // up to 3 times. The first attempt is reserved at once, so a request over the cap is refused without waiting for a slot.
  let reserved = await reserve();
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    // An urgent request does not queue behind the paced ones: it is a single request that a person is waiting for (the
    // brand of a preview playground) while a price build may hold the queue for minutes. It still takes a place among the
    // requests in flight and counts as a start, and a 429 is retried below like any other.
    // A retry is a new request sent: it is reserved too, before it waits for a place (the place is held for the send, not
    // for the store). Reached here, the earlier attempts were sent, and no more are.
    if (attempt > 0)
      reserved = await reserve().catch((e) => {
        if (e instanceof ContextDevError) throw new ContextDevError(e.status, e.code, `${e.message} (${attempt} earlier ${attempt === 1 ? "attempt was" : "attempts were"} sent and rate-limited; no more are sent.)`);
        throw e;
      });
    const done = await slots.acquire(opts.urgent);
    let res: Response | null = null;
    let data: Json = {};
    let t0 = 0;
    try {
      // Each reservation was made before the wait for a place. When the day changed meanwhile, it is given back and made
      // again on the new day, right before the send (nothing has been sent on it).
      // Every reservation, the first (made before the pacing wait) and each retry's, must be for the day of this send: one
      // made on an earlier day is given back and made again, until it is for today (a refusal ends the call).
      while (reserved && [reserved.global, reserved.personal].some((d) => d != null && d < today())) {
        await release(reserved);
        reserved = await reserve();
      }
      // Nothing is awaited between this check and pending++, so parallel requests cannot pass the request cap together.
      // Refused here, this attempt was not sent: its reservation is given back.
      try {
        overCap();
      } catch (e) {
        await release(reserved);
        throw e;
      }
      t0 = Date.now();
      pending++;
      try {
        res = await fetch(BASE + path, {
          method,
          headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(120_000),
        });
        data = (await res.json().catch(() => ({}))) as Json;
      } finally {
        // Every request that was sent is logged, also one that failed or timed out (status 0): it may have been billed, and it counts toward the cap.
        try {
          // lean: request log is a local file; on Vercel the filesystem is read-only, so this is skipped there. Use the Context.dev request logs API instead.
          mkdirSync("run", { recursive: true });
          // The account's limit as the answer states it (after a plan change, one request shows the new limit).
          const rl = (h: string) => res?.headers.get(`x-ratelimit-${h}`) ?? null;
          const ratelimit = rl("mode") ?? rl("limit") ?? rl("remaining") ? { mode: rl("mode"), limit: rl("limit"), remaining: rl("remaining"), retryAfter: res?.headers.get("retry-after") ?? null } : null;
          appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), via: FIXTURE ? "fixture" : "app", method, path, status: res?.status ?? 0, ms: Date.now() - t0, credits: (data.key_metadata as Json | undefined)?.credits_consumed ?? null, cache: (data.cache_metadata as Json | undefined)?.status ?? null, ...(ratelimit ? { ratelimit } : {}) }) + "\n");
        } catch {}
        pending--;
      }
    } finally {
      done(); // the place is free before any wait for a retry
    }
    const ms = Date.now() - t0;
    // Rate-limited: the code says so, or a 429 without a code states when to try again. Any other code (a quota, credits)
    // is not retried. The waits of one call stay within RETRY_WAIT_MS, so a background build ends inside its function's
    // 300 s (maxDuration).
    const retryAfter = res.headers.get("retry-after");
    if (res.status === 429 && (data.error_code === "RATE_LIMITED" || (retryAfter && data.error_code == null)) && attempt < RATE_LIMIT_RETRIES) {
      const wait = retryAfterMs(String(data.message ?? ""), Math.random(), retryAfter);
      if (waited + wait <= RETRY_WAIT_MS) {
        waited += wait;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
    }
    // The message of an error may be an object (an input validation error lists its issues): say it, not "[object Object]".
    const said = typeof data.message === "string" ? data.message : data.message == null ? "" : JSON.stringify(data.message).slice(0, 300);
    if (!res.ok) throw new ContextDevError(res.status, (data.error_code as string) ?? null, `Context.dev ${method} ${path} -> ${res.status} ${data.error_code ?? ""} ${said}`.trim());
    return { ...(data as T), _ms: ms };
  }
}

type Output<T> = { requested: boolean; success: boolean | null; data: T | null; error_code?: string; message?: string; isTruncated?: true };
/**
 * When the page of a scrape answer was captured. Clay asks for a fresh capture (maxAgeMs 0), so the age is normally 0.
 * It fails closed. Only two answers have a known time: one with a usable age, and one that says it is a fresh capture
 * ("miss") and gives no age. A cache hit without a usable age, a negative or broken age, and an answer WITHOUT the
 * cache_metadata block are of unknown age, which is given as the epoch, so they never count as read "in this check"
 * (lib/record.ts, fullRead). Why the missing block is refused: all 168 successful live /web/scrape answers that our
 * servers logged on 2026-11-14 carried the block; only failed requests (HTTP 400, 429) lacked it, and those are not read.
 */
export function capturedAt(meta: { status?: string; age_ms?: unknown } | null | undefined, now = Date.now()): string {
  const age = meta?.age_ms;
  if (typeof age === "number" && Number.isFinite(age) && age >= 0) return new Date(now - age).toISOString();
  return meta?.status === "miss" && age == null ? new Date(now).toISOString() : new Date(0).toISOString();
}

/**
 * Does a scrape answer say that it came from a cache? A hit, or an age longer than the call took (with five seconds of
 * slack): the page was not captured for this call. Clay asks for a fresh capture, so such an answer is refused where it
 * is read (lib/pipeline.ts) and nothing of it is stored. An answer of unknown age is not refused here: it is kept,
 * dated as unknown (capturedAt), and certifies nothing.
 */
export function servedFromCache(meta: { status?: string; age_ms?: unknown } | null | undefined, tookMs: number): boolean {
  const age = meta?.age_ms;
  return meta?.status === "hit" || (typeof age === "number" && Number.isFinite(age) && age > tookMs + 5_000);
}

export type ScrapeResult = {
  url: string;
  markdown: Output<string>;
  json: Output<Json>;
  isPartial?: true;
  cache_metadata: { status: "hit" | "miss" | "zdr"; age_ms: number };
  request_id: string;
  _ms: number;
};

/** Read one page (POST /web/scrape). maxAgeMs 0 forces a fresh capture, so Markdown and JSON come from the same visit. */
export function scrape(url: string, json?: { schema: unknown; instructions: string }) {
  return cd<ScrapeResult>("POST", "/web/scrape", {
    url,
    formats: { markdown: true, ...(json ? { json: true } : {}) },
    ...(json ? { jsonParams: json } : {}),
    maxAgeMs: 0,
  });
}

/**
 * Brand facts of one site (POST /brand/retrieve, type by_domain; 10 credits; checked against docs.context.dev/openapi.json on 2026-11-14).
 * Only colours, logos and the title are kept. Names and the title are text from the web: cut short, and treated as data.
 */
export async function brand(domain: string): Promise<BrandData> {
  const r = await cd<{ brand?: { title?: unknown; colors?: { hex?: unknown; name?: unknown }[]; logos?: { url?: unknown; mode?: unknown; type?: unknown }[] } }>("POST", "/brand/retrieve", { type: "by_domain", domain }, { urgent: true });
  const cut = (x: unknown, n: number) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const colors = (r.brand?.colors ?? []).flatMap((c) => (typeof c?.hex === "string" && /^#[0-9a-f]{6}$/i.test(c.hex) ? [{ hex: c.hex.toLowerCase(), name: cut(c.name, 40) }] : []));
  const logos = (r.brand?.logos ?? []).flatMap((l) => (typeof l?.url === "string" && /^https:\/\/[^\s"'<>]{4,500}$/.test(l.url) ? [{ url: l.url, mode: cut(l.mode, 30), type: cut(l.type, 10) }] : []));
  return { domain, title: cut(r.brand?.title, 80), colors: colors.filter((c, i) => colors.findIndex((x) => x.hex === c.hex) === i).slice(0, 12), logos: logos.slice(0, 6), fetchedAt: new Date().toISOString(), source: "context.dev brand" };
}

export type Monitor = { id: string; status: string; webhook: { url: string; secret?: string; events: string[] } | null; initial_run_id: string | null };

/** Page monitor with semantic detection and a signed webhook (POST /monitors). The secret is only returned to keys with monitors:write. */
export function createMonitor(name: string, url: string, webhookUrl: string, instructions: string, minutes = Number(process.env.MONITOR_INTERVAL_MINUTES ?? 0)) {
  return cd<Monitor>("POST", "/monitors", {
    name,
    tags: ["clay"],
    target: { type: "page", url, instructions },
    webhook: { url: webhookUrl, events: ["change.detected"], retry: {} },
    // The API default is one run per day; the shortest interval the docs allow is 10 minutes, so a smaller value is raised to 10.
    // Not yet exercised against the API.
    ...(minutes > 0 ? { schedule: { type: "interval", frequency: Math.max(10, Math.round(minutes)), unit: "minutes" } } : {}),
  });
}

export const deleteMonitor = (id: string) => cd<{ id: string; deleted: boolean }>("DELETE", `/monitors/${id}`);
export const usage = () => cd<{ credits_remaining: number; period: { credits_used: number } | null }>("GET", "/org/usage");

/** Signature check from https://docs.context.dev/webhooks : X-Context-Signature is "t=<unix>,v1=<hex>", v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). */
export function verifyWebhook(rawBody: Buffer, header: string, secret: string, nowMs = Date.now()): boolean {
  if (!secret) return false;
  const parts: Record<string, string> = Object.create(null);
  for (const part of header.split(",")) {
    const pair = part.trim().split("=");
    if (pair.length !== 2 || pair[0] in parts) return false;
    parts[pair[0]] = pair[1];
  }
  if (!/^[0-9]{1,12}$/.test(parts.t ?? "") || !/^[a-f0-9]{64}$/i.test(parts.v1 ?? "")) return false;
  if (Math.abs(nowMs / 1000 - Number(parts.t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.`).update(rawBody).digest();
  const actual = Buffer.from(parts.v1, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
