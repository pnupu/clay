import assert from "node:assert/strict";
import { test } from "node:test";
import { agentConnected, bindActor, canRead, canWrite, currentUserId, guessLimiter, hashKey, isAdminUser, isExample, KEY_CHECK_MS, markExample, orderExamples, KEY_GRACE_MS, keyDecision, limit, looksLikeAgentKey, needsCheck, newAgentKey, onlyTestAddresses, playgroundCapMessage, sessionUserId, testAccountsAllowed, userOfKey, VISITOR, type Actor } from "./accounts.ts";
import { newPlayground, spend } from "./store.ts";
import { DOMAIN } from "./domain.ts";
import { markLook, viewVersion } from "./report.ts";

const look = (p: unknown) => markLook(p as never);

const admin: Actor = { kind: "admin" };
/** An account admin: a listed Clerk account, signed in in a browser (CLAY_ADMIN_USER_IDS). */
const adminOlga: Actor = { kind: "admin", userId: "user_olga" };
const ann: Actor = { kind: "user", userId: "user_ann", via: "session" };
const bob: Actor = { kind: "user", userId: "user_bob", via: "key" };
const seed = { domain: { id: DOMAIN.id } };
const annPrivate = { domain: { id: "ann-email" }, owner: "user_ann" };
const annExample = { ...annPrivate, example: true };
const legacy = { domain: { id: "old-one" } }; // created before accounts: no owner, the admin's

test("access: visitor, owner, another person and admin, on examples and private labs", () => {
  const rows: [string, Actor, object, boolean, boolean][] = [
    // who, actor, lab, may read, may write
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
    ["account admin/another person's private", adminOlga, annPrivate, true, true],
    ["account admin/own private", adminOlga, { domain: { id: "olga-one" }, owner: "user_olga" }, true, true],
    ["account admin/seed", adminOlga, seed, true, true],
    ["account admin/legacy", adminOlga, legacy, true, true],
    ["no request/private", null as unknown as Actor, annPrivate, false, false],
  ];
  for (const [name, a, p, r, w] of rows) assert.deepEqual([canRead(a, p), canWrite(a, p)], [r, w], name);
  // The seed is an example until the admin unmarks it; any other lab only when marked.
  assert.equal(isExample({ ...seed, example: false }), false);
  assert.equal(isExample(legacy), false);
});

test("an agent key made before the rename (prefix clay_) is still a key and still finds its person", () => {
  const old = "clay_" + "aB3-_x9".repeat(6) + "Q";
  assert.equal(old.length, 48);
  assert.equal(looksLikeAgentKey(old), true);
  assert.equal(userOfKey(old, { user_ann: { keyHash: hashKey(old), keyCreatedAt: "x", usage: null } }), "user_ann");
  assert.equal(userOfKey("clay_short", { user_ann: { keyHash: hashKey("clay_short"), keyCreatedAt: "x", usage: null } }), null);
});

test("agent keys: stored as a hash, found in constant time, a revoked or wrong key matches nothing", () => {
  const key = newAgentKey();
  assert.match(key, /^sorvi_[A-Za-z0-9_-]{43}$/);
  const accounts = { user_ann: { keyHash: hashKey(key), keyCreatedAt: "x", usage: null }, user_bob: { keyHash: null, keyCreatedAt: null, usage: null } };
  assert.equal(userOfKey(key, accounts), "user_ann");
  assert.equal(userOfKey(newAgentKey(), accounts), null);
  assert.equal(userOfKey(hashKey(key), accounts), null); // the stored hash is not a key
  assert.equal(userOfKey("sorvi_short", accounts), null);
  assert.ok(!JSON.stringify(accounts).includes(key));
});

