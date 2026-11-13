import { refused, type Ctx } from "@/app/api/respond";
import { cleanValues, mergeKitExploration, renderOutputs } from "@/lib/kit";
import { update } from "@/lib/store";

/** The person settles a preview playground: the values, the outputs rendered from them on the server, and the time are stored for the agent. */
export async function POST(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  const body = (await req.json().catch(() => null)) as { values?: unknown } | null;
  return update((s) => {
    const k = s.playgrounds[pg]?.kit;
    if (!k) return Response.json({ error: `Playground "${pg}" is not a preview playground.` }, { status: 404 });
    const values = cleanValues(k.kit.controls, body?.values);
    if (!values) return Response.json({ error: "values must give every control a value it can have" }, { status: 400 });
    const at = new Date().toISOString();
    k.settled = { values, outputs: renderOutputs(k.kit, values), at };
    // The settled values are also where the controls are now.
    k.exploration = mergeKitExploration(k.kit.controls, k.exploration, { controls: Object.fromEntries(Object.entries(values).map(([id, final]) => [id, { final }])) }, at) ?? k.exploration;
    return Response.json({ settled: k.settled });
  });
}
