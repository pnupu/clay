// Pure pricing computation. Runs in the browser on every control move: no network, no agent.
import type { Meter, Plan, PricingModel } from "./domain";

export type Usage = Record<string, number>;
export type Assumptions = { usage: Usage; required: string[] };

export type PlanCost = {
  plan: string;
  /** Sum of the known cost parts per month. The true cost is at least this when `unknowns` is not empty. */
  cost: number;
  /** null = eligible, otherwise the reason the plan cannot be used under these assumptions. */
  ineligible: string | null;
  /** Facts the page does not state that affect this cost. Not empty => `cost` is only a lower bound. */
  unknowns: string[];
  /** Things counted as 0 because the page states no charge for them. */
  assumed: string[];
  lines: { label: string; amount: number | null; key: string }[];
};

export type VendorCost = { id: string; best: PlanCost | null; complete: boolean; plans: PlanCost[] };

const fmtN = (n: number) => n.toLocaleString("en-US");

/** Cost of `units` on one meter. Tiers are graduated and apply above `included`. */
export function meterCost(m: Meter, units: number): { amount: number; unknown?: string; ineligible?: string } {
  const hasTiers = !!m.tiers?.length;
  if (m.unlimited) return { amount: 0 };
  if (m.included == null && !hasTiers) return units > 0 ? { amount: 0, unknown: `${m.metric}: included quantity and price not stated` } : { amount: 0 };
  const inc = m.included ?? 0;
  if (units <= inc) return { amount: 0 };
  if (m.overage_allowed === false) return { amount: 0, ineligible: inc === 0 ? `${m.metric} not available` : `${m.metric} limit is ${fmtN(inc)}` };
  if (!hasTiers) return { amount: 0, unknown: `${m.metric}: price above ${fmtN(inc)} not stated` };
  let amount = 0;
  let from = inc;
  for (const t of m.tiers!) {
    const cap = t.up_to ?? Infinity;
    if (cap <= from) continue;
    if (t.price == null || t.per_units == null || t.per_units <= 0) return { amount, unknown: `${m.metric}: price above ${fmtN(from)} not stated` };
    amount += ((Math.min(units, cap) - from) * t.price) / t.per_units;
    from = cap;
    if (units <= cap) return { amount };
  }
  return { amount, unknown: `${m.metric}: price above ${fmtN(from)} not stated` };
}

/** Why a plan's price is not in the page text, in words for the person (domain.ts, PriceGap). */
export const GAP_WORDS = {
  interactive: "the page shows this price only through an interactive slider or calculator, so it cannot be read from the text",
  configuration: "the page states several prices that depend on the product or configuration, so no single price applies",
} as const;

export function planCost(plan: Plan, a: Assumptions): PlanCost {
  const r: PlanCost = { plan: plan.name, cost: 0, ineligible: null, unknowns: [], assumed: [], lines: [] };
  const gap = plan.price_gap ? GAP_WORDS[plan.price_gap] : null;
  // A slider page shows some number at its start position ("$0 /month"): that is not the plan's price.
  const base = plan.price_gap === "interactive" && !plan.base_price ? null : plan.base_price;
  if (base == null) r.unknowns.push(gap ?? (plan.custom_pricing ? "custom pricing (contact sales)" : "base price not stated"));
  else r.cost += base;
  r.lines.push({ label: "Base price", amount: base, key: "base" });

  for (const [metric, units] of Object.entries(a.usage)) {
    if (!(units > 0)) continue;
    const m = plan.meters?.find((x) => x.metric === metric);
    if (!m) {
      r.assumed.push(`no ${metric} charge stated for this plan`);
      continue;
    }
    const c = meterCost(m, units);
    if (c.ineligible) r.ineligible ??= c.ineligible;
    // The specific reason is said once (with the base price or here), not once per metric.
    if (c.unknown && !(gap && r.unknowns.includes(gap))) r.unknowns.push(gap ? `${metric}: ${gap}` : c.unknown);
    r.cost += c.amount;
    r.lines.push({ label: metric, amount: c.unknown ? null : c.amount, key: `meter/${metric}` });
  }

  for (const f of a.required) {
    const fact = plan.features?.find((x) => x.feature === f);
    const key = `feature/${f}`;
    if (!fact || fact.status == null) r.unknowns.push(`${f}: page does not say if the plan has it`);
    else if (fact.status === "not_available") r.ineligible ??= `${f} not available`;
    else if (fact.status === "addon") {
      if (fact.addon_price == null) r.unknowns.push(`${f}: add-on price not stated`);
      else r.cost += fact.addon_price;
      r.lines.push({ label: `${f} add-on`, amount: fact.addon_price, key });
    }
  }
  return r;
}

