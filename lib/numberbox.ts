// The rule of a typed number box (price controls and the tolerance): what the person typed is theirs while they type,
// and it is committed on Enter or when they leave the box. No React here, so it is tested on its own.

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });

/**
 * Commit the text of a number box. Empty or not a number: the previous value stays, and the note says so. Outside the
 * range: the nearest end of the range, and the note says so. Grouping commas and spaces ("300,000") are accepted.
 * `note` is null only when the value is exactly what the person typed.
 */
export function commitNumber(text: string, o: { min: number; max?: number; prev: number }): { value: number; note: string | null } {
  const raw = text.trim();
  if (raw === "") return { value: o.prev, note: `The box was empty, so ${fmt(o.prev)} stays.` };
  const n = Number(raw.replace(/[,\s_]/g, ""));
  if (!Number.isFinite(n) || !/^[-+]?[\d.,\s_]+(e[-+]?\d+)?$/i.test(raw)) return { value: o.prev, note: `“${raw.slice(0, 20)}” is not a number, so ${fmt(o.prev)} stays.` };
  const max = o.max ?? Infinity;
  if (n < o.min) return { value: o.min, note: `${fmt(n)} is below ${fmt(o.min)}, the lowest value here, so it is set to ${fmt(o.min)}.` };
  if (n > max) return { value: max, note: `${fmt(n)} is above ${fmt(max)}, the highest value here, so it is set to ${fmt(max)}.` };
  return { value: n, note: null };
}

/** May this text take effect at once, while the person is still typing? Only a complete number inside the range. */
export function liveNumber(text: string, o: { min: number; max?: number }): number | null {
  const raw = text.trim();
  if (!/^[-+]?[\d,]*\.?\d+$/.test(raw)) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= o.min && n <= (o.max ?? Infinity) ? n : null;
}
