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

/**
 * A change on a real source is recorded only when two fresh extractions agree on it: extraction is not deterministic,
 * and a single read can report a value that is not on the page. Returns the changes both reads report with the same new value.
 */
export function agreed(first: FieldChange[], second: FieldChange[]): FieldChange[] {
  return first.filter((c) => second.some((d) => d.path === c.path && d.after === c.after));
}

/** `tolerance`: the decision is still fine while the chosen vendor costs at most this much more per month than the cheapest. */
export type Decision = Assumptions & { chosen: string; savedAt: string; tolerance?: number };

export type Standing = { holds: boolean; chosenCost: number | null; cheapest: string | null; cheapestCost: number | null; /** Chosen cost minus cheapest cost. */ gap: number | null; tolerance: number };

/** The one "holds" rule: the chosen vendor can be fully priced and costs at most `tolerance` more per month than the cheapest fully priced vendor. */
export function standing(decision: Decision, models: Record<string, PricingModel | null>): Standing {
  const r = rank(models, decision);
  const chosenCost = r.ranked.find((v) => v.id === decision.chosen)?.best?.cost ?? null;
  const cheapestCost = r.ranked[0]?.best?.cost ?? null;
  const tolerance = Math.max(0, decision.tolerance ?? 0);
  const gap = chosenCost == null || cheapestCost == null ? null : chosenCost - cheapestCost;
  // The cheapest vendor always holds, also when a tied vendor is listed first.
  return { holds: gap != null && (r.cheapest === decision.chosen || gap <= tolerance), chosenCost, cheapest: r.cheapest, cheapestCost, gap, tolerance };
}

export type Verdict = {
  holds: boolean;
  cheapestBefore: string | null;
  cheapestNow: string | null;
  chosenCostBefore: number | null;
  chosenCostNow: number | null;
  reason: string;
};

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** Does the saved decision still hold after the sources changed? Judged by standing() under the saved assumptions. */
export function verdict(decision: Decision, before: Record<string, PricingModel | null>, after: Record<string, PricingModel | null>): Verdict {
  const sb = standing(decision, before);
  const sa = standing(decision, after);
  const v = { holds: sa.holds, cheapestBefore: sb.cheapest, cheapestNow: sa.cheapest, chosenCostBefore: sb.chosenCost, chosenCostNow: sa.chosenCost };
  const wasCheapest = sb.cheapest === decision.chosen;
  const costChanged = sb.chosenCost != null && sa.chosenCost != null && sa.chosenCost !== sb.chosenCost;
  if (sa.chosenCost == null) return { ...v, reason: "The chosen vendor can no longer be priced under your assumptions." };
  if (sa.cheapest === decision.chosen) return { ...v, reason: !wasCheapest ? "The chosen vendor is now the cheapest." : costChanged ? "The chosen vendor's cost changed, but it is still the cheapest." : "The chosen vendor is still the cheapest." };
  if (sa.holds) return { ...v, reason: `The chosen vendor costs ${usd(sa.gap!)} per month more than the cheapest, within your tolerance of ${usd(sa.tolerance)}.` };
  if (sa.tolerance > 0) return { ...v, reason: `The chosen vendor now costs ${usd(sa.gap!)} per month more than the cheapest, above your tolerance of ${usd(sa.tolerance)}.` };
  return { ...v, reason: wasCheapest ? "The chosen vendor is no longer the cheapest under your assumptions." : "The chosen vendor was not the cheapest before this change and still is not." };
}
