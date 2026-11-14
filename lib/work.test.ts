// Web reads that outlast the tool call: the status of tracked work, the report the agent gets, and the rate-limit wait.
import assert from "node:assert/strict";
import { test } from "node:test";
import { retryAfterMs } from "./contextdev.ts";
import type { Domain } from "./domain.ts";
import { buildReport, collectionReport } from "./report.ts";
import { workStatus, type Playground, type Work } from "./store.ts";

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
