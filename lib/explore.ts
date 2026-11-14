// The exploration summary: per control, the range of values the person tried and the value they ended on.
// The browser sends what happened since its last report; this merges it into the stored summary. The report is untrusted input.
import type { Domain } from "./domain.ts";
import type { Exploration } from "./store.ts";

const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1e15;

/** Returns the merged summary, or null when the report is malformed. Controls and vendors the lab does not have are ignored. */
export function mergeExploration(d: Domain, prev: Exploration | null, report: unknown, now: string): Exploration | null {
  const r = report as { metrics?: unknown; required?: unknown; selected?: unknown } | null;
  if (!r || typeof r !== "object" || typeof r.metrics !== "object" || r.metrics === null || !Array.isArray(r.required)) return null;
  const out: Exploration = { metrics: {}, features: {}, selected: null, updatedAt: now };
  for (const m of d.metrics) {
    const was = prev?.metrics[m.id] ?? { start: m.initial, min: m.initial, max: m.initial, final: m.initial };
    const seen = (r.metrics as Record<string, { min?: unknown; max?: unknown; final?: unknown }>)[m.id];
    if (seen === undefined) out.metrics[m.id] = was;
    else if (!seen || !num(seen.min) || !num(seen.max) || !num(seen.final)) return null;
    else out.metrics[m.id] = { start: was.start, min: Math.min(was.min, seen.min, seen.final), max: Math.max(was.max, seen.max, seen.final), final: seen.final };
  }
  for (const f of d.features) {
    const was = prev?.features[f.id] ?? { final: false, toggles: 0 };
    const final = r.required.includes(f.id);
    out.features[f.id] = { final, toggles: was.toggles + (final !== was.final ? 1 : 0) };
  }
  out.selected = typeof r.selected === "string" && d.vendors.some((v) => v.id === r.selected) ? r.selected : null;
  return out;
}
