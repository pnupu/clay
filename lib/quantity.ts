// How a value of a metric is said in a sentence. One place, used by the landing page's hero and by the price page, so
// that "30 GB of database storage" reads the same everywhere. A metric comes from an agent's spec: `label` is the control
// label ("Monthly active users", "Database storage", "Neon compute (CU-hours/month)") and `unit` the plural unit ("users",
// "GB", "CU-hours"). The label alone is a countable noun only for some metrics ("20,000 monthly active users" reads, "30
// database storage" does not), and the unit alone loses what is counted ("600 million tokens": input or output?).

export type Measured = { label: string; unit: string };
export type SayOptions = {
  /** For a value that was found, not set (where the cheapest vendor changes): three figures, and "about" when that rounds it. */
  approx?: boolean;
  /** Names that keep their capital at the start of a label: the vendors of the lab ("Neon compute"). */
  names?: string[];
};

/** Digits of a number: two decimals at most, and three figures for a value below 1 ("0.004", never "0"). */
const group = (n: number) => (n !== 0 && Math.abs(n) < 1 ? n.toLocaleString("en-US", { maximumSignificantDigits: 3 }) : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/**
 * A number a person can read. Below a million it is exact ("20,000", "31"); with `approx` it is cut to three figures
 * ("about 20,200"). From a million on it is said in millions or billions with three figures: "600 million", "1.25
 * million", "3 billion". "about" stands before every number that the cut changed ("about 360 million" for 360,050,000).
 */
export function sayNumber(n: number, approx = false): string {
  return cut(n, approx).text;
}

/** The number as it is shown (`shown`, for "is it exactly one?") and as it is said. */
function cut(n: number, approx: boolean): { shown: number; text: string } {
  if (!Number.isFinite(n)) return { shown: n, text: String(n) };
  const big = Math.abs(n) >= 999_500;
  const small = n !== 0 && Math.abs(n) < 1;
  const shown = big || approx || small ? Number(n.toPrecision(3)) : Math.round(n * 100) / 100;
  const abs = Math.abs(shown);
  const text = abs >= 1e12 ? `${group(shown / 1e12)} trillion` : abs >= 1e9 ? `${group(shown / 1e9)} billion` : abs >= 1e6 ? `${group(shown / 1e6)} million` : group(shown);
  // "about" only for a real cut: the noise of a sum of fractions (0.1 + 0.2) is not one.
  const same = Math.abs(shown - n) <= Math.abs(n) * 1e-9;
  return { shown, text: same ? text : `about ${text}` };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The unit as a whole word or words inside a text, whatever the case. */
const within = (unit: string) => new RegExp(`(^|[^A-Za-z0-9])(${escape(unit)})(?=$|[^A-Za-z0-9])`, "i");
/**
 * A unit of measure takes "of": "30 GB of database storage", "183 CU-hours of Neon compute", "500 USD of monthly spend".
 * Sizes, times and currency codes are such units. A counted thing ("members") is not, and neither is a short name of
 * one ("MAU", "FTE").
 */
const isMeasure = (unit: string) => /^(?:[KMGTP]i?B|ms|s|h|hrs?|mins?|secs?|USD|EUR|GBP)$/i.test(unit) || /(hours?|minutes?|seconds?|days?|bytes?)$/i.test(unit);
/** A short name in capitals for a counted thing ("MAU", "MRU", "FTE"): the label says what it is. */
const isShortName = (unit: string) => /^[A-Z]{2,5}$/.test(unit);
/**
 * The unit for exactly one: "connections" to "connection", "queries" to "query", "mailboxes" to "mailbox". A short unit
 * ("ms", "GB") and a word that is not a plain plural ("series", "status", "analysis") stay as written.
 */
function single(unit: string): string {
  if (unit.length <= 3 || /(series|species|ss|us|is)$/i.test(unit)) return unit;
  // Words in "-ies" whose singular ends in "ie" (not "y").
  if (/(cookies|movies|calories)$/i.test(unit)) return unit.slice(0, -1);
  if (/ies$/i.test(unit)) return unit.slice(0, -3) + "y";
  // "mailboxes", "matches", "batches": "es" goes. After a vowel the "e" belongs to the word: "caches" to "cache".
  if (/(x|sh|ss|[^aeiou]ch)es$/i.test(unit)) return unit.slice(0, -2);
  return /s$/i.test(unit) ? unit.slice(0, -1) : unit;
}

/**
 * What is counted, from the label: without a note in brackets at the end ("(CU-hours/month)") and without "per month"
 * (the sentences around it say "a month" for the cost). The first word loses its capital when it is an ordinary word
 * ("Monthly", "Database"), and keeps it when it is a name of the lab or not a plain word ("H100", "SSO").
 */
function nounOf(label: string, unit: string, names: string[]): string {
  const perMonth = /\s*(?:\/|\bper\b|\ba\b|\beach\b)\s*month\s*$/i;
  const noun = label
    .replace(perMonth, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(perMonth, "")
    // The unit as a note at the end ("Storage in GB") is not what is counted.
    .replace(unit ? new RegExp(`\\s+in\\s+${escape(unit)}$`, "i") : /$^/, "")
    .trim();
  // An ordinary first word, hyphens included ("Monthly", "Sign-ups", "E-mails"); not "H100", "SSO" or "API".
  const first = /^[A-Z][a-z]*(?:-[a-z]+)*(?=$|\s)/.exec(noun)?.[0];
  return first && !names.some((n) => n.split(/\s+/)[0] === first) ? noun.charAt(0).toLowerCase() + noun.slice(1) : noun;
}

/**
 * A value of a metric as it is said in a sentence:
 * - a count, when the label names what is counted: "20,000 monthly active users", "600 million input tokens";
 * - a quantity with a unit of measure, when it does not: "30 GB of database storage", "183 CU-hours of Neon compute";
 * - the unit alone for a counted thing that the label does not name: "5 members" (label "Team size").
 */
export function sayMetric(m: Measured, n: number, o: SayOptions = {}): string {
  const { shown, text: number } = cut(n, o.approx === true);
  const unit = m.unit.trim();
  const noun = nounOf(m.label, unit, o.names ?? []);
  // Singular for the number that is said ("about 1 request"), not for the value behind it.
  const one = shown === 1;
  if (!unit) return `${number} ${noun}`;
  if (within(unit).test(noun)) return `${number} ${one ? noun.replace(within(unit), (_all, before: string, u: string) => before + single(u)) : noun}`;
  if (isMeasure(unit) && noun) return `${number} ${one ? single(unit) : unit} of ${noun}`;
  // "20,000 monthly active users" for the unit "MAU": the label is said when it names things that are counted (it ends
  // in a plural). Else the unit is said: "500 RPM" (label "Rate limit"), "5 members" (label "Team size").
  const last = /[A-Za-z-]+$/.exec(noun)?.[0] ?? "";
  if (isShortName(unit) && /[^s]s$/i.test(last)) return `${number} ${one ? noun.slice(0, -last.length) + single(last) : noun}`;
  return `${number} ${one ? single(unit) : unit}`;
}

/** A range of one metric: "from 10 to 300 GB of database storage". The unit and the noun are said once, at the end. */
export const sayRange = (m: Measured, from: number, to: number, o: SayOptions = {}) => `${sayNumber(from, o.approx)} to ${sayMetric(m, to, o)}`;

/** Where the cheapest vendor changes, for the hero and the price page: "The cheapest changes at about 360 million input tokens". No full stop: the caller ends or continues the sentence. */
export const changesAt = (m: Measured, at: number, names?: string[]) => `The cheapest changes at ${sayMetric(m, at, { approx: true, names })}`;
