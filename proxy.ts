import { NextResponse, type NextRequest } from "next/server";

/**
 * One guard for every state-changing API request. The app has no auth and binds to 127.0.0.1, so the remaining risk is a
 * web page open in the person's browser that posts to this app: it could spend Context.dev requests or overwrite the saved
 * decision that the agent later reads as the person's choice. Browsers send Origin on such requests; agents, scripts and
 * the Context.dev webhook do not. A request with an Origin must come from the page of this app itself, and the app must
 * be addressed by one of its own names, so a foreign name that resolves to 127.0.0.1 is refused too.
 */
export function proxy(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return NextResponse.next();
  const origin = req.headers.get("origin");
  if (origin == null) return NextResponse.next();
  const host = req.headers.get("host") ?? "";
  const own = ["localhost", "127.0.0.1", "[::1]"];
  if (process.env.PUBLIC_BASE_URL) own.push(new URL(process.env.PUBLIC_BASE_URL).hostname);
  let sameSite = false;
  try {
    sameSite = new URL(origin).host === host && own.includes(new URL(`http://${host}`).hostname);
  } catch {}
  return sameSite ? NextResponse.next() : NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
}

export const config = { matcher: "/api/:path*" };
