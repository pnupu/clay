import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { hasAccess, isHosted } from "@/lib/access";
import { bindActor, canRead, canWrite, guessLimiter, looksLikeAgentKey, userOfKey, VISITOR, type Actor } from "@/lib/accounts";
import { NotFound } from "@/lib/pipeline";
import { load, publicBase, publicState } from "@/lib/store";

/** Sign-in through Clerk is on when both Clerk keys are set. Without them only the owner key works (the app as it was). */
export const clerkOn = () => !!process.env.CLERK_SECRET_KEY && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const ADMIN: Actor = { kind: "admin" };
const guesses = guessLimiter();
const clientIp = (h: { get(name: string): string | null }) => h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";

/**
 * Who sends this request (lib/accounts.ts)? In this order: the owner key (bearer or owner cookie) is the admin; a bearer
 * agent key is its person; a Clerk session is its person; anyone else is a visitor. `bad` is set when a bearer token was
 * sent and matched nothing, so the caller can say so instead of acting as a visitor. Works on route requests and, with
 * the headers of the page request, in server components.
 */
export async function identify(h: { get(name: string): string | null }): Promise<{ actor: Actor; bad: null | "key" | "blocked" }> {
  const key = process.env.CLAY_ACCESS_KEY;
  const authorization = h.get("authorization");
  // Without an owner key, only the development server without Clerk is open, as before accounts existed.
  if (key ? hasAccess({ authorization, cookie: h.get("cookie") }, key) : !isHosted() && !clerkOn()) return { actor: ADMIN, bad: null };
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "")?.[1];
  if (bearer) {
    const ip = clientIp(h);
    if (guesses.blocked(ip)) return { actor: VISITOR, bad: "blocked" };
    const userId = looksLikeAgentKey(bearer) ? userOfKey(bearer, (await load()).users) : null;
    if (userId) return { actor: { kind: "user", userId, via: "key" }, bad: null };
    guesses.fail(ip);
    return { actor: VISITOR, bad: "key" };
  }
  if (!clerkOn()) return { actor: VISITOR, bad: null };
  try {
    const { userId } = await auth();
    return { actor: userId ? { kind: "user", userId, via: "session" } : VISITOR, bad: null };
  } catch {
    // auth() throws where the Clerk proxy did not run (proxy.ts leaves out the MCP and webhook routes): no session there.
    return { actor: VISITOR, bad: null };
  }
}

/** The caller of the page being rendered (server components): the admin's owner cookie, a Clerk session, or a visitor. */
export const viewer = async (): Promise<Actor> => (await identify(await headers())).actor;

/** May this request open the playground, and change it? `null` when the playground does not exist. */
export async function access(req: Request, pg: string): Promise<{ read: boolean; write: boolean } | null> {
  const p = (await load()).playgrounds[pg];
  if (!p) return null;
  const { actor } = await identify(req.headers);
  return { read: canRead(actor, p, pg), write: canWrite(actor, p) };
}

/** Routes only the admin may call: the demo page editor, webhook monitors (their runs are not counted per person) and example marks. */
const ADMIN_ONLY = /^\/api\/(demo(\/|$)|p\/[^/]+\/(watch|example)(\/|$))/;
const noAccess = () => Response.json({ error: "Playground not found, or it is private. Sign in as its owner, or use your own agent key." }, { status: 404 });

export type Ctx = { params: Promise<{ pg: string }> };

/** Does this request carry the owner key (bearer header or owner cookie)? */
export const isOwner = (req: Request) => hasAccess({ authorization: req.headers.get("authorization"), cookie: req.headers.get("cookie") });

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
  const { actor, bad } = await identify(req.headers);
  holder.actor = actor;
  if (bad === "blocked") return Response.json({ error: "Too many requests with a wrong key from this address. Wait 10 minutes, then use the agent key from the Connect your agent page." }, { status: 429 });
  if (bad === "key") return Response.json({ error: "This key is not valid. It may have been regenerated or revoked. Get a new agent key on the Connect your agent page of Clay." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  if (actor.kind === "visitor") return Response.json({ error: "Sign in to do this. An agent sends its personal agent key as the header Authorization: Bearer <key>; get one on the Connect your agent page." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  const path = new URL(req.url).pathname;
  if (ADMIN_ONLY.test(path) && actor.kind !== "admin") return Response.json({ error: "Only the operator of this Clay deployment can do this." }, { status: 403 });
  let pg: string | null = null;
  try {
    pg = decodeURIComponent(/^\/api\/p\/([^/]+)/.exec(path)?.[1] ?? "") || null;
  } catch {}
  const p = pg ? (await load()).playgrounds[pg] : undefined;
  if (p && !canWrite(actor, p)) return canRead(actor, p, pg!) ? Response.json({ error: "This is an example playground: move the controls as you like, but only the operator can save or re-check it. Connect your agent to build your own." }, { status: 403 }) : noAccess();
  return null;
}
