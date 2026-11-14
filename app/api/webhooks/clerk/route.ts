import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { update } from "@/lib/store";

/**
 * Clerk webhook (Svix-signed): the fast path of key revocation. A deleted user loses their record (agent key hash and
 * request count); a banned user loses their key. Inactive until CLERK_WEBHOOK_SIGNING_SECRET is set; without it, agent
 * keys are still confirmed with Clerk every 10 minutes (lib/accounts.ts). Playgrounds of a deleted user stay, owned by
 * nobody who can sign in; the admin can delete them.
 */
export async function POST(req: NextRequest) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) return new Response("Clerk webhooks are not configured", { status: 404 });
  let event;
  try {
    event = await verifyWebhook(req, { signingSecret });
  } catch {
    return new Response("Invalid webhook signature", { status: 400 });
  }
  const id = typeof event.data?.id === "string" ? event.data.id : null;
  if (id && event.type === "user.deleted") await update((s) => void delete s.users[id]);
  if (id && event.type === "user.updated" && (event.data as { banned?: unknown }).banned === true)
    await update((s) => void (s.users[id] && (s.users[id] = { ...s.users[id], keyHash: null, keyCreatedAt: null, checkedAt: null })));
  return new Response(null, { status: 204 });
}
