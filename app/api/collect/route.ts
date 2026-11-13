import { DOMAIN } from "@/lib/domain";
import { collect, originOf } from "@/lib/pipeline";
import { load, publicState } from "@/lib/store";

export const maxDuration = 120;

/** Collect one vendor ({id}) or all of them, in parallel. */
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const ids = id ? [id] : DOMAIN.vendors.map((v) => v.id);
  const results = await Promise.allSettled(ids.map((x) => collect(x, originOf(req))));
  const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  return Response.json({ ...publicState(load()), error: failed ? String(failed.reason?.message ?? failed.reason) : null }, { status: failed ? 502 : 200 });
}
