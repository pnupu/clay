// Verifies the Context.dev monitor API contract with the app's own client: creates ONE page monitor, reads it back, deletes it.
// The webhook URL is a placeholder on a reserved documentation domain; the monitor is deleted before any change could be delivered.
// Usage: node --env-file=.env.local scripts/monitor-contract.ts
import { cd, createMonitor, deleteMonitor } from "../lib/contextdev.ts";

const m = await createMonitor("Clay: contract test (delete me)", "https://clerk.com/pricing", "https://example.com/api/webhooks/context/contract-test", "Report changes to prices, plan names, included quantities, usage tiers and limits. Ignore navigation, testimonials, dates and marketing copy.");
const full = m as unknown as Record<string, unknown>;
console.log("created", { id_prefix: m.id.slice(0, 4), status: m.status, change_detection: full.change_detection, schedule: full.schedule, events: m.webhook?.events, secret_returned: typeof m.webhook?.secret === "string", secret_prefix_whsec: m.webhook?.secret?.startsWith("whsec_") ?? false, initial_run_id: m.initial_run_id ? "present" : null, ms: m._ms });
try {
  const got = await cd<Record<string, unknown>>("GET", `/monitors/${m.id}`);
  console.log("retrieved", { status: got.status, next_run_at: got.next_run_at, baseline: got.baseline == null ? null : "present", last_error: got.last_error, ms: got._ms });
} finally {
  const d = await deleteMonitor(m.id);
  console.log("deleted", { deleted: d.deleted, ms: d._ms });
}
// Confirm the deletion: the monitor is gone from the API and the account count is back.
const after = await cd<Record<string, unknown>>("GET", `/monitors/${m.id}`).then((g) => `NOT CONFIRMED: still readable, status ${g.status}`, (e) => (e?.status === 404 ? "confirmed: GET -> 404" : `NOT CONFIRMED: ${e?.status ?? ""} ${e?.message ?? e}`));
const list = await cd<{ data: { id: string }[] }>("GET", "/monitors?tag=clay");
const limits = await cd<Record<string, unknown>>("GET", "/monitors/limits");
console.log("confirmed", { get_after_delete: after, listed_with_tag: list.data.length, still_listed: list.data.some((x) => x.id === m.id), monitors_used: limits.monitors_used, monitors_limit: limits.monitors_limit, plan: limits.plan });
