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

export function planCost(plan: Plan, a: Assumptions): PlanCost {
  const r: PlanCost = { plan: plan.name, cost: 0, ineligible: null, unknowns: [], assumed: [], lines: [] };
  if (plan.base_price == null) r.unknowns.push(plan.custom_pricing ? "custom pricing (contact sales)" : "base price not stated");
  else r.cost += plan.base_price;
  r.lines.push({ label: "Base price", amount: plan.base_price, key: "base" });

  for (const [metric, units] of Object.entries(a.usage)) {
    if (!(units > 0)) continue;
    const m = plan.meters?.find((x) => x.metric === metric);
    if (!m) {
      r.assumed.push(`no ${metric} charge stated for this plan`);
      continue;
    }
    const c = meterCost(m, units);
    if (c.ineligible) r.ineligible ??= c.ineligible;
    if (c.unknown) r.unknowns.push(c.unknown);
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
