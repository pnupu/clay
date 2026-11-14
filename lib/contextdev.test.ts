import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("caps count requests sent: a retry after a 429 is reserved too, and none is sent past the cap", async () => {
  // A stand-in API that answers 429 three times, then 200. Both caps are 1.
  let hits = 0;
  const api = createServer((_req, res) => {
    hits++;
    res.writeHead(hits <= 3 ? 429 : 200, { "Content-Type": "application/json" }).end(JSON.stringify(hits <= 3 ? { error_code: "RATE_LIMITED", message: "Retry in 0 seconds." } : { ok: true }));
  });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  process.chdir(mkdtempSync(join(tmpdir(), "clay-quota-"))); // the store file of this test lives here, not in the repo
  Object.assign(process.env, { CONTEXT_DEV_BASE_URL: `http://127.0.0.1:${(api.address() as { port: number }).port}`, CONTEXT_DEV_API_KEY: "fixture", CONTEXT_DEV_REQUESTS_PER_MINUTE: "0", CONTEXT_DEV_DAILY_CAP: "1", CLAY_USER_DAILY_REQUESTS: "1" });
  for (const k of ["BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN"]) delete process.env[k];
  const { bindActor } = await import("./accounts.ts");
  bindActor().actor = { kind: "user", userId: "fixture_user", via: "key" };
  const { cd } = await import("./contextdev.ts");
  try {
    await assert.rejects(cd("POST", "/web/scrape", { url: "https://fixture.com/" }), (e: Error & { code?: string }) => e.code === "DAILY_CAP" && /1 earlier attempt was sent and rate-limited/.test(e.message));
    assert.equal(hits, 1);
  } finally {
    api.close();
  }
});
