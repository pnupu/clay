// What the person has on the controls, carried over a revision. When the agent revises a playground, the open page
// shows the new version with no reload (app/live.tsx): the screen is mounted again, and the person must find their
// values where they left them, for every control that still exists and whose value is still allowed.
// Kept in this tab's memory only. The screens write it in an effect, so nothing is written while a server renders them.
import { cleanValue, type Control, type Values } from "./kit.ts";

type Metric = { id: string; min: number; max: number };
export type PriceCarry = { spec: string; usage: Record<string, number>; required: string[]; chosen: string | null; tolerance: number; ranges: Record<string, [number, number]> };
export type KitCarry = { rev: string; values: Values };

/** Per playground and view ("<id>:page", "<id>:embedded"). */
export const carriedKit = new Map<string, KitCarry>();
export const carriedPrice = new Map<string, PriceCarry>();

/**
 * The start values of a preview screen after a revision: `base` (what the server holds), with every carried value that
 * its control still allows. Carried values of the same revision are not used: the screen keeps those itself.
 */
export function carryValues(controls: Control[], was: KitCarry | undefined, rev: string, base: Values): Values {
  if (!was || was.rev === rev) return base;
  const out = { ...base };
  for (const c of controls) {
    const v = cleanValue(c, was.values[c.id]);
    if (v !== undefined) out[c.id] = v;
  }
  return out;
}

/**
 * The carried state of a price screen after a revision, or null when there is none (or the spec is the one it was held
 * on: the screen then opens as it always does). A number stays when its metric still exists and the number is inside the
 * range, or the range did not change (the number field allows a typed value beyond it). A requirement and the selected
 * vendor stay while they exist.
 */
export function carryPrice(d: { metrics: Metric[]; features: { id: string }[]; vendors: { id: string }[] }, was: PriceCarry | undefined, spec: string): Pick<PriceCarry, "usage" | "required" | "chosen" | "tolerance"> | null {
  if (!was || was.spec === spec) return null;
  const usage: Record<string, number> = {};
  for (const m of d.metrics) {
    const v = was.usage[m.id], r = was.ranges[m.id];
    if (typeof v === "number" && Number.isFinite(v) && ((v >= m.min && v <= m.max) || (r && r[0] === m.min && r[1] === m.max))) usage[m.id] = v;
  }
  return { usage, required: was.required.filter((id) => d.features.some((f) => f.id === id)), chosen: d.vendors.some((v) => v.id === was.chosen) ? was.chosen : null, tolerance: was.tolerance };
}
