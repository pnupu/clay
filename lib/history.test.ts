import assert from "node:assert/strict";
import { test } from "node:test";
import type { Verdict } from "./diff.ts";
import { SHOWN, changeSentence, effectSentence, fold, sourceWords } from "./history.ts";

const label = (id: string) => ({ sso_connections: "enterprise SSO connections", mau: "monthly active users", mfa: "multi-factor authentication" })[id] ?? id;
const names: Record<string, string> = { supabase: "Supabase Auth", northwind: "Northwind Auth" };
const who = { chosenId: "supabase", chosen: "Supabase Auth", nameOf: (id: string | null) => (id ? (names[id] ?? id) : null) };
const verdict = (v: Partial<Verdict>): Verdict => ({ holds: true, cheapestBefore: "supabase", cheapestNow: "supabase", chosenCostBefore: 32, chosenCostNow: 32, reason: "The chosen vendor is still the cheapest.", ...v });

// The four events of the public example as a person saw them on a phone (newest first).
const RAISED = [{ path: "Growth / base price", before: 0, after: 49 }, { path: "Growth / sso_connections / tier 1 price", before: "0 per 1", after: "50 per 1" }];
const CUT = [{ path: "Growth / base price", before: 49, after: 0 }, { path: "Growth / sso_connections / tier 1 price", before: "50 per 1", after: "0 per 1" }];
const HELD_AGAIN = verdict({ cheapestBefore: "northwind", reason: "The chosen vendor is now the cheapest." });
const STOPPED = verdict({ holds: false, cheapestNow: "northwind", reason: "The chosen vendor now costs $32 per month more than the cheapest, above your tolerance of $25." });

test("what the vendor did: a plan's price and a unit price in plain words, no fact path", () => {
  assert.equal(changeSentence("Northwind Auth", RAISED, label), "Northwind Auth raised Growth from $0 to $49 a month and enterprise SSO connections on Growth from $0 to $50 each.");
  assert.equal(changeSentence("Northwind Auth", CUT, label), "Northwind Auth cut Growth from $49 to $0 a month and enterprise SSO connections on Growth from $50 to $0 each.");
  assert.equal(changeSentence("Northwind Auth", [{ path: "Growth / base price", before: 149, after: 49 }], label), "Northwind Auth cut Growth from $149 to $49 a month.");
  // Other kinds of facts, each in words: an included quantity, a unit price per 1,000, a later tier, a feature, a price that appears or goes.
  assert.equal(changeSentence("Resend", [{ path: "Pro / mau / included", before: 10000, after: 50000 }], label), "Resend changed the monthly active users included in Pro from 10,000 to 50,000.");
  assert.equal(changeSentence("Resend", [{ path: "Pro / mau / tier 2 price", before: "1.5 per 1000", after: "0.9 per 1000" }], label), "Resend cut monthly active users on Pro (tier 2) from $1.50 to $0.90 per 1,000.");
  assert.equal(changeSentence("Clerk", [{ path: "Pro / mfa", before: "addon", after: "included" }], label), "Clerk changed multi-factor authentication on Pro: now included.");
  assert.equal(changeSentence("Clerk", [{ path: "Pro / base price", before: null, after: 25 }], label), "Clerk set a price for Pro: $25 a month.");
  assert.equal(changeSentence("Clerk", [{ path: "Pro / base price", before: 25, after: null }], label), "Clerk no longer stated a price for Pro.");
  // A raise and a cut keep their verbs; more than two changes are counted, the price first.
  assert.equal(changeSentence("Clerk", [{ path: "Pro / mau / included", before: 1, after: 2 }, { path: "Pro / mau / tier 1 price", before: "2 per 1", after: "1 per 1" }, { path: "Pro / base price", before: 20, after: 25 }], label), "Clerk raised Pro from $20 to $25 a month, and cut monthly active users on Pro from $2 to $1 each, and changed 1 more fact.");
  // A fact with no plain form is counted, never shown as a path.
  assert.equal(changeSentence("Clerk", [{ path: "Pro / custom pricing", before: false, after: true }], label), "Clerk changed 1 fact on its pricing page.");
  for (const s of [changeSentence("Northwind Auth", RAISED, label), changeSentence("Clerk", [{ path: "Pro / mau / tier 1 up to", before: 1, after: 2 }, { path: "Pro / base price", before: 1, after: 2 }], label)]) assert.ok(!/ \/ |tier 1 price|per 1\b/.test(s), s);
});

