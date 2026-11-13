import { failure, refused, stateResponse, type Ctx } from "@/app/api/respond";
import { ContextDevError, createMonitor, deleteMonitor } from "@/lib/contextdev";
import { load, publicBase, update } from "@/lib/store";

const INSTRUCTIONS = "Report changes to prices, plan names, included quantities, usage tiers, limits and feature availability. Ignore navigation, testimonials, counters, dates and marketing copy.";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Start watching: one Context.dev page monitor per source, with a signed webhook back to this deployment. Needs a public URL. */
export async function POST(req: Request, { params }: Ctx) {
  const no = refused(req);
  if (no) return no;
  const { pg } = await params;
  const base = publicBase();
  if (!base) return Response.json({ error: "This app has no public URL. Context.dev can only deliver webhooks to a public URL." }, { status: 409 });
  /** A monitor that exists at Context.dev and is not stored yet. */
  let unstored: string | null = null;
  try {
    for (const src of Object.values((await load()).playgrounds[pg]?.sources ?? {})) {
      if (src.monitor || !src.url) continue;
      const webhookUrl = `${base}/api/webhooks/context/${pg}/${src.id}`;
      const m = await createMonitor(`Clay ${pg}: ${src.name} pricing`, src.url, webhookUrl, INSTRUCTIONS);
      unstored = m.id;
      if (!m.webhook?.secret) throw new Error("Monitor created without a webhook secret; the API key needs monitors:write.");
      await update((s) => void (s.playgrounds[pg].sources[src.id].monitor = { id: m.id, secret: m.webhook!.secret!, webhookUrl }));
      unstored = null;
    }
    return await stateResponse(pg);
  } catch (e) {
    console.error("start of webhook monitors failed", e);
    // A monitor that could not be stored would run with nothing that can stop it: delete it. The answer carries the state,
    // so the page shows the monitors that were stored before the failure, and the message (for example the daily budget).
    if (unstored) await deleteMonitor(unstored).catch((x) => console.error("the unstored monitor could not be deleted", unstored, x));
    return stateResponse(pg, message(e));
  }
}

/** Stop watching: delete the monitors this app created. Deleting is not counted against the daily budget. */
export async function DELETE(req: Request, { params }: Ctx) {
  const no = refused(req);
  if (no) return no;
  const { pg } = await params;
  let failed: string | null = null;
  try {
    for (const src of Object.values((await load()).playgrounds[pg]?.sources ?? {})) {
      if (!src.monitor) continue;
      try {
        await deleteMonitor(src.monitor.id);
      } catch (e) {
        // A monitor that is already gone at Context.dev counts as deleted. Any other failure keeps the record, and the loop goes on.
        if (!(e instanceof ContextDevError && e.status === 404)) {
          failed = message(e);
          continue;
        }
      }
      await update((s) => void (s.playgrounds[pg]?.sources[src.id] && (s.playgrounds[pg].sources[src.id].monitor = null)));
    }
    return await stateResponse(pg, failed);
  } catch (e) {
    console.error("stop of webhook monitors failed", e);
    return failure(e);
  }
}