test("caps: labs per person, environment values, and the bound caller", async () => {
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, { owner: "user_ann" }]));
  assert.match(playgroundCapMessage(many, ann) ?? "", /limit of 20 labs/);
  assert.equal(playgroundCapMessage(many, bob), null);
  assert.equal(playgroundCapMessage(many, admin), null);
  process.env.CLAY_USER_PLAYGROUNDS = "21";
  assert.equal(playgroundCapMessage(many, ann), null);
  process.env.CLAY_USER_PLAYGROUNDS = "0"; // 0 turns the cap off
  assert.equal(playgroundCapMessage(many, ann), null);
  delete process.env.CLAY_USER_PLAYGROUNDS;
  assert.deepEqual([undefined, "", "x", "-1", "0", "7"].map((x) => limit(x, 40)), [40, 40, 40, 40, 0, 7]);

  // The guard binds a holder before its first await and fills it in later; the rest of the handler sees the caller,
  // and a lab created there gets its owner. Another request does not see it.
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
  // Nobody but the admin: not a visitor, not a signed-in person, not even the owner of the lab, not a missing caller.
  for (const who of [VISITOR, ann, bob, null]) {
    const s = store();
    assert.deepEqual(markExample(s, "gpu", { example: true, featured: true }, who, look), { ok: false, status: 403, error: "Only the operator of this Sorvi deployment can mark or feature an example." });
    assert.deepEqual(s, store());
  }
  const s = store();
  // Without a featured example the newest example comes first, as before.
  assert.deepEqual(orderExamples(s).map(([id]) => id), ["models", "card"]);
  assert.deepEqual(markExample(s, "card", { featured: true, version: viewVersion(s["card"] as never) }, admin, look), { ok: true, example: true, featured: true });
  assert.deepEqual(orderExamples(s).map(([id]) => id), ["card", "models"]);
  // Featuring another one takes the mark from the first: one at a time.
  assert.deepEqual(markExample(s, "models", { example: true, featured: true, version: viewVersion(s["models"] as never) }, admin, look), { ok: true, example: true, featured: true });
  assert.deepEqual(Object.entries(s).filter(([, p]) => (p as { featured?: boolean }).featured).map(([id]) => id), ["models"]);
  // Only an example can be featured; marking and featuring in one call works for a lab that is not one yet.
  assert.equal((markExample(s, "gpu", { featured: true, version: viewVersion(s["gpu"] as never) }, admin, look) as { status: number }).status, 400);
  assert.deepEqual(markExample(s, "gpu", { example: true, featured: true, version: viewVersion(s["gpu"] as never) }, admin, look), { ok: true, example: true, featured: true });
  assert.deepEqual(orderExamples(s).map(([id]) => id), ["gpu", "models", "card"]);
  // Unmarking the example also unfeatures it, and the newest example is first again.
  assert.deepEqual(markExample(s, "gpu", { example: false }, admin, look), { ok: true, example: false, featured: false });
  assert.deepEqual(orderExamples(s).map(([id]) => id), ["models", "card"]);
  // A plain mark leaves the featured one alone; unknown ids and empty bodies are refused.
  markExample(s, "card", { featured: true, version: viewVersion(s["card"] as never) }, admin, look);
  assert.deepEqual(markExample(s, "models", { example: true, version: viewVersion(s["models"] as never) }, admin, look), { ok: true, example: true, featured: false });
  assert.equal(s.card.featured, true);
  assert.equal((markExample(s, "nope", { example: true, version: "0" }, admin, look) as { status: number }).status, 404);
  assert.equal((markExample(s, "card", {}, admin, look) as { status: number }).status, 400);
  // A field of the wrong type is refused, also beside a valid one.
  assert.equal((markExample(s, "card", { example: "false", featured: false }, admin, look) as { status: number }).status, 400);
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
  assert.equal(markExample({ card: p }, "card", { example: true, version: viewVersion(p as never) }, admin, look).ok, true);
  assert.equal(isEx(p, "card"), true);
  assert.equal(p.exampleCleared, undefined);
  // A private lab, and the built-in seed, are not touched.
  const priv = { domain: { id: "mine" }, owner: "user_ann" };
  assert.equal(unpublishOnRevision(priv, "mine", ann, "t2"), false);
  assert.equal(unpublishOnRevision({ domain: { id: DOMAIN.id } }, DOMAIN.id, ann, "t3"), false);
});

