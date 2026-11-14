// A started lab (start_playground): the state in the store, the create that fills it, who may touch it, and the
// rule that keeps abandoned ones from piling up.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bindActor, markExample } from "./accounts.ts";
import { idOf, notBuilt, oneLine, pageRev, startPlayground } from "./started.ts";
import { insertPlayground, load, newPlayground, STARTED_TTL_MS, update } from "./store.ts";

// The store is a file under the working directory: these tests write to a fresh one.
process.chdir(mkdtempSync(join(tmpdir(), "clay-started-")));
const as = (userId: string) => (bindActor().actor = { kind: "user", userId, via: "key" });
const domain = (id: string) => ({ id, question: "How should the button look?", product: "", metrics: [], features: [], vendors: [] });

test("a start stores a started lab of the caller, and a later line changes only that", async () => {
  as("ann");
  // A minute ago by the real clock: load() drops a start that is older than a day, so a fixed date would expire.
  const at = new Date(Date.now() - 60_000).toISOString();
  const r = await startPlayground({ title: "Which radius for the signup button?", workingOn: "Reading button.css" }, () => at);
  assert.ok("started" in r && !r.existed);
  const id = "started" in r ? r.started.id : "";
  assert.equal(id, "which-radius-for-the-signup-button");
  const p = (await load()).playgrounds[id];
  assert.deepEqual(p.started, { workingOn: "Reading button.css", at });
  assert.equal(p.owner, "ann");
  assert.equal(p.kit, undefined);
  // The same start again (the first answer was lost) is the same lab, not a second one.
  const again = await startPlayground({ title: "Which radius for the signup button?", workingOn: "Reading button.css" });
  assert.ok("started" in again && again.existed && again.started.id === id);
  // A new line, by id.
  const line = await startPlayground({ id, workingOn: "Reading the brand colours" });
  assert.ok("started" in line && line.started.workingOn === "Reading the brand colours" && line.started.title === "Which radius for the signup button?");
  // Another person cannot change it, and learns nothing about it: it is "missing" for them.
  as("bob");
  assert.deepEqual(await startPlayground({ id, workingOn: "mine now" }), { missing: id });
  assert.equal((await load()).playgrounds[id].started?.workingOn, "Reading the brand colours");
  // The operator may write everything, but is not handed a person's started lab either.
  bindActor().actor = { kind: "admin" };
  assert.deepEqual(await startPlayground({ id, workingOn: "operator" }), { missing: id });
});

test("a create by its owner fills the started lab in place; anyone else gets the id with a suffix", async () => {
  as("cat");
  const r = await startPlayground({ title: "Fill me in place", workingOn: "Working" });
  const id = "started" in r ? r.started.id : "";
  // Someone else asks for the same id: the started lab stays, and their lab gets a suffix.
  as("dan");
  const other = await insertPlayground(domain(id), (d) => newPlayground(d));
  assert.ok("id" in other && other.id !== id && other.id.startsWith(`${id}-`) && !other.filled);
  assert.ok((await load()).playgrounds[id].started);
  // Its owner: the build lands at the same id, and nothing of the started state is left.
  as("cat");
  const mine = await insertPlayground(domain(id), (d) => newPlayground(d));
  assert.deepEqual(mine, { id, filled: true });
  const p = (await load()).playgrounds[id];
  assert.equal(p.started, undefined);
  assert.equal(p.owner, "cat");
  assert.equal(p.domain.question, "How should the button look?");
  // A late line never puts a built lab back to "started".
  assert.deepEqual(await startPlayground({ id, workingOn: "too late" }), { built: id });
  assert.equal((await load()).playgrounds[id].started, undefined);
});

