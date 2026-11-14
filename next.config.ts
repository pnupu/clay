import type { NextConfig } from "next";

/**
 * The pages that embed a preview frame (a playground, and the landing page with its example) allow frames only from this
 * app. The browser checks every navigation of a nested frame against the embedding page's frame-src, also one that the
 * frame starts itself, so preview code cannot send requests to another host by navigating its frame (for example to a URL
 * that answers 204, which keeps the document and fires no second load). Only these pages: Clerk's sign-in pages may
 * need frames from other hosts for their bot check.
 */
const FRAMES = [{ key: "Content-Security-Policy", value: "frame-src 'self'" }];

// The dev indicator bubble is hidden so it does not cover the screen on a projector.
const nextConfig: NextConfig = {
  devIndicators: false,
  headers: async () => [
    { source: "/", headers: FRAMES },
    { source: "/p/:pg", headers: FRAMES },
  ],
};

export default nextConfig;
