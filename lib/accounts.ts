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
import { isHosted } from "./access.ts";
import { DOMAIN } from "./domain.ts";
import type { Budget } from "./store.ts";

export type Actor = { kind: "visitor" } | { kind: "admin" } | { kind: "user"; userId: string; via: "session" | "key" };
export const VISITOR: Actor = { kind: "visitor" };

/** What Clay stores per person: the hash of their agent key and their request count of the day. Keyed by Clerk user id. */
export type Account = {
  keyHash: string | null;
  keyCreatedAt: string | null;
  usage: Budget | null;
  /** When Clerk last confirmed that this person still exists, is not banned and may hold a key (keyDecision()). */
  checkedAt?: string | null;
};

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

type Owned = { owner?: string | null; example?: boolean; featured?: boolean; createdAt?: string; domain?: { id?: string } };
/** The seed playground is an example unless the admin unmarks it. Any other playground is an example only when marked. */
export const isExample = (p: Owned, id = p.domain?.id): boolean => p.example ?? id === DOMAIN.id;
export const ownerOf = (p: Owned): string | null => p.owner ?? null;

/**
 * Mark or unmark a playground as an example, and choose the featured example: the one the landing page embeds.
 * Only the admin may do either (the example route is admin-only already; this is the same rule where the data changes).
 * Featuring needs an example, and takes the mark from every other playground, so at most one is featured. Unmarking an
 * example also unfeatures it. Returns what the playground is now, or the refusal.
 */
/**
 * The operator approves what they saw when they mark an example. A revision by anyone else (new code, new data sources,
 * new words) takes the mark away, so visitors never run a version nobody approved; the operator marks it again after a
 * look. The operator's own revisions keep the mark. Returns true when the mark was cleared.
 */
export function unpublishOnRevision(p: Owned & { featured?: boolean; exampleCleared?: string | null }, id: string, a: Actor | null, now: string): boolean {
  if (a?.kind === "admin" || id === DOMAIN.id || !isExample(p, id)) return false;
  p.example = false;
  delete p.featured;
  p.exampleCleared = now;
  return true;
}
export const EXAMPLE_CLEARED = "This playground was an example. Because it was revised, the example mark was cleared: other people no longer see it until the operator of this Clay deployment looks at it and marks it again.";

export function markExample(playgrounds: Record<string, Owned>, id: string, mark: { example?: unknown; featured?: unknown }, a: Actor | null): { ok: true; example: boolean; featured: boolean } | { ok: false; status: 400 | 403 | 404; error: string } {
  if (a?.kind !== "admin") return { ok: false, status: 403, error: "Only the operator of this Clay deployment can mark or feature an example." };
  const p = playgrounds[id];
  if (!p) return { ok: false, status: 404, error: "Playground not found." };
  // A field that is sent must be a boolean: {"example": "false"} is refused, not read as "leave it as it is".
  const sent = [mark.example, mark.featured].filter((v) => v !== undefined);
  if (!sent.length || sent.some((v) => typeof v !== "boolean")) return { ok: false, status: 400, error: 'Send {"example": true|false}, {"featured": true|false}, or both.' };
  const example = typeof mark.example === "boolean" ? mark.example : isExample(p, id);
  if (mark.featured === true && !example) return { ok: false, status: 400, error: 'Only an example can be featured: mark it as an example first, or send {"example": true, "featured": true}.' };
  if (typeof mark.example === "boolean") p.example = mark.example;
  if (mark.example === true) delete (p as { exampleCleared?: string | null }).exampleCleared;
  if (mark.featured === true) {
    for (const other of Object.values(playgrounds)) delete other.featured;
    p.featured = true;
  } else if (mark.featured === false || !example) delete p.featured;
  return { ok: true, example, featured: p.featured === true };
}

/**
 * The examples in the order of the gallery: the featured one first, then the newest first. The first entry is the one the
 * landing page embeds, so without a featured example that is the newest, as before.
 */
