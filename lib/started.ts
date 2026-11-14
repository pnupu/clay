// A started lab: the person gets a working link in the first seconds, before the agent has researched or written
// the spec. start_playground stores it (title and one line on what the agent is doing), the page at its link shows that
// line, and create_playground with its id replaces it with the built lab at the same URL (lib/store.ts,
// insertPlayground). Abandoned ones do not pile up: a started lab counts toward its person's lab cap, and
// one that no create has filled is dropped 24 hours after its last line (lib/store.ts, STARTED_TTL_MS).
import { createHash } from "node:crypto";
import { currentUserId, StorageRefused } from "./accounts.ts";
import { freeId, newPlayground, oneMoreRefusal, update, type Playground } from "./store.ts";
import { webStamp } from "./web.ts";

/** Limits of the two texts, checked on input (lib/mcp.ts). The title has the limits of a spec title. */
export const STARTED_LIMITS = { title: [3, 200], workingOn: [1, 200] } as const;

/** One line of plain text: an agent's text is shown as text, and a line break or a control character has no place in it. */
export const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();

/** The id a title gives: its words in lowercase with hyphens, cut at a word, 3 to 40 characters as a spec id is. */
export function idOf(title: string): string {
  const words = title.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  let id = "";
  for (const w of words) {
    if ((id ? id.length + 1 : 0) + w.length > 34) break;
    id += (id ? "-" : "") + w;
  }
  id = id || words.join("-").slice(0, 34);
  return /^[a-z][a-z0-9-]{2,}$/.test(id) ? id : `lab-${id}`.replace(/-$/, "").slice(0, 34);
}

/**
 * What an open page asks for every few seconds: a short hash of what the page renders from the spec (the title, the
 * controls, the view), and the started line while the lab is not built. It changes when a create fills a started
 * lab and on every revision; web reads that arrive do not change it (the pages follow those themselves).
 */
export const pageRev = (p: Pick<Playground, "domain" | "kit" | "started">): string =>
  createHash("sha256").update(JSON.stringify([p.domain, p.kit?.kit ?? null, !!p.started])).digest("hex").slice(0, 16);

/**
 * The stamp of the web data a preview page was rendered with (the brand and the web sources, as the page keys them): it
 * changes when a read arrives, a build's or a re-check's. An open page then renders again and shows the new values. A
 * price page needs none: it reloads its own state.
 */
export const dataStamp = (p: Pick<Playground, "kit">): string => (p.kit ? `${p.kit.brandData?.fetchedAt ?? ""}|${webStamp(p.kit.web)}` : "");

export type Started = { id: string; title: string; workingOn: string; at: string };
const view = (id: string, p: Playground): Started => ({ id, title: p.domain.question, workingOn: p.started!.workingOn, at: p.started!.at });

/**
 * Start a lab, or change the line of one that is started. All in ONE store update, like a create: the allowance
 * is checked, a free id is taken and the lab is stored together.
 * - With `id`: the caller's own started lab gets the new line (and title, when given). One that is built already
 *   is left as it is (`built`): a late line must never put a built lab back to "started".
 * - Without `id`: a new started lab. A repeated start with the same title (the first answer was lost) returns the
 *   one that exists.
 * Ownership is the same owner, as for a repeated create: the admin may write everything and must not be handed, or
 * change, somebody else's started lab.
 */
export async function startPlayground(input: { title?: string; workingOn: string; id?: string }, now = () => new Date().toISOString()): Promise<{ started: Started; existed?: boolean } | { built: string } | { missing: string } | { refused: string }> {
  return update((s) => {
    const owner = currentUserId();
    const own = (p: Playground | undefined): p is Playground => !!p && (p.owner ?? null) === owner;
    if (input.id) {
      const p = s.playgrounds[input.id];
      if (!own(p)) return { missing: input.id };
      if (!p.started) return { built: input.id };
      p.started = { workingOn: input.workingOn, at: now() };
      if (input.title) p.domain = { ...p.domain, question: input.title };
      return { started: view(input.id, p), existed: true };
    }
    const title = input.title!;
    const again = Object.entries(s.playgrounds).find(([, p]) => own(p) && p.started && p.domain.question === title);
    if (again) {
      again[1].started = { workingOn: input.workingOn, at: now() };
      return { started: view(again[0], again[1]), existed: true };
    }
    const refused = oneMoreRefusal(s);
    if (refused) return { refused: refused.replace("Nothing was created.", "Nothing was started.") };
    const id = freeId(idOf(title), (x) => !!s.playgrounds[x]);
    s.playgrounds[id] = { ...newPlayground({ id, question: title, product: "", metrics: [], features: [], vendors: [] }), started: { workingOn: input.workingOn, at: now() } };
    return { started: view(id, s.playgrounds[id]) };
  }).catch((e) => {
    if (e instanceof StorageRefused) return { refused: e.message };
    throw e;
  });
}

/** The answer of every write on a started lab except the create that fills it. */
export const notBuilt = (id: string) => `Lab "${id}" is started and not built yet: there is nothing to change or re-check. Build it with create_playground, with "${id}" as the id of the spec.`;
