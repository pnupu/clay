// How a value of a metric is said in a sentence. One place, used by the landing page's hero and by the price page, so
// that "30 GB of database storage" reads the same everywhere. A metric comes from an agent's spec: `label` is the control
// label ("Monthly active users", "Database storage", "Neon compute (CU-hours/month)") and `unit` the plural unit ("users",
// "GB", "CU-hours"). The label alone is a countable noun only for some metrics ("20,000 monthly active users" reads, "30
// database storage" does not), and the unit alone loses what is counted ("600 million tokens": input or output?).

export type Measured = { label: string; unit: string };
export type SayOptions = {
  /** For a value that was found, not set (where the cheapest vendor changes): three figures, and "about" when that rounds it. */
  approx?: boolean;
  /** Names that keep their capital at the start of a label: the vendors of the playground ("Neon compute"). */
  names?: string[];
};

const group = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * A number a person can read. Below a million it is exact ("20,000", "31"); with `approx` it is cut to three figures
 * ("about 20,200"). From a million on it is said in millions or billions with three figures: "600 million", "1.25
 * million", "3 billion". "about" stands before every number that the cut changed ("about 360 million" for 360,050,000).
 */
export function sayNumber(n: number, approx = false): string {
  if (!Number.isFinite(n)) return String(n);
  const big = Math.abs(n) >= 999_500;
  const shown = big || approx ? Number(n.toPrecision(3)) : Math.round(n * 100) / 100;
  const abs = Math.abs(shown);
  const text = abs >= 1e9 ? `${group(shown / 1e9)} billion` : abs >= 1e6 ? `${group(shown / 1e6)} million` : group(shown);
  return shown === n ? text : `about ${text}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The unit as a whole word or words inside a text, whatever the case. */
const within = (unit: string) => new RegExp(`(^|[^A-Za-z0-9])(${escape(unit)})(?=$|[^A-Za-z0-9])`, "i");
/** A unit of measure ("GB", "ms", "CU-hours", "minutes") takes "of": "30 GB of database storage". A counted thing ("members") does not. */
const isMeasure = (unit: string) => unit.length <= 3 || /(hours?|minutes?|seconds?|days?|bytes?)$/i.test(unit);
/** "connections" to "connection", for exactly one. Only the plain plural "s": other plurals stay as written. */
const single = (unit: string) => (/[^s]s$/.test(unit) ? unit.slice(0, -1) : unit);

/**
 * What is counted, from the label: without a note in brackets at the end ("(CU-hours/month)") and without "per month"
 * (the sentences around it say "a month" for the cost). The first word loses its capital when it is an ordinary word
 * ("Monthly", "Database"), and keeps it when it is a name of the playground or not a plain word ("H100", "SSO").
 */
function nounOf(label: string, names: string[]): string {
  const noun = label
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*(?:\/|\bper\b|\ba\b|\beach\b)\s*month\s*$/i, "")
    .trim();
  const first = /^[A-Z][a-z]+(?=$|\s)/.exec(noun)?.[0];
  return first && !names.some((n) => n.split(/\s+/)[0] === first) ? noun.charAt(0).toLowerCase() + noun.slice(1) : noun;
}

/**
 * A value of a metric as it is said in a sentence:
 * - a count, when the label names what is counted: "20,000 monthly active users", "600 million input tokens";
 * - a quantity with a unit of measure, when it does not: "30 GB of database storage", "183 CU-hours of Neon compute";
 * - the unit alone for a counted thing that the label does not name: "5 members" (label "Team size").
 */
export function sayMetric(m: Measured, n: number, o: SayOptions = {}): string {
  const number = sayNumber(n, o.approx);
  const unit = m.unit.trim();
  const noun = nounOf(m.label, o.names ?? []);
  const one = n === 1;
  if (!unit) return `${number} ${noun}`;
  if (within(unit).test(noun)) return `${number} ${one ? noun.replace(within(unit), (_all, before: string, u: string) => before + single(u)) : noun}`;
  const u = one ? single(unit) : unit;
  return isMeasure(unit) && noun ? `${number} ${u} of ${noun}` : `${number} ${u}`;
}

/** A range of one metric: "from 10 to 300 GB of database storage". The unit and the noun are said once, at the end. */
export const sayRange = (m: Measured, from: number, to: number, o: SayOptions = {}) => `${sayNumber(from, o.approx)} to ${sayMetric(m, to, o)}`;

/** Where the cheapest vendor changes, for the hero and the price page: "The cheapest changes at about 360 million input tokens". No full stop: the caller ends or continues the sentence. */
export const changesAt = (m: Measured, at: number, names?: string[]) => `The cheapest changes at ${sayMetric(m, at, { approx: true, names })}`;