test("examples: a mark carries the version the operator reviewed; a stale one is refused", async () => {
  const { markExample: mark, unpublishOnRevision: unpublish } = await import("./accounts.ts");
  const version = (p: unknown) => viewVersion(p as never);
  const p = { domain: { id: "card", question: "A" }, owner: "user_ann", kit: { kit: { preview: { js: "OLD" } } } } as never as { domain: { id: string; question: string }; owner: string; example?: boolean; kit: { kit: { preview: { js: string } } } };
  const reviewed = version(p);
  assert.equal(mark({ card: p }, "card", { example: true }, admin, look).ok, false); // no version: 400
  assert.equal((mark({ card: p }, "card", { example: true }, admin, look) as { status: number }).status, 400);
  assert.equal(mark({ card: p }, "card", { example: true, version: reviewed }, admin, look).ok, true);
  // The owner revises the code: the mark is cleared, and an approval of the old view is refused.
  p.kit.kit.preview.js = "NEW";
  unpublish(p, "card", ann, "t");
  const stale = mark({ card: p }, "card", { example: true, version: reviewed }, admin, look);
  assert.deepEqual([stale.ok, (stale as { status: number }).status], [false, 409]);
  assert.equal(p.example, false);
  // Words only change the version too; unmarking needs none.
  const v2 = version(p);
  p.domain.question = "B";
  assert.notEqual(version(p), v2);
  assert.equal(mark({ card: p }, "card", { example: false }, admin, look).ok, true);
});

test("published examples: only the operator writes; the owner may only revise, which clears the mark", async () => {
  const { publishedRefusal: refusal, unpublishOnRevision: unpublish, isExample: isEx } = await import("./accounts.ts");
  const ex = { domain: { id: "card" }, owner: "user_ann", example: true } as { domain: { id: string }; owner: string; example?: boolean };
  assert.match(refusal(ann, ex, "card") ?? "", /published example/);
  assert.equal(refusal(admin, ex, "card"), null);
  assert.equal(refusal(bob, ex, "card"), null); // not the owner: refused anyway by canWrite, with the usual answer
  assert.equal(refusal(ann, { ...ex, example: false }, "card"), null); // a private lab: the owner writes as before
  // The owner's revision is the one way through, and it unpublishes.
  assert.equal(unpublish(ex, "card", ann, "t"), true);
  assert.equal(isEx(ex, "card"), false);
  assert.equal(refusal(ann, ex, "card"), null);
});

test("deployment bound: people cannot fill the one store; the operator can still create", async () => {
  const { deploymentCapMessage: cap } = await import("./accounts.ts");
  assert.equal(cap(1999, 9_000_000, ann), null);
  assert.match(cap(2000, 1000, ann) ?? "", /limit of 2000 labs/);
  assert.match(cap(10, 10_000_000, ann) ?? "", /storage is full/);
  assert.equal(cap(5000, 50_000_000, admin), null);
  process.env.CLAY_MAX_PLAYGROUNDS = "0"; process.env.CLAY_MAX_STORE_BYTES = "5";
  assert.equal(cap(9999, 4, ann), null);
  assert.match(cap(1, 5, ann) ?? "", /storage is full/);
  delete process.env.CLAY_MAX_PLAYGROUNDS; delete process.env.CLAY_MAX_STORE_BYTES;
});

