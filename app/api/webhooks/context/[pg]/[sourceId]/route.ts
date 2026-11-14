import { after } from "next/server";
import { verifyWebhook } from "@/lib/contextdev";
import { originOf, recheck } from "@/lib/pipeline";
import { atAllowance, isExample, ownerOf } from "@/lib/accounts";
import { load, update } from "@/lib/store";

export const maxDuration = 300;

/**
 * Context.dev monitor webhook (https://docs.context.dev/webhooks). The route ids only select the playground, the source and its secret;
 * the signature over the raw body is the authentication. A verified change.detected event triggers the same re-check as the button.
 */
export async function POST(req: Request, { params }: { params: Promise<{ pg: string; sourceId: string }> }) {
  const { pg, sourceId } = await params;
  const raw = Buffer.from(await req.arrayBuffer()); // raw bytes first: verify before parsing
  const all = (await load()).playgrounds;
  const p = all[pg];
  const src = p?.sources[sourceId];
  if (!src?.monitor || !verifyWebhook(raw, req.headers.get("x-context-signature") ?? "", src.monitor.secret)) return new Response("Invalid webhook signature", { status: 401 });

  let event: { id?: unknown; event?: unknown; data?: { change?: { monitor_id?: unknown } } };
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (typeof event.id !== "string" || !event.id || event.id !== req.headers.get("x-context-id") || event.event !== req.headers.get("x-context-event")) return new Response("Invalid event envelope", { status: 400 });
  if (event.event !== "change.detected" || event.data?.change?.monitor_id !== src.monitor.id) return new Response("Event does not belong to this source", { status: 400 });

  // A person's published example keeps what the operator approved (lib/accounts.ts, keepPublished would discard the
  // result): it is not re-read, so nothing is spent. An example that the operator owns follows its pages, by design.
  if (p && isExample(p, pg) && ownerOf(p)) return new Response(null, { status: 204 });
  // A person at their storage allowance: the result could not be stored (lib/accounts.ts, boundOwners), so nothing is read.
  if (p && ownerOf(p) && atAllowance(all, ownerOf(p)!)) return new Response(null, { status: 204 });
  // Persist the event id before acknowledging; a retry or replay of the same id is acknowledged without a second run.
  const fresh = await update((s) => {
    if (s.webhookEventIds.includes(event.id as string)) return false;
    s.webhookEventIds = [event.id as string, ...s.webhookEventIds].slice(0, 500);
    return true;
  });
  // The docs ask for a 2xx within 15 seconds, and extraction can take longer, so the re-check runs after the response.
  if (fresh) after(() => recheck(pg, sourceId, "webhook", originOf(req)).catch((e) => console.error("webhook re-check failed", e)));
  return new Response(null, { status: 204 });
}
