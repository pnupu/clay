import { refused, type Ctx } from "@/app/api/respond";
import { currentActor, markExample } from "@/lib/accounts";
import { update } from "@/lib/store";

/**
 * Mark ({"example": true}) or unmark a playground as an example that anyone may open without signing in, and choose the
 * featured example ({"featured": true} for an example, or {"example": true, "featured": true}): the one the landing page embeds. Featuring one unfeatures the
 * others. Admin only: refused() refuses everyone else on this route, and markExample() checks the caller again.
 */
export async function POST(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  const body: unknown = await req.json().catch(() => null);
  const mark: { example?: unknown; featured?: unknown } = body && typeof body === "object" ? body : {};
  const actor = currentActor();
  const r = await update((s) => markExample(s.playgrounds, pg, mark, actor));
  return r.ok ? Response.json({ id: pg, example: r.example, featured: r.featured, ...(r.example ? { published: "As an example, this playground is open to everyone. Marking a preview playground as an example lets every visitor run its preview code; its author could learn visitors' control values and IP addresses (the page says so next to the preview). A price playground's saved decision, its tolerance, the verdict and the change history are shown to all; the owner's exploration, control positions and a preview's settled result are not." } : {}) }) : Response.json({ error: r.error }, { status: r.status });
}