test("examples: the version covers what a visitor sees, and a mark waits for running web reads", async () => {
  const { markExample: mark } = await import("./accounts.ts");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose test fixtures
  const p = { domain: { id: "card", question: "A" }, owner: "user_ann", sources: { alpha: { snapshot: { textHash: "h1", fetchedAt: "t1" }, lastCheckedAt: "t1", monitor: { id: "m", secret: "s1", webhookUrl: "u" } } }, decision: null as unknown, events: [] as unknown[], leftOut: [] as unknown[], kit: { kit: { js: "x" }, web: { src: { read: { fields: { note: "plain" } } } }, brandData: null as unknown, brandError: null as string | null, brandSince: null as string | null, preview: { status: "ok" }, settled: { values: { a: 1 } }, exploration: null }, work: null as unknown } as never as Record<string, any>;
  const v = () => viewVersion(p as never);
  const seen = new Set([v()]);
  const changes: [string, () => void][] = [
    ["a web value", () => (p.kit.web.src.read.fields.note = "<img onerror>")],
    ["the brand", () => (p.kit.brandData = { title: "B" })],
    ["a price read", () => (p.sources.alpha.snapshot.textHash = "h2")],
    ["a read time", () => (p.sources.alpha.snapshot.fetchedAt = "t2")],
    ["the saved decision", () => (p.decision = { chosen: "beta", tolerance: 123 })],
    ["left_out", () => p.leftOut.push({ name: "n", reason: "added after the look" })],
    ["a change event", () => p.events.push({ id: "e" })],
  ];
  for (const [what, change] of changes) {
    change();
    assert.ok(!seen.has(v()), what);
    seen.add(v());
  }
  // Not in it: the marks themselves, the webhook secret, and what only the owner sees (settled result, preview status).
  const now = v();
  Object.assign(p, { example: true, featured: true, exampleCleared: "t" });
  p.sources.alpha.monitor.secret = "s2";
  p.kit.settled = { values: { a: 2 } };
  p.kit.preview = { status: "failed" };
  assert.equal(v(), now);
  // Running web reads (a build or a re-check, or a pending brand read): the mark is refused until they end.
  p.example = false;
  p.work = { id: "w", kind: "recheck", startedAt: new Date().toISOString(), pending: ["src"], finishedAt: null, stop: null };
  const busy = mark({ card: p } as never, "card", { example: true, version: now }, admin, look);
  assert.deepEqual([busy.ok, (busy as { status: number }).status, p.example], [false, 409, false]);
  assert.match((busy as { error: string }).error, /still reading web pages/);
  p.work.finishedAt = new Date().toISOString();
  Object.assign(p.kit, { brandError: "pending", brandSince: new Date().toISOString() });
  const { BRAND_PENDING } = await import("./kit.ts");
  p.kit.brandError = BRAND_PENDING;
  assert.equal((mark({ card: p } as never, "card", { example: true, version: v() }, admin, look) as { status: number }).status, 409);
  p.kit.brandError = null;
  assert.equal(mark({ card: p } as never, "card", { example: true, version: v() }, admin, look).ok, true);
});

test("published examples: a write that lands after the mark keeps what the operator approved", async () => {
  const { keepPublished } = await import("./accounts.ts");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose test fixtures
  const fresh = () => ({ card: { domain: { id: "card" }, owner: "user_ann", example: true, kit: { web: { note: "plain" } }, work: { finishedAt: null } }, mine: { domain: { id: "mine" }, owner: "user_ann", kit: { web: { note: "plain" } } } } as Record<string, any>);
  // The owner's re-check stores a new web value on the published example and on a private lab.
  let s = fresh();
  let keep = keepPublished(s, ann);
  s.card.kit.web.note = "NEW";
  s.card.work = { finishedAt: "t" };
  s.mine.kit.web.note = "NEW";
  keep(s);
  assert.deepEqual([s.card.kit.web.note, s.card.work, s.card.example, s.mine.kit.web.note], ["plain", { finishedAt: "t" }, true, "NEW"]);
  // A delete by the owner is undone too.
  s = fresh();
  keep = keepPublished(s, ann);
  delete s.card;
  keep(s);
  assert.equal(s.card?.kit.web.note, "plain");
  // The owner's revision clears the mark: it passes. The operator's writes pass.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose test fixtures
  for (const [who, change] of [[ann, (x: any) => Object.assign(x, { example: false, kit: { web: { note: "REVISED" } } })], [admin, (x: any) => (x.kit.web.note = "REVISED")]] as const) {
    s = fresh();
    keep = keepPublished(s, who);
    change(s.card);
    keep(s);
    assert.equal(s.card.kit.web.note, "REVISED");
  }
});

