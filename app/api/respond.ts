import { hasAccess } from "@/lib/access";
import { NotFound } from "@/lib/pipeline";
import { load, publicBase, publicState } from "@/lib/store";

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
 * The guard of every route that changes state or spends Context.dev requests. Returns the refusal, or null when the request may go on.
 * 1. The owner key (lib/access.ts): a bearer header from an agent, or the cookie that /enter sets in a browser. Without a
 *    configured key only the development server is open; every other way to run the app is closed.
 * 2. Browsers send Origin on such requests; agents and scripts do not. A request with an Origin must come from the page of
 *    this app itself, and the app must be addressed by localhost, by an IP address or by its public host name, so a foreign
 *    name that is made to resolve to this machine is refused too.
 * The webhook route does not call this: its signature is its authentication.
 */
export function refused(req: Request): Response | null {
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
  if (!isOwner(req)) return Response.json({ error: "This needs the owner key of this Clay deployment. In a browser, open the owner link once. An agent sends the header Authorization: Bearer <key>." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  return null;
}
