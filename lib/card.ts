// What a gallery card says about an example, taken from its note. Pure text rules: a card never ends in the middle of a
// word, and never in the middle of a sentence without an ellipsis.

/** The longest start of a note that a card shows when the note has no quoted request. */
export const BLURB_MAX = 160;

/** Words the narrator of a note goes on with after the person's request: Their own agent built..., It has..., The agent... */
const NARRATOR = "(?:Their|They|The|It|Its|This|That|An?|Her|His|We|Our|Move|Drag|Press|Try|Built)\\b";

/**
 * The person's own words, when the note starts with them: Someone told their agent: "...".
 * The request ends at the first closing quote that the narrator's next sentence (or the end) follows, so a quoted word
 * inside the request stays in it ('make the "Buy" Button pop').
 */
export function requestOf(note: string): string | null {
  const text = note.trim();
  const open = /^Someone told their agent:\s*["“]/.exec(text);
  if (!open) return null;
  const rest = text.slice(open[0].length);
  const narrated = new RegExp(`^([\\s\\S]{3,300}?)["”][.,]?(?=\\s+${NARRATOR}|\\s*$)`).exec(rest);
  if (narrated) return narrated[1].trim();
  // Another continuation: only a request with no quote inside it, closed before a new sentence. Anything else gives no
  // request, so that the agent's own prose is never shown as the person's words.
  return /^([^"“”]{3,300})["”][.,]?(?=\s+[A-Z"“]|\s*$)/.exec(rest)?.[1].trim() ?? null;
}

/** Cut at the last whole word that fits, with an ellipsis. Punctuation that would hang before the ellipsis is dropped. */
export function atWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  // The cut may end exactly at a word. Else it goes back to the last space. Only one long token is cut inside.
  const whole = text[max - 1] === " ";
  return `${(whole || at <= 0 ? cut : cut.slice(0, at)).replace(/[\s.,;:!?(\-–—"“”]+$/, "")}…`;
}

/** An abbreviation's full stop does not end a sentence: "e.g. Vercel", "vs. Netlify", "approx. 40k". */
const ABBREVIATION = /(?:\b(?:e\.g|i\.e|vs|approx|etc|incl|excl|no|dr|mr|mrs|ms|st|inc|ltd|co)\.)$/i;

/** The sentences of a note. A full stop after an abbreviation, or one that no capital letter, digit or quote follows, ends nothing. */
function sentences(note: string): string[] {
  const out: string[] = [];
  for (const piece of note.trim().split(/(?<=[.!?]["”]?)\s+(?=[A-Z0-9"“(])/).filter(Boolean)) {
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  return out;
}

/** The whole sentences from the start of the note that fit; when not even the first one fits, that sentence cut at a word. */
export function blurbOf(note: string, max = BLURB_MAX): string {
  const all = sentences(note);
  let out = "";
  for (const s of all) {
    if ((out ? out.length + 1 : 0) + s.length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  return out || atWord(all[0] ?? "", max);
}

/** The text of a card: the person's request in their words when the note has one, else the start of the note. */
export function cardText(note: string, max = 200): { quote: string } | { blurb: string } | null {
  const request = requestOf(note);
  if (request) return { quote: atWord(request, max) };
  const blurb = blurbOf(note, Math.min(max, BLURB_MAX));
  return blurb ? { blurb } : null;
}

/**
 * Why the agent left something out of a playground, as the page shows it after the name and a dash: "SendGrid — its
 * pricing page states no price." The reason is the agent's own text and stays as written (no word is re-cased, so a name
 * keeps its spelling); only a full stop is added when the text does not end a sentence.
 */
export function reasonOf(reason: string): string {
  const text = reason.trim();
  return /[.!?]["”')\]]?$/.test(text) ? text : `${text}.`;
}

/**
 * The label of a playground on a card, from what it is built on: a preview with web sources or a brand is about live web
 * data, a plain preview is the real thing tuned by hand, a price playground keeps its own label. `whose` words the
 * person's own data: "your numbers" in a person's own list, "their numbers" on an example card.
 */
export function kindLabel(p: { price: boolean; preview: boolean; web: number; brand: boolean; inline: boolean }, whose: "yours" | "theirs" = "theirs"): string {
  if (!p.preview) return p.price ? "Price decision" : "Playground";
  const numbers = p.inline ? ` × ${whose === "yours" ? "your" : "their"} numbers` : "";
  if (p.web > 0) return `Live web data${p.brand ? " and brand colours" : ""}${numbers}`;
  if (p.brand) return "Real brand colours";
  return "Preview, tuned by hand";
}

/** The hosts of a list of page addresses or domains, as a card names them: no "www.", each one once, in order. */
export function hostsOf(pages: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const page of pages) {
    if (!page?.trim()) continue;
    let host = page.trim();
    try {
      host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(host) ? host : `https://${host}`).hostname;
    } catch {
      // Not an address: the text stands as it is.
    }
    host = host.replace(/^www\./i, "").toLowerCase();
    if (host && !out.includes(host)) out.push(host);
  }
  return out;
}

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** A word that names one thing by itself: a model number such as "a6000", "l4", "4090"; not "5", "24" or "gpu". */
const isCode = (w: string) => /\d/.test(w) && (w.length >= 4 || (w.length >= 2 && /[a-z]/.test(w)));
export type JoinNames = { exact: Set<string>; partial: string[]; codes: Set<string> };

/**
 * The names a preview can join its page rows on: the short texts of its own data (a model id from a measurements file)
 * and the values and labels of its select options, in plain form (lower case, letters and digits only).
 * - `exact`: a row whose whole name is one of them.
 * - `partial`: a name with a digit or several words names one thing, so it also matches inside a longer row name:
 *   "h100sxm" in "NVIDIA H100 SXM". "claude" alone does not.
 * - `codes`: a model number in a name ("a6000" in "RTX A6000") matches a row that has it as a whole word ("NVIDIA A6000"),
 *   so "a10" does not take "A100".
 * The preview's own code decides what it uses; this is the page's best reading of it, for what to show first.
 */
export function joinNames(inline: unknown, options: string[] = []): JoinNames {
  const exact = new Set<string>();
  const partial = new Set<string>();
  const codes = new Set<string>();
  const add = (text: string) => {
    if (text.length > 60) return;
    const p = plain(text);
    if (p.length < 2) return;
    exact.add(p);
    const words = wordsOf(text);
    if (p.length >= 4 && (/\d/.test(p) || words.length > 1)) partial.add(p);
    words.filter(isCode).forEach((w) => codes.add(w));
  };
  const walk = (x: unknown, depth: number) => {
    if (typeof x === "string") add(x);
    else if (depth < 6 && Array.isArray(x)) x.slice(0, 200).forEach((y) => walk(y, depth + 1));
    else if (depth < 6 && x && typeof x === "object") Object.values(x).slice(0, 200).forEach((y) => walk(y, depth + 1));
  };
  walk(inline, 0);
  options.forEach(add);
  return { exact, partial: [...partial], codes };
}

/** Whether a row read from a page (by its name) is one that the preview's own names match. */
export function rowNamed(name: unknown, names: JoinNames): boolean {
  if (typeof name !== "string") return false;
  const n = plain(name);
  if (!n) return false;
  return names.exact.has(n) || names.partial.some((p) => n.includes(p)) || wordsOf(name).some((w) => names.codes.has(w));
}
