import test from "node:test";
import assert from "node:assert/strict";
import { crossovers, meterCost, planCost, productLike, rank, sameAssumptions, savedAssumptions, stand, standSentence } from "./pricing.ts";
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

// ---- The saved decision and the values the person is trying now.

const offers = {
  // 100,000 included, then $1 per 1,000: $70 at 120,000 and $200 at 250,000.
  cheap: model(50, meter(100_000, [[null, 1, 1000]])),
  // $1.20 per 1,000 from the first unit: $46 at 30,000, $154 at 120,000, $310 at 250,000.
  saved: model(10, meter(0, [[null, 1.2, 1000]])),
};
const gaps = {
  cheap: offers.cheap,
  // $60 flat, and no price stated above 200,000.
  silent: model(60, meter(200_000, [], null)),
  // $90 flat, with a hard limit of 200,000.
  capped: model(90, meter(200_000, [], false)),
};
const at = (mau: number) => ({ usage: { mau }, required: [] });

test("a saved choice is judged under the assumptions it was saved with, and separately under the values tried now", () => {
  // Saved at 120,000 with a $100 tolerance: $84 above the cheapest, so it holds.
  const savedAt = stand(offers, at(120_000), "saved", 100);
  assert.deepEqual([savedAt.state, savedAt.cost, savedAt.cheapest, Math.round(savedAt.gap!), savedAt.holds], ["within", 154, "cheap", 84, true]);
  assert.equal(standSentence(savedAt, "Postmark", "Resend"), "Postmark costs $154 per month, $84 more than Resend, the cheapest. That is within your tolerance of $100.");
  // The same vendor at 250,000, which the person only tries: $110 above the cheapest, outside the tolerance. The saved verdict is untouched.
  const tried = stand(offers, at(250_000), "saved", 100);
  assert.deepEqual([tried.state, tried.cost, Math.round(tried.gap!), tried.holds], ["outside", 310, 110, false]);
  assert.equal(standSentence(tried, "Postmark", "Resend", true), "Postmark would cost $310 per month, $110 more than Resend, the cheapest. That is above your tolerance of $100.");
  assert.equal(stand(offers, at(120_000), "saved", 100).holds, true);
  // A visitor on an example did not save it: no "your".
  assert.equal(standSentence(tried, "Postmark", "Resend", true, undefined, false), "Postmark would cost $310 per month, $110 more than Resend, the cheapest. That is above the saved tolerance of $100.");
  // At 30,000 the saved vendor is the cheapest.
  const low = stand(offers, at(30_000), "saved", 100);
  assert.equal(low.state, "cheapest");
  assert.equal(standSentence(low, "Postmark", "Postmark", true), "Postmark would be the cheapest at $46 per month.");
  // No tolerance: anything above the cheapest is outside, and the sentence says why.
  assert.equal(standSentence(stand(offers, at(120_000), "saved", 0), "Postmark", "Resend"), "Postmark costs $154 per month, $84 more than Resend, the cheapest. You saved it with no tolerance, so it holds only while it is the cheapest.");
});

test("a saved choice that cannot be priced under the tried values says why, and never shows a cost as if it were known", () => {
  const unknown = stand(gaps, at(250_000), "silent", 100);
  assert.deepEqual([unknown.state, unknown.holds, unknown.gap], ["unknown", false, null]);
  assert.equal(standSentence(unknown, "Mailgun", "Resend", true, (t) => t.replace("mau", "emails per month")), "Mailgun cannot be fully priced: emails per month: price above 200,000 not stated. Its known costs are at least $60 per month.");
  const out = stand(gaps, at(250_000), "capped", 100);
  assert.deepEqual([out.state, out.cost, out.holds], ["ineligible", null, false]);
  assert.equal(standSentence(out, "SendGrid", "Resend", true), "no SendGrid plan fits: mau limit is 200,000.");
  // Both are fine at the saved 120,000.
  assert.equal(stand(gaps, at(120_000), "silent", 100).state, "cheapest");
  assert.equal(stand(gaps, at(120_000), "capped", 100).state, "within");
  // A vendor without pricing data, or one that is not part of the lab.
  assert.equal(stand({ ...offers, gone: null }, at(120_000), "gone", 100).state, "unread");
  assert.equal(standSentence(stand(offers, at(120_000), "nobody", 100), "Nobody", null), "Nobody has no pricing data.");
});

