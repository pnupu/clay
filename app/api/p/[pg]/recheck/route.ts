import { failure, refused, stateResponse, type Ctx } from "@/app/api/respond";
import { originOf, recheck, recheckAll, recheckWeb } from "@/lib/pipeline";
import { recheckFile, recheckVerdict } from "@/lib/record";
import { webChanges } from "@/lib/report";
import { load, type Playground } from "@/lib/store";

export const maxDuration = 300;

/**
 * "Re-check now": one source ({id}) or all. Same function the webhook and the agent tool call.
 * With {"verdict": true} the answer is for a script that has no page (the scheduled re-check of a person's repository,
 * public/clay-recheck.yml): every source is read again, and the answer starts with the verdict fields of the
 * agent's recheck_playground, built by the same functions (lib/record.ts). The guard above it is the same: the owner's
 * agent key or session, the caps of that person.
 */
export async function POST(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  const { id, trigger, verdict } = (await req.json().catch(() => ({}))) as { id?: string; trigger?: "manual" | "auto"; verdict?: boolean };
  const p = (await load()).playgrounds[pg];
  if (!p) return stateResponse(pg);
  try {
    if (verdict === true) return await withVerdict(req, pg, p, trigger === "auto" ? "auto" : "manual");
    const results = await Promise.allSettled((id ? [id] : Object.keys(p.sources)).map((x) => recheck(pg, x, trigger === "auto" ? "auto" : "manual", originOf(req))));
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    return stateResponse(pg, failed ? String(failed.reason?.message ?? failed.reason) : null);
  } catch (e) {
    return failure(e);
  }
}

async function withVerdict(req: Request, pg: string, before: Playground, trigger: "manual" | "auto") {
  const url = `${originOf(req)}/p/${pg}`;
  const head = { playground_id: pg, url };
  if (before.kit) {
    if (!before.kit.kit.web?.length) return Response.json({ ...head, verdict: "Nothing to re-check: this playground reads no web page." });
    const w = await recheckWeb(pg);
    const now = (await load()).playgrounds[pg];
    const checked_at = new Date().toISOString();
    const changes = webChanges(now.kit!).changes;
    return Response.json({ ...head, checked_at, ...(w.stop ? { stopped: w.stop } : {}), ...recheckFile(now, url, checked_at, changes.length, !!w.stop), web_changes: changes });
  }
  const results = await recheckAll(pg, before.domain.vendors.map((v) => v.id), trigger, originOf(req));
  const stop = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  const now = (await load()).playgrounds[pg];
  const checked_at = new Date().toISOString();
  return Response.json({ ...head, checked_at, ...(stop ? { stopped: String(stop.reason?.message ?? stop.reason).slice(0, 300) } : {}), ...recheckVerdict(now, url, checked_at, !!stop) });
}