test("what a change did to the saved choice then: past tense, with the numbers, for a visitor and for the owner", () => {
  // The public example, read by a visitor.
  assert.equal(effectSentence(HELD_AGAIN, STOPPED, { ...who, current: true, own: false }), "The saved choice held again: Supabase Auth became the cheapest.");
  assert.equal(effectSentence(STOPPED, null, { ...who, current: true, own: false }), "The saved choice stopped holding: Supabase Auth was $32 a month over the cheapest (Northwind Auth), above the saved $25 tolerance.");
  // The owner reads "your".
  assert.equal(effectSentence(STOPPED, null, { ...who, current: true, own: true }), "Your choice stopped holding: Supabase Auth was $32 a month over the cheapest (Northwind Auth), above your $25 tolerance.");
  assert.equal(effectSentence(HELD_AGAIN, STOPPED, { ...who, current: true, own: true }), "Your choice held again: Supabase Auth became the cheapest.");
  // It held before and after; inside the tolerance; its own cost moved.
  assert.equal(effectSentence(verdict({}), verdict({}), { ...who, current: true, own: true }), "Your choice still held: Supabase Auth was still the cheapest.");
  assert.equal(effectSentence(verdict({ cheapestNow: "northwind", chosenCostBefore: 32, chosenCostNow: 40, reason: "The chosen vendor costs $12 per month more than the cheapest, within your tolerance of $25." }), null, { ...who, current: true, own: true }), "Your choice still held: Supabase Auth was $12 a month over the cheapest (Northwind Auth), inside your $25 tolerance. Its cost went from $32 to $40 a month.");
  // It did not hold before either; no tolerance; it could not be priced.
  assert.equal(effectSentence(verdict({ holds: false, cheapestNow: "northwind", reason: "The chosen vendor was not the cheapest before this change and still is not." }), STOPPED, { ...who, current: true, own: false }), "The saved choice still did not hold: Supabase Auth was not the cheapest (Northwind Auth was).");
  assert.equal(effectSentence(verdict({ holds: false, cheapestNow: "northwind", reason: "The chosen vendor is no longer the cheapest under your assumptions." }), null, { ...who, current: true, own: true }), "Your choice stopped holding: Supabase Auth was not the cheapest (Northwind Auth was).");
  assert.equal(effectSentence(verdict({ holds: false, chosenCostNow: null, reason: "The chosen vendor can no longer be priced under your assumptions." }), null, { ...who, current: true, own: true }), "Your choice stopped holding: Supabase Auth could no longer be priced at your values.");
  // Every event says its effect: an old one without a stored verdict, and one judged for a choice that was replaced.
  assert.equal(effectSentence(null, null, { ...who, current: false, own: false }), "Not judged at the time: no choice was saved then.");
  assert.equal(effectSentence(null, null, { ...who, current: true, own: true }), "Not judged at the time: no choice was saved then.");
  assert.equal(effectSentence(STOPPED, null, { ...who, current: false, own: true }), "Judged for an earlier saved choice: it did not hold.");
  assert.equal(effectSentence(HELD_AGAIN, null, { ...who, current: false, own: false }), "Judged for an earlier saved choice: it held.");
  // No sentence is in the present tense of a verdict.
  for (const s of [effectSentence(STOPPED, null, { ...who, current: true, own: false }), effectSentence(HELD_AGAIN, STOPPED, { ...who, current: true, own: false })]) assert.ok(!/no longer holds|now costs|is now/.test(s), s);
});

test("where a change came from, in plain words; a demo vendor is named as one", () => {
  assert.equal(sourceWords("webhook", false), "the vendor's page changed");
  assert.equal(sourceWords("manual", false), "a re-check");
  assert.equal(sourceWords("auto", false), "a scheduled check");
  assert.equal(sourceWords("auto", true), "demo vendor: a test change");
  assert.equal(sourceWords("webhook", true), "demo vendor: a test change");
  assert.equal(sourceWords("manual", true), "demo vendor: a re-check");
});

test("more than a few events fold behind one button", () => {
  const events = [1, 2, 3, 4, 5, 6];
  assert.equal(SHOWN, 3);
  assert.deepEqual(fold(events, false), { shown: [1, 2, 3], folded: 3 });
  assert.deepEqual(fold(events, true), { shown: events, folded: 0 });
  assert.deepEqual(fold([1, 2, 3], false), { shown: [1, 2, 3], folded: 0 });
  assert.deepEqual(fold([], false), { shown: [], folded: 0 });
});
