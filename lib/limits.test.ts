// The limits of a create: spec size bounds before validation, capped errors, the per-person allowance and a free id.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bindActor } from "./accounts.ts";
import { MAX_BATCH, MAX_ERRORS, oversize, parseSpec, refuseOversize } from "./spec.ts";
import { freeId, insertPlayground, load, newPlayground } from "./store.ts";

// The store is a file under the working directory: these tests write to a fresh one.
process.chdir(mkdtempSync(join(tmpdir(), "clay-limits-")));

const preview = (id: string, extra: object = {}) => ({ id, title: "How should the button look?", view: { type: "preview", html: '<button class="b" style="border-radius:{{radius}}px">Save</button>' }, controls: [{ id: "radius", type: "slider", label: "Radius", meaning: "border-radius in px", min: 0, max: 24, initial: 2 }], outputs: [{ id: "css", label: "radius", template: "border-radius: {{radius}}px" }], ...extra });

test("a collection over its bound is refused before any element is validated", () => {
  // The review's request: 10,000 empty controls. It produced 50,000 errors; now it produces one sentence.
  const huge = preview("huge", { controls: Array.from({ length: 10_000 }, () => ({})) });
  const t0 = performance.now();
  const r = parseSpec(huge);
  assert.equal(r.ok, false);
  assert.deepEqual(!r.ok && r.errors, ["controls: at most 12 entries, got 10000. Nothing was checked or created."]);
  assert.ok(performance.now() - t0 < 50, "no element was validated");
  assert.equal(JSON.stringify(r).length < 200, true);
  // Every collection has a bound, also the nested ones and the ones of a price playground.
  const options = Array.from({ length: 500 }, (_, i) => ({ value: `v${i}` }));
  assert.match(oversize(preview("x", { controls: [{ id: "a", type: "select", options }] }))[0], /controls\.0\.options: at most 12 entries, got 500/);
  assert.match(oversize({ data: { price_pages: { vendors: Array(1000).fill({}) } } })[0], /data\.price_pages\.vendors: at most 6 entries, got 1000/);
  assert.match(oversize({ outputs: Array(100).fill({}) })[0], /outputs: at most 6 entries, got 100/);
  assert.match(oversize({ data: { inline: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, 1])) } })[0], /data\.inline: at most 40 entries/);
  assert.deepEqual(oversize(preview("fine")), []);
  assert.deepEqual(oversize("not an object"), []);
});

test("at most MAX_ERRORS problems are returned, with a count of the rest", () => {
  // Inside every bound, each of 12 broken controls still gives several problems.
  const r = parseSpec(preview("many", { controls: Array.from({ length: 12 }, () => ({ nonsense: 1, more: 2, id: 5 })) }));
  assert.equal(r.ok, false);
  const errors = r.ok ? [] : r.errors;
  assert.equal(errors.length, MAX_ERRORS + 1);
  assert.match(errors[MAX_ERRORS], /^and \d+ more problems\. Fix these first\.$/);
});

test("the MCP route refuses an oversized tool call before the SDK validates it", () => {
  const call = (args: unknown) => ({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "create_playground", arguments: args } });
  const refused = refuseOversize(call(preview("huge", { controls: Array(10_000).fill({}) })));
  assert.equal(refused?.id, 7);
  assert.match(refused!.text, /controls: at most 12 entries, got 10000/);
  assert.ok(refused!.text.length < 300);
  assert.equal(refuseOversize(call(preview("fine"))), null);
  assert.equal(refuseOversize({ jsonrpc: "2.0", id: 1, method: "tools/list" }), null);
  assert.equal(refuseOversize(null), null);
  // A batch: the oversized call in it is found wherever it stands, and a batch itself is bounded.
  assert.equal(refuseOversize([{ jsonrpc: "2.0", id: 1, method: "tools/list" }, call({ outputs: Array(50).fill({}) })])?.id, 7);
  const pings = (n: number) => Array.from({ length: n }, (_, i) => ({ jsonrpc: "2.0", id: 100 + i, method: "ping" }));
  assert.equal(refuseOversize([...pings(MAX_BATCH - 1), call({ controls: Array(10_000).fill({}) })])?.id, 7);
  assert.match(refuseOversize([...pings(MAX_BATCH), call({ controls: Array(10_000).fill({}) })])!.text, /at most 10 messages, this one has 11/);
});

