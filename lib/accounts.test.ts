import assert from "node:assert/strict";
import { test } from "node:test";
import { specVersion, bindActor, canRead, canWrite, currentUserId, guessLimiter, hashKey, isExample, KEY_CHECK_MS, markExample, orderExamples, KEY_GRACE_MS, keyDecision, limit, needsCheck, newAgentKey, onlyTestAddresses, playgroundCapMessage, testAccountsAllowed, userOfKey, VISITOR, type Actor } from "./accounts.ts";
import { newPlayground, spend } from "./store.ts";
import { DOMAIN } from "./domain.ts";

const admin: Actor = { kind: "admin" };
const ann: Actor = { kind: "user", userId: "user_ann", via: "session" };
const bob: Actor = { kind: "user", userId: "user_bob", via: "key" };
const seed = { domain: { id: DOMAIN.id } };
const annPrivate = { domain: { id: "ann-email" }, owner: "user_ann" };
const annExample = { ...annPrivate, example: true };
const legacy = { domain: { id: "old-one" } }; // created before accounts: no owner, the admin's

test("access: visitor, owner, another person and admin, on examples and private playgrounds", () => {
  const rows: [string, Actor, object, boolean, boolean][] = [
    // who, actor, playground, may read, may write
    ["visitor/seed", VISITOR, seed, true, false],
    ["visitor/private", VISITOR, annPrivate, false, false],
    ["visitor/marked example", VISITOR, annExample, true, false],
    ["visitor/legacy", VISITOR, legacy, false, false],
    ["owner/private", ann, annPrivate, true, true],
    ["owner/own example", ann, annExample, true, true],
    ["owner/seed", ann, seed, true, false],
    ["other/private", bob, annPrivate, false, false],
    ["other/example", bob, annExample, true, false],
    ["other/legacy", bob, legacy, false, false],
    ["admin/private", admin, annPrivate, true, true],
    ["admin/seed", admin, seed, true, true],
    ["admin/legacy", admin, legacy, true, true],
    ["no request/private", null as unknown as Actor, annPrivate, false, false],
  ];
  for (const [name, a, p, r, w] of rows) assert.deepEqual([canRead(a, p), canWrite(a, p)], [r, w], name);
  // The seed is an example until the admin unmarks it; any other playground only when marked.
  assert.equal(isExample({ ...seed, example: false }), false);
  assert.equal(isExample(legacy), false);
});

test("agent keys: stored as a hash, found in constant time, a revoked or wrong key matches nothing", () => {
  const key = newAgentKey();
  assert.match(key, /^clay_[A-Za-z0-9_-]{43}$/);
  const accounts = { user_ann: { keyHash: hashKey(key), keyCreatedAt: "x", usage: null }, user_bob: { keyHash: null, keyCreatedAt: null, usage: null } };
  assert.equal(userOfKey(key, accounts), "user_ann");
  assert.equal(userOfKey(newAgentKey(), accounts), null);
  assert.equal(userOfKey(hashKey(key), accounts), null); // the stored hash is not a key
  assert.equal(userOfKey("clay_short", accounts), null);
  assert.ok(!JSON.stringify(accounts).includes(key));
});

test("caps: playgrounds per person, environment values, and the bound caller", async () => {
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, { owner: "user_ann" }]));
  assert.match(playgroundCapMessage(many, ann) ?? "", /limit of 20 playgrounds/);
  assert.equal(playgroundCapMessage(many, bob), null);
  assert.equal(playgroundCapMessage(many, admin), null);
  process.env.CLAY_USER_PLAYGROUNDS = "21";
  assert.equal(playgroundCapMessage(many, ann), null);
  process.env.CLAY_USER_PLAYGROUNDS = "0"; // 0 turns the cap off
  assert.equal(playgroundCapMessage(many, ann), null);
  delete process.env.CLAY_USER_PLAYGROUNDS;
  assert.deepEqual([undefined, "", "x", "-1", "0", "7"].map((x) => limit(x, 40)), [40, 40, 40, 40, 0, 7]);

  // The guard binds a holder before its first await and fills it in later; the rest of the handler sees the caller,
  // and a playground created there gets its owner. Another request does not see it.
  async function guard() {
    const holder = bindActor();
    await new Promise((r) => setTimeout(r, 5));
    holder.actor = ann;
  }
  async function handler() {
    await guard();
    await new Promise((r) => setTimeout(r, 1));
    return [currentUserId(), newPlayground(DOMAIN).owner];
  }
  const other = async () => {
    await new Promise((r) => setTimeout(r, 20));
    return currentUserId();
  };
  // Each request starts from its own event (a socket read in the server), modelled here with setImmediate.
  const request = <T,>(fn: () => Promise<T>) => new Promise<T>((resolve) => setImmediate(() => resolve(fn())));
  const [mine, theirs] = await Promise.all([request(handler), request(other)]);
  assert.deepEqual(mine, ["user_ann", "user_ann"]);
  assert.equal(theirs, null);
});

