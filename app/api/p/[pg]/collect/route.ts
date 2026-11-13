import { failure, stateResponse, type Ctx } from "@/app/api/respond";
import { collectAll, originOf } from "@/lib/pipeline";

export const maxDuration = 120;

/** Collect one vendor ({id}) or all of them, in parallel. */
export async function POST(req: Request, { params }: Ctx) {
  const { pg } = await params;
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  try {
    return stateResponse(pg, await collectAll(pg, originOf(req), id ? [id] : undefined));
  } catch (e) {
    return failure(e);
  }
}
