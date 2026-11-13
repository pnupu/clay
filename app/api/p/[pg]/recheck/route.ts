import { failure, stateResponse, type Ctx } from "@/app/api/respond";
import { originOf, recheck } from "@/lib/pipeline";
import { load } from "@/lib/store";

export const maxDuration = 120;

/** "Re-check now": one source ({id}) or all. Same function the webhook and the agent tool call. */
export async function POST(req: Request, { params }: Ctx) {
  const { pg } = await params;
  const { id, trigger } = (await req.json().catch(() => ({}))) as { id?: string; trigger?: "manual" | "auto" };
  const p = load().playgrounds[pg];
  if (!p) return stateResponse(pg);
  try {
    const results = await Promise.allSettled((id ? [id] : Object.keys(p.sources)).map((x) => recheck(pg, x, trigger === "auto" ? "auto" : "manual", originOf(req))));
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    return stateResponse(pg, failed ? String(failed.reason?.message ?? failed.reason) : null);
  } catch (e) {
    return failure(e);
  }
}
