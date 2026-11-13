import { refused, stateResponse, type Ctx } from "@/app/api/respond";
import { load, update } from "@/lib/store";

const bad = (error: string) => Response.json({ error }, { status: 400 });

/** Save the settled state: assumptions, the chosen vendor and the tolerance of the "holds" rule. */
export async function POST(req: Request, { params }: Ctx) {
  const no = refused(req);
  if (no) return no;
  const { pg } = await params;
  const p = load().playgrounds[pg];
  if (!p) return stateResponse(pg);
  const b = (await req.json().catch(() => null)) as { usage?: unknown; required?: unknown; chosen?: unknown; tolerance?: unknown } | null;
  const tolerance = b?.tolerance ?? 0;
  if (!b || typeof b.usage !== "object" || b.usage === null || !Array.isArray(b.required) || typeof b.chosen !== "string") return bad("usage (object), required (array) and chosen (vendor id) are needed");
  if (!p.domain.vendors.some((v) => v.id === b.chosen)) return bad(`chosen must be one of: ${p.domain.vendors.map((v) => v.id).join(", ")}`);
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) return bad("tolerance must be a number of dollars per month, 0 or more");
  // Only controls of this playground are stored.
  const usage: Record<string, number> = {};
  for (const m of p.domain.metrics) {
    const n = (b.usage as Record<string, unknown>)[m.id];
    if (n === undefined) continue;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return bad(`usage.${m.id} must be a number, 0 or more`);
    usage[m.id] = n;
  }
  const required = p.domain.features.map((f) => f.id).filter((id) => (b.required as unknown[]).includes(id));
  await update((s) => void (s.playgrounds[pg].decision = { usage, required, chosen: b.chosen as string, tolerance, savedAt: new Date().toISOString() }));
  return stateResponse(pg);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const no = refused(req);
  if (no) return no;
  const { pg } = await params;
  if (load().playgrounds[pg]) await update((s) => void (s.playgrounds[pg].decision = null));
  return stateResponse(pg);
}
