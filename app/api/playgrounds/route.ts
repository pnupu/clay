import { parseConfig } from "@/lib/config";
import { createPlayground, originOf } from "@/lib/pipeline";
import { load } from "@/lib/store";
import { crossOrigin } from "@/app/api/respond";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

export const GET = () => Response.json(Object.values(load().playgrounds).map((p) => ({ id: p.domain.id, question: p.domain.question, createdAt: p.createdAt, vendors: p.domain.vendors.map((v) => v.name) })));

/** Create a playground from a config (the HTTP form of the agent's create_playground tool). The config is validated in lib/config.ts. */
export async function POST(req: Request) {
  if (crossOrigin(req)) return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  const parsed = parseConfig(await req.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: "Invalid config", problems: parsed.errors }, { status: 400 });
  const r = await createPlayground(parsed.domain, originOf(req));
  if (!r.created) return Response.json({ error: `Playground "${parsed.domain.id}" already exists.` }, { status: 409 });
  return Response.json({ id: parsed.domain.id, url: `${originOf(req)}/p/${parsed.domain.id}`, error: r.error }, { status: r.error ? 502 : 201 });
}
