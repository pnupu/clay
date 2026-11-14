import { badKey, identify, type Ctx } from "@/app/api/respond";
import { canRead } from "@/lib/accounts";
import { dataStamp, pageRev } from "@/lib/started";
import { load } from "@/lib/store";

export const dynamic = "force-dynamic";
/**
 * What an open page asks for every few seconds (app/live.tsx): the revision of what it renders, the stamp of its web
 * data, and the started line while the playground is not built. Nothing else: the page fetches the rest only when this
 * changes. The same access as the state route: a missing and a private playground get the same answer. Every open page
 * polls this, so the store is read once, and the access check runs on that same read.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { pg } = await params;
  const { actor, bad } = await identify(req.headers, req);
  const refused = badKey(bad, req);
  if (refused) return refused;
  const p = (await load()).playgrounds[pg];
  if (!p || !canRead(actor, p, pg)) return Response.json({ error: "Playground not found, or it is private." }, { status: 404 });
  return Response.json({ rev: pageRev(p), data: dataStamp(p), now: Date.now(), started: p.started ? { title: p.domain.question, workingOn: p.started.workingOn, at: p.started.at } : null }, { headers: { "Cache-Control": "no-store" } });
}
