import { originOf, recheck } from "@/lib/pipeline";
import { load, publicState } from "@/lib/store";

export const maxDuration = 120;

/** "Re-check now": one source ({id}) or all. Same function the webhook calls. */
export async function POST(req: Request) {
  const { id, trigger } = (await req.json().catch(() => ({}))) as { id?: string; trigger?: "manual" | "auto" };
  const ids = id ? [id] : Object.keys(load().sources);
  const results = await Promise.allSettled(ids.map((x) => recheck(x, trigger === "auto" ? "auto" : "manual", originOf(req))));
  const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  return Response.json({ ...publicState(load()), error: failed ? String(failed.reason?.message ?? failed.reason) : null }, { status: failed ? 502 : 200 });
}
