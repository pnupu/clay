import test from "node:test";
import assert from "node:assert/strict";
import { confirmed, diffModels, noPriceRead, NO_PRICE_GAP_MS, standing, verdict, type Decision } from "./diff.ts";
import type { PricingModel } from "./domain.ts";

const model = (base: number | null, price: number | null, quote = "q"): PricingModel => ({
  vendor: "V",
  currency: "USD",
  plans: [
    {
      name: "Pro",
      base_price: base,
      custom_pricing: false,
      price_quote: quote,
      meters: [{ metric: "mau", included: 10_000, overage_allowed: true, tiers: [{ up_to: null, price, per_units: 1 }], quote }],
      features: [{ feature: "mfa", status: "included", addon_price: null, quote }],
    },
  ],
});

test("identical facts give no changes, even when quotes differ", () => {
  assert.deepEqual(diffModels(model(25, 0.02, "a"), model(25, 0.02, "b")), []);
});

test("a changed price is reported with its path, before and after", () => {
  assert.deepEqual(diffModels(model(25, 0.02), model(35, 0.02)), [{ path: "Pro / base price", before: 25, after: 35 }]);
  assert.deepEqual(diffModels(model(25, 0.02), model(25, 0.03)), [{ path: "Pro / mau / tier 1 price", before: "0.02 per 1", after: "0.03 per 1" }]);
});

test("a fact that became unknown and a removed plan are both changes", () => {
  assert.deepEqual(diffModels(model(25, 0.02), model(25, null)), [{ path: "Pro / mau / tier 1 price", before: "0.02 per 1", after: null }]);
  const gone = diffModels(model(25, 0.02), { vendor: "V", currency: "USD", plans: [] });
  assert.ok(gone.some((c) => c.path === "Pro / base price" && c.after === undefined));
});

const decision: Decision = { usage: { mau: 20_000 }, required: [], chosen: "a", savedAt: "2026-11-13T00:00:00Z" };
const b = model(250, 0.001); // 260 at 20k

test("verdict: the chosen vendor stays cheapest after a small rise", () => {
  const v = verdict(decision, { a: model(25, 0.02), b }, { a: model(35, 0.02), b });
  assert.equal(v.holds, true);
  assert.deepEqual([v.chosenCostBefore, v.chosenCostNow, v.cheapestNow], [225, 235, "a"]);
});

test("verdict: a rise that makes another vendor cheapest breaks the decision", () => {
  const v = verdict(decision, { a: model(25, 0.02), b }, { a: model(125, 0.02), b });
  assert.equal(v.holds, false);
  assert.deepEqual([v.cheapestBefore, v.cheapestNow, v.chosenCostNow], ["a", "b", 325]);
});

test("verdict: the decision breaks when the chosen vendor can no longer be priced", () => {
  const v = verdict(decision, { a: model(25, 0.02), b }, { a: model(25, null), b });
  assert.equal(v.holds, false);
  assert.equal(v.chosenCostNow, null);
});

test("verdict: a change at another vendor that undercuts the choice breaks the decision", () => {
  const v = verdict(decision, { a: model(25, 0.02), b }, { a: model(25, 0.02), b: model(100, 0.001) });
  assert.equal(v.holds, false);
  assert.equal(v.cheapestNow, "b");
});

test("tolerance: the decision holds while the choice is within the tolerance of the cheapest, and breaks above it", () => {
  const after = { a: model(125, 0.02), b }; // a costs 325, b costs 260: a gap of 65
  assert.equal(standing({ ...decision, tolerance: 65 }, after).holds, true);
  assert.equal(standing({ ...decision, tolerance: 64 }, after).holds, false);
  assert.equal(standing(decision, after).holds, false); // the default tolerance is 0
  const v = verdict({ ...decision, tolerance: 100 }, { a: model(25, 0.02), b }, after);
  assert.deepEqual([v.holds, v.cheapestNow], [true, "b"]);
  assert.match(v.reason, /within your tolerance of \$100/);
  // A tolerance never rescues a choice that cannot be priced.
  assert.equal(standing({ ...decision, tolerance: 1e9 }, { a: model(25, null), b }).holds, false);
});

test("one re-check that reads no price does not take a vendor's prices away", () => {
  const first = Date.parse("2026-11-14T11:18:24.000Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  // The vendor had prices and this check reads none (a capture before the page filled them in): the prices stay.
  assert.equal(noPriceRead(true, false, null, first), "hold");
  assert.equal(noPriceRead(true, false, undefined, first), "hold");
  // A second check seconds later is the same slow moment of the page: still held.
  assert.equal(noPriceRead(true, false, iso(first), first + 30_000), "hold");
  assert.equal(noPriceRead(true, false, iso(first), first + NO_PRICE_GAP_MS - 1), "hold");
  // A check at least ten minutes after the first one that also reads no price: the page states none now.
  assert.equal(noPriceRead(true, false, iso(first), first + NO_PRICE_GAP_MS), "accept");
  assert.equal(noPriceRead(true, false, iso(first), first + 3_600_000), "accept");
  // A read with prices, or a vendor that had none before, is not this case.
  assert.equal(noPriceRead(true, true, iso(first), first + 3_600_000), "none");
  assert.equal(noPriceRead(false, false, null, first), "none");
  // A stored time that is not a time never accepts.
  assert.equal(noPriceRead(true, false, "soon", first + 3_600_000), "hold");
});

test("agreement: a fact changes only when two fresh extractions state the same thing", () => {
  const old = model(25, 0.02);
  // Both reads say the base price is 35. They differ on the tier price, so that meter keeps its old state.
  const partly = confirmed(old, model(35, 0.05), model(35, 0.03));
  assert.deepEqual(diffModels(old, partly.model), [{ path: "Pro / base price", before: 25, after: 35 }]);
  assert.deepEqual(partly.kept, [{ evidence: "Pro/meter/mau", prefix: "Pro / mau /" }]);
  // Equal facts count as equal, whatever the key order, a missing key or the quote.
  const reordered = model(35, 0.02, "other words");
  reordered.plans![0].meters![0].tiers = [{ per_units: 1, price: 0.02 } as never];
  assert.deepEqual(confirmed(old, model(35, 0.02), reordered).kept, []);
  // The currency needs two agreeing reads too.
  assert.equal(confirmed(old, model(25, 0.02), { ...model(25, 0.02), currency: "EUR" }).model.currency, "USD");
  // Full agreement: every fact of the reads is taken.
  assert.deepEqual(diffModels(model(35, 0.03), confirmed(old, model(35, 0.03), model(35, 0.03)).model), []);
  // Same fact, two different new values: nothing changes.
  assert.deepEqual(diffModels(old, confirmed(old, model(35, 0.02), model(45, 0.02)).model), []);
  // A plan that only one read lost stays; a plan that both reads lost is gone.
  const none = { vendor: "V", currency: "USD", plans: [] };
  assert.deepEqual(diffModels(old, confirmed(old, none, model(25, 0.02)).model), []);
  assert.deepEqual(confirmed(old, none, none).model.plans, []);
});
