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
  const n = parse(raw);
  if (n == null) return { value: o.prev, note: `“${raw.slice(0, 20)}” is not a number, so ${fmt(o.prev)} stays.` };
  const max = o.max ?? Infinity;
  if (n < o.min) return { value: o.min, note: `${fmt(n)} is below ${fmt(o.min)}, the lowest value here, so it is set to ${fmt(o.min)}.` };
  if (n > max) return { value: max, note: `${fmt(n)} is above ${fmt(max)}, the highest value here, so it is set to ${fmt(max)}.` };
  return { value: n, note: null };
}

/** A plain number ("-5", "12.5", "300000") or one with thousands commas ("300,000"). A decimal comma ("12,5") is not a number. */
function parse(raw: string): number | null {
  const plain = /^[-+]?(\d+\.?\d*|\.\d+)$/.test(raw) ? raw : /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw) ? raw.replace(/,/g, "") : null;
  const n = plain == null ? NaN : Number(plain);
  return Number.isFinite(n) ? n : null;
}

/** May this text take effect at once, while the person is still typing? Only a complete number inside the range. */
export function liveNumber(text: string, o: { min: number; max?: number }): number | null {
  const raw = text.trim();
  if (raw.endsWith(".")) return null;
  const n = parse(raw);
  return n != null && n >= o.min && n <= (o.max ?? Infinity) ? n : null;
}
