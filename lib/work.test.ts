// Web reads that outlast the tool call: the status of tracked work, the report the agent gets, and the rate-limit wait.
import assert from "node:assert/strict";
import { test } from "node:test";
import { retryAfterMs } from "./contextdev.ts";
import type { Domain } from "./domain.ts";
import { BRAND_PENDING, brandPending, checkKit } from "./kit.ts";
import { buildReport, collectionReport, dataReport } from "./report.ts";
import { endWork, sourceArrived, startWork, workStatus, type Playground, type Work } from "./store.ts";

const domain: Domain = { id: "p1", question: "Which one?", product: "x", metrics: [{ id: "emails", label: "Emails", unit: "emails", describe: "emails per month", min: 0, max: 100, initial: 10 }], features: [], vendors: [{ id: "a", name: "A", domain: "a.com" }, { id: "b", name: "B", domain: "b.com" }] };
const work = (w: Partial<Work>): Work => ({ id: "w", kind: "build", startedAt: new Date().toISOString(), pending: ["a", "b"], finishedAt: null, stop: null, ...w });
const playground = (w: Work | null): Playground => ({ domain, createdAt: "", sources: {}, decision: null, events: [], exploration: null, work: w });

test("work status: running, done, and stalled when a function instance was cut off", () => {
  assert.equal(workStatus({}), null);
  assert.equal(workStatus({ work: work({}) })?.status, "running");
  assert.deepEqual(workStatus({ work: work({}) })?.pending, ["a", "b"]);
  const done = workStatus({ work: work({ finishedAt: new Date().toISOString(), stop: "rate limit" }) });
  assert.deepEqual([done?.status, done?.pending, done?.stop], ["done", [], "rate limit"]);
  // maxDuration is 300 s: work that started 6 minutes ago and never finished did not survive its function.
  assert.equal(workStatus({ work: work({ startedAt: new Date(Date.now() - 360_000).toISOString() }) })?.status, "stalled");
  assert.equal(workStatus({ work: work({ startedAt: new Date(Date.now() - 200_000).toISOString() }) })?.status, "running");
});

test("the agent's report while pages are still being read: no problem for a vendor that has not arrived", () => {
  const running = playground(work({}));
  assert.deepEqual(collectionReport(running).problems, []);
  assert.deepEqual(collectionReport(running).vendors.map((v) => "status" in v && v.status), ["still being read", "still being read"]);
  const b = buildReport(running);
  assert.deepEqual([b.status, b.pages, "still_reading" in b && b.still_reading], ["running", "0 of 2 pricing pages read", ["a", "b"]]);
  // When the reads have ended, a vendor without a page is a problem to repair.
  const ended = playground(work({ finishedAt: new Date().toISOString(), pending: [] }));
  assert.equal(collectionReport(ended).problems.filter((p) => /was not read/.test(p)).length, 2);
  assert.equal(buildReport(ended).status, "done");
  assert.equal(buildReport(playground(null)).status, "done");
  assert.equal(buildReport(playground(work({ startedAt: new Date(Date.now() - 400_000).toISOString() }))).status, "stalled");
});

test("a rate-limited request waits as long as the API says, within 1 to 30 seconds", () => {
  assert.equal(retryAfterMs("API rate limit exceeded: 10 request units are allowed per minute and this request uses 1. Retry in 4 seconds.", 0), 5000);
  assert.equal(retryAfterMs("Retry in 4 seconds.", 1), 7000);
  assert.equal(retryAfterMs("no hint", 0), 6000);
  assert.equal(retryAfterMs("Retry in 500 seconds.", 0), 30000);
});

test("a build on which fewer than two vendors can be ranked is reported as broken, with the metric to repair", () => {
  const plan = (meter: object | null) => ({ name: "Pro", base_price: 10, custom_pricing: false, price_quote: null, meters: meter ? [{ metric: "emails", ...meter }] : [], features: [] });
  const source = (id: string, meter: object | null) => ({ id, name: id, demo: false, url: `https://${id}.com/pricing`, foundVia: null, lastCheckedAt: null, error: null, monitor: null, snapshot: { url: "", fetchedAt: "", extractor: "context.dev" as const, model: { vendor: id, currency: "USD", plans: [plan(meter)] }, evidence: {}, quarantined: [], textHash: "", truncated: false, latencyMs: 0, requestId: null } });
  const priced = { included: 100, overage_allowed: true, tiers: [{ up_to: null, price: 1, per_units: 100 }], quote: null };
  const unstated = { included: null, overage_allowed: null, tiers: [], quote: "emails are billed" };
  const broken = { ...playground(null), sources: { a: source("a", unstated), b: source("b", unstated) } } as unknown as Playground;
  const first = collectionReport(broken).problems[0];
  assert.match(first, /^BROKEN BUILD: only 0 of 2 vendors can be ranked/);
  assert.match(first, /metric emails has no price on the pages of 2 vendor\(s\)/);
  const fine = { ...playground(null), sources: { a: source("a", priced), b: source("b", priced) } } as unknown as Playground;
  assert.equal(collectionReport(fine).problems.some((x) => x.startsWith("BROKEN BUILD")), false);
  // While pages are still being read, the build is not judged yet.
  const running = { ...playground(work({ pending: ["b"] })), sources: { a: source("a", unstated) } } as unknown as Playground;
  assert.equal(collectionReport(running).problems.some((x) => x.startsWith("BROKEN BUILD")), false);
  assert.equal(buildReport(running).pages, "1 of 2 pricing pages read");
  // The build is judged at the starting values. A person who then moves a slider beyond every stated price (here: above
  // the included 100 with no price for more) must not make a healthy build look broken when the agent reads it back.
  const capped = { included: 100, overage_allowed: true, tiers: [], quote: null };
  const explored = { ...playground(null), sources: { a: source("a", capped), b: source("b", capped) }, exploration: { updatedAt: "", metrics: { emails: { start: 10, min: 10, max: 500, final: 500 } }, features: {}, selected: null } } as unknown as Playground;
  const report = collectionReport(explored);
  assert.equal(report.ranking_at_current_values.ranked_cheapest_first.length, 0);
  assert.equal(report.problems.some((x) => x.startsWith("BROKEN BUILD")), false);
});

