import type { Ctx } from "@/app/api/respond";
import { mergeExploration } from "@/lib/explore";
import { update } from "@/lib/store";

/** The browser reports what the person tried since its last report. It is merged into the exploration summary that the agent reads. */
export async function POST(req: Request, { params }: Ctx) {
  const { pg } = await params;
  const report = await req.json().catch(() => null);
  const status = await update((s) => {
    const p = s.playgrounds[pg];
    if (!p) return 404;
    const merged = mergeExploration(p.domain, p.exploration, report, new Date().toISOString());
    if (!merged) return 400;
    p.exploration = merged;
    return 204;
  });
  return new Response(null, { status });
}
