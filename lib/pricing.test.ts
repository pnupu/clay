import test from "node:test";
import assert from "node:assert/strict";
import { crossovers, meterCost, planCost, rank } from "./pricing.ts";
import type { PricingModel } from "./domain.ts";

const meter = (included: number | null, tiers: [number | null, number | null, number][], overage_allowed: boolean | null = true) => ({ metric: "mau", included, overage_allowed, tiers: tiers.map(([up_to, price, per_units]) => ({ up_to, price, per_units })), quote: null });
const model = (base: number | null, m: ReturnType<typeof meter>, features: [string, "included" | "addon" | "not_available", number | null][] = []): PricingModel => ({
  vendor: null,
  currency: "USD",
  plans: [{ name: "P", base_price: base, custom_pricing: false, price_quote: null, meters: [m], features: features.map(([feature, status, addon_price]) => ({ feature, status, addon_price, quote: null })) }],
});

test("graduated tiers apply above the included quantity", () => {
  const m = meter(50_000, [[100_000, 0.02, 1], [1_000_000, 0.018, 1], [null, 0.015, 1]]);
  assert.deepEqual(meterCost(m, 50_000), { amount: 0 });
  assert.equal(meterCost(m, 60_000).amount, 200);
  assert.equal(meterCost(m, 150_000).amount, 50_000 * 0.02 + 50_000 * 0.018);
});

test("block prices are linear in per_units", () => {
  assert.equal(meterCost(meter(1_000_000, [[null, 2500, 1_000_000]]), 3_000_000).amount, 5000);
});

test("a hard limit makes the plan ineligible, not expensive", () => {
  assert.match(meterCost(meter(50_000, [], false), 50_001).ineligible!, /limit is 50,000/);
  assert.match(meterCost(meter(0, [], false), 1).ineligible!, /not available/);
});

test("a missing price stays unknown and keeps the known part as a lower bound", () => {
  assert.match(meterCost(meter(10_000, []), 20_000).unknown!, /price above 10,000 not stated/);
  const beyondLastTier = meterCost(meter(1, [[15, 75, 1]]), 20);
  assert.equal(beyondLastTier.amount, 14 * 75);
  assert.match(beyondLastTier.unknown!, /price above 15 not stated/);
  assert.match(meterCost(meter(0, [[null, null, 1]]), 5).unknown!, /not stated/);
});

test("required features: add-on adds its price, unknown status is an unknown, not_available excludes the plan", () => {
  const p = (status: "included" | "addon" | "not_available", price: number | null) => planCost(model(10, meter(100, []), [["mfa", status, price]]).plans![0], { usage: { mau: 1 }, required: ["mfa"] });
  assert.equal(p("addon", 99).cost, 109);
  assert.equal(p("addon", null).unknowns.length, 1);
  assert.equal(p("not_available", null).ineligible, "mfa not available");
  assert.equal(planCost(model(10, meter(100, [])).plans![0], { usage: { mau: 1 }, required: ["mfa"] }).unknowns.length, 1);
});

test("a metric the plan does not mention counts as 0 and is listed as an assumption", () => {
  const c = planCost(model(10, meter(100, [])).plans![0], { usage: { mau: 1, sso_connections: 3 }, required: [] });
  assert.equal(c.cost, 10);
  assert.equal(c.assumed.length, 1);
});

const cheapThenDear = model(0, meter(10_000, [[null, 0.02, 1]])); // free to 10k, then 2 cents
const flat = model(100, meter(1_000_000, [[null, 0.001, 1]]));
const partlyUnknown = model(0, meter(10_000, []));

test("ranking puts incomplete vendors aside and states their effect on the winner", () => {
  const r = rank({ a: cheapThenDear, b: flat, c: partlyUnknown }, { usage: { mau: 20_000 }, required: [] });
  assert.deepEqual(r.ranked.map((v) => [v.id, v.best!.cost]), [["b", 100], ["a", 200]]);
  assert.equal(r.cheapest, "b");
  assert.match(r.unranked[0].effect, /only if the missing facts add less than \$100/);
  const low = rank({ a: cheapThenDear, c: partlyUnknown }, { usage: { mau: 5_000 }, required: [] });
  assert.equal(low.unranked.length, 0); // below the included quantity nothing is unknown
});

test("crossover is found at the exact unit where the cheapest vendor changes", () => {
  // a costs (x - 10000) * 0.02, b costs 100: a is cheaper below 15,000; equal at 15,000 keeps a; b wins from 15,001.
  const c = crossovers({ a: cheapThenDear, b: flat }, { usage: { mau: 1 }, required: [] }, "mau", 1000, 5_000_000);
  assert.deepEqual(c, [{ at: 15_001, from: "a", to: "b" }]);
});

test("request pacing: the eleventh request in a minute waits until the first is a minute old", async () => {
  const { waitFor } = await import("./contextdev.ts");
  const starts = Array.from({ length: 10 }, (_, i) => 1000 + i * 100); // ten requests within one second
  assert.equal(waitFor(starts.slice(0, 9), 2000, 10), 0);
  assert.equal(waitFor(starts, 2000, 10), 59_000); // the first started at 1,000 and frees its slot at 61,000
  assert.equal(waitFor(starts, 61_000, 10), 0);
});
