// The texts an agent reads. A client may show only the first 200 characters of the instructions (Codex lists the server
// as a deferred namespace) and load tool descriptions on demand, so the start of each text must say when to use it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSpec, oversize } from "./spec.ts";
import { readFileSync } from "node:fs";
import { STANDING_INSTRUCTION } from "../connect/standing-instruction.ts";
import { INSTRUCTIONS, TOOLS } from "./texts.ts";

test("the first 200 characters of the server instructions hold the trigger and the name of the create tool", () => {
  const head = INSTRUCTIONS.slice(0, 200);
  assert.match(head, /create_playground/);
  assert.match(head, /before you answer from memory or search the web/i);
  assert.match(head, /cannot say exactly what they want/);
  assert.match(head, /which one/);
  assert.match(head, /looks or feels off/);
  // The trigger is a complete sentence inside that window: nothing of it is cut.
  assert.ok(INSTRUCTIONS.indexOf("\n") <= 200, "the first paragraph ends inside the first 200 characters");
});

test("the standing instruction: the file and the text on /connect are the same, short, and name both tools", () => {
  assert.equal(readFileSync(new URL("../connect/standing-instruction.md", import.meta.url), "utf8"), STANDING_INSTRUCTION);
  assert.ok(STANDING_INSTRUCTION.split(/\s+/).filter(Boolean).length <= 85, "about 80 words: a person pastes it into their own file");
  assert.match(STANDING_INSTRUCTION, /create_playground/);
  assert.match(STANDING_INSTRUCTION, /read_playground/);
  // The exception keeps an exact instruction and a plain fact out: without it the agent would build for everything.
  assert.match(STANDING_INSTRUCTION, /exact instruction .* needs no playground/);
});

test("the workflow file that people copy holds the re-check script as it is", () => {
  // public/clay-recheck.yml carries connect/github/clay-recheck.sh inline (evals/recheck-workflow.test.ts runs it).
  const yml = readFileSync(new URL("../public/clay-recheck.yml", import.meta.url), "utf8");
  const inline = yml.slice(yml.indexOf("        run: |\n") + "        run: |\n".length).split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
  assert.equal(inline.trimEnd(), readFileSync(new URL("../connect/github/clay-recheck.sh", import.meta.url), "utf8").trimEnd());
});

test("the first sentence of every tool description says when to call it", () => {
  for (const [name, text] of Object.entries(TOOLS)) {
    const first = text.slice(0, text.search(/[.:](\s|$)/) + 1);
    assert.match(first, /^Call this /, name);
    assert.match(first, / when | to repair | once before | first, before /, name);
    assert.ok(first.length <= 330, `${name}: the first sentence has ${first.length} characters`);
  }
  assert.match(TOOLS.create_playground.slice(0, 200), /before you answer from memory or search the web/);
});

test("left_out: what was left out and why is part of a spec, bounded like the rest", () => {
  const price = { id: "email-choice", title: "Which email service should we use?", view: { type: "price_ranking" }, data: { price_pages: { product: "transactional email API", metrics: [{ id: "emails", label: "Emails per month", unit: "emails", describe: "emails sent per month", min: 1000, max: 100000, initial: 10000 }], features: [], vendors: [{ id: "resend", name: "Resend", domain: "resend.com" }, { id: "postmark", name: "Postmark", domain: "postmarkapp.com" }] } } };
  const ok = parseSpec({ ...price, left_out: [{ name: "SendGrid", reason: "its pricing page could not be read twice" }] });
  assert.ok(ok.ok && ok.kind === "price");
  assert.deepEqual(ok.ok ? ok.leftOut : null, [{ name: "SendGrid", reason: "its pricing page could not be read twice" }]);
  assert.equal(parseSpec(price).ok && "leftOut" in parseSpec(price), false);
  const long = parseSpec({ ...price, left_out: [{ name: "SendGrid", reason: "x".repeat(201) }] });
  assert.deepEqual(!long.ok && long.errors, ["left_out.0.reason: at most 200 characters, this one has 201"]);
  // An entry without a name or a reason is refused with a readable error, not stored empty.
  const empty = parseSpec({ ...price, left_out: [{ name: "SendGrid", reason: "  " }] });
  assert.equal(empty.ok, false);
  assert.match(!empty.ok ? empty.errors.join(" ") : "", /left_out\.0\.reason: at least 1 characters/);
  assert.deepEqual(oversize({ left_out: Array(50).fill({}) }), ["left_out: at most 6 entries, got 50. Nothing was checked or created."]);
});