test("a started lab counts toward the person's cap, and one that nobody built is dropped after 24 hours", async () => {
  process.env.CLAY_USER_PLAYGROUNDS = "2";
  try {
    as("eve");
    const old = new Date(Date.now() - STARTED_TTL_MS - 60_000).toISOString();
    const recent = new Date(Date.now() - STARTED_TTL_MS + 3_600_000).toISOString();
    const a = await startPlayground({ title: "Abandoned yesterday", workingOn: "x" }, () => old);
    const b = await startPlayground({ title: "Started an hour less than a day ago", workingOn: "x" }, () => recent);
    assert.ok("started" in a && "started" in b);
    // The old one is gone for every reader, so only one counts now.
    const all = (await load()).playgrounds;
    assert.equal("started" in a && all[a.started.id], undefined);
    assert.ok("started" in b && all[b.started.id]);
    const c = await startPlayground({ title: "Second of two", workingOn: "x" });
    assert.ok("started" in c);
    // Two started labs are two labs: the third start and a create are refused, and nothing is stored.
    const d = await startPlayground({ title: "Third", workingOn: "x" });
    assert.match("refused" in d ? d.refused : "", /limit of 2 labs per person\. Nothing was started\./);
    const e = await insertPlayground(domain("over-the-cap"), (x) => newPlayground(x));
    assert.match("refused" in e ? e.refused : "", /limit of 2 labs/);
    // A create that fills a started one is not one more lab: it passes at the cap.
    const f = await insertPlayground(domain("started" in c ? c.started.id : ""), (x) => newPlayground(x));
    assert.ok("id" in f && f.filled);
    // The drop is stored by the next write: the file no longer holds the abandoned one.
    assert.ok(!readFileSync(".data/store.json", "utf8").includes("Abandoned yesterday"));
  } finally {
    delete process.env.CLAY_USER_PLAYGROUNDS;
  }
});

test("a started lab can never be an example, and a stored one with a broken time is dropped", async () => {
  as("fay");
  const r = await startPlayground({ title: "Never an example", workingOn: "x" });
  const id = "started" in r ? r.started.id : "";
  const marked = await update((s) => markExample(s.playgrounds, id, { example: true, version: "any" }, { kind: "admin" }, () => ({ version: "any", busy: false })));
  assert.deepEqual(marked, { ok: false, status: 409, error: "This lab is started and not built yet: there is nothing to publish." });
  const raw = JSON.parse(readFileSync(".data/store.json", "utf8"));
  raw.playgrounds[id].started.at = "not a time";
  writeFileSync(".data/store.json", JSON.stringify(raw));
  assert.equal((await load()).playgrounds[id], undefined);
});

test("the texts of a start are one plain line, the id comes from the title, and the page revision follows the spec", () => {
  assert.equal(oneLine("  Reading\n the  pricing\tpages\u0000 now "), "Reading the pricing pages now");
  assert.equal(idOf("Where to buy gas in Tampere? I live at Hervanta"), "where-to-buy-gas-in-tampere-i-live");
  assert.equal(idOf("3 GPUs"), "lab-3-gpus");
  // An accent is dropped; it does not break the word.
  assert.equal(idOf("Päivän paras hinta Tampereella: Ärrä vai Öljy?"), "paivan-paras-hinta-tampereella");
  assert.equal(idOf("日本語"), "lab");
  for (const t of ["Which radius?", "a".repeat(200), "x y", "<script>alert(1)</script>"]) assert.match(idOf(t), /^[a-z][a-z0-9-]{2,39}$/, t);
  assert.match(notBuilt("gas"), /started and not built yet.*create_playground, with "gas" as the id of the spec/);
  const d = domain("rev");
  const started = { domain: d, started: { workingOn: "a", at: "2026-11-14T10:00:00.000Z" } };
  // The line is not part of the revision (the started page reads it from the same answer); the build and a revision are.
  assert.equal(pageRev(started), pageRev({ ...started, started: { workingOn: "b", at: "2026-11-14T10:01:00.000Z" } }));
  assert.notEqual(pageRev(started), pageRev({ domain: d }));
  assert.notEqual(pageRev({ domain: d }), pageRev({ domain: { ...d, question: "Another title" } }));
});
