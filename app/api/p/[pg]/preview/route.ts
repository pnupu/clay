import { refused, type Ctx } from "@/app/api/respond";
import { update } from "@/lib/store";

/**
 * The page reports what happened when the owner's browser ran the preview code: it ran, or it failed with this error.
 * The agent reads it with read_playground and repairs the code. The latest report stands. The error text comes from
 * agent-supplied code in the frame: it is cut short and stored as data.
 */
export async function POST(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  const body = (await req.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null;
  const error = typeof body?.error === "string" ? body.error.replace(/\s+/g, " ").trim().slice(0, 500) : null;
  if (!error && body?.ok !== true) return new Response(null, { status: 400 });
  const status = await update((s) => {
    const k = s.playgrounds[pg]?.kit;
    if (!k) return 404;
    k.preview = { status: error ? "failed" : "ok", error, at: new Date().toISOString() };
    return 204;
  });
  return new Response(null, { status });
}
