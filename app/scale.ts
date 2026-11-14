import type { MetricDef } from "@/lib/domain";

// ---- Slider scales: a wide range needs a non-linear slider. Values always stay inside [min, max].
export const isLog = (m: MetricDef) => m.min > 0 && m.max / m.min > 50;
export const isCubic = (m: MetricDef) => m.min === 0 && m.max > 1000;
const round2 = (x: number) => {
  if (x < 100) return Math.round(x);
  const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.round(x / p) * p;
};
export const clamp = (m: MetricDef, v: number) => Math.min(m.max, Math.max(m.min, v));
// A small range keeps every whole number; a large one moves in steps of two significant digits (the number field takes exact values).
export const toValue = (m: MetricDef, pos: number) => clamp(m, (m.max <= 1000 ? Math.round : round2)(isLog(m) ? m.min * Math.pow(m.max / m.min, pos / 1000) : isCubic(m) ? m.max * Math.pow(pos / 1000, 3) : m.min + ((m.max - m.min) * pos) / 1000));
export const toPos = (m: MetricDef, v: number) => (isLog(m) ? (1000 * Math.log(clamp(m, v) / m.min)) / Math.log(m.max / m.min) : isCubic(m) ? 1000 * Math.cbrt(clamp(m, v) / m.max) : (1000 * (clamp(m, v) - m.min)) / (m.max - m.min));
