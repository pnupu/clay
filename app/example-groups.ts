import { orderExamples } from "@/lib/accounts";
import { load } from "@/lib/store";

/** The examples in the nav's panel, by what each is built on. */
export async function exampleGroups() {
  const examples = orderExamples((await load()).playgrounds);
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
