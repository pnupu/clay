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
 * The operator approves what they saw when they mark an example. A revision by anyone else (new code, new data sources,
 * new words) takes the mark away, so visitors never run a version nobody approved; the operator marks it again after a
 * look. The operator's own revisions keep the mark. Returns true when the mark was cleared.
 */
export function unpublishOnRevision(p: Owned & { featured?: boolean; exampleCleared?: string | null }, id: string, a: Actor | null, now: string): boolean {
  if (a?.kind === "admin" || id === DOMAIN.id || !isExample(p, id)) return false;
  p.example = false;
  delete p.featured;
  p.exampleCleared = now;
  delete (p as { discardedWrites?: unknown }).discardedWrites; // they were about the published example
  return true;
}
export const EXAMPLE_CLEARED = "This playground was an example. Because it was revised, the example mark was cleared: other people no longer see it until the operator of this Clay deployment looks at it and marks it again.";

/**
 * Mark or unmark a playground as an example, and choose the featured example: the one the landing page embeds.
 * Only the admin may do either (the example route is admin-only already; this is the same rule where the data changes).
 * Featuring needs an example, and takes the mark from every other playground, so at most one is featured. Unmarking an
 * example also unfeatures it. Returns what the playground is now, or the refusal.
 */
/**
 * `look`: the version of what a visitor would see of the playground (lib/report.ts, viewVersion) and whether web reads
 * still run on it (a build, a re-check or a brand read), whose results nobody has seen yet.
 */