/** Best plan of one vendor: the cheapest eligible plan with a fully known cost, else the eligible plan with the lowest lower bound. */
export function vendorCost(id: string, model: PricingModel | null, a: Assumptions): VendorCost {
  const plans = (model?.plans ?? []).map((p) => planCost(p, a));
  const eligible = plans.filter((p) => !p.ineligible).sort((x, y) => x.cost - y.cost);
  const complete = eligible.find((p) => p.unknowns.length === 0);
  return { id, best: complete ?? eligible[0] ?? null, complete: !!complete, plans };
}

export type Ranking = {
  /** Vendors with a fully known cost, cheapest first. */
  ranked: VendorCost[];
  /** Vendors that cannot be ranked: missing facts or no eligible plan. */
  unranked: (VendorCost & { effect: string })[];
  cheapest: string | null;
};

export function rank(models: Record<string, PricingModel | null>, a: Assumptions): Ranking {
  const all = Object.entries(models).map(([id, m]) => vendorCost(id, m, a));
  const ranked = all.filter((v) => v.complete).sort((x, y) => x.best!.cost - y.best!.cost);
  const top = ranked[0]?.best?.cost;
  const unranked = all
    .filter((v) => !v.complete)
    .map((v) => {
      let effect: string;
      if (!v.best) effect = "No plan meets these requirements, so it is out of the ranking.";
      else if (top == null) effect = `Costs at least $${fmtN(Math.round(v.best.cost))}; nothing else can be ranked either.`;
      else if (v.best.cost >= top) effect = `Costs at least $${fmtN(Math.round(v.best.cost))}, which is already above the cheapest. The missing facts cannot change the winner.`;
      else effect = `Costs at least $${fmtN(Math.round(v.best.cost))}. It would be the cheapest only if the missing facts add less than $${fmtN(Math.round(top - v.best.cost))} per month. The winner depends on this.`;
      return { ...v, effect };
    });
  return { ranked, unranked, cheapest: ranked[0]?.id ?? null };
}

export type Crossover = { at: number; from: string | null; to: string | null };

/** Points on one metric axis where the cheapest vendor changes, all other assumptions fixed. Scan a grid, then bisect. */
export function crossovers(models: Record<string, PricingModel | null>, a: Assumptions, metric: string, min: number, max: number): Crossover[] {
  const winner = (x: number) => rank(models, { ...a, usage: { ...a.usage, [metric]: x } }).cheapest;
  const N = 240;
  const log = min > 0 && max / min > 50;
  const at = (i: number) => Math.round(log ? min * Math.pow(max / min, i / N) : min + ((max - min) * i) / N);
  const out: Crossover[] = [];
  let px = at(0);
  let pw = winner(px);
  for (let i = 1; i <= N; i++) {
    const x = at(i);
    if (x === px) continue;
    const w = winner(x);
    if (w !== pw) {
      let lo = px;
      let hi = x;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (winner(mid) === pw) lo = mid;
        else hi = mid;
      }
      out.push({ at: hi, from: pw, to: winner(hi) });
    }
    px = x;
    pw = w;
  }
  return out;
}

// ---- How one vendor stands under some assumptions. The page uses it twice: for the saved decision under the saved
// assumptions, and for the same vendor under the values the person is trying now. The two must never be mixed up.

export type Stand = {
  /** cheapest: no ranked vendor costs less. within / outside: dearer than the cheapest, by at most / by more than the tolerance. unknown: a fact is missing. ineligible: no plan fits. unread: no pricing data. */
  state: "cheapest" | "within" | "outside" | "unknown" | "ineligible" | "unread";
  /** The full cost per month, or for "unknown" the sum of the known parts (a lower bound). */
  cost: number | null;
  plan: string | null;
  cheapest: string | null;
  cheapestCost: number | null;
  /** Cost minus the cheapest cost. Null when the vendor cannot be ranked. */
  gap: number | null;
  tolerance: number;
  /** For "unknown" and "ineligible": the first reason, in the words of planCost(). */
  why: string | null;
  /** The decision rule: the vendor can be fully priced and costs at most the tolerance more than the cheapest. */
  holds: boolean;
};

export function stand(models: Record<string, PricingModel | null>, a: Assumptions, chosen: string, tolerance = 0): Stand {
  const r = rank(models, a);
  const base = { cheapest: r.cheapest, cheapestCost: r.ranked[0]?.best?.cost ?? null, tolerance: Math.max(0, tolerance) };
  const v = r.ranked.find((x) => x.id === chosen);
  if (v) {
    const cost = v.best!.cost;
    const gap = cost - base.cheapestCost!;
    // A vendor level with the first row is also the cheapest.
    const state = r.cheapest === chosen || gap <= 0 ? "cheapest" : gap <= base.tolerance ? "within" : "outside";
    return { ...base, state, cost, plan: v.best!.plan, gap, why: null, holds: state !== "outside" };
  }
  const u = r.unranked.find((x) => x.id === chosen);
  if (u?.best) {
    // The cost is the vendor's lower bound. The reason is taken from a plan that states a price, when there is one: "contact
    // sales" on an enterprise plan says less than the fact that is missing on the plan the person would buy.
    const telling = u.plans.find((p) => !p.ineligible && p.unknowns.length > 0 && !p.unknowns.some((x) => x.startsWith("custom pricing"))) ?? u.best;
    return { ...base, state: "unknown", cost: u.best.cost, plan: telling.plan, gap: null, why: telling.unknowns[0] ?? null, holds: false };
  }
  if (u && models[chosen]?.plans?.length) return { ...base, state: "ineligible", cost: null, plan: null, gap: null, why: u.plans.find((p) => p.ineligible)?.ineligible ?? null, holds: false };
  return { ...base, state: "unread", cost: null, plan: null, gap: null, why: null, holds: false };
}

