import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { refusesTestAccount } from "@/lib/accounts";
import { update } from "@/lib/store";

/**
 * Clerk webhook (Svix-signed): the fast path of key revocation. A deleted user loses their record (agent key hash and
 * request count); a banned user, or one left with only Clerk test addresses on a public app, loses their key. Inactive until CLERK_WEBHOOK_SIGNING_SECRET is set; without it, agent
 * keys are still confirmed with Clerk every 10 minutes (lib/accounts.ts). Labs of a deleted user stay, owned by
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
  // A ban, or an update that leaves only Clerk test addresses on a public app, removes the key (as the 10-minute check would).
  const d = event.data as { banned?: unknown; email_addresses?: { email_address?: string; verification?: { status?: string } | null }[]; phone_numbers?: { phone_number?: string; verification?: { status?: string } | null }[] };
  const ids = [...(d.email_addresses ?? []).map((e) => ({ address: String(e.email_address ?? ""), verified: e.verification?.status === "verified" })), ...(d.phone_numbers ?? []).map((p) => ({ address: String(p.phone_number ?? ""), verified: p.verification?.status === "verified" }))];
  if (id && event.type === "user.updated" && (d.banned === true || refusesTestAccount(ids)))
    await update((s) => void (s.users[id] && (s.users[id] = { ...s.users[id], keyHash: null, keyCreatedAt: null, checkedAt: null })));
  return new Response(null, { status: 204 });
}
