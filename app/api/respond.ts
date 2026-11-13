import { NotFound } from "@/lib/pipeline";
import { load, publicState } from "@/lib/store";

export type Ctx = { params: Promise<{ pg: string }> };

/** The state of one playground as JSON, or 404 when it does not exist. */
export function stateResponse(pg: string, error: string | null = null, status = error ? 502 : 200) {
  const s = load();
  if (!s.playgrounds[pg]) return Response.json({ error: `Playground "${pg}" does not exist.` }, { status: 404 });
  return Response.json({ ...publicState(s, pg), error }, { status });
}

export const failure = (e: unknown) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof NotFound ? 404 : 502 });

/**
 * The guard of every state-changing route. The app has no auth and binds to 127.0.0.1, so the remaining risk is a web page
 * open in the person's browser that posts to this app: it could spend Context.dev requests or overwrite the saved decision
 * that the agent later reads as the person's choice. Browsers send Origin on such requests; agents, scripts and the
 * Context.dev webhook do not. A request with an Origin must come from the page of this app itself, and the app must be
 * addressed by localhost, by an IP address or by the PUBLIC_BASE_URL host, so a foreign name that is made to resolve to
 * this machine is refused too. Returns the refusal, or null when the request may go on.
 */
export function refused(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (origin == null) return null;
  const host = req.headers.get("host") ?? "";
  let sameSite = false;
  try {
    const name = new URL(`http://${host}`).hostname;
    const own = name === "localhost" || /^(\d{1,3}\.){3}\d{1,3}$/.test(name) || name.startsWith("[") || (!!process.env.PUBLIC_BASE_URL && name === new URL(process.env.PUBLIC_BASE_URL).hostname);
    sameSite = new URL(origin).host === host && own;
  } catch {}
  return sameSite ? null : Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
}
