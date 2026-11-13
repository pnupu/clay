import type { Decision } from "@/lib/diff";
import { load, publicState, update } from "@/lib/store";

/** Save the settled state: assumptions plus the chosen vendor. */
export async function POST(req: Request) {
  const b = (await req.json()) as Partial<Decision>;
  const tolerance = b.tolerance ?? 0;
  if (!b.chosen || typeof b.usage !== "object" || !Array.isArray(b.required)) return Response.json({ error: "usage, required and chosen are needed" }, { status: 400 });
  if (typeof tolerance !== "number" || !(tolerance >= 0) || !Number.isFinite(tolerance)) return Response.json({ error: "tolerance must be a number of dollars per month, 0 or more" }, { status: 400 });
  await update((s) => void (s.decision = { usage: b.usage!, required: b.required!, chosen: b.chosen!, tolerance, savedAt: new Date().toISOString() }));
  return Response.json(publicState(load()));
}

export async function DELETE() {
  await update((s) => void (s.decision = null));
  return Response.json(publicState(load()));
}