/**
 * The assumptions of a saved decision for every metric of the playground. A metric that the decision does not name (it was
 * added by a later revision) counts as 0, which is how the decision is judged: nothing is charged for it.
 */
export function savedAssumptions(saved: Assumptions, metricIds: string[]): Assumptions {
  return { usage: { ...Object.fromEntries(metricIds.map((k) => [k, 0])), ...saved.usage }, required: saved.required };
}

/** Are the controls at the saved assumptions (complete them with savedAssumptions first)? Every metric and every must-have counts. */
export function sameAssumptions(now: Assumptions, saved: Assumptions): boolean {
  const keys = new Set([...Object.keys(saved.usage), ...Object.keys(now.usage)]);
  return [...keys].every((k) => (now.usage[k] ?? 0) === (saved.usage[k] ?? 0)) && now.required.length === saved.required.length && saved.required.every((f) => now.required.includes(f));
}

const usd = (n: number) => "$" + fmtN(Math.round(n));

/**
 * One sentence about a stand. `tried`: the person is only trying these values (nothing is saved under them), so the
 * sentence says "would". `words` turns metric and feature ids in a reason into the labels of the page. `own`: the reader
 * saved the decision; a visitor on an example reads "the tolerance", not "your tolerance".
 */
export function standSentence(s: Stand, name: string, cheapestName: string | null, tried = false, words: (text: string) => string = (t) => t, own = true): string {
  const costs = tried ? "would cost" : "costs";
  const more = `${name} ${costs} ${usd(s.cost ?? 0)} per month, ${usd(s.gap ?? 0)} more than ${cheapestName ?? "the cheapest vendor"}, the cheapest.`;
  switch (s.state) {
    case "cheapest":
      return `${name} ${tried ? "would be" : "is"} the cheapest at ${usd(s.cost!)} per month.`;
    case "within":
      return `${more} That is within ${own ? "your" : "the saved"} tolerance of ${usd(s.tolerance)}.`;
    case "outside":
      return `${more} ${s.tolerance > 0 ? `That is above ${own ? "your" : "the saved"} tolerance of ${usd(s.tolerance)}.` : `${own ? "You saved it" : "It was saved"} with no tolerance, so it holds only while it is the cheapest.`}`;
    case "unknown":
      return `${name} cannot be fully priced${s.why ? `: ${words(s.why)}` : ""}. Its known costs are at least ${usd(s.cost ?? 0)} per month.`;
    case "ineligible":
      return `no ${name} plan fits${s.why ? `: ${words(s.why)}` : ""}.`;
    default:
      return `${name} has no pricing data.`;
  }
}

// ---- Plans that are separate products, not tiers of one product (GPU models, instance types). The engine prices each
// vendor by its cheapest plan that fits, so such a vendor's price is for its cheapest product: the page must say so.

const TIER_WORD = /\b(free|hobby|starter|basic|essentials?|standard|plus|pro|professional|premium|teams?|business|growth|scale|startup|enterprise|developer|individual|personal|solo|studio|agency|advanced|ultimate|community|launch|pay[- ]as[- ]you[- ]go|payg)\b/i;
/**
 * A model name inside a plan name: capital letters fused with digits ("A100", "H100", "L4", "L40S", "GH200"), an acronym
 * followed by a number ("RTX 6000"), or an instance type ("c5.large"). A quantity is not a model: "50k", "Up to 500
 * contacts", "Tier 10".
 */
const MODEL_NAME = /(^|[\s(/-])([A-Z]{1,5}\d{1,4}[A-Za-z]{0,2}|[A-Z]{2,5} \d{3,5}|[a-z]\d[a-z]?\.[a-z0-9]+)(?=$|[\s),/-])/;

/** True when most plan names of a vendor look like product names: three or more plans, most with a model name, few with a tier word. */
export function productLike(planNames: string[]): boolean {
  if (planNames.length < 3) return false;
  const tiers = planNames.filter((n) => TIER_WORD.test(n)).length;
  const products = planNames.filter((n) => MODEL_NAME.test(n) && !TIER_WORD.test(n)).length;
  return products * 2 > planNames.length && tiers * 3 < planNames.length;
}
