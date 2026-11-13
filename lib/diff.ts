// Change diff between two extractions of one source, and the verdict on a saved decision. Pure.
import type { PricingModel } from "./domain";
import { rank, type Assumptions } from "./pricing.ts";

export type Fact = string | number | boolean | null;
export type FieldChange = { path: string; before: Fact | undefined; after: Fact | undefined };

/** One entry per extracted fact, keyed by a stable readable path. Quotes are evidence, not facts, so they are left out. */
export function flatten(model: PricingModel | null): Record<string, Fact> {
  const out: Record<string, Fact> = {};
  for (const p of model?.plans ?? []) {
    const k = `${p.name} / `;
    out[k + "base price"] = p.base_price;
    out[k + "custom pricing"] = p.custom_pricing;
    for (const m of p.meters ?? []) {
      out[`${k}${m.metric} / included`] = m.included;
      out[`${k}${m.metric} / overage allowed`] = m.overage_allowed;
      (m.tiers ?? []).forEach((t, i) => {
        out[`${k}${m.metric} / tier ${i + 1} up to`] = t.up_to;
        out[`${k}${m.metric} / tier ${i + 1} price`] = t.price == null || t.per_units == null ? null : `${t.price} per ${t.per_units}`;
      });
    }
    for (const f of p.features ?? []) {
      out[`${k}${f.feature}`] = f.status;
      if (f.status === "addon") out[`${k}${f.feature} / add-on price`] = f.addon_price;
    }
  }
  return out;
}

export function diffModels(before: PricingModel | null, after: PricingModel | null): FieldChange[] {
  const a = flatten(before);
  const b = flatten(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((path) => a[path] !== b[path])
    .map((path) => ({ path, before: a[path], after: b[path] }));
}

export type Decision = Assumptions & { chosen: string; savedAt: string };
export type Verdict = {
  holds: boolean;
  cheapestBefore: string | null;
  cheapestNow: string | null;
  chosenCostBefore: number | null;
  chosenCostNow: number | null;
  reason: string;
};

/** Does the saved decision still hold after the sources changed? It holds when the chosen vendor keeps its position against the cheapest. */
export function verdict(decision: Decision, before: Record<string, PricingModel | null>, after: Record<string, PricingModel | null>): Verdict {
  const cost = (r: ReturnType<typeof rank>) => r.ranked.find((v) => v.id === decision.chosen)?.best?.cost ?? null;
  const rb = rank(before, decision);
  const ra = rank(after, decision);
  const v = { cheapestBefore: rb.cheapest, cheapestNow: ra.cheapest, chosenCostBefore: cost(rb), chosenCostNow: cost(ra) };
  const wasCheapest = rb.cheapest === decision.chosen;
  const costChange = v.chosenCostBefore != null && v.chosenCostNow != null && v.chosenCostNow !== v.chosenCostBefore;
  if (v.chosenCostNow == null) return { ...v, holds: false, reason: "The chosen vendor can no longer be priced under your assumptions." };
  if (ra.cheapest === decision.chosen) return { ...v, holds: true, reason: wasCheapest ? (costChange ? "The chosen vendor's cost changed, but it is still the cheapest." : "The chosen vendor is still the cheapest.") : "The chosen vendor is now the cheapest." };
  if (wasCheapest) return { ...v, holds: false, reason: "The chosen vendor is no longer the cheapest under your assumptions." };
  if (ra.cheapest !== rb.cheapest) return { ...v, holds: false, reason: "The cheapest vendor changed under your assumptions." };
  if (v.chosenCostBefore != null && v.chosenCostNow > v.chosenCostBefore) return { ...v, holds: false, reason: "The chosen vendor was not the cheapest and now costs more." };
  return { ...v, holds: true, reason: "The ranking that your decision rests on did not change." };
}