test("key guesses: an address is refused after 20 failures in 10 minutes", () => {
  const g = guessLimiter(20, 600_000);
  for (let i = 0; i < 20; i++) g.fail("1.2.3.4", 1000 + i);
  assert.equal(g.blocked("1.2.3.4", 2000), true);
  assert.equal(g.blocked("5.6.7.8", 2000), false);
  assert.equal(g.blocked("1.2.3.4", 1000 + 600_001), false);
});

test("agent keys follow the Clerk account: confirmed every 10 minutes, revoked when gone, bounded when Clerk is down", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  // When to ask Clerk: never confirmed (a key from before this rule), or confirmed 10 minutes ago or more.
  assert.equal(needsCheck({ checkedAt: null }, now), true);
  assert.equal(needsCheck({}, now), true);
  assert.equal(needsCheck({ checkedAt: ago(KEY_CHECK_MS - 1) }, now), false);
  assert.equal(needsCheck({ checkedAt: ago(KEY_CHECK_MS) }, now), true);
  assert.equal(needsCheck({ checkedAt: "garbage" }, now), true);
  // Clerk confirms: allow and record the time. Deleted, banned or a test account on a public app: refuse and revoke.
  assert.deepEqual(keyDecision({ checkedAt: ago(KEY_CHECK_MS) }, now, "ok"), { allow: true, revoke: false, checkedAt: new Date(now).toISOString() });
  assert.deepEqual(keyDecision({ checkedAt: ago(1000) }, now, "gone"), { allow: false, revoke: true, checkedAt: null });
  assert.deepEqual(keyDecision({ checkedAt: ago(1000) }, now, "test"), { allow: false, revoke: true, checkedAt: null });
  // Clerk unreachable: fail open only within the grace after the last confirmation, never for a key never confirmed.
  assert.equal(keyDecision({ checkedAt: ago(KEY_GRACE_MS - 1) }, now, "unknown").allow, true);
  assert.equal(keyDecision({ checkedAt: ago(KEY_GRACE_MS) }, now, "unknown").allow, false);
  assert.equal(keyDecision({ checkedAt: null }, now, "unknown").allow, false);
  assert.equal(keyDecision({ checkedAt: ago(1000) }, now, "unknown").revoke, false);
});

