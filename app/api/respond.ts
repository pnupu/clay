import { auth, clerkClient } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { hasAccess, isHosted } from "@/lib/access";
import { bindActor, canRead, canWrite, guessLimiter, keyDecision, looksLikeAgentKey, needsCheck, refusesTestAccount, userOfKey, VISITOR, type Actor, type ClerkVerdict } from "@/lib/accounts";
import { NotFound } from "@/lib/pipeline";
import { load, publicBase, publicState, update } from "@/lib/store";

/** Sign-in through Clerk is on when both Clerk keys are set. Without them only the owner key works (the app as it was). */
export const clerkOn = () => !!process.env.CLERK_SECRET_KEY && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const ADMIN: Actor = { kind: "admin" };
const guesses = guessLimiter();
// Vercel sets x-real-ip to the client address; x-forwarded-for is only a fallback for other hosts.
const clientIp = (h: { get(name: string): string | null }) => h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

/**
 * What Clerk says about this person now (lib/accounts.ts): "gone" when deleted or banned; "test" when only Clerk test
 * addresses or numbers are verified on a public app; "unknown" when Clerk does not answer within 5 seconds or fails.
 * The addresses are only read, never stored.
 */
export async function clerkVerdict(userId: string): Promise<ClerkVerdict> {
  if (!clerkOn()) return "unknown";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), 5000)));
    const u = await Promise.race([(await clerkClient()).users.getUser(userId), timeout]);
    if (u.banned) return "gone";
    const ids = [...u.emailAddresses.map((e) => ({ address: e.emailAddress, verified: e.verification?.status === "verified" })), ...u.phoneNumbers.map((p) => ({ address: p.phoneNumber, verified: p.verification?.status === "verified" }))];
    return refusesTestAccount(ids) ? "test" : "ok";
  } catch (e) {
    return (e as { status?: unknown })?.status === 404 ? "gone" : "unknown";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Confirm an agent key's person with Clerk at most every 10 minutes (keyDecision()); revoke the key of a person who is
 * gone. Parallel requests of one person share one Clerk call. After Clerk failed to answer, this instance does not ask
 * again for 60 seconds (the grace rule decides meanwhile), so an outage does not make every request wait 5 seconds.
 */
const pending = new Map<string, Promise<"ok" | "revoked" | "unavailable">>();
const unreachableUntil = new Map<string, number>();
async function confirmKey(userId: string, checkedAt: string | null | undefined): Promise<"ok" | "revoked" | "unavailable"> {
  if (!needsCheck({ checkedAt }, Date.now())) return "ok";
  let run = pending.get(userId);
  if (!run) {
    run = checkKey(userId, checkedAt).finally(() => pending.delete(userId));
    pending.set(userId, run);
  }
  return run;
}
/** One check: one Clerk call and at most one store write, shared by every request that waits for it. */
async function checkKey(userId: string, checkedAt: string | null | undefined): Promise<"ok" | "revoked" | "unavailable"> {
  const now = Date.now();
  const verdict: ClerkVerdict = (unreachableUntil.get(userId) ?? 0) > now ? "unknown" : await clerkVerdict(userId);
  if (verdict === "unknown") unreachableUntil.set(userId, now + 60_000);
  else unreachableUntil.delete(userId);
  const d = keyDecision({ checkedAt }, now, verdict);
  if (d.revoke || d.checkedAt)
    await update((s) => {
      const a = s.users[userId];
      if (!a) return;
      if (d.revoke) s.users[userId] = { ...a, keyHash: null, keyCreatedAt: null, checkedAt: null };
      else a.checkedAt = d.checkedAt;
    });
  return d.allow ? "ok" : d.revoke ? "revoked" : "unavailable";
}

/**
 * Who sends this request (lib/accounts.ts)? In this order: the owner key (bearer or owner cookie) is the admin; a bearer
 * agent key is its person; a Clerk session is its person; anyone else is a visitor. `bad` is set when a bearer token was
 * sent and matched nothing, so the caller can say so instead of acting as a visitor. Works on route requests and, with
 * the headers of the page request, in server components.
 */
export type Bad = null | "key" | "blocked" | "revoked" | "unavailable";
export async function identify(h: { get(name: string): string | null }, req?: Request): Promise<{ actor: Actor; bad: Bad }> {
  const key = process.env.CLAY_ACCESS_KEY;
  const authorization = h.get("authorization");
  // Without an owner key, only the development server without Clerk is open, as before accounts existed.
  if (key ? hasAccess({ authorization, cookie: h.get("cookie") }, key) : !isHosted() && !clerkOn()) return { actor: ADMIN, bad: null };
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "")?.[1];
  if (bearer) {
    // A valid key always works, so nobody can lock a person out by sending wrong keys from (or claiming) their address.
    const users = looksLikeAgentKey(bearer) ? (await load()).users : {};
    const userId = userOfKey(bearer, users);
    if (userId) {
      const confirmed = await confirmKey(userId, users[userId]?.checkedAt);
      return confirmed === "ok" ? { actor: { kind: "user", userId, via: "key" }, bad: null } : { actor: VISITOR, bad: confirmed };
    }
    const ip = clientIp(h);
    if (guesses.blocked(ip)) return { actor: VISITOR, bad: "blocked" };
    guesses.fail(ip);
    return { actor: VISITOR, bad: "key" };
  }
  if (!clerkOn()) return { actor: VISITOR, bad: null };
  try {
    const { userId } = await auth();
    return { actor: userId ? { kind: "user", userId, via: "session" } : VISITOR, bad: null };
  } catch {
    // auth() throws where the Clerk proxy did not run (proxy.ts leaves out the MCP, webhook and preview frame routes).
    // With the request at hand, read the session cookie directly: this never redirects, and an expired session counts
    // as signed out. The browser keeps the session fresh while the page around the frame is open.
    // Only the preview frame route reads the cookie this way; the MCP endpoint takes agent keys, never a browser session.
    if (!req || !/^\/p\/[^/]+\/frame$/.test(new URL(req.url).pathname)) return { actor: VISITOR, bad: null };
    try {
      const base = publicBase();
      const state = await (await clerkClient()).authenticateRequest(req, base ? { authorizedParties: [base] } : {});
      const userId = state.isAuthenticated ? state.toAuth().userId : null;
      return { actor: userId ? { kind: "user", userId, via: "session" } : VISITOR, bad: null };
    } catch {
      return { actor: VISITOR, bad: null };
    }
  }
}