export function orderExamples<T extends Owned>(playgrounds: Record<string, T>): [string, T][] {
  return Object.entries(playgrounds)
    .filter(([id, p]) => isExample(p, id))
    .sort(([, a], [, b]) => Number(b.featured === true) - Number(a.featured === true) || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

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
// No final period: lib/mcp.ts quotes this text inside a sentence of its own ("stopped early: <text>. Do not retry").
export const userCapMessage = (cap: number) => `Your daily limit of ${cap} web requests is used up (reading a brand counts as 2), so no request was sent. It resets at 00:00 UTC. Until then the playgrounds still work, because moving the controls needs no web request, and your agent can still build preview playgrounds that use no web data`;

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

// Agent keys follow the Clerk account: a key whose person was deleted or banned in Clerk stops working. The store keeps
// when Clerk last confirmed the person, so a cold function instance does not skip the check.
/** How often an agent key's person is confirmed with Clerk. */
export const KEY_CHECK_MS = 10 * 60_000;
/**
 * When Clerk cannot be reached, a key that Clerk confirmed less than this long ago keeps working (fail open, bounded);
 * after that, or for a key never confirmed, the request is refused (fail closed). An outage of Clerk then does not stop
 * every agent at once, and a deleted person keeps a key for at most KEY_CHECK_MS + KEY_GRACE_MS.
 */
export const KEY_GRACE_MS = 60 * 60_000;
/** What Clerk says about a person: fine, gone (deleted or banned), a test account not allowed a key here, or nothing (not reachable). */
export type ClerkVerdict = "ok" | "gone" | "test" | "unknown";

/** Must this key's person be confirmed with Clerk before the request goes on? */
export const needsCheck = (acc: Pick<Account, "checkedAt">, now: number): boolean => !acc.checkedAt || !(now - Date.parse(acc.checkedAt) < KEY_CHECK_MS);
/** After asking Clerk: allow the request? Revoke the key (remove its hash)? Record a new confirmation time? */
export function keyDecision(acc: Pick<Account, "checkedAt">, now: number, verdict: ClerkVerdict): { allow: boolean; revoke: boolean; checkedAt: string | null } {
  if (verdict === "ok") return { allow: true, revoke: false, checkedAt: new Date(now).toISOString() };
  if (verdict === "gone" || verdict === "test") return { allow: false, revoke: true, checkedAt: null };
  const last = acc.checkedAt ? Date.parse(acc.checkedAt) : NaN;
  return { allow: now - last < KEY_GRACE_MS, revoke: false, checkedAt: null };
}

// Clerk test addresses (name+clerk_test@...) sign up with a fixed code and no mailbox, so anyone can make many accounts
// with them. A public app gives no agent key to an account whose only verified addresses are test addresses, unless
// CLAY_ALLOW_TEST_ACCOUNTS=1 (the team's own local runs). The addresses are read from Clerk when needed and never stored.
// Clerk test phone numbers are +1 (XXX) 555-0100 to 555-0199, with the same fixed code.
export const isTestAddress = (address: string) => (address.includes("@") ? /\+clerk_test@/i.test(address) : /^1\d{3}55501\d{2}$/.test(address.replace(/\D/g, "")));
/** Does this account have verified email addresses or phone numbers, all of them Clerk test ones? */
export const onlyTestAddresses = (emails: { address: string; verified: boolean }[]): boolean => {
  const verified = emails.filter((e) => e.verified);
  return verified.length > 0 && verified.every((e) => isTestAddress(e.address));
};
/** May an account with only test addresses hold an agent key? Only off a public deployment, or when explicitly allowed. */
export const testAccountsAllowed = (hosted: boolean, env: Record<string, string | undefined> = process.env) => !hosted || env.CLAY_ALLOW_TEST_ACCOUNTS === "1";
/** The one test-account rule, for the key check and the Clerk webhook: only test identifiers, on a public app, not allowed. */
export const refusesTestAccount = (ids: { address: string; verified: boolean }[]): boolean => onlyTestAddresses(ids) && !testAccountsAllowed(isHosted());
/** What a Clerk test account hears when it tries to build or spend on a public app (it may still sign in and look). */
export const TEST_ACCOUNT_LOOK_ONLY = "This account's only email address is a Clerk test address (+clerk_test). It can sign in and look around, but not build, change or re-check playgrounds, or spend web requests. Sign up with an email address you own:";
export const TEST_ACCOUNT_MESSAGE = "Clay gives no agent key to an account whose only email address is a Clerk test address (+clerk_test). Sign up with an email address you own";
