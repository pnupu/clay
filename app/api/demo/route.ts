import type { PricingModel } from "@/lib/domain";
import { DOMAIN } from "@/lib/domain";
import { originOf, recheck } from "@/lib/pipeline";
import { load, update } from "@/lib/store";
import { refused, stateResponse } from "@/app/api/respond";

export const maxDuration = 300;

/**
 * The presenter edits the demo vendor's pricing page. Publishing triggers the normal re-check of every demo source, in this
 * request (no watch loop), and the answer is the state after it: on a deployment Context.dev reads the page, as for a real source.
 */
export async function POST(req: Request) {
  const no = refused(req);
  if (no) return no;
  const model = (await req.json()) as PricingModel;
  if (!Array.isArray(model?.plans)) return Response.json({ error: "plans are needed" }, { status: 400 });
  await update((s) => void (s.demoPage = model));
  const watching = Object.entries((await load()).playgrounds).flatMap(([pg, p]) => Object.values(p.sources).filter((x) => x.demo && x.snapshot).map((x) => [pg, x.id]));
  const results = await Promise.allSettled(watching.map(([pg, id]) => recheck(pg, id, "auto", originOf(req))));
  const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  return stateResponse(DOMAIN.id, failed ? String(failed.reason?.message ?? failed.reason) : null);
}
