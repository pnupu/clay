import { createPlayground, createPreview, originOf } from "@/lib/pipeline";
import { parseSpec } from "@/lib/spec";
import { load } from "@/lib/store";
import { refused } from "@/app/api/respond";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export const GET = async () => Response.json(Object.values((await load()).playgrounds).map((p) => ({ id: p.domain.id, question: p.domain.question, createdAt: p.createdAt, vendors: p.domain.vendors.map((v) => v.name) })));

/** Create a playground from a spec (the HTTP form of the agent's create_playground tool). The spec is validated in lib/spec.ts. */
export async function POST(req: Request) {
  const no = refused(req);
  if (no) return no;
  const parsed = parseSpec(await req.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: "Invalid spec", problems: parsed.errors }, { status: 400 });
  const id = parsed.domain.id;
  const r = parsed.kind === "preview" ? { ...(await createPreview(parsed.domain, parsed.kit)), error: null } : await createPlayground(parsed.domain, originOf(req));
  if (!r.created) return Response.json({ error: `Playground "${id}" already exists.` }, { status: 409 });
  return Response.json({ id, url: `${originOf(req)}/p/${id}`, error: r.error }, { status: r.error ? 502 : 201 });
}
