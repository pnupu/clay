import { refused, type Ctx } from "@/app/api/respond";
import { mergeExploration } from "@/lib/explore";
import { isCurrent, mergeKitExploration } from "@/lib/kit";
import { update } from "@/lib/store";

/** The browser reports what the person tried since its last report. It is merged into the exploration summary that the agent reads. */
export async function POST(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  const report = await req.json().catch(() => null);
  const status = await update((s) => {
    const p = s.playgrounds[pg];
    if (!p) return 404;
    const now = new Date().toISOString();
    if (p.kit) {
      if (!isCurrent(p.kit, (report as { rev?: unknown } | null)?.rev)) return 409;
      const merged = mergeKitExploration(p.kit.kit.controls, p.kit.exploration, report, now);
      if (merged) p.kit.exploration = merged;
      return merged ? 204 : 400;
    }
    const merged = mergeExploration(p.domain, p.exploration, report, now);
    if (!merged) return 400;
    p.exploration = merged;
    return 204;
  });
  return new Response(null, { status });
}
