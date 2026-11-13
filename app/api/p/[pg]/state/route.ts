import { isOwner, stateResponse, type Ctx } from "@/app/api/respond";

export const dynamic = "force-dynamic";
/** Public: anyone with the link may read a playground. `owner` in the answer says whether this browser holds the owner key. */
export const GET = async (req: Request, { params }: Ctx) => stateResponse((await params).pg, null, 200, isOwner(req));
