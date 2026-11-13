// The access guard of a public deployment: one shared owner key (CLAY_ACCESS_KEY). Everything that writes state or
// spends Context.dev requests needs it, as "Authorization: Bearer <key>" (agents) or as the cookie that /enter sets (browser).
import { createHash, timingSafeEqual } from "node:crypto";

export const COOKIE = "clay_owner";
const digest = (s: string) => createHash("sha256").update(s).digest();
/** Constant-time comparison: both sides are hashed first, so the lengths are equal and nothing about the key leaks through timing. */
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
/** The cookie holds a value derived from the key, never the key itself. */
export const cookieValue = (key: string) => createHash("sha256").update(`clay-cookie:${key}`).digest("hex");

/** Is `given` the owner key? A missing or short (under 32 characters) configured key matches nothing. */
export const isKey = (given: unknown, key = process.env.CLAY_ACCESS_KEY): boolean => typeof given === "string" && !!key && key.length >= 32 && same(given, key);

/**
 * Does this app need the owner key even when none is configured? Everything except the development server does: a production
 * build (`next start`, Vercel) or an app with a public base URL. Only `pnpm dev`, which always binds to 127.0.0.1, runs without a key.
 * lean: a handler cannot prove that a request came over loopback, so a dev server that someone puts behind a tunnel without
 * PUBLIC_BASE_URL and without a key is open. Set CLAY_ACCESS_KEY whenever the app is reachable from another machine.
 */
export const isHosted = (env: Record<string, string | undefined> = process.env): boolean => env.NODE_ENV === "production" || !!env.VERCEL || !!env.PUBLIC_BASE_URL;

/**
 * May this request write state or spend Context.dev requests?
 * No key configured: open on the development server, closed everywhere else.
 */
export function hasAccess(h: { authorization?: string | null; cookie?: string | null }, key = process.env.CLAY_ACCESS_KEY, hosted = isHosted()): boolean {
  if (!key) return !hosted;
  if (key.length < 32) return false;
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(h.authorization ?? "")?.[1];
  if (bearer && same(bearer, key)) return true;
  const cookie = (h.cookie ?? "").split(";").map((c) => c.trim().split("=")).find(([name]) => name === COOKIE)?.[1];
  return !!cookie && same(cookie, cookieValue(key));
}
