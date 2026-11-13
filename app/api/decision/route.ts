import type { Decision } from "@/lib/diff";
import { load, publicState, update } from "@/lib/store";

/** Save the settled state: assumptions plus the chosen vendor. */
export async function POST(req: Request) {
  const b = (await req.json()) as Partial<Decision>;
  if (!b.chosen || typeof b.usage !== "object" || !Array.isArray(b.required)) return Response.json({ error: "usage, required and chosen are needed" }, { status: 400 });
  await update((s) => void (s.decision = { usage: b.usage!, required: b.required!, chosen: b.chosen!, savedAt: new Date().toISOString() }));
  return Response.json(publicState(load()));
}

export async function DELETE() {
  await update((s) => void (s.decision = null));
  return Response.json(publicState(load()));
}