test("published examples: a webhook write keeps a person's example; the operator's own example stays live; the owner is told", async () => {
  const { keepPublished } = await import("./accounts.ts");
  const { nonOwnerView, discardedReport } = await import("./report.ts");
  const fresh = () => ({ theirs: { domain: { id: "theirs" }, owner: "user_ann", example: true, sources: { alpha: { price: 20 } } }, ours: { domain: { id: "ours" }, example: true, sources: { alpha: { price: 20 } } } }) as Record<string, { domain: { id: string }; owner?: string; example: boolean; sources: { alpha: { price: number } }; discardedWrites?: import("./accounts.ts").Discarded[] }>;
  const s = fresh();
  const keep = keepPublished(s, null, () => "t1"); // no caller: a monitor's re-check
  s.theirs.sources.alpha.price = 70;
  s.ours.sources.alpha.price = 70;
  keep(s);
  assert.deepEqual([s.theirs.sources.alpha.price, s.ours.sources.alpha.price], [20, 70]);
  assert.deepEqual(s.theirs.discardedWrites, [{ at: "t1", by: "a web monitor or other work with no caller" }]);
  assert.equal(s.ours.discardedWrites, undefined);
  // The owner reads it; nobody else sees it.
  assert.match(discardedReport(s.theirs as never).published_example_kept ?? "", /1 write\(s\) .* discarded, the last at t1/);
  assert.equal((nonOwnerView(s.theirs as never) as { discardedWrites?: unknown }).discardedWrites, undefined);
  // The owner's own write is recorded as theirs.
  const k2 = keepPublished(s, ann, () => "t2");
  s.theirs.sources.alpha.price = 99;
  k2(s);
  assert.deepEqual([s.theirs.sources.alpha.price, s.theirs.discardedWrites?.[0].by, s.theirs.discardedWrites?.length], [20, "its owner", 2]);
});

