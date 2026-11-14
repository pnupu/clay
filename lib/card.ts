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
 * What the agent left out of a playground, as a clause after "because": "its pricing page states no price." The reason is
 * the agent's own sentence, so a leading "because" and a capital first letter are folded in, and a full stop is added.
 */
export function becauseOf(reason: string): string {
  const text = reason.trim().replace(/^because\s+/i, "");
  const lowered = /^[A-Z][a-z]/.test(text) && !/^I\b/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
  return /[.!?]$/.test(lowered) ? lowered : `${lowered}.`;
}
