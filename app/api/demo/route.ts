import type { PricingModel } from "@/lib/domain";
import { load, publicState, update } from "@/lib/store";

/** The presenter edits the demo vendor's pricing page. This only changes the page; detection happens through the normal re-check path. */
export async function POST(req: Request) {
  const model = (await req.json()) as PricingModel;
  if (!Array.isArray(model?.plans)) return Response.json({ error: "plans are needed" }, { status: 400 });
  await update((s) => void (s.demoPage = model));
  return Response.json(publicState(load()));
}