test("a taken id gets a suffix, inside the length limit of an id", () => {
  const taken = new Set(["signup-button", "signup-button-aaaaaa"]);
  const ids = ["aaaaaa", "bbbbbb"];
  assert.equal(freeId("fresh", (x) => taken.has(x)), "fresh");
  assert.equal(freeId("signup-button", (x) => taken.has(x), () => ids.shift()!), "signup-button-bbbbbb");
  const long = "a".repeat(40);
  const got = freeId(long, (x) => x === long);
  assert.match(got, /^[a-z][a-z0-9-]{2,39}$/);
  assert.notEqual(got, long);
});

test("parallel creates by one person cannot pass the playground cap, and a taken id never fails or leaks", async () => {
  process.env.CLAY_USER_PLAYGROUNDS = "20";
  const parsed = parseSpec(preview("mine"));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  // The step every create path shares (lib/pipeline.ts): one store update that checks the allowance, takes a free id and
  // inserts. Each create is another playground (another title): identical ones by one person are one playground.
  let n = 0;
  const create = () => insertPlayground({ ...parsed.domain, question: `${parsed.domain.question} (${++n})` }, (d) => newPlayground(d));
  // Somebody else already owns "mine".
  bindActor().actor = { kind: "user", userId: "other", via: "key" };
  assert.deepEqual(await create(), { id: "mine" });
  // The review's race: 25 creates at once by one person, against a cap of 20. All ask for the id that is taken.
  bindActor().actor = { kind: "user", userId: "u1", via: "key" };
  const results = await Promise.all(Array.from({ length: 25 }, create));
  const created = results.flatMap((r) => ("id" in r ? [r.id] : []));
  const refused = results.flatMap((r) => ("refused" in r ? [r.refused] : []));
  assert.equal(created.length, 20);
  assert.equal(refused.length, 5);
  assert.match(refused[0], /limit of 20 playgrounds/);
  // Every created playground has its own id, none is the taken one, and the answer says nothing about the other owner.
  assert.equal(new Set(created).size, 20);
  assert.ok(created.every((id) => /^mine-[0-9a-f]{6}$/.test(id)));
  const stored = Object.values((await load()).playgrounds);
  assert.equal(stored.filter((p) => p.owner === "u1").length, 20);
  assert.equal(stored.filter((p) => p.owner === "other").length, 1);
});

test("a repeated create of the caller's own playground with the same spec is the same playground; anything else gets a new id", async () => {
  const a = parseSpec(preview("idem"));
  const b = parseSpec(preview("idem", { title: "Another question about the button?" }));
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  bindActor().actor = { kind: "user", userId: "u7", via: "key" };
  assert.deepEqual(await insertPlayground(a.domain, (d) => newPlayground(d)), { id: "idem" });
  // The answer was lost and the agent calls again: no second playground, nothing to read again.
  assert.deepEqual(await insertPlayground(a.domain, (d) => newPlayground(d)), { id: "idem", existed: true });
  // Another spec under the same id is another playground.
  const other = await insertPlayground(b.domain, (d) => newPlayground(d));
  assert.ok("id" in other && /^idem-[0-9a-f]{6}$/.test(other.id) && !other.existed);
  // Somebody else with the same spec learns nothing: they get their own, under another id.
  bindActor().actor = { kind: "user", userId: "u8", via: "key" };
  const theirs = await insertPlayground(a.domain, (d) => newPlayground(d));
  assert.ok("id" in theirs && /^idem-[0-9a-f]{6}$/.test(theirs.id) && !theirs.existed);
  assert.equal(Object.values((await load()).playgrounds).filter((p) => p.owner === "u7").length, 2);
  // Their first create was renamed (the id was taken) and its answer was lost: the retry finds that playground.
  assert.deepEqual(await insertPlayground(a.domain, (d) => newPlayground(d)), { id: (theirs as { id: string }).id, existed: true });
  // The admin may write every playground, but is not handed somebody else's: an identical spec gets its own.
  bindActor().actor = { kind: "admin" };
  const admins = await insertPlayground(a.domain, (d) => newPlayground(d));
  assert.ok("id" in admins && !admins.existed && admins.id !== "idem" && admins.id !== (theirs as { id: string }).id);
  assert.deepEqual(await insertPlayground(a.domain, (d) => newPlayground(d)), { id: (admins as { id: string }).id, existed: true });
});
