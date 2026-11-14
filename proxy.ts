import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const clerk = clerkMiddleware();

/**
 * Clerk's session handling for pages and the browser's API calls, so auth() works in them (app/api/respond.ts). It does not
 * guard anything: refused() in each route does. Without Clerk keys it does nothing.
 */
export default async function proxy(req: NextRequest, ev: NextFetchEvent) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return NextResponse.next();
  const res = await clerk(req, ev);
  // Clerk passes its auth state on as request headers with a rewrite to the same URL. A NextRequest names every loopback
  // host "localhost", but a server bound to 127.0.0.1 (pnpm dev, pnpm start) compares rewrites with 127.0.0.1, so that
  // rewrite looked external and Next proxied the request to itself until it failed ("Failed to proxy ... socket hang up").
  // A rewrite to the same path and query is the same as "next", which keeps the request headers: send that instead.
  const rewrite = res?.headers.get("x-middleware-rewrite");
  if (res && rewrite) {
    const to = new URL(rewrite);
    if (to.pathname === req.nextUrl.pathname && to.search === req.nextUrl.search) {
      res.headers.delete("x-middleware-rewrite");
      res.headers.set("x-middleware-next", "1");
    }
  }
  return res;
}

export const config = {
  // Everything except Next.js internals, static files (Clerk's documented matcher), the MCP endpoint (agents send their
  // key, not a session), the signed webhooks, the demo pricing page (Context.dev reads it; no handshake redirect there) and the preview frame
  // (a handshake redirect would take it to another host; its route reads the session without one, identify()).
  matcher: ["/((?!_next|api/mcp|api/webhooks|demo-vendor|p/[^/]+/frame$|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)"],
};