test("Clerk test accounts: no agent key on a public app unless explicitly allowed", () => {
  const v = (address: string, verified = true) => ({ address, verified });
  assert.equal(onlyTestAddresses([v("ann+clerk_test@example.com")]), true);
  assert.equal(onlyTestAddresses([v("Ann+CLERK_TEST@Example.com")]), true);
  assert.equal(onlyTestAddresses([v("ann+clerk_test@example.com"), v("ann@example.org")]), false);
  // An unverified real address does not count; an unverified test address does not count either.
  assert.equal(onlyTestAddresses([v("ann+clerk_test@example.com"), v("ann@example.org", false)]), true);
  assert.equal(onlyTestAddresses([v("ann+clerk_test@example.com", false)]), false);
  assert.equal(onlyTestAddresses([]), false);
  assert.equal(onlyTestAddresses([v("ann+clerktest@example.com")]), false);
  // Clerk test phone numbers: +1 (XXX) 555-0100 to 555-0199.
  assert.equal(onlyTestAddresses([v("+1 (201) 555-0123")]), true);
  assert.equal(onlyTestAddresses([v("+12015550199"), v("ann+clerk_test@example.com")]), true);
  assert.equal(onlyTestAddresses([v("+12015550200")]), false);
  assert.equal(onlyTestAddresses([v("+45 15 55 01 23")]), false); // a real Danish number has the same last ten digits pattern
  assert.equal(onlyTestAddresses([v("ann2015550123@example.com")]), false);
  assert.equal(onlyTestAddresses([v("+12015550123"), v("+358401234567")]), false);
  assert.equal(testAccountsAllowed(true, {}), false);
  assert.equal(testAccountsAllowed(true, { CLAY_ALLOW_TEST_ACCOUNTS: "true" }), false);
  assert.equal(testAccountsAllowed(true, { CLAY_ALLOW_TEST_ACCOUNTS: "1" }), true);
  assert.equal(testAccountsAllowed(false, {}), true);
});

test("budget: a brand read counts as 2 and cannot pass the cap with one unit left", () => {
  assert.deepEqual(spend({ day: "d", used: 37 }, "d", 40, 2), { day: "d", used: 39 });
  assert.equal(spend({ day: "d", used: 39 }, "d", 40, 2), null);
  assert.deepEqual(spend({ day: "d", used: 39 }, "d", 40), { day: "d", used: 40 });
});

test("examples: only the admin marks and features; one example is featured at a time; the gallery puts it first", () => {
  const store = () => ({
    card: { domain: { id: "card" }, example: true, createdAt: "2026-11-14T00:41:00Z" } as { domain: { id: string }; example?: boolean; featured?: boolean; createdAt: string; owner?: string },
    models: { domain: { id: "models" }, example: true, createdAt: "2026-11-14T05:00:00Z" },
    gpu: { domain: { id: "gpu" }, createdAt: "2026-11-14T06:00:00Z", owner: "user_ann" },
  });
  // Nobody but the admin: not a visitor, not a signed-in person, not even the owner of the playground, not a missing caller.
  for (const who of [VISITOR, ann, bob, null]) {
    const s = store();
    assert.deepEqual(markExample(s, "gpu", { example: true, featured: true }, who), { ok: false, status: 403, error: "Only the operator of this Clay deployment can mark or feature an example." });
    assert.deepEqual(s, store());
  }
  const s = store();
  // Without a featured example the newest example comes first, as before.
  assert.deepEqual(orderExamples(s).map(([id]) => id), ["models", "card"]);
  assert.deepEqual(markExample(s, "card", { featured: true, version: specVersion(s["card"] as never) }, admin), { ok: true, example: true, featured: true });
  assert.deepEqual(orderExamples(s).map(([id]) => id), ["card", "models"]);
  // Featuring another one takes the mark from the first: one at a time.
  assert.deepEqual(markExample(s, "models", { example: true, featured: true, version: specVersion(s["models"] as never) }, admin), { ok: true, example: true, featured: true });
  assert.deepEqual(Object.entries(s).filter(([, p]) => (p as { featured?: boolean }).featured).map(([id]) => id), ["models"]);
  // Only an example can be featured; marking and featuring in one call works for a playground that is not one yet.
  assert.equal((markExample(s, "gpu", { featured: true, version: specVersion(s["gpu"] as never) }, admin) as { status: number }).status, 400);
  assert.deepEqual(markExample(s, "gpu", { example: true, featured: true, version: specVersion(s["gpu"] as never) }, admin), { ok: true, example: true, featured: true });
  assert.deepEqual(orderExamples(s).map(([id]) => id), ["gpu", "models", "card"]);
  // Unmarking the example also unfeatures it, and the newest example is first again.
  assert.deepEqual(markExample(s, "gpu", { example: false }, admin), { ok: true, example: false, featured: false });
  assert.deepEqual(orderExamples(s).map(([id]) => id), ["models", "card"]);
  // A plain mark leaves the featured one alone; unknown ids and empty bodies are refused.
  markExample(s, "card", { featured: true, version: specVersion(s["card"] as never) }, admin);
  assert.deepEqual(markExample(s, "models", { example: true, version: specVersion(s["models"] as never) }, admin), { ok: true, example: true, featured: false });
  assert.equal(s.card.featured, true);
  assert.equal((markExample(s, "nope", { example: true, version: specVersion(undefined) }, admin) as { status: number }).status, 404);
  assert.equal((markExample(s, "card", {}, admin) as { status: number }).status, 400);
  // A field of the wrong type is refused, also beside a valid one.
  assert.equal((markExample(s, "card", { example: "false", featured: false }, admin) as { status: number }).status, 400);
});

