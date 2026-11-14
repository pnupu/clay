import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A local stand-in for Context.dev (no live request): each answer is chosen by the test; `inFlight` counts open requests.
let inFlight = 0, maxInFlight = 0, hits = 0;
let answer: (res: ServerResponse, n: number) => void = (res) => res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
const api = createServer((_req, res) => {
  hits++;
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  res.on("finish", () => inFlight--);
  answer(res, hits);
});
await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
process.chdir(mkdtempSync(join(tmpdir(), "clay-limits-")));
Object.assign(process.env, { CONTEXT_DEV_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}`, CONTEXT_DEV_API_KEY: "fixture-key-never-logged", CONTEXT_DEV_REQUESTS_PER_MINUTE: "0", CONTEXT_DEV_CONCURRENCY: "3", CONTEXT_DEV_DAILY_CAP: "0", CLAY_USER_DAILY_REQUESTS: "0" });
for (const k of ["BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN", "CONTEXT_DEV_REQUEST_CAP"]) delete process.env[k];
const { cd, limiter, retryAfterMs } = await import("./contextdev.ts");
const later = (ms: number, f: () => void) => setTimeout(f, ms);

test("the cap on requests in flight holds under a burst; an urgent request takes a place too", async () => {
  inFlight = maxInFlight = hits = 0;
  answer = (res) => later(150, () => res.writeHead(200, { "Content-Type": "application/json" }).end("{}"));
  await Promise.all([...Array.from({ length: 10 }, () => cd("POST", "/web/scrape", {})), cd("POST", "/brand/retrieve", {}, { urgent: true })]);
  assert.equal(hits, 11);
  assert.equal(maxInFlight, 3);
});

test("the cap and the per-minute pacing together: never more than N in flight, never more than the minute allows", async () => {
  // A fake clock: the pacing's waits move it on; a request holds its place for a few turns of the event loop.
  let now = 1_000_000;
  const l = limiter({ concurrency: () => 4, perMinute: () => 10, now: () => now, sleep: async (ms) => void (now += ms) });
  let active = 0, most = 0;
  const starts: number[] = [];
  await Promise.all(Array.from({ length: 25 }, async () => {
    const done = await l.acquire();
    starts.push(now);
    most = Math.max(most, ++active);
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    active--;
    done();
    done(); // a second call gives nothing back twice
  }));
  assert.equal(starts.length, 25);
  assert.equal(most, 4);
  assert.equal(l.inFlight(), 0);
  starts.sort((a, b) => a - b);
  for (let i = 0; i + 10 < starts.length; i++) assert.ok(starts[i + 10] - starts[i] >= 60_000, `11 starts within a minute at ${i}`);
});

test("a 429 with retry-after is sent again after the stated wait; the log line keeps the account's limit, not the key", async () => {
  hits = 0;
  answer = (res, n) =>
    n === 1
      ? res.writeHead(429, { "Content-Type": "application/json", "retry-after": "1", "x-ratelimit-mode": "concurrency", "x-ratelimit-limit": "500" }).end(JSON.stringify({ message: "Too many requests" }))
      : res.writeHead(200, { "Content-Type": "application/json", "x-ratelimit-mode": "concurrency", "x-ratelimit-limit": "500", "x-ratelimit-remaining": "499" }).end("{}");
  const t = Date.now();
  await cd("POST", "/web/scrape", {});
  assert.equal(hits, 2);
  assert.ok(Date.now() - t >= 2000, "waited the stated second plus at least one");
  const log = readFileSync("run/fixture-requests.jsonl", "utf8");
  const lines = log.trim().split("\n").slice(-2).map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.status, l.ratelimit]), [[429, { mode: "concurrency", limit: "500", remaining: null, retryAfter: "1" }], [200, { mode: "concurrency", limit: "500", remaining: "499", retryAfter: null }]]);
  assert.ok(!log.includes("fixture-key-never-logged"));
  // The wait: Retry-After (seconds or a date), else the message, else 5 s; plus 1 to 3 s; 1 to 65 s.
  assert.equal(retryAfterMs("", 0, "43"), 44_000);
  assert.equal(retryAfterMs("", 0, new Date(Date.UTC(2026, 10, 14, 12, 0, 20)).toUTCString(), Date.UTC(2026, 10, 14, 12, 0, 0)), 21_000);
  assert.equal(retryAfterMs("Retry in 7 seconds", 0), 8_000);
  assert.equal(retryAfterMs("", 1, "600"), 65_000);
  // A used-up quota is not retried, whatever it says.
  hits = 0;
  answer = (res) => res.writeHead(429, { "Content-Type": "application/json", "retry-after": "1" }).end(JSON.stringify({ error_code: "USAGE_EXCEEDED", message: "Out of credits" }));
  await assert.rejects(cd("POST", "/web/scrape", {}), /USAGE_EXCEEDED/);
  assert.equal(hits, 1);
});

test("a request that waits for a place across midnight is charged on the day it is sent, not the day it began to wait", async () => {
  process.env.CONTEXT_DEV_CONCURRENCY = "1";
  process.env.CONTEXT_DEV_DAILY_CAP = "5";
  const RealDate = Date;
  let now = RealDate.parse("2026-11-14T23:59:59Z");
  globalThis.Date = class extends RealDate {
    constructor(...a: unknown[]) {
      super(...((a.length ? a : [now]) as []));
    }
    static now() {
      return now;
    }
  } as DateConstructor;
  try {
    let open!: () => void;
    hits = 0;
    answer = (res, n) => (n === 1 ? (open = () => res.writeHead(200, { "Content-Type": "application/json" }).end("{}")) : res.writeHead(200, { "Content-Type": "application/json" }).end("{}"));
    const first = cd("POST", "/web/scrape", {}); // holds the only place until `open`
    while (hits < 1) await new Promise((r) => setTimeout(r, 10));
    const second = cd("POST", "/web/scrape", {}); // reserved at 23:59:59, then waits for the place
    await new Promise((r) => setTimeout(r, 200));
    const { load } = await import("./store.ts");
    assert.deepEqual((await load()).budget, { day: "2026-11-14", used: 2 });
    now = RealDate.parse("2026-11-15T00:00:01Z");
    open();
    await Promise.all([first, second]);
    // The second request was sent on the 15th: its reservation of the 14th was given back and made again on the 15th.
    assert.equal(hits, 2);
    assert.deepEqual((await load()).budget, { day: "2026-11-15", used: 1 });
  } finally {
    globalThis.Date = RealDate;
    process.env.CONTEXT_DEV_CONCURRENCY = "3";
    process.env.CONTEXT_DEV_DAILY_CAP = "0";
    api.close();
  }
});
