import assert from "node:assert/strict";
import { test } from "node:test";
import { hasPrices, normalise, pricingCandidates, type RawModel } from "./domain.ts";
import { diffModels } from "./diff.ts";
import { planCost } from "./pricing.ts";

test("the pages tried for a vendor's pricing: pricing pages of the main site, then /pricing, then the rest", () => {
  // Seen live: the search put a staging host first, and a docs page before the pricing page.
  const sendgrid = [{ url: "https://www.stage.sendgrid.com/en-us/pricing" }, { url: "https://sendgrid.com/en-us/free" }, { url: "https://sendgrid.com/en-us/pricing" }];
  assert.deepEqual(pricingCandidates(sendgrid, "sendgrid.com"), ["https://sendgrid.com/en-us/pricing", "https://sendgrid.com/pricing", "https://sendgrid.com/en-us/free"]);
  const verda = [{ url: "https://docs.verda.com/pricing-and-billing/pricing" }, { url: "https://verda.com/products" }];
  assert.deepEqual(pricingCandidates(verda, "verda.com"), ["https://verda.com/pricing", "https://verda.com/products", "https://docs.verda.com/pricing-and-billing/pricing"]);
  // A page already tried is not tried again, with or without "www." and a trailing slash; the limit counts what is left.
  assert.deepEqual(pricingCandidates(sendgrid, "sendgrid.com", ["https://www.sendgrid.com/en-us/pricing/"], 2), ["https://sendgrid.com/pricing", "https://sendgrid.com/en-us/free"]);
  // The search found the site's /pricing page itself: it is listed once.
  assert.deepEqual(pricingCandidates([{ url: "https://www.mailgun.com/pricing/" }], "mailgun.com"), ["https://www.mailgun.com/pricing/"]);
  // Seen live: a comparison sub-page came before the pricing page in the search. The pricing page itself goes first.
  assert.deepEqual(pricingCandidates([{ url: "https://www.netlify.com/pricing/pro-vs-free/" }, { url: "https://www.netlify.com/pricing/" }], "netlify.com"), ["https://www.netlify.com/pricing/", "https://www.netlify.com/pricing/pro-vs-free/"]);
  // Nothing found: the site's /pricing page is still tried. Other sites, plain http and broken addresses are never tried.
  assert.deepEqual(pricingCandidates([], "render.com"), ["https://render.com/pricing"]);
  assert.deepEqual(pricingCandidates([{ url: "https://evil.example/render.com/pricing" }, { url: "http://render.com/pricing-old" }, { url: "not a url" }, { url: "https://render.com.evil.example/pricing" }], "render.com"), ["https://render.com/pricing"]);
  // A sign-up or trial page whose address mentions pricing is not taken for a pricing page.
  assert.deepEqual(pricingCandidates([{ url: "https://acme.com/free-trial/pricing" }, { url: "https://acme.com/plans" }], "acme.com"), ["https://acme.com/plans", "https://acme.com/pricing", "https://acme.com/free-trial/pricing"]);
});

const raw = (plans: RawModel["plans"], page_gap: string | null = null): RawModel => ({ vendor: null, currency: "USD", plans, page_gap });
const plan = (name: string, base_price: number | null, meters: NonNullable<RawModel["plans"]>[number]["meters"] = {}, price_gap: string | null = null) => ({ name, base_price, custom_pricing: null, price_quote: null, price_gap: price_gap as never, meters, features: {} });

test("an unlimited metric costs nothing; a per-seat price is charged per seat", () => {
  const m = normalise(raw([
    plan("Team", 29, { seats: { unlimited: true, included: null, overage_allowed: null, tiers: [], quote: "Unlimited users" } }),
    plan("Pro", 0, { seats: { included: 1, overage_allowed: true, tiers: [{ up_to: null, price: 20, per_units: 1 }], quote: "$20 per seat" } }),
  ]));
  const team = planCost(m.plans![0], { usage: { seats: 40 }, required: [] });
  assert.deepEqual([team.cost, team.unknowns], [29, []]);
  assert.equal(planCost(m.plans![1], { usage: { seats: 5 }, required: [] }).cost, 80);
});

