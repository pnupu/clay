import type { NextConfig } from "next";

/**
 * Frames come only from this app. The browser checks every navigation of a nested frame against the embedding page's
 * frame-src, also one that the frame starts itself, so preview code cannot send requests to another host by navigating
 * its frame (for example to a URL that answers 204, which keeps the document and fires no second load). The policy is
 * on every page, not only on playgrounds, because a client-side navigation keeps the policy of the page the visitor
 * landed on. Clerk's sign-in and sign-up pages also allow Cloudflare's bot check, which runs in a frame. The frame
 * document itself is left out: it sends its own, stricter policy (lib/frame.ts).
 */
const csp = (value: string) => [{ key: "Content-Security-Policy", value }];

// The dev indicator bubble is hidden so it does not cover the screen on a projector.
const nextConfig: NextConfig = {
  devIndicators: false,
  // The frame route reads the page's text typeface from disk for a data view (app/(app)/p/[pg]/frame/route.ts): a file
  // under public/ is not part of a route's deployment unless it is named here.
  outputFileTracingIncludes: { "/p/*/frame": ["./public/fonts/figtree-var.woff2"] },
  headers: async () => [
    { source: "/((?!p/[^/]+/frame$|sign-in|sign-up).*)", headers: csp("frame-src 'self'") },
    { source: "/:auth(sign-in|sign-up)/:rest*", headers: csp("frame-src 'self' https://challenges.cloudflare.com") },
  ],
};

export default nextConfig;
