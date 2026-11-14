import { createPlayground, createPreview, originOf } from "@/lib/pipeline";
import { MAX_SPEC_BYTES, parseSpec } from "@/lib/spec";
import { load } from "@/lib/store";
import { badKey, identify, refused } from "@/app/api/respond";
import { canRead } from "@/lib/accounts";
import { readJson } from "@/app/api/body";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** The playgrounds this caller may open: the examples, their own, or all for the admin. */
export const GET = async (req: Request) => {
  const { actor, bad } = await identify(req.headers, req);
  const badAnswer = badKey(bad);
  if (badAnswer) return badAnswer;
  return Response.json(Object.values((await load()).playgrounds).filter((p) => canRead(actor, p)).map((p) => ({ id: p.domain.id, question: p.domain.question, createdAt: p.createdAt, vendors: p.domain.vendors.map((v) => v.name) })));
};

/** Create a playground from a spec (the HTTP form of the agent's create_playground tool). The spec is validated in lib/spec.ts. */
export async function POST(req: Request) {
  const no = await refused(req);
  if (no) return no;
  const body = await readJson(req, MAX_SPEC_BYTES);
  if ("tooLarge" in body) return Response.json({ error: `The request is larger than ${MAX_SPEC_BYTES} bytes. Nothing was read.` }, { status: 413 });
  const parsed = parseSpec(body.json);
  if (!parsed.ok) return Response.json({ error: "Invalid spec", problems: parsed.errors }, { status: 400 });
  // The owner's allowance and the id are settled inside the create (one store update). A taken id gets a suffix.
  const r = parsed.kind === "preview" ? await createPreview(parsed.domain, parsed.kit) : await createPlayground(parsed.domain, originOf(req));
  if ("refused" in r) return Response.json({ error: r.refused }, { status: 429 });
  // This HTTP form has no short client deadline: it answers when every page is read (the MCP tool answers earlier).
  const error = "work" in r ? await r.work : (await r.brand, null);
  return Response.json({ id: r.id, url: `${originOf(req)}/p/${r.id}`, error }, { status: error ? 502 : 201 });
}