export function markExample(playgrounds: Record<string, Owned>, id: string, mark: { example?: unknown; featured?: unknown; version?: unknown }, a: Actor | null, look: (p: Owned) => { version: string; busy: boolean }): { ok: true; example: boolean; featured: boolean } | { ok: false; status: 400 | 403 | 404 | 409; error: string } {
  if (a?.kind !== "admin") return { ok: false, status: 403, error: "Only the operator of this Clay deployment can mark or feature an example." };
  const p = playgrounds[id];
  if (!p) return { ok: false, status: 404, error: "Playground not found." };
  // A started playground (lib/started.ts) has nothing built to show: it can never be an example.
  if ((p as { started?: unknown }).started) return { ok: false, status: 409, error: "This playground is started and not built yet: there is nothing to publish." };
  // A field that is sent must be a boolean: {"example": "false"} is refused, not read as "leave it as it is".
  const sent = [mark.example, mark.featured].filter((v) => v !== undefined);
  if (!sent.length || sent.some((v) => typeof v !== "boolean")) return { ok: false, status: 400, error: 'Send {"example": true|false}, {"featured": true|false}, or both.' };
  // Publishing (marking or featuring) approves what the operator reviewed: the version of that view must still be the
  // playground's version, checked here inside the same store update that publishes it. Unmarking needs no version.
  if (mark.example === true || mark.featured === true) {
    const { version: now, busy } = look(p);
    if (busy) return { ok: false, status: 409, error: "This playground is still reading web pages (a build, a re-check or a brand read runs), and what they bring has not been seen yet. Wait until the reads have ended, open the playground again, look at it, then mark it with the version it shows then." };
    if (typeof mark.version !== "string") return { ok: false, status: 400, error: `Send the version you reviewed with the mark: {"example": true, "version": "${now}"}. GET /api/p/${id}/state returns it as "version"; look at the playground before you mark it.` };
    if (mark.version !== now) return { ok: false, status: 409, error: `This playground changed after the version you reviewed (${mark.version.slice(0, 16)}; it is now ${now}). Open it again, look at what changed, then mark it with the new version.` };
  }
  const example = typeof mark.example === "boolean" ? mark.example : isExample(p, id);
  if (mark.featured === true && !example) return { ok: false, status: 400, error: 'Only an example can be featured: mark it as an example first, or send {"example": true, "featured": true}.' };
  if (typeof mark.example === "boolean") {
    p.example = mark.example;
    delete (p as { discardedWrites?: unknown }).discardedWrites; // a new publication, or none: the old notes are done
  }
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

/**
 * A published example changes for visitors only through the operator: on a playground marked as an example, every
 * write by anyone else (re-check, collect, settle, explore, a saved or deleted decision, a preview report, a delete) is
 * refused, because new web values, a new decision or a new state would reach every visitor unseen. The owner may still
 * revise it (revise_playground), which clears the mark (unpublishOnRevision). Returns the refusal, or null.
 */
export function publishedRefusal(a: Actor | null, p: Owned, id: string): string | null {
  if (a?.kind === "admin" || !isExample(p, id) || !canWrite(a, p)) return null;
  return "This playground is a published example: only the operator of this Clay deployment can change it now. Ask the operator to unpublish it, or revise it with revise_playground, which clears the example mark so that other people no longer see it.";
}

/** A write that keepPublished() discarded, as its owner is told (lib/report.ts). */
export type Discarded = { at: string; by: "its owner" | "another caller" | "a web monitor or other work with no caller" };
/**
 * The in-update half of publishedRefusal: store.ts update() calls this before every write and the function it returns
 * after it. A published example that the write changed gets back what it was before the write, so it keeps what the
 * operator approved, when the write was made by:
 * - a caller who is not the operator (a request of its owner, or work that the request left running, such as a
 *   re-check whose pages arrive after the mark), on any example;
 * - no caller (a webhook monitor's re-check), on an example that a person owns. An example that the operator owns stays
 *   live by design: its monitor's re-checks update it.
 * The work bookkeeping (`work`) is kept, a revision that clears the mark (unpublishOnRevision) passes, and the discarded
 * write is recorded for the owner (`discardedWrites`, the last 10; never shown to anyone else).
 */
export function keepPublished<P extends Owned & { work?: unknown; discardedWrites?: Discarded[] }>(playgrounds: Record<string, P>, a: Actor | null = currentActor(), now = () => new Date().toISOString()): (after: Record<string, P>) => void {
  if (a?.kind === "admin") return () => {};
  const seen = (p: P) => JSON.stringify({ ...p, work: undefined });
  const before = new Map(Object.entries(playgrounds).filter(([id, p]) => isExample(p, id) && (a !== null || ownerOf(p) !== null)).map(([id, p]) => [id, seen(p)]));
  return (after) => {
    for (const [id, was] of before) {
      const p = after[id];
      if ((p && !isExample(p, id)) || (p && seen(p) === was)) continue;
      const kept = JSON.parse(was) as P;
      if (p && p.work !== undefined) kept.work = p.work;
      kept.discardedWrites = [{ at: now(), by: !a ? ("a web monitor or other work with no caller" as const) : a.kind === "user" && ownerOf(kept) === a.userId ? ("its owner" as const) : ("another caller" as const) }, ...(kept.discardedWrites ?? [])].slice(0, 10);
      after[id] = kept;
    }
  };
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
// Checked inside the create's store update (store.ts, insertPlayground), so parallel creates stop at the cap.
export function playgroundCapMessage(playgrounds: Record<string, Owned>, a: Actor | null = currentActor()): string | null {
  if (a?.kind !== "user") return null;
  const cap = userPlaygroundCap();
  const own = Object.values(playgrounds).filter((p) => ownerOf(p) === a.userId).length;
  return cap > 0 && own >= cap ? `You have reached the limit of ${cap} playgrounds per person. Nothing was created. Delete a playground you no longer need on the Clay home page ("Your playgrounds"), then try again.` : null;
}
/**
 * The deployment-wide bound: every request reads and parses the one store document, so its size is the real limit
 * (measured: about 25 ms to read and parse 10 MB, 150 ms for 50 MB, plus the blob transfer on Vercel). A person may not
 * create a playground once the deployment holds CLAY_MAX_PLAYGROUNDS playgrounds (default 2,000) or its store
 * CLAY_MAX_STORE_BYTES characters (default 10,000,000); 0 turns a bound off. The operator is not bound: examples and the
 * operator's own playgrounds stay creatable.
 */
export function deploymentCapMessage(count: number, bytes: number, a: Actor | null = currentActor(), ownsAny = true): string | null {
  if (a?.kind !== "user") return null;
  const maxCount = limit(process.env.CLAY_MAX_PLAYGROUNDS, 2_000);
  const maxBytes = maxStoreChars();
  if (maxCount > 0 && count >= maxCount) return `This Clay deployment holds its limit of ${maxCount} playgrounds. Nothing was created. ${makeRoom(ownsAny)}`;
  if (maxBytes > 0 && bytes >= maxBytes) return `This Clay deployment's storage is full (${bytes} of ${maxBytes} characters). Nothing was created. ${makeRoom(ownsAny)}`;
  return null;
}
const maxStoreChars = () => limit(process.env.CLAY_MAX_STORE_BYTES, 10_000_000);
/** What a refused person can do: delete one of theirs, or, owning none, ask the operator. */
const makeRoom = (ownsAny: boolean) => (ownsAny ? 'Delete a playground you no longer need on the Clay home page ("Your playgrounds"), or try again later.' : "Ask the operator of this Clay deployment to make room, or try again later.");
/**
 * Characters per person over their own playgrounds (CLAY_USER_STORE_BYTES, default 600,000): 20 playgrounds the size of
 * the largest live example (about 26,000 characters) fit, so filling the 10,000,000 of the deployment takes about 16 accounts.
 */
export const userStoreAllowance = () => limit(process.env.CLAY_USER_STORE_BYTES, 600_000);
/** A write that the storage bounds refuse: nothing of it is stored (store.ts update()). */
export class StorageRefused extends Error {}
/**
 * A write of a person's that grows their playgrounds by at most this many characters, without adding or revising one,
 * passes a full deployment store: a settle (its outputs are capped at 32,000 characters, OUTPUT_LIMIT), an exploration
 * record and a saved decision (a few hundred characters each), and a re-check result (a price read up to about 4,000, a
 * web source up to about 6,000 in the live examples). Only the person's own allowance holds such writes.
 */
export const SMALL_WRITE = 40_000;
/**
 * The storage bounds, checked inside every store update on the size it leaves (store.ts update() calls this before the
 * write and the function it returns after it). A write by a person that grows their own playgrounds is refused when
 * their playgrounds would hold more than their allowance, and, when the store would hold more than
 * CLAY_MAX_STORE_BYTES, if it adds a playground, revises one (a new spec) or grows them by more than SMALL_WRITE. So a
 * full store stops creates, revisions and large growth, and the people who already have playgrounds can still settle,
 * explore, save a decision and store a re-check. A write that does not grow them (a delete, a smaller revision) always
 * passes, and so does the operator. Throws StorageRefused.
 */
export function boundStorage(playgrounds: Record<string, Owned>, a: Actor | null = currentActor()): (after: Record<string, Owned>, storeChars: () => number) => void {
  if (!a) return boundOwners(playgrounds);
  if (a.kind !== "user") return () => {};
  const mine = (all: Record<string, Owned>) => Object.entries(all).filter(([, p]) => ownerOf(p) === a.userId);
  // The work bookkeeping is not counted: ending tracked work (and storing why it stopped) must always pass.
  const chars = (ps: [string, Owned][]) => ps.reduce((n, [, p]) => n + JSON.stringify({ ...p, work: undefined }).length, 0);
  const specOf = (p: Owned) => JSON.stringify([p.domain, (p as { kit?: { kit?: unknown } }).kit?.kit ?? null]);
  const owned = mine(playgrounds);
  const specs = new Map(owned.map(([id, p]) => [id, specOf(p)]));
  const before = chars(owned);
  return (after, storeChars) => {
    const now = mine(after);
    const own = chars(now);
    if (own <= before) return;
    const allowance = userStoreAllowance(), max = maxStoreChars();
    if (allowance > 0 && own > allowance) throw new StorageRefused(`Your playgrounds would hold ${own} characters, over the limit of ${allowance} characters per person. Nothing was stored. Make the playground smaller, or delete a playground you no longer need on the Clay home page ("Your playgrounds"), then try again.`);
    const large = own - before > SMALL_WRITE || now.some(([id, p]) => specs.get(id) !== specOf(p)); // added (no spec before), revised, or large
    const total = max > 0 && large ? storeChars() : 0;
    if (max > 0 && large && total > max) throw new StorageRefused(`This Clay deployment's storage is full (${total} of ${max} characters). Nothing was stored. ${makeRoom(owned.length > 0)}`);
  };
}
/** Characters that a person's playgrounds hold (the work bookkeeping left out), as the storage bounds count them. */
export const ownedChars = (playgrounds: Record<string, Owned>, owner: string) => Object.values(playgrounds).filter((p) => ownerOf(p) === owner).reduce((n, p) => n + JSON.stringify({ ...p, work: undefined }).length, 0);
/** A person at or over their storage allowance: a webhook monitor's re-check of their playground is not even read (its result could not be stored). */
export const atAllowance = (playgrounds: Record<string, Owned>, owner: string) => userStoreAllowance() > 0 && ownedChars(playgrounds, owner) >= userStoreAllowance();
/**
 * The same bounds for a write with no caller (a webhook monitor's re-check), per owner of the person's playgrounds it
 * grows: over the owner's allowance, or larger than SMALL_WRITE while the store is over CLAY_MAX_STORE_BYTES. Such
 * growth is not refused (nobody waits for the answer): each of that owner's playgrounds that the write grew keeps what
 * it held before (its `work` bookkeeping excepted), and the owner is told (`storageKept`, the last 10). A write that
 * is stored clears that note. Operator-owned playgrounds and published examples (keepPublished guards those) are not
 * bound here.
 */
function boundOwners(playgrounds: Record<string, Owned>, now = () => new Date().toISOString()): (after: Record<string, Owned>, storeChars: () => number) => void {
  const json = (p: Owned) => JSON.stringify({ ...p, work: undefined });
  const before = new Map(Object.entries(playgrounds).filter(([id, p]) => ownerOf(p) && !isExample(p, id)).map(([id, p]) => [id, { owner: ownerOf(p)!, json: json(p) }]));
  return (after, storeCharsOnce) => {
    let total: number | null = null;
    const storeChars = () => (total ??= storeCharsOnce());
    const sums = new Map<string, [number, number]>();
    const add = (o: string, i: 0 | 1, n: number) => { const v = sums.get(o) ?? [0, 0]; v[i] += n; sums.set(o, v); };
    for (const { owner, json: j } of before.values()) add(owner, 0, j.length);
    const jsonNow = new Map([...before.keys()].filter((id) => after[id]).map((id) => [id, json(after[id])]));
    for (const [id, j] of jsonNow) add(before.get(id)!.owner, 1, j.length);
    const allowance = userStoreAllowance(), max = maxStoreChars();
    for (const [owner, [was, is]] of sums) {
      if (is <= was) continue;
      const refused = (allowance > 0 && is > allowance) || (max > 0 && is - was > SMALL_WRITE && storeChars() > max);
      for (const [id, b] of before) {
        const j = jsonNow.get(id);
        if (b.owner !== owner || j === undefined || j.length <= b.json.length) continue; // only what this write grew
        const p = after[id] as Owned & { work?: unknown; storageKept?: { at: string }[] };
        if (!refused) { delete p.storageKept; continue; } // stored: an earlier note is done
        const kept = JSON.parse(b.json) as typeof p;
        if (p.work !== undefined) kept.work = p.work;
        kept.storageKept = [{ at: now() }, ...(kept.storageKept ?? [])].slice(0, 10);
        after[id] = kept;
      }
    }
  };
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
 * Is this viewer past connecting an agent? A person with an agent key, and the operator, whose agent uses the owner key.
 * The pages then stop asking them to connect one (the headers, the landing page, the example notes, the example refusal).
 * A key only shows that one was created, and nothing is stored for the operator: no text may say that an agent is connected.
 */
export const agentConnected = (a: Actor | null, accounts: Record<string, Account>): boolean => a?.kind === "admin" || (a?.kind === "user" && !!accounts[a.userId]?.keyHash);

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
