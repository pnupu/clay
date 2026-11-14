// What a gallery card says about an example, taken from its note. Pure text rules: a card never ends in the middle of a
// word or of a sentence without saying so.

/** The person's own words, when the note starts with them: Someone told their agent: "...". */
export function requestOf(note: string): string | null {
  // The closing quote is the first one that a new sentence or the end follows, so a quoted word inside the request stays in it.
  return /^Someone told their agent:\s*["“]([\s\S]{3,400}?)["”][.,]?(?=\s+[A-Z"“]|\s*$)/.exec(note.trim())?.[1].trim() ?? null;
}

/** Cut at the last word that fits, with an ellipsis. Punctuation that would hang before the ellipsis is dropped. */
export function atWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:(\-–—"“]+$/, "")}…`;
}

/** The whole sentences from the start of the note that fit; when not even the first one fits, that sentence cut at a word. */
export function blurbOf(note: string, max = 160): string {
  const sentences = note.trim().split(/(?<=[.!?]["”]?)\s+/).filter(Boolean);
  let out = "";
  for (const s of sentences) {
    if ((out ? out.length + 1 : 0) + s.length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  return out || atWord(sentences[0] ?? "", max);
}

/** The text of a card: the person's request in their words when the note has one, else the start of the note. */
export function cardText(note: string, max = 200): { quote: string } | { blurb: string } | null {
  const request = requestOf(note);
  if (request) return { quote: atWord(request, max) };
  const blurb = blurbOf(note, Math.min(max, 160));
  return blurb ? { blurb } : null;
}
