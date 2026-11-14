import { refused, type Ctx } from "@/app/api/respond";
import { currentActor, markExample } from "@/lib/accounts";
import { update } from "@/lib/store";

/**
 * Mark ({"example": true}) or unmark a playground as an example that anyone may open without signing in, and choose the
 * featured example ({"example": true, "featured": true}): the one the landing page embeds. Featuring one unfeatures the
 * others. Admin only: refused() refuses everyone else on this route, and markExample() checks the caller again.
 */
export async function POST(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  const body = (await req.json().catch(() => null)) as { example?: unknown; featured?: unknown } | null;
  const mark = { ...(typeof body?.example === "boolean" ? { example: body.example } : {}), ...(typeof body?.featured === "boolean" ? { featured: body.featured } : {}) };
  const actor = currentActor();
  const r = await update((s) => markExample(s.playgrounds, pg, mark, actor));
  return r.ok ? Response.json({ id: pg, example: r.example, featured: r.featured }) : Response.json({ error: r.error }, { status: r.status });
}
