import { refused, stateResponse, type Ctx } from "@/app/api/respond";
import { createMonitor, deleteMonitor } from "@/lib/contextdev";
import { load, publicBase, update } from "@/lib/store";

const INSTRUCTIONS = "Report changes to prices, plan names, included quantities, usage tiers, limits and feature availability. Ignore navigation, testimonials, counters, dates and marketing copy.";

/** Start watching: one Context.dev page monitor per source, with a signed webhook back to this deployment. Needs a public URL. */
export async function POST(req: Request, { params }: Ctx) {
  const no = refused(req);
  if (no) return no;
  const { pg } = await params;
  const base = publicBase();
  if (!base) return Response.json({ error: "This app has no public URL. Context.dev can only deliver webhooks to a public URL." }, { status: 409 });
  for (const src of Object.values((await load()).playgrounds[pg]?.sources ?? {})) {
    if (src.monitor || !src.url) continue;
    const webhookUrl = `${base}/api/webhooks/context/${pg}/${src.id}`;
    const m = await createMonitor(`Clay ${pg}: ${src.name} pricing`, src.url, webhookUrl, INSTRUCTIONS);
    if (!m.webhook?.secret) return Response.json({ error: "Monitor created without a webhook secret; the API key needs monitors:write." }, { status: 502 });
    await update((s) => void (s.playgrounds[pg].sources[src.id].monitor = { id: m.id, secret: m.webhook!.secret!, webhookUrl }));
  }
  return stateResponse(pg);
}

/** Stop watching: delete the monitors this app created. */
export async function DELETE(req: Request, { params }: Ctx) {
  const no = refused(req);
  if (no) return no;
  const { pg } = await params;
  for (const src of Object.values((await load()).playgrounds[pg]?.sources ?? {})) {
    if (!src.monitor) continue;
    await deleteMonitor(src.monitor.id);
    await update((s) => void (s.playgrounds[pg].sources[src.id].monitor = null));
  }
  return stateResponse(pg);
}
