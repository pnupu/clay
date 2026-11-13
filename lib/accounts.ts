// Who is calling, and what may they do. No Next.js imports: the routes resolve the caller (app/api/respond.ts) and bind it here.
//
// Three kinds of caller:
// - visitor: not signed in. May read and use the example playgrounds; may not write or spend anything.
// - user: a person signed in through Clerk (a browser session) or their agent (a personal agent key). Owns the playgrounds
//   their agent creates. Only the Clerk user id is stored: no email address or name.
// - admin: the owner key (CLAY_ACCESS_KEY). May do everything, and marks playgrounds as examples.
// A playground with no owner (every playground created before accounts existed) belongs to the admin.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DOMAIN } from "./domain.ts";
import type { Budget } from "./store.ts";

export type Actor = { kind: "visitor" } | { kind: "admin" } | { kind: "user"; userId: string; via: "session" | "key" };
export const VISITOR: Actor = { kind: "visitor" };

/** What Clay stores per person: the hash of their agent key and their request count of the day. Keyed by Clerk user id. */
export type Account = { keyHash: string | null; keyCreatedAt: string | null; usage: Budget | null };

// One instance per process, also when the bundler duplicates this module per route.
const g = globalThis as { __clayActor?: AsyncLocalStorage<{ actor: Actor }> };
const als = (g.__clayActor ??= new AsyncLocalStorage<{ actor: Actor }>());

/**
 * Binds a holder for the caller to the current async context and returns it. Call it synchronously at the start of the
 * guard (before its first await): the holder then travels with the rest of the route handler, into the pipeline and the
 * Context.dev client, and the guard fills in the caller once it is known. Code outside a request sees no caller.
 */
export function bindActor(): { actor: Actor } {
  const holder = { actor: VISITOR };
  als.enterWith(holder);
  return holder;
}
/** The caller of the current request, or null outside a request (scripts, a webhook re-check). */
export const currentActor = (): Actor | null => als.getStore()?.actor ?? null;
/** The Clerk user id of the current caller, or null for an admin, a visitor or no request. */
export const currentUserId = (): string | null => {
  const a = currentActor();
  return a?.kind === "user" ? a.userId : null;
};

type Owned = { owner?: string | null; example?: boolean; domain?: { id?: string } };
/** The seed playground is an example unless the admin unmarks it. Any other playground is an example only when marked. */
export const isExample = (p: Owned, id = p.domain?.id): boolean => p.example ?? id === DOMAIN.id;
export const ownerOf = (p: Owned): string | null => p.owner ?? null;

/** May this caller open the playground? Examples are open to everyone; any other playground only to its owner and the admin. */
export function canRead(a: Actor | null, p: Owned, id?: string): boolean {
  if (a?.kind === "admin" || isExample(p, id)) return true;
  return a?.kind === "user" && ownerOf(p) === a.userId;
}
/** May this caller change the playground or spend requests on it? Only its owner and the admin; an example only the admin. */
export function canWrite(a: Actor | null, p: Owned): boolean {
  if (a?.kind === "admin") return true;
  return a?.kind === "user" && ownerOf(p) === a.userId;
}

/** A limit from an environment variable. Only an explicit 0 turns it off; a missing, empty or malformed value gives the default. */
export function limit(raw: string | undefined, fallback: number): number {
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
/** Context.dev requests per person per UTC day (CLAY_USER_DAILY_REQUESTS, default 40). */
export const userDailyCap = () => limit(process.env.CLAY_USER_DAILY_REQUESTS, 40);
/** Playgrounds per person (CLAY_USER_PLAYGROUNDS, default 20). */
export const userPlaygroundCap = () => limit(process.env.CLAY_USER_PLAYGROUNDS, 20);

/** The refusal when the current caller may not create one more playground, or null. Only signed-in people are capped. */
// lean: checked on one read before the create, so parallel creates by one person can pass it together and end a few over
// the cap (bounded by how many calls their agent sends at once). Move the count into the create's update() if that matters.
export function playgroundCapMessage(playgrounds: Record<string, Owned>, a: Actor | null = currentActor()): string | null {
  if (a?.kind !== "user") return null;
  const cap = userPlaygroundCap();
  const own = Object.values(playgrounds).filter((p) => ownerOf(p) === a.userId).length;
  return cap > 0 && own >= cap ? `You have reached the limit of ${cap} playgrounds per person. Nothing was created. Delete a playground you no longer need on the Clay home page ("Your playgrounds"), then try again.` : null;
}
export const userCapMessage = (cap: number) => `Your daily limit of ${cap} web requests is used up, so no request was sent. It resets at 00:00 UTC. The playgrounds still work: moving the controls needs no web request.`;

// Agent keys: "clay_" and 32 random bytes. Only the SHA-256 hash is stored; the key is shown once.
const KEY_PREFIX = "clay_";
export const newAgentKey = () => KEY_PREFIX + randomBytes(32).toString("base64url");
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
export const looksLikeAgentKey = (s: string) => s.startsWith(KEY_PREFIX) && s.length >= 40 && s.length <= 100;
/** The user whose agent key this is, or null. Every stored hash is compared in constant time. */
export function userOfKey(key: string, accounts: Record<string, Account>): string | null {
  if (!looksLikeAgentKey(key)) return null;
  const given = Buffer.from(hashKey(key), "hex");
  let found: string | null = null;
  for (const [userId, acc] of Object.entries(accounts)) {
    if (acc.keyHash && acc.keyHash.length === 64 && timingSafeEqual(given, Buffer.from(acc.keyHash, "hex"))) found = userId;
  }
  return found;
}

/**
 * Failed key guesses per client address, per process. After `max` failures in `windowMs` the address is refused until the
 * window passes. lean: in memory, so it is per function instance and resets on a cold start; the keys have 256 bits, so
 * this only keeps logs and the store quiet. Move it into the store if guessing traffic ever shows up.
 */
export function guessLimiter(max = 20, windowMs = 10 * 60_000) {
  const fails = new Map<string, number[]>();
  const recent = (ip: string, now: number) => (fails.get(ip) ?? []).filter((t) => now - t < windowMs);
  return {
    blocked: (ip: string, now = Date.now()) => recent(ip, now).length >= max,
    fail(ip: string, now = Date.now()) {
      if (fails.size > 10_000) fails.clear();
      fails.set(ip, [...recent(ip, now), now]);
    },
  };
}
