import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("a retry after a 429 just before midnight is charged on the new day, and the new day's cap holds", async () => {
  // The clock: 23:59:59 until the retry's wait, then 00:00:01 the next day.
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
  const realTimer = setTimeout;
  // The retry's wait: another store update holds the store's queue, the retry asks for its reservation (still 23:59:59),
  // and only then does midnight pass and the held update end. The reservation must be charged on the new day.
  let update: ((fn: () => Promise<void>) => Promise<unknown>) | null = null;
  let held = false;
  globalThis.setTimeout = ((f: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (ms && ms >= 1000 && ms < 10_000 && update && !held && new Error().stack?.includes("contextdev")) {
      held = true;
      let release!: () => void;
      void update(() => new Promise<void>((r) => (release = r)));
      realTimer(() => {
        f(...args);
        realTimer(() => {
          now = RealDate.parse("2026-11-15T00:00:01Z");
          release();
        }, 50);
      }, 0);
      return realTimer(() => {}, 0);
    }
    return realTimer(f, ms, ...args);
  }) as typeof setTimeout;
  const hits: string[] = [];
  const api = createServer((req, res) => {
    hits.push(`${req.url} ${new Date().toISOString().slice(0, 10)}`);
    const limited = hits.length === 1;
    res.writeHead(limited ? 429 : 200, { "Content-Type": "application/json" }).end(limited ? JSON.stringify({ error_code: "RATE_LIMITED", message: "Retry in 1 second" }) : "{}");
  });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  process.chdir(mkdtempSync(join(tmpdir(), "clay-midnight-")));
  Object.assign(process.env, { CONTEXT_DEV_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}`, CONTEXT_DEV_API_KEY: "fixture", CONTEXT_DEV_REQUESTS_PER_MINUTE: "0", CONTEXT_DEV_DAILY_CAP: "2", CLAY_USER_DAILY_REQUESTS: "2", CONTEXT_DEV_REQUEST_CAP: "0" });
  for (const k of ["BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN"]) delete process.env[k];
  const { bindActor } = await import("./accounts.ts");
  bindActor().actor = { kind: "user", userId: "fixture_user", via: "key" };
  const { cd } = await import("./contextdev.ts");
  update = (await import("./store.ts")).update as never;
  try {
    await cd("POST", "/retry", {});
    const s = JSON.parse(readFileSync(".data/store.json", "utf8"));
    assert.deepEqual([s.budget, s.users.fixture_user.usage], [{ day: "2026-11-15", used: 1 }, { day: "2026-11-15", used: 1 }]);
    await cd("POST", "/today-a", {}, { urgent: true });
    await assert.rejects(cd("POST", "/today-b", {}, { urgent: true }), (e: Error & { code?: string }) => e.code === "DAILY_CAP");
    assert.equal(hits.filter((h) => h.endsWith("2026-11-15")).length, 2); // the cap of 2 holds on the new day
  } finally {
    api.close();
    globalThis.Date = RealDate;
    globalThis.setTimeout = realTimer;
  }
});
