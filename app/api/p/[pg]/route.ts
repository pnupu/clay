import { refused, type Ctx } from "@/app/api/respond";
import { DOMAIN } from "@/lib/domain";
import { update } from "@/lib/store";

/** Delete a lab (its owner or the admin; refused() checks that). The built-in example cannot be deleted. */
export async function DELETE(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  if (pg === DOMAIN.id) return Response.json({ error: "The built-in example cannot be deleted." }, { status: 400 });
  const status = await update((s) => {
    const p = s.playgrounds[pg];
    if (!p) return 404;
    // A monitor that is still running would keep sending webhooks for a lab that no longer exists.
    if (Object.values(p.sources).some((x) => x.monitor)) return 409;
    delete s.playgrounds[pg];
    return 204;
  });
  if (status === 409) return Response.json({ error: "This lab has webhook monitors, which only the operator can stop. Ask the operator to stop them, then delete it." }, { status });
  return status === 404 ? Response.json({ error: "Lab not found." }, { status }) : new Response(null, { status });
}