test("a vendor that cannot be fully priced: the cost is its lower bound, the reason comes from a plan that states a price", () => {
  const m: PricingModel = { vendor: null, currency: "USD", plans: [
    { name: "Pro", base_price: 20, custom_pricing: false, price_quote: null, meters: [{ metric: "mau", included: null, overage_allowed: null, tiers: [], quote: "Included in Flat Rate" }], features: [] },
    { name: "Enterprise", base_price: null, custom_pricing: true, price_quote: null, meters: [], features: [] },
  ] };
  // The ranking keeps the true lower bound: the contact-sales plan could cost anything from $0.
  assert.deepEqual([rank({ v: m }, at(200)).unranked[0].best!.plan, rank({ v: m }, at(200)).unranked[0].best!.cost], ["Enterprise", 0]);
  // The sentence about a saved choice names the missing fact of the plan with a price, and still says "at least $0".
  const s = stand({ v: m }, at(200), "v", 0);
  assert.deepEqual([s.state, s.cost, s.plan, s.why], ["unknown", 0, "Pro", "mau: included quantity and price not stated"]);
  // Only a contact-sales plan: that is the reason.
  assert.equal(stand({ v: { ...m, plans: [m.plans![1]] } }, at(200), "v", 0).why, "custom pricing (contact sales)");
});

test("the controls are at the saved assumptions only when every metric and every must-have matches", () => {
  const decision = { usage: { mau: 120_000 }, required: ["sso"] };
  // A metric added by a later revision is not in the decision: it counts as 0 there, as the verdict counts it.
  const saved = savedAssumptions(decision, ["mau", "seats"]);
  assert.deepEqual(saved, { usage: { mau: 120_000, seats: 0 }, required: ["sso"] });
  assert.equal(sameAssumptions({ usage: { mau: 120_000, seats: 0 }, required: ["sso"] }, saved), true);
  assert.equal(sameAssumptions({ usage: { mau: 120_000, seats: 5 }, required: ["sso"] }, saved), false); // the ranking would price 5 seats, the verdict none
  assert.equal(sameAssumptions({ usage: { mau: 250_000, seats: 0 }, required: ["sso"] }, saved), false);
  assert.equal(sameAssumptions({ usage: { mau: 120_000, seats: 0 }, required: [] }, saved), false);
  assert.equal(sameAssumptions({ usage: { mau: 120_000, seats: 0 }, required: ["sso", "sla"] }, saved), false);
});

test("plans that are separate products are told apart from tiers of one product", () => {
  assert.equal(productLike(["NVIDIA Quadro RTX 6000", "NVIDIA A10", "NVIDIA A100 (40 GB)", "NVIDIA H100", "NVIDIA GH200"]), true);
  assert.equal(productLike(["RTX 4090", "RTX A6000", "A100 PCIe", "H100 SXM", "L40S"]), true);
  assert.equal(productLike(["Free", "Pro", "Team", "Enterprise"]), false);
  assert.equal(productLike(["Essentials 50K", "Essentials 100K", "Pro 100K", "Premier"]), false);
  assert.equal(productLike(["10,000 emails", "50,000 emails", "100,000 emails"]), false); // volume rows are quantities, not models
  assert.equal(productLike(["Pay as you go"]), false);
  assert.equal(productLike(["A100", "H100"]), false); // two rows are too few to tell
  assert.equal(productLike(["L4", "T4", "A100", "H100"]), true);
  assert.equal(productLike(["c5.large", "c5.xlarge", "m5.large"]), true);
  // Volume rows and numbered tiers are quantities of one product.
  assert.equal(productLike(["Up to 500 contacts", "Up to 2500 contacts", "Up to 10000 contacts"]), false);
  assert.equal(productLike(["Foundation 50k", "Foundation 100k", "Flex"]), false);
  assert.equal(productLike(["Tier 10", "Tier 25", "Tier 100"]), false);
});

test("ties: one rule for the ranking and the verdict (cost to the cent, then id)", () => {
  // Beta is listed first; both cost $20 (no usage beyond the included amount), so Alpha (id order) leads, in the ranking and in the verdict.
  const models = { beta: model(20, meter(1_000_000, [])), alpha: model(20, meter(1_000_000, [])) };
  const a = { usage: { mau: 100 }, required: [] };
  assert.deepEqual(rank(models, a).ranked.map((v) => v.id), ["alpha", "beta"]);
  const st = stand(models, a, "beta", 0);
  assert.equal(st.state, "cheapest");
  assert.equal(st.holds, true);
  assert.equal(st.cheapest, "alpha");
  assert.match(standSentence(st, "Beta Post", "Alpha Mail"), /Beta Post is level with Alpha Mail, the cheapest/);
  assert.match(standSentence(stand(models, a, "alpha", 0), "Alpha Mail", "Alpha Mail"), /^Alpha Mail is the cheapest/);
});