test("storage bounds: a person's allowance and a full store hold for every write that grows their labs", async () => {
  const { boundStorage, StorageRefused } = await import("./accounts.ts");
  process.env.CLAY_USER_STORE_BYTES = "1000";
  process.env.CLAY_MAX_STORE_BYTES = "5000";
  const s = () => ({ a: { domain: { id: "a" }, owner: "user_ann", pad: "x".repeat(300) }, b: { domain: { id: "b" }, owner: "user_bob", pad: "x".repeat(300) } }) as Record<string, { domain: { id: string }; owner?: string; pad: string }>;
  const run = (who: Actor, change: (x: ReturnType<typeof s>) => void, store = 100) => {
    const x = s();
    const bound = boundStorage(x, who);
    change(x);
    bound(x, () => store);
  };
  // A revision (or pages arriving) that takes Ann over her allowance is refused; a smaller one and a delete pass.
  assert.throws(() => run(ann, (x) => (x.a.pad = "x".repeat(1200))), (e) => e instanceof StorageRefused && /over the limit of 1000 characters per person/.test(e.message));
  run(ann, (x) => (x.a.pad = "x".repeat(500)));
  run(ann, (x) => delete x.a);
  // A create that would pass the allowance is refused too.
  assert.throws(() => run(ann, (x) => (x.c = { domain: { id: "c" }, owner: "user_ann", pad: "x".repeat(800) })), StorageRefused);
  // Over the deployment bound: a revision (a new spec) is refused, shrinking passes; who owns nothing is sent to the
  // operator. A small write that only adds data (a settle, a decision) is the next test.
  assert.throws(() => run(ann, (x) => (x.a.domain = { id: "a", question: "A longer question" } as never), 5001), (e) => e instanceof Error && /storage is full \(5001 of 5000/.test(e.message) && /Delete a lab/.test(e.message));
  run(ann, (x) => (x.a.pad = "x"), 6000);
  const carl: Actor = { kind: "user", userId: "user_carl", via: "key" };
  assert.throws(() => run(carl, (x) => (x.c = { domain: { id: "c" }, owner: "user_carl", pad: "x" }), 5001), (e) => e instanceof Error && /Ask the operator/.test(e.message));
  // The operator is not bound. Work with no caller is bound per owner (next test).
  run(admin, (x) => (x.a.pad = "x".repeat(9000)), 99999);
  delete process.env.CLAY_USER_STORE_BYTES;
  delete process.env.CLAY_MAX_STORE_BYTES;
});

test("review fixes: work bookkeeping is not growth; notes of discarded writes end with the publication", async () => {
  const { boundStorage, keepPublished, markExample: mark, unpublishOnRevision: unpublish } = await import("./accounts.ts");
  process.env.CLAY_USER_STORE_BYTES = "200";
  const s = { a: { domain: { id: "a" }, owner: "user_ann", pad: "x".repeat(150), work: null as unknown } } as Record<string, { domain: { id: string }; owner: string; pad: string; work: unknown; example?: boolean; discardedWrites?: import("./accounts.ts").Discarded[] }>;
  // Ending tracked work, with the reason it stopped, passes at the allowance.
  const bound = boundStorage(s, ann);
  s.a.work = { id: "w", stop: "y".repeat(300), finishedAt: "t" };
  bound(s, () => 0);
  delete process.env.CLAY_USER_STORE_BYTES;
  // A discarded write by someone who is not the owner is not called the owner's.
  s.a.example = true;
  const keep = keepPublished(s, bob, () => "t1");
  s.a.pad = "changed";
  keep(s);
  assert.deepEqual(s.a.discardedWrites, [{ at: "t1", by: "another caller" }]);
  // The owner's revision unpublishes it, and the notes go with the publication; so does a new mark.
  unpublish(s.a, "a", ann, "t2");
  assert.equal(s.a.discardedWrites, undefined);
  s.a.discardedWrites = [{ at: "t3", by: "its owner" }];
  assert.equal(mark(s, "a", { example: true, version: viewVersion(s.a as never) }, admin, look).ok, true);
  assert.equal(s.a.discardedWrites, undefined);
});

test("storage bounds: a full store stops creates, revisions and large growth, not a person's settle, decision or re-check", async () => {
  const { boundStorage, StorageRefused, SMALL_WRITE } = await import("./accounts.ts");
  process.env.CLAY_MAX_STORE_BYTES = "100000";
  // The reviewer's S2 shape: other people filled the store to its bound; Ann is far under her own allowance (600,000).
  type P = { domain: { id: string; question?: string }; owner: string; kit?: { kit: { js: string }; settled?: unknown; web?: unknown }; decision?: unknown; exploration?: unknown };
  const s = () => ({ a: { domain: { id: "a" }, owner: "user_ann", kit: { kit: { js: "x" } } } }) as Record<string, P>;
  const full = 100040; // the store with the write: 40 characters over the bound
  const run = (change: (x: Record<string, P>) => void) => {
    const x = s();
    const bound = boundStorage(x, ann);
    change(x);
    bound(x, () => full);
  };
  run((x) => (x.a.kit!.settled = { values: { size: 14 }, outputs: { size: "14px" }, at: "t" })); // settle
  run((x) => (x.a.exploration = { controls: { size: { min: 10, max: 16, final: 14 } } })); // explore
  run((x) => (x.a.decision = { usage: { emails: 1000 }, required: [], chosen: "beta", tolerance: 5 })); // a saved decision
  run((x) => (x.a.kit!.web = { src: { read: { fields: { note: "y".repeat(6000) } } } })); // a re-check result
  // Still refused at the bound: a create, a revision (even a small one), and growth by more than SMALL_WRITE.
  const refused = (change: (x: Record<string, P>) => void) => assert.throws(() => run(change), (e) => e instanceof StorageRefused && /storage is full/.test(e.message));
  refused((x) => (x.b = { domain: { id: "b" }, owner: "user_ann" }));
  refused((x) => (x.a.kit!.kit = { js: "x".repeat(50_000) }));
  refused((x) => (x.a.domain = { id: "a", question: "a longer title" }));
  refused((x) => (x.a.kit!.web = { src: { read: { fields: { note: "y".repeat(SMALL_WRITE + 1) } } } }));
  delete process.env.CLAY_MAX_STORE_BYTES;
});

test("storage bounds: a webhook monitor's write is bound by the owner's allowance; the owner keeps the prior data and is told", async () => {
  const { boundStorage, SMALL_WRITE } = await import("./accounts.ts");
  const { discardedReport } = await import("./report.ts");
  process.env.CLAY_USER_STORE_BYTES = "5000";
  process.env.CLAY_MAX_STORE_BYTES = "100000";
  type P = { domain: { id: string }; owner?: string; example?: boolean; sources: { alpha: { plans: string } }; work?: unknown; storageKept?: { at: string }[] };
  const s = () => ({ ann: { domain: { id: "ann" }, owner: "user_ann", sources: { alpha: { plans: "x".repeat(4000) } } }, ours: { domain: { id: "ours" }, sources: { alpha: { plans: "x" } } } }) as Record<string, P>;
  const monitor = (change: (x: Record<string, P>) => void, store = 50) => {
    const x = s();
    const bound = boundStorage(x, null);
    change(x);
    bound(x, () => store);
    return x;
  };
  // A re-check that takes Ann over her allowance: her lab keeps the earlier read (its work bookkeeping is new).
  let x = monitor((y) => Object.assign(y.ann, { sources: { alpha: { plans: "x".repeat(6000) } }, work: { finishedAt: "t" } }));
  assert.deepEqual([x.ann.sources.alpha.plans.length, x.ann.work, x.ann.storageKept?.length], [4000, { finishedAt: "t" }, 1]);
  assert.match(discardedReport(x.ann as never).storage_kept ?? "", /1 result\(s\) of a web monitor's re-check were not stored/);
  // Within her allowance it is stored, also while the deployment's store is full, and a stored write clears the note;
  // the operator's own lab is not bound.
  x = monitor((y) => Object.assign(y.ann, { storageKept: [{ at: "t0" }], sources: { alpha: { plans: "x".repeat(4500) } } }), 200000);
  assert.deepEqual([x.ann.sources.alpha.plans.length, x.ann.storageKept], [4500, undefined]);
  x = monitor((y) => (y.ours.sources.alpha.plans = "x".repeat(SMALL_WRITE * 2)), 200000);
  assert.equal(x.ours.sources.alpha.plans.length, SMALL_WRITE * 2);
  // A deleted lab is not brought back, and a published example is left to keepPublished.
  x = monitor((y) => { delete (y as Record<string, unknown>).ann; });
  assert.equal(x.ann, undefined);
  x = s();
  x.ann.example = true;
  const kb = boundStorage(x, null);
  x.ann.sources.alpha.plans = "x".repeat(6000);
  kb(x, () => 50);
  assert.deepEqual([x.ann.sources.alpha.plans.length, x.ann.storageKept], [6000, undefined]);
  // Large growth (over SMALL_WRITE) of a person's lab while the store is full is not stored.
  process.env.CLAY_USER_STORE_BYTES = "0";
  x = monitor((y) => (y.ann.sources.alpha.plans = "x".repeat(SMALL_WRITE + 5000)), 200000);
  assert.equal(x.ann.sources.alpha.plans.length, 4000);
  delete process.env.CLAY_USER_STORE_BYTES;
  delete process.env.CLAY_MAX_STORE_BYTES;
});

test("connected: a person with an agent key and the operator are not asked to connect an agent; a visitor and a person without a key are", () => {
  const key = { keyHash: hashKey(newAgentKey()), keyCreatedAt: "2026-11-14T10:00:00.000Z", usage: null };
  const none = { keyHash: null, keyCreatedAt: null, usage: null };
  const accounts = { user_ann: key, user_bob: none };
  assert.equal(agentConnected(ann, accounts), true, "a person with a key");
  assert.equal(agentConnected(bob, accounts), false, "a person whose key was revoked, or who never made one");
  assert.equal(agentConnected({ kind: "user", userId: "user_new", via: "session" }, accounts), false, "a person with no record");
  assert.equal(agentConnected(admin, {}), true, "the operator: the owner key, no record needed");
  assert.equal(agentConnected(adminOlga, accounts), false, "an account admin without a personal key is asked, as a person is");
  assert.equal(agentConnected(adminOlga, { ...accounts, user_olga: key }), true, "an account admin with a personal key");
  assert.equal(agentConnected(VISITOR, accounts), false, "a visitor");
  assert.equal(agentConnected(null, accounts), false, "no caller");
});

test("admin accounts: CLAY_ADMIN_USER_IDS lists Clerk user ids; trimmed, empty entries ignored, exact match only", () => {
  const env = (list?: string) => (list === undefined ? {} : { CLAY_ADMIN_USER_IDS: list });
  assert.equal(isAdminUser("user_olga", env()), false, "unset: nobody");
  assert.equal(isAdminUser("user_olga", env("")), false, "empty: nobody");
  assert.equal(isAdminUser("user_olga", env(" , ,, ")), false, "only empty entries: nobody");
  assert.equal(isAdminUser("user_olga", env("user_olga")), true, "one id");
  assert.equal(isAdminUser("user_pia", env("user_olga,user_pia")), true, "the second of two");
  assert.equal(isAdminUser("user_olga", env("  user_olga ,\tuser_pia\n")), true, "whitespace around an entry");
  assert.equal(isAdminUser("user_pia", env("  user_olga ,\tuser_pia\n")), true, "whitespace around the last entry");
  assert.equal(isAdminUser("user_ol", env("user_olga")), false, "a prefix of a listed id");
  assert.equal(isAdminUser("user_olga2", env("user_olga")), false, "a listed id is a prefix of it");
  assert.equal(isAdminUser("USER_OLGA", env("user_olga")), false, "another case");
  assert.equal(isAdminUser("user_olga,user_pia", env("user_olga,user_pia")), false, "the whole list is not an id");
  for (const none of ["", " ", null, undefined]) assert.equal(isAdminUser(none, env("user_olga, ,")), false, `no id (${JSON.stringify(none)}) never matches, also not an empty entry`);
  // The default is the process environment.
  const before = process.env.CLAY_ADMIN_USER_IDS;
  try {
    delete process.env.CLAY_ADMIN_USER_IDS;
    assert.equal(isAdminUser("user_olga"), false);
    process.env.CLAY_ADMIN_USER_IDS = "user_olga";
    assert.equal(isAdminUser("user_olga"), true);
  } finally {
    if (before === undefined) delete process.env.CLAY_ADMIN_USER_IDS;
    else process.env.CLAY_ADMIN_USER_IDS = before;
  }
});

test("admin accounts: an account admin is a browser session for the Clerk check and the agent key, and no person for owners and limits", () => {
  // Who meets the Clerk eligibility check before a write, and who manages a personal agent key: every browser session.
  assert.equal(sessionUserId(ann), "user_ann", "a person's session");
  assert.equal(sessionUserId(adminOlga), "user_olga", "an account admin");
  assert.equal(sessionUserId(bob), null, "an agent key met the check when it was identified");
  assert.equal(sessionUserId(admin), null, "the owner key has no Clerk account");
  assert.equal(sessionUserId(VISITOR), null);
  assert.equal(sessionUserId(null), null);
  // What an account admin creates in the browser is the operator's (no owner), and the cap per person does not count.
  bindActor().actor = adminOlga;
  assert.equal(currentUserId(), null);
  assert.equal("owner" in newPlayground(DOMAIN), false);
  process.env.CLAY_USER_PLAYGROUNDS = "1";
  try {
    assert.equal(playgroundCapMessage({ a: { owner: "user_olga" } }, adminOlga), null);
  } finally {
    delete process.env.CLAY_USER_PLAYGROUNDS;
  }
  // The example mark is the operator's, by owner key or by account.
  const labs = { one: { domain: { id: "one" }, owner: "user_ann" } };
  assert.deepEqual(markExample(labs, "one", { example: false }, adminOlga, look), { ok: true, example: false, featured: false });
});
