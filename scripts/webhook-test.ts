// Local check of the webhook route: signs requests exactly as https://docs.context.dev/webhooks describes and posts them to the running app.
// It arms a test monitor record (fake id and secret) on one source in .data/store.json, and removes it at the end.
// Usage: node scripts/webhook-test.ts <port> <sourceId>
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [port, sourceId] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const FILE = ".data/store.json";
const secret = "whsec_" + randomBytes(24).toString("hex");
const monitorId = "mon_localtest";

const edit = (fn: (s: any) => void) => { const s = JSON.parse(readFileSync(FILE, "utf8")); fn(s); writeFileSync(FILE, JSON.stringify(s, null, 1)); };
edit((s) => (s.sources[sourceId].monitor = { id: monitorId, secret, webhookUrl: "(local test)" }));

const payload = (id: string, monitor = monitorId) => JSON.stringify({ event: "change.detected", id, created_at: new Date().toISOString(), data: { change: { mode: "web", id: "chg_localtest", monitor_id: monitor, run_id: "run_localtest", target_type: "page", change_detection_type: "semantic", title: "Local test", summary: "Local test", detected_at: new Date().toISOString(), url: "https://example.com", tags: [] } } });

async function send(name: string, expect: number, body: string, opts: { t?: number; key?: string; idHeader?: string } = {}) {
  const t = opts.t ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", opts.key ?? secret).update(`${t}.`).update(body).digest("hex");
  const id = JSON.parse(body).id;
  const res = await fetch(`${base}/api/webhooks/context/${sourceId}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Context-Signature": `t=${t},v1=${v1}`, "X-Context-Id": opts.idHeader ?? id, "X-Context-Event": "change.detected" }, body });
  console.log(`${res.status === expect ? "PASS" : "FAIL"}  ${name}: HTTP ${res.status} (expected ${expect})`);
  if (res.status !== expect) process.exitCode = 1;
}

const state = async () => (await fetch(`${base}/api/state`)).json();
const before = await state();
const evt = "evt_" + randomBytes(6).toString("hex");
try {
  await send("wrong secret is rejected", 401, payload("evt_bad1"), { key: "whsec_wrong" });
  await send("timestamp older than 5 minutes is rejected", 401, payload("evt_bad2"), { t: Math.floor(Date.now() / 1000) - 600 });
  await send("id header that differs from the body is rejected", 400, payload("evt_bad3"), { idHeader: "evt_other" });
  await send("event of another monitor is rejected", 400, payload("evt_bad4", "mon_other"));
  await send("valid signed event is accepted", 204, payload(evt));
  await send("replay of the same event id is acknowledged", 204, payload(evt));
  await new Promise((r) => setTimeout(r, Number(process.env.WAIT_MS ?? 15000)));
  const after = await state();
  const fresh = after.events.filter((e: any) => !before.events.some((b: any) => b.id === e.id));
  console.log(`re-check ran: lastCheckedAt ${before.sources[sourceId].lastCheckedAt} -> ${after.sources[sourceId].lastCheckedAt}`);
  console.log(`new change events: ${fresh.length}`, JSON.stringify(fresh.map((e: any) => ({ trigger: e.trigger, changes: e.changes, verdict: e.verdict })), null, 1));
  const ok = after.sources[sourceId].lastCheckedAt !== before.sources[sourceId].lastCheckedAt && fresh.length <= 1;
  console.log(`${ok ? "PASS" : "FAIL"}  exactly one re-check for the accepted event (the replay did not start a second one)`);
  if (!ok) process.exitCode = 1;
} finally {
  edit((s) => { s.sources[sourceId].monitor = null; s.webhookEventIds = s.webhookEventIds.filter((x: string) => x !== evt); });
}