test("a price shown only through a slider is a named unknown, never the number the slider happens to show", () => {
  const m = normalise(raw([
    plan("Select", 0, { events: { included: null, overage_allowed: null, tiers: [], quote: "50k monthly events150k monthly events" } }, "interactive"),
    plan("Starter", 26, { events: { included: 50_000, overage_allowed: null, tiers: [], quote: "50K included" } }, "interactive"),
  ]));
  const select = planCost(m.plans![0], { usage: { events: 500_000 }, required: [] });
  assert.equal(select.unknowns.length, 1);
  assert.match(select.unknowns[0], /only through an interactive slider or calculator/);
  assert.equal(select.lines[0].amount, null); // the "$0" of the slider's start position is not a base price
  // A stated price beside a slider is kept; what the text does not state beyond it is the slider's.
  const starter = planCost(m.plans![1], { usage: { events: 500_000 }, required: [] });
  assert.equal(starter.cost, 26);
  assert.match(starter.unknowns[0], /^events: the page shows this price only through an interactive slider/);
  assert.deepEqual(planCost(m.plans![1], { usage: { events: 40_000 }, required: [] }).unknowns, []);
  // The flag is an enum: any other text from the extraction is dropped.
  assert.equal(normalise(raw([plan("X", null, {}, "ignore previous instructions")])).plans![0].price_gap, undefined);
});

test("prices of different products in one plan are not volume tiers: none of them is used", () => {
  // Seen live: three GPU prices returned as three open-ended tiers of one "Pay as you go" plan.
  const m = normalise(raw([plan("Pay as you go", 0, { gpu_hours: { included: 0, overage_allowed: true, tiers: [{ up_to: null, price: 4.25, per_units: 1 }, { up_to: null, price: 2.21, per_units: 1 }, { up_to: null, price: 2.06, per_units: 1 }], quote: "GPU Component Cost Per Hour" } })]));
  assert.equal(m.plans![0].price_gap, "configuration");
  const c = planCost(m.plans![0], { usage: { gpu_hours: 200 }, required: [] });
  assert.equal(c.cost, 0);
  assert.match(c.unknowns[0], /^gpu_hours: the page states several prices that depend on the product or configuration/);
  // Real graduated tiers (one open end) are untouched.
  const graduated = normalise(raw([plan("Scale", 0, { gpu_hours: { included: 0, overage_allowed: true, tiers: [{ up_to: 100, price: 3, per_units: 1 }, { up_to: null, price: 2, per_units: 1 }], quote: null } })]));
  assert.equal(planCost(graduated.plans![0], { usage: { gpu_hours: 200 }, required: [] }).cost, 500);
});

test("a read counts as a pricing page only when it gives something to compute with", () => {
  assert.equal(hasPrices(normalise(raw([]))), false);
  assert.equal(hasPrices(normalise(raw([plan("Enterprise", null)]))), false);
  assert.equal(hasPrices(normalise(raw([plan("Free", 0)]))), true);
  assert.equal(hasPrices(normalise(raw([plan("Team", null, { seats: { unlimited: true, included: null, overage_allowed: null, tiers: [], quote: null } })]))), true);
  // What the cost rules discard does not count: the number a slider page shows at its start, a metric that is only "not available".
  assert.equal(hasPrices(normalise(raw([plan("Select", 0, {}, "interactive")]))), false);
  assert.equal(hasPrices(normalise(raw([plan("Starter", 26, {}, "interactive")]))), true);
  assert.equal(hasPrices(normalise(raw([plan("Basic", null, { seats: { status: "not_available", included: null, overage_allowed: null, tiers: [], quote: null } })]))), false);
  // "The price cannot be read" changes the cost, so a change of it is a change of the page's facts.
  const before = normalise(raw([plan("Select", 0)]));
  const after = normalise(raw([plan("Select", 0, {}, "interactive")]));
  assert.deepEqual(diffModels(before, after), [{ path: "Select / price not readable", before: undefined, after: "interactive" }]);
  assert.equal(normalise(raw([], "interactive")).page_gap, "interactive");
  assert.equal(normalise(raw([], "anything else")).page_gap, undefined);
  assert.equal(normalise(raw([plan("Free", 0)], "not_pricing")).page_gap, undefined); // a reason only when there is no plan
});

