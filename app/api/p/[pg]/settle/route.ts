import { refused, storageFull, type Ctx } from "@/app/api/respond";
import { cleanValues, isCurrent, mergeKitExploration, OUTPUT_LIMIT, outputsSize, renderOutputs } from "@/lib/kit";
import { update } from "@/lib/store";

/** The person settles a preview lab: the values, the outputs rendered from them on the server, and the time are stored for the agent. */
export async function POST(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  const body = (await req.json().catch(() => null)) as { values?: unknown; rev?: unknown } | null;
  return update((s) => {
    const k = s.playgrounds[pg]?.kit;
    if (!k) return Response.json({ error: `Lab "${pg}" is not a preview lab.` }, { status: 404 });
    if (!isCurrent(k, body?.rev)) return Response.json({ error: "Your agent has revised this lab. This page shows the new version in a few seconds; then settle again." }, { status: 409 });
    const values = cleanValues(k.kit.controls, body?.values);
    if (!values) return Response.json({ error: "values must give every control a value it can have" }, { status: 400 });
    // Never store a notice in place of outputs (a kit stored before the limit): refuse, so the agent never writes it into code.
    const size = outputsSize(k.kit, values);
    if (size > OUTPUT_LIMIT) return Response.json({ error: `These values would make outputs of ${size} characters; the limit is ${OUTPUT_LIMIT}. Ask your agent to revise the lab.` }, { status: 413 });
    const at = new Date().toISOString();
    k.settled = { values, outputs: renderOutputs(k.kit, values), at };
    // The settled values are also where the controls are now.
    k.exploration = mergeKitExploration(k.kit.controls, k.exploration, { controls: Object.fromEntries(Object.entries(values).map(([id, final]) => [id, { final }])) }, at) ?? k.exploration;
    return Response.json({ settled: k.settled });
  }).catch(storageFull);
}