test("budget: an older day never replaces a newer day's counter", () => {
  assert.deepEqual(spend({ day: "2026-11-15", used: 2 }, "2026-11-14", 5), { day: "2026-11-15", used: 3 });
  assert.equal(spend({ day: "2026-11-15", used: 2 }, "2026-11-14", 2), null);
  assert.deepEqual(spend({ day: "2026-11-14", used: 9 }, "2026-11-15", 2), { day: "2026-11-15", used: 1 });
  assert.deepEqual(spend({ day: "2026-11-20", used: 2 }, "2026-11-14", 2), { day: "2026-11-14", used: 1 }); // a far future day is not trusted
});

test("examples: a revision by the owner clears the mark; the operator's own revision keeps it", async () => {
  const { unpublishOnRevision, markExample, isExample: isEx } = await import("./accounts.ts");
  const p = { domain: { id: "card" }, owner: "user_ann", example: true, featured: true } as { domain: { id: string }; owner: string; example?: boolean; featured?: boolean; exampleCleared?: string | null };
  assert.equal(unpublishOnRevision(p, "card", { kind: "admin" }, "t0"), false);
  assert.equal(isEx(p, "card"), true);
  assert.equal(unpublishOnRevision(p, "card", ann, "t1"), true);
  assert.equal(isEx(p, "card"), false);
  assert.equal(p.featured, undefined);
  assert.equal(p.exampleCleared, "t1");
  // Marking it again publishes the revision the operator has now seen, and the note goes away.
  assert.equal(markExample({ card: p }, "card", { example: true, version: specVersion(p as never) }, admin).ok, true);
  assert.equal(isEx(p, "card"), true);
  assert.equal(p.exampleCleared, undefined);
  // A private playground, and the built-in seed, are not touched.
  const priv = { domain: { id: "mine" }, owner: "user_ann" };
  assert.equal(unpublishOnRevision(priv, "mine", ann, "t2"), false);
  assert.equal(unpublishOnRevision({ domain: { id: DOMAIN.id } }, DOMAIN.id, ann, "t3"), false);
});

test("examples: a mark carries the version the operator reviewed; a stale one is refused", async () => {
  const { markExample: mark, specVersion: version, unpublishOnRevision: unpublish } = await import("./accounts.ts");
  const p = { domain: { id: "card", question: "A" }, owner: "user_ann", kit: { kit: { preview: { js: "OLD" } } } } as never as { domain: { id: string; question: string }; owner: string; example?: boolean; kit: { kit: { preview: { js: string } } } };
  const reviewed = version(p);
  assert.equal(mark({ card: p }, "card", { example: true }, admin).ok, false); // no version: 400
  assert.equal((mark({ card: p }, "card", { example: true }, admin) as { status: number }).status, 400);
  assert.equal(mark({ card: p }, "card", { example: true, version: reviewed }, admin).ok, true);
  // The owner revises the code: the mark is cleared, and an approval of the old view is refused.
  p.kit.kit.preview.js = "NEW";
  unpublish(p, "card", ann, "t");
  const stale = mark({ card: p }, "card", { example: true, version: reviewed }, admin);
  assert.deepEqual([stale.ok, (stale as { status: number }).status], [false, 409]);
  assert.equal(p.example, false);
  // Words only change the version too; unmarking needs none.
  const v2 = version(p);
  p.domain.question = "B";
  assert.notEqual(version(p), v2);
  assert.equal(mark({ card: p }, "card", { example: false }, admin).ok, true);
});