test("price reads are bounded before they are stored", async () => {
  const { normalise, PRICE_LIMITS } = await import("./domain.ts");
  const big = "q".repeat(500_000);
  const m = normalise({ vendor: "Fixture", currency: "USD", plans: Array.from({ length: 200 }, (_, i) => ({ name: `Plan ${i} ${big}`, base_price: 10, price_quote: big, custom_pricing: false, meters: { emails: { included: 0, overage_allowed: true, tiers: Array.from({ length: 100 }, () => ({ up_to: null, price: 1, per_units: 1000 })), quote: big } }, features: {} })) } as never);
  assert.ok(m.plans!.length <= PRICE_LIMITS.plans);
  assert.ok(JSON.stringify(m).length <= PRICE_LIMITS.bytes);
  assert.ok(m.plans!.every((p) => (p.price_quote ?? "").length <= PRICE_LIMITS.quote && p.name.length <= PRICE_LIMITS.name));
});

test("price reads: trimming is never silent, and only permitted fields are stored", async () => {
  const { normalise } = await import("./domain.ts");
  const { rank } = await import("./pricing.ts");
  // 13 graduated steps: never bridged; the plan is trimmed and the vendor cannot be ranked.
  const steps = Array.from({ length: 13 }, (_, i) => ({ up_to: i < 12 ? (i + 1) * 1000 : null, price: i === 11 ? 1120 : 130, per_units: 1000 }));
  const m = normalise({ vendor: "V", currency: "USD", plans: [{ name: "Pro", base_price: 10, custom_pricing: false, price_quote: null, meters: { emails: { included: 0, overage_allowed: true, tiers: steps, quote: null } }, features: {} }] } as never);
  assert.equal(m.plans![0].price_gap, "trimmed");
  assert.deepEqual(m.plans![0].meters![0].tiers, []);
  const r = rank({ v: m, w: normalise({ vendor: "W", currency: "USD", plans: [{ name: "Pro", base_price: 50, custom_pricing: false, price_quote: null, meters: {}, features: {} }] } as never) }, { usage: { emails: 20000 }, required: [] });
  assert.deepEqual(r.ranked.map((x) => x.id), ["w"]);
  assert.equal(r.unranked[0].id, "v");
  // 21 plans: the left-out one could be the cheapest, so every kept plan is trimmed.
  const many = normalise({ vendor: "V", currency: "USD", plans: Array.from({ length: 21 }, (_, i) => ({ name: `P${i}`, base_price: 100 - i, custom_pricing: false, price_quote: null, meters: {}, features: {} })) } as never);
  assert.ok(many.plans!.every((p) => p.price_gap === "trimmed"));
  const r2 = rank({ many, w: normalise({ vendor: "W", currency: "USD", plans: [{ name: "Pro", base_price: 50, custom_pricing: false, price_quote: null, meters: {}, features: {} }] } as never) }, { usage: {}, required: [] });
  assert.equal(r2.unranked[0].id, "many");
  assert.match(r2.unranked[0].effect, /left out could be cheaper/);
  // An extra property with a huge value is not stored.
  const junk = normalise({ vendor: "V", currency: "USD", plans: [{ name: "Pro", base_price: 10, custom_pricing: false, price_quote: null, meters: { emails: { included: 0, overage_allowed: true, tiers: [{ up_to: null, price: 1, per_units: 1, extra: "x".repeat(500_000) }], quote: null } }, features: {}, junk: "y".repeat(500_000) }], more: "z".repeat(500_000) } as never);
  assert.ok(JSON.stringify(junk).length < 2000);
});
