// The texts an agent reads. A client may show only the first 200 characters of the instructions (Codex lists the server
// as a deferred namespace) and load tool descriptions on demand, so the start of each text must say when to use it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSpec, oversize } from "./spec.ts";
import { readFileSync } from "node:fs";
import { STANDING_INSTRUCTION } from "../connect/standing-instruction.ts";
import { INSTRUCTIONS, PROMPTS, TOOLS } from "./texts.ts";

test("the first 200 characters of the server instructions say what Clay is for, that the person asks for a playground, and the create tool", () => {
  // The trigger is explicit now: the person asks for a playground. (Before 9e the head held the unprompted trigger.)
  const head = INSTRUCTIONS.slice(0, 200);
  assert.match(head, /^Clay builds playgrounds: web pages where a person tries the real thing/);
  assert.match(head, /When a person asks for a playground, call create_playground\./);
  // Both sentences are complete inside that window: nothing of them is cut.
  assert.ok(INSTRUCTIONS.indexOf("\n") <= 200, "the first paragraph ends inside the first 200 characters");
  // The words a person uses, and the unprompted trigger as it was measured, follow inside the first 512 characters (Codex).
  const next = INSTRUCTIONS.slice(0, 512);
  for (const words of ["build me a playground for", "let me play with it first", "clay this"]) assert.ok(next.includes(words), words);
  assert.match(next, /BEFORE you answer from memory or search the web when a person cannot say exactly what they want/);
  assert.match(next, /which one/);
  assert.match(next, /looks or feels off/);
});

test("the prompts: the person's own request with the whole loop, short, with and without what they want", () => {
  const withWhat = PROMPTS.playground.text("  the hover on the button in button.css ");
  assert.ok(withWhat.startsWith("Build me a Clay playground for this: the hover on the button in button.css\n"));
  // Claude Code 2.1.321 gives the prompt only the first word after the command ("the"): the text then points at the
  // person's whole line, which that client puts just above the prompt.
  assert.match(PROMPTS.playground.text("the"), /^Build me a Clay playground for this: the\n\(Some clients pass only the first word here: when my words after the command, just above, say more, they are my request\.\)/);
  assert.match(PROMPTS.recheck.text("the"), /about the still right\? \(Some clients pass only the first word here/);
  // The loop, in order: the real file first, the reference and the build, the link at once, then the repairs and the
  // wait, the hand-back. (The link came after the repairs before: the person then waited for the whole build.)
  const order = ["read my real file", "longer research comes after the first link", "kit_reference", "create_playground", "price_ranking", "Write the spec straight into the call", "Give me the link when create_playground returns it, before any check or repair", 'Follow "next" in each tool result until the build is done and repaired', "wait until I say I am done", "read_playground", "or tell me the decision I saved", "decision_record"].map((x) => withWhat.indexOf(x));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), JSON.stringify(order));
  assert.match(withWhat, /Do not guess, edit my files or answer the question before that/);
  // Without it, the agent asks first, then builds by the same loop.
  const bare = PROMPTS.playground.text();
  assert.match(bare, /^I want a Clay playground\. Ask me in one line what I want to try, tune or decide/);
  assert.ok(bare.includes("create_playground") && bare.includes("read_playground"));
  assert.equal(PROMPTS.playground.text("   "), bare);
  // The return path.
  assert.match(PROMPTS.recheck.text(), /^Is my saved decision still right\? Find the decision files in this repository \(\.clay\/decisions\/\*\.md\), call recheck_playground with the playground id in each/);
  assert.match(PROMPTS.recheck.text("the email provider"), /^Is my saved decision about the email provider still right\? \(Some clients[^)]*\) Find the decision file /);
  assert.match(PROMPTS.recheck.text(), /Follow the answer: its verdict and do_now, or "next" while the pages are still being read/);
  assert.match(PROMPTS.recheck.text(), /change nothing in my code until I agree/);
  // Short: the agent reads them every time.
  for (const text of [withWhat, bare, PROMPTS.recheck.text("x")]) assert.ok(text.split(/\s+/).length <= 180, String(text.split(/\s+/).length));
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
