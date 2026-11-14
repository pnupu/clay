import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("a reservation the local cap refused is given back on each counter's own day (the global one may be off)", async () => {
  let hits = 0;
  const api = createServer((_req, res) => { hits++; res.writeHead(200, { "Content-Type": "application/json" }).end("{}"); });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  process.chdir(mkdtempSync(join(tmpdir(), "clay-release-")));
  // Yesterday's deployment counter is still stored; the global cap is off; the person's cap is 5; the local cap allows 1.
  mkdirSync(".data", { recursive: true });
  writeFileSync(".data/store.json", JSON.stringify({ playgrounds: {}, users: {}, budget: { day: "2000-01-01", used: 7 } }));
  Object.assign(process.env, { CONTEXT_DEV_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}`, CONTEXT_DEV_API_KEY: "fixture", CONTEXT_DEV_REQUESTS_PER_MINUTE: "0", CONTEXT_DEV_DAILY_CAP: "0", CLAY_USER_DAILY_REQUESTS: "5", CONTEXT_DEV_REQUEST_CAP: "1" });
  for (const k of ["BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN"]) delete process.env[k];
  const { bindActor } = await import("./accounts.ts");
  bindActor().actor = { kind: "user", userId: "fixture_user", via: "key" };
  const { cd } = await import("./contextdev.ts");
  try {
    const r = await Promise.allSettled(Array.from({ length: 5 }, () => cd("POST", "/web/scrape", {})));
    assert.equal(hits, 1);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    const s = JSON.parse(readFileSync(".data/store.json", "utf8"));
    assert.equal(s.users.fixture_user.usage.used, 1); // one sent, one counted
  } finally {
    api.close();
  }
});
