import assert from "node:assert/strict";
import { test } from "node:test";
import { bindActor, canRead, canWrite, currentUserId, guessLimiter, hashKey, isExample, limit, newAgentKey, playgroundCapMessage, userOfKey, VISITOR, type Actor } from "./accounts.ts";
import { DOMAIN } from "./domain.ts";
import { newPlayground } from "./store.ts";

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