/** The caller of the page being rendered (server components): the admin's owner cookie, a Clerk session, or a visitor. */
export const viewer = async (): Promise<Actor> => (await identify(await headers())).actor;

/** May this request open the playground, and change it? Both false when it does not exist. `bad`: see badKey(), also for an unknown id. */
export async function access(req: Request, pg: string): Promise<{ read: boolean; write: boolean; bad: Bad }> {
  const { actor, bad } = await identify(req.headers, req);
  const p = (await load()).playgrounds[pg];
  return { read: !!p && canRead(actor, p, pg), write: !!p && canWrite(actor, p), bad };
}

/** The answer to a bearer token that did not identify anyone, or null. Also for the read routes, so an agent learns that its key failed. */
export function badKey(bad: Bad): Response | null {
  if (bad === "blocked") return Response.json({ error: "Too many requests with a wrong key from this address. Wait 10 minutes, then use the agent key from the Connect your agent page." }, { status: 429 });
  if (bad === "revoked") return Response.json({ error: "This agent key no longer works: its Clay account was deleted or blocked, or it may not hold a key. Sign in on Clay and create a new key on the Connect your agent page." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  if (bad === "unavailable") return Response.json({ error: "Clay could not confirm your account with its sign-in service just now. Nothing was done. Try again in a few minutes." }, { status: 503, headers: { "Retry-After": "60" } });
  if (bad === "key") return Response.json({ error: "This key is not valid. It may have been regenerated or revoked. Get a new agent key on the Connect your agent page of Clay." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  return null;
}

/** Routes only the admin may call: the demo page editor, webhook monitors (their runs are not counted per person) and example marks. */
const ADMIN_ONLY = /^\/api\/(demo(\/|$)|p\/[^/]+\/(watch|example)(\/|$))/;
const noAccess = () => Response.json({ error: "Playground not found, or it is private. Sign in as its owner, or use your own agent key." }, { status: 404 });

export type Ctx = { params: Promise<{ pg: string }> };


/** The state of one playground as JSON, or 404 when it does not exist. `owner` tells the page whether its write buttons will work. */
export async function stateResponse(pg: string, error: string | null = null, status = error ? 502 : 200, owner = true) {
  const s = await load();
  if (!s.playgrounds[pg]) return Response.json({ error: `Playground "${pg}" does not exist.` }, { status: 404 });
  return Response.json({ ...publicState(s, pg, owner), error }, { status });
}

export const failure = (e: unknown) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof NotFound ? 404 : 502 });

/**
 * The guard of every route that changes state or spends Context.dev requests. Returns the refusal, or null when the request
 * may go on. Call it as `const no = await refused(req); if (no) return no;` before anything else in the handler: it binds the
 * caller to the request (lib/accounts.ts), so a playground created later in the handler gets its owner and every
 * Context.dev request counts against that person's daily cap.
 * 1. Browsers send Origin on such requests; agents and scripts do not. A request with an Origin must come from the page of
 *    this app itself, and the app must be addressed by localhost, by an IP address or by its public host name, so a foreign
 *    name that is made to resolve to this machine is refused too.
 * 2. The caller (identify()): a visitor may not write anything. The admin may do everything.
 * 3. A route under /api/p/<id>/ may change that playground only for its owner and the admin; the playground id is read from
 *    the URL, so every route there is covered. A few routes are for the admin only (ADMIN_ONLY).
 * The webhook route does not call this: its signature is its authentication.
 */
export async function refused(req: Request): Promise<Response | null> {
  const holder = bindActor(); // synchronously, before the first await: see bindActor()
  const origin = req.headers.get("origin");
  if (origin != null) {
    const host = req.headers.get("host") ?? "";
    let sameSite = false;
    try {
      const name = new URL(`http://${host}`).hostname;
      const base = publicBase();
      const own = name === "localhost" || /^(\d{1,3}\.){3}\d{1,3}$/.test(name) || name.startsWith("[") || (!!base && name === new URL(base).hostname);
      sameSite = new URL(origin).host === host && own;
    } catch {}
    if (!sameSite) return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  const { actor, bad } = await identify(req.headers, req);
  holder.actor = actor;
  const badAnswer = badKey(bad);
  if (badAnswer) return badAnswer;
  if (actor.kind === "visitor") return Response.json({ error: "Sign in to do this. An agent sends its personal agent key as the header Authorization: Bearer <key>; get one on the Connect your agent page." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  // Decoded, so an encoded form of an admin-only path (for example /api/p/x/%77atch) is recognised too.
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url).pathname);
  } catch {
    return Response.json({ error: "Malformed path" }, { status: 400 });
  }
  if (ADMIN_ONLY.test(path) && actor.kind !== "admin") return Response.json({ error: "Only the operator of this Clay deployment can do this." }, { status: 403 });
  let pg: string | null = null;
  try {
    pg = /^\/api\/p\/([^/]+)/.exec(path)?.[1] || null;
  } catch {}
  const p = pg ? (await load()).playgrounds[pg] : undefined;
  if (p && !canWrite(actor, p)) return canRead(actor, p, pg!) ? Response.json({ error: "This is an example playground: move the controls as you like, but only the operator can save or re-check it. Connect your agent to build your own." }, { status: 403 }) : noAccess();
  return null;
}
