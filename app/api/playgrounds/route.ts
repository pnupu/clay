import { createPlayground, createPreview, originOf } from "@/lib/pipeline";
import { parseSpec } from "@/lib/spec";
import { load } from "@/lib/store";
import { identify, refused } from "@/app/api/respond";
import { canRead, currentActor, playgroundCapMessage } from "@/lib/accounts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** The playgrounds this caller may open: the examples, their own, or all for the admin. */
export const GET = async (req: Request) => {
  const { actor } = await identify(req.headers);
  return Response.json(Object.values((await load()).playgrounds).filter((p) => canRead(actor, p)).map((p) => ({ id: p.domain.id, question: p.domain.question, createdAt: p.createdAt, vendors: p.domain.vendors.map((v) => v.name) })));
};

/** Create a playground from a spec (the HTTP form of the agent's create_playground tool). The spec is validated in lib/spec.ts. */
export async function POST(req: Request) {
  const no = await refused(req);
  if (no) return no;
  const parsed = parseSpec(await req.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: "Invalid spec", problems: parsed.errors }, { status: 400 });
  const id = parsed.domain.id;
  const capped = playgroundCapMessage((await load()).playgrounds, currentActor());
  if (capped) return Response.json({ error: capped }, { status: 429 });
  const r = parsed.kind === "preview" ? { ...(await createPreview(parsed.domain, parsed.kit)), error: null } : await createPlayground(parsed.domain, originOf(req));
  if (!r.created) return Response.json({ error: `Playground "${id}" already exists.` }, { status: 409 });
  return Response.json({ id, url: `${originOf(req)}/p/${id}`, error: r.error }, { status: r.error ? 502 : 201 });
}