test("a brand that is still being read is a state the agent waits for, not a failed read", () => {
  const k = checkKit({ controls: [{ id: "bg", type: "color", label: "Background", meaning: "background colour", initial: "#2563eb", palette: "brand" }], view: { html: '<b style="background:{{bg}}">x</b>' }, outputs: [{ id: "css", label: "background", template: "{{bg}}" }], brand: { domain: "stripe.com" } });
  assert.ok(k.ok);
  if (!k.ok) return;
  const state = (brandError: string | null) => ({ kit: k.kit, rev: "r", brandData: null, brandError, brandSince: new Date().toISOString(), preview: { status: "unverified" as const, error: null, at: null }, settled: null, exploration: null });
  const pending = dataReport(state(BRAND_PENDING))[0] as Record<string, unknown>;
  assert.equal(pending.status, "still being read");
  assert.equal("error" in pending, false);
  const failed = dataReport(state("Context.dev POST /brand/retrieve -> 500"))[0] as Record<string, unknown>;
  assert.match(String(failed.error), /500/);
  // The mark has an end: a read that started longer ago than a function can live was cut off, and counts as failed.
  const now = Date.now();
  assert.equal(brandPending({ brandError: BRAND_PENDING, brandSince: new Date(now - 30_000).toISOString() }, now), true);
  assert.equal(brandPending({ brandError: BRAND_PENDING, brandSince: new Date(now - 400_000).toISOString() }, now), false);
  assert.equal(brandPending({ brandError: BRAND_PENDING }, now), false);
  assert.equal(brandPending({ brandError: null, brandSince: new Date(now).toISOString() }, now), false);
  const cut = dataReport({ ...state(BRAND_PENDING), brandSince: new Date(now - 400_000).toISOString() })[0] as Record<string, unknown>;
  assert.match(String(cut.error), /cut off/);
});

test("a revision that overlaps a running build keeps the build's sources pending, and the work ends when the last one arrives", () => {
  const p: Pick<Playground, "work"> = {};
  // A build reads a, b and c. It answers the agent early; the agent revises only c.
  startWork(p, "build", "build", ["a", "b", "c"]);
  sourceArrived(p, "a");
  startWork(p, "revise", "build", ["c"]);
  assert.deepEqual(workStatus(p)?.pending.sort(), ["b", "c"]); // b is still being read by the first run: not "not read"
  // The first run ends (its mark is gone): nothing changes. Its read of b arrives: b is no longer pending.
  endWork(p, "build", ["a", "b", "c"], null);
  assert.equal(workStatus(p)?.status, "running");
  sourceArrived(p, "b");
  assert.deepEqual(workStatus(p)?.pending, ["c"]);
  // The revision's read of c arrives: the work has ended, also before its run reports the end.
  sourceArrived(p, "c");
  assert.equal(workStatus(p)?.status, "done");
  endWork(p, "revise", ["c"], "rate limit");
  assert.deepEqual([workStatus(p)?.status, workStatus(p)?.stop], ["done", "rate limit"]);
  // A run whose reads threw never calls sourceArrived: its end clears its own sources.
  const q: Pick<Playground, "work"> = {};
  startWork(q, "w", "recheck", ["a", "b"]);
  endWork(q, "w", ["a", "b"], "stopped");
  assert.equal(workStatus(q)?.status, "done");
  // Work that was cut off long ago is not carried into new work.
  const old: Pick<Playground, "work"> = { work: work({ startedAt: new Date(Date.now() - 400_000).toISOString(), pending: ["x"] }) };
  startWork(old, "new", "build", ["a"]);
  assert.deepEqual(workStatus(old)?.pending, ["a"]);
});
