import { access, stateResponse, type Ctx } from "@/app/api/respond";

export const dynamic = "force-dynamic";
/**
 * Anyone may read an example; any other playground only its owner and the admin. A missing and a private playground get
 * the same answer, so the answer does not tell whether an id exists. `owner` says whether this caller may write it.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { pg } = await params;
  const a = await access(req, pg);
  if (!a?.read) return Response.json({ error: "Playground not found, or it is private." }, { status: 404 });
  return stateResponse(pg, null, 200, a.write);
}
