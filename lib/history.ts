// The change history of a price playground, in words a buyer reads: what a vendor did, where the change came from, and
// what it did to the saved choice at that time. Past tense: these rows are history; the state now is said once, above
// them. Pure functions over stored events, so the page and its tests share the wording.
import type { FieldChange, Verdict } from "./diff.ts";

const usd = (n: number) => {
  // A unit price under one cent keeps its digits ($0.0004): rounded to cents it would read as $0.
  if (n !== 0 && Math.abs(n) < 0.01) return "$" + Number(n.toPrecision(2)).toString();
  return "$" + (Math.round(n * 100) % 100 === 0 ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
};
const count = (n: number) => n.toLocaleString("en-US");

/** "raised" or "cut", by the two numbers. */
const moved = (before: number, after: number) => (after > before ? "raised" : "cut");
/** A tier price as flatten() stores it ("50 per 1", "1.5 per 1000"): its number and its unit in words. */
function tierPrice(fact: unknown): { price: number; per: string } | null {
  const m = /^(-?[\d.]+) per (\d+)$/.exec(String(fact ?? ""));
  if (!m) return null;
  return { price: Number(m[1]), per: Number(m[2]) === 1 ? "each" : `per ${count(Number(m[2]))}` };
}

/**
 * One changed fact as a clause without its subject, or null when it has no plain form (the exact fact stays behind the
 * disclosure). `path` is as lib/diff.ts flatten() writes it: "<plan> / base price", "<plan> / <metric> / tier 1 price",
 * "<plan> / <metric> / included", "<plan> / <feature>". `label` gives the words of a metric or feature id.
 */
function clause(c: FieldChange, label: (id: string) => string): { rank: number; text: string } | null {
  const parts = c.path.split(" / ");
  const plan = parts[0];
  const [b, a] = [c.before, c.after];
  if (parts.length === 2 && parts[1] === "base price") {
    if (typeof b === "number" && typeof a === "number") return { rank: 0, text: `${moved(b, a)} ${plan} from ${usd(b)} to ${usd(a)} a month` };
    if (typeof a === "number") return { rank: 0, text: `set a price for ${plan}: ${usd(a)} a month` };
    // Only a price that was stated can stop being stated: a new plan without a price has no plain form.
    return typeof b === "number" ? { rank: 0, text: `no longer stated a price for ${plan}` } : null;
  }
  if (parts.length === 3 && /^tier \d+ price$/.test(parts[2])) {
    const [pb, pa] = [tierPrice(b), tierPrice(a)];
    const tier = parts[2] === "tier 1 price" ? "" : ` (${parts[2].replace(" price", "")})`;
    const what = `${label(parts[1])} on ${plan}${tier}`;
    if (pb && pa && pb.per === pa.per) return { rank: 1, text: `${moved(pb.price, pa.price)} ${what} from ${usd(pb.price)} to ${usd(pa.price)} ${pa.per}` };
    if (pb && pa) return { rank: 1, text: `changed the price of ${what} from ${usd(pb.price)} ${pb.per} to ${usd(pa.price)} ${pa.per}` };
    if (pa) return { rank: 1, text: `set the price of ${what}: ${usd(pa.price)} ${pa.per}` };
    return pb ? { rank: 1, text: `no longer stated a price for ${what}` } : null;
  }
  if (parts.length === 3 && parts[2] === "included") {
    if (typeof b === "number" && typeof a === "number") return { rank: 2, text: `changed the ${label(parts[1])} included in ${plan} from ${count(b)} to ${count(a)}` };
    return null;
  }
  if (parts.length === 3 && parts[2] === "add-on price" && typeof b === "number" && typeof a === "number") return { rank: 2, text: `${moved(b, a)} the ${label(parts[1])} add-on of ${plan} from ${usd(b)} to ${usd(a)} a month` };
  if (parts.length === 2 && parts[1] !== "custom pricing" && parts[1] !== "price not readable" && typeof a === "string" && (b == null || typeof b === "string")) {
    const status: Record<string, string> = { included: "now included", addon: "now a paid add-on", not_available: "no longer available" };
    if (status[a]) return { rank: 2, text: `changed ${label(parts[1])} on ${plan}: ${status[a]}` };
  }
  return null;
}

/**
 * What the vendor did, as one sentence: the one or two changes that matter most to a price (a plan's price first, then a
 * unit price), and how many other facts changed. "Northwind Auth raised Growth from $0 to $49 a month and enterprise SSO
 * connections on Growth from $0 to $50 each."
 */
export function changeSentence(vendor: string, changes: FieldChange[], label: (id: string) => string = (id) => id): string {
  const plain = changes.map((c) => clause(c, label)).filter((x) => x != null).sort((x, y) => x.rank - y.rank);
  if (!plain.length) return `${vendor} changed ${changes.length === 1 ? "1 fact" : `${changes.length} facts`} on its pricing page.`;
  const said = plain.slice(0, 2).map((x) => x.text);
  // Two clauses with the same verb share it: "raised A ... and B ...".
  const [v1, v2] = said.map((t) => t.split(" ")[0]);
  const text = said.length === 2 && v1 === v2 && (v1 === "raised" || v1 === "cut") ? `${said[0]} and ${said[1].slice(v1.length + 1)}` : said.join(", and ");
  const more = changes.length - said.length;
  return `${vendor} ${text}${more > 0 ? `, and changed ${more} more ${more === 1 ? "fact" : "facts"}` : ""}.`;
}

/** Where a change came from, in plain words. A demo vendor's events say that they are a demo. */
export function sourceWords(trigger: "manual" | "webhook" | "auto", demo: boolean): string {
  if (demo) return trigger === "manual" ? "demo vendor: a re-check" : "demo vendor: a test change";
  return trigger === "webhook" ? "the vendor's page changed" : trigger === "auto" ? "a scheduled check" : "a re-check";
}

/**
 * What a change did to the saved choice at that time, in the past tense.
 * `verdict`: as stored with the event; null when nothing was judged. `earlier`: the verdict of the change before this one
 * (for the same saved choice), which says whether the choice held until then. `current`: the event came after the choice
 * that is saved now; an older event was judged, if at all, for a choice that has since been replaced.
 * `own`: the reader owns the playground ("your choice"); a visitor reads "the saved choice".
 */
export function effectSentence(verdict: Verdict | null, earlier: Verdict | null, o: { current: boolean; own: boolean; /** The saved vendor: its id and its name. */ chosenId: string; chosen: string; nameOf: (id: string | null) => string | null }): string {
  if (!verdict) return "Not judged at the time: no choice was saved then.";
  if (!o.current) return `Judged for an earlier saved choice: it ${verdict.holds ? "held" : "did not hold"}.`;
  const choice = o.own ? "Your choice" : "The saved choice";
  const yours = o.own ? "your" : "the saved";
  // The numbers of the stored reason (lib/diff.ts verdict()): the gap to the cheapest and the tolerance.
  const gap = /\$([\d,]+) per month more than the cheapest, (within|above) your tolerance of \$([\d,]+)/.exec(verdict.reason);
  const cheapest = verdict.cheapestNow && verdict.cheapestNow !== o.chosenId ? o.nameOf(verdict.cheapestNow) : null;
  const cost = verdict.chosenCostBefore != null && verdict.chosenCostNow != null && verdict.chosenCostBefore !== verdict.chosenCostNow ? ` Its cost went from ${usd(verdict.chosenCostBefore)} to ${usd(verdict.chosenCostNow)} a month.` : "";
  // How the choice stood before this change: by the change before it, else by the verdict's own "before" (the cheapest
  // vendor holds for sure). Unknown otherwise: the row then says how it stood after the change, without "again" or "stopped".
  const heldBefore = earlier ? earlier.holds : verdict.cheapestBefore === o.chosenId ? true : null;
  if (verdict.holds) {
    const lead = heldBefore === false ? `${choice} held again` : heldBefore === true ? `${choice} still held` : `${choice} held`;
    if (gap) return `${lead}: ${o.chosen} was $${gap[1]} a month over the cheapest${cheapest ? ` (${cheapest})` : ""}, inside ${yours} $${gap[3]} tolerance.${cost}`;
    return `${lead}: ${o.chosen} ${verdict.cheapestBefore !== o.chosenId ? "became" : "was still"} the cheapest.${cost}`;
  }
  const lead = heldBefore === false ? `${choice} still did not hold` : heldBefore === true ? `${choice} stopped holding` : `${choice} did not hold`;
  if (verdict.chosenCostNow == null) return `${lead}: ${o.chosen} could no longer be priced at ${yours} values.`;
  if (gap) return `${lead}: ${o.chosen} was $${gap[1]} a month over the cheapest${cheapest ? ` (${cheapest})` : ""}, above ${yours} $${gap[3]} tolerance.${cost}`;
  return `${lead}: ${o.chosen} was not the cheapest${cheapest ? ` (${cheapest} was)` : ""}.${cost}`;
}

/** How many events show before "Show earlier changes". */
export const SHOWN = 3;
/** The events that show now and the number folded away. Everything shows once the person asked for it. */
export function fold<T>(events: T[], all: boolean): { shown: T[]; folded: number } {
  return all || events.length <= SHOWN ? { shown: events, folded: 0 } : { shown: events.slice(0, SHOWN), folded: events.length - SHOWN };
}
