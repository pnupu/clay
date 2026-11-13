import { refused, type Ctx } from "@/app/api/respond";
import { update } from "@/lib/store";

/** Mark ({"example": true}) or unmark a playground as an example that anyone may open without signing in. Admin only (refused()). */
export async function POST(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  const example = ((await req.json().catch(() => null)) as { example?: unknown } | null)?.example;
  if (typeof example !== "boolean") return Response.json({ error: 'Send {"example": true} or {"example": false}.' }, { status: 400 });
  const found = await update((s) => {
    const p = s.playgrounds[pg];
    if (p) p.example = example;
    return !!p;
  });
  return found ? Response.json({ id: pg, example }) : Response.json({ error: "Playground not found." }, { status: 404 });
}
