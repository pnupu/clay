import type { NextConfig } from "next";

/**
 * Every page allows frames only from this app, Clerk's Frontend API (its session handshake can redirect an embedded
 * page there and back) and Cloudflare's bot check (Clerk's sign-in forms). The browser checks every navigation of a
 * nested frame against the embedding page's frame-src, also one that the frame starts itself, so preview code cannot
 * send requests to another host by navigating its frame (for example to a URL that answers 204, which keeps the
 * document and fires no second load). It is on every page, not only on playgrounds, because a client-side navigation
 * keeps the policy of the page the visitor landed on. The frame document itself is left out: it sends its own, stricter
 * policy (lib/frame.ts).
 */
const clerkFrontendApi = (() => {
  const host = Buffer.from(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.split("_")[2] ?? "", "base64").toString().replace(/\$$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : "";
})();
const FRAMES = [{ key: "Content-Security-Policy", value: `frame-src 'self' ${clerkFrontendApi} https://challenges.cloudflare.com`.replace(/\s+/g, " ") }];

// The dev indicator bubble is hidden so it does not cover the screen on a projector.
const nextConfig: NextConfig = {
  devIndicators: false,
  headers: async () => [{ source: "/((?!p/[^/]+/frame$).*)", headers: FRAMES }],
};

export default nextConfig;
