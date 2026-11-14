import { clerkVerdict, refused } from "@/app/api/respond";
import { currentActor, hashKey, newAgentKey, sessionUserId, TEST_ACCOUNT_MESSAGE } from "@/lib/accounts";
import { update } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Only a person signed in through Clerk in a browser manages their agent key; an agent key cannot replace itself. An
 * account admin is such a person too: their key acts as a person, not as the operator. The owner key has no agent key.
 */
async function signedIn(req: Request): Promise<string | Response> {
  const no = await refused(req);
  if (no) return no;
  return sessionUserId(currentActor()) ?? Response.json({ error: "Sign in to manage your agent key." }, { status: 401 });
}

/** Create a new agent key, which replaces the old one. The key is in this answer only; Sorvi stores its SHA-256 hash. */
export async function POST(req: Request) {
  const userId = await signedIn(req);
  if (userId instanceof Response) return userId;
  // Asked at this moment, so a Clerk test account on a public app gets no key; nothing about the address is stored.
  const verdict = await clerkVerdict(userId);
  if (verdict === "test") return Response.json({ error: `${TEST_ACCOUNT_MESSAGE}.` }, { status: 403 });
  if (verdict === "gone") return Response.json({ error: "This account is deleted or blocked, so it cannot get an agent key." }, { status: 403 });
  if (verdict === "unknown") return Response.json({ error: "Sorvi could not confirm your account with its sign-in service just now. Try again in a few minutes." }, { status: 503 });
  const key = newAgentKey();
  const createdAt = new Date().toISOString();
  await update((s) => void (s.users[userId] = { usage: s.users[userId]?.usage ?? null, keyHash: hashKey(key), keyCreatedAt: createdAt, checkedAt: createdAt }));
  return Response.json({ key, createdAt }, { headers: { "Cache-Control": "no-store" } });
}

/** Revoke the agent key: an agent that still uses it is refused from now on. */
export async function DELETE(req: Request) {
  const userId = await signedIn(req);
  if (userId instanceof Response) return userId;
  await update((s) => void (s.users[userId] && (s.users[userId] = { ...s.users[userId], keyHash: null, keyCreatedAt: null })));
  return new Response(null, { status: 204 });
}
