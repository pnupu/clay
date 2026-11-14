import { agentConnected, orderExamples, type Actor } from "@/lib/accounts";
import { load, type Store } from "@/lib/store";

/** The examples in the nav's panel, by what each is built on. */
function exampleGroups(playgrounds: Store["playgrounds"]) {
  const examples = orderExamples(playgrounds);
  const groups: { label: string; items: { id: string; title: string; line: string }[] }[] = [
    { label: "Tuned by hand", items: [] },
    { label: "On live web data", items: [] },
    { label: "Price decisions", items: [] },
  ];
  for (const [id, p] of examples) {
    const title = p.domain?.question ?? id;
    if (!p.kit) groups[2].items.push({ id, title, line: (p.domain?.vendors ?? []).map((v) => v.name).slice(0, 3).join(", ") });
    else if (p.kit.kit.web?.length) groups[1].items.push({ id, title, line: "Prices read from the vendors' pages" });
    else groups[0].items.push({ id, title, line: p.kit.kit.controls.slice(0, 3).map((c) => c.label).join(", ") });
  }
  return groups.filter((g) => g.items.length);
}

/**
 * What both headers read from the store, in one read: the example groups, and whether the viewer is past connecting an
 * agent (lib/accounts.ts, agentConnected).
 * A header must not take a page down: when the store cannot be read, the list is empty and the header shows a plain link.
 */
export async function headerState(me: Actor) {
  let s: Store | null = null;
  try {
    s = await load();
  } catch {}
  return { groups: s ? exampleGroups(s.playgrounds) : [], connected: agentConnected(me, s?.users ?? {}) };
}
