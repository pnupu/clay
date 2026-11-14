// The texts an agent reads. A client may show only the first 200 characters of the instructions (Codex lists the server
// as a deferred namespace) and load tool descriptions on demand, so the start of each text must say when to use it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSpec, oversize } from "./spec.ts";
import { readFileSync } from "node:fs";
import { STANDING_INSTRUCTION } from "../connect/standing-instruction.ts";
import { INSTRUCTIONS, PROMPTS, TOOLS } from "./texts.ts";

test("the first 200 characters of the server instructions say what Sorvi is for, that the person asks for a lab, and the start and create tools", () => {
  // The trigger is explicit now: the person asks for a lab. (Before 9e the head held the unprompted trigger.)
  // The first call is start_playground since the person gets a link before anything is built: the head names it, the
  // link and the create tool, in that order. (It named only create_playground before.)
  const head = INSTRUCTIONS.slice(0, 200);
  assert.match(head, /^Sorvi builds labs: web pages where a person tries the real thing/);
  assert.match(head, /When a person asks for a lab, call start_playground, give them its link, then create_playground\./);
  // Both sentences are complete inside that window: nothing of them is cut.
  assert.ok(INSTRUCTIONS.indexOf("\n") <= 200, "the first paragraph ends inside the first 200 characters");
  // The words a person uses, and the unprompted trigger as it was measured, follow inside the first 512 characters (Codex).
  const next = INSTRUCTIONS.slice(0, 512);
  for (const words of ["build me a lab for", "let me play with it first", 'the older word "playground"']) assert.ok(next.includes(words), words);
  assert.match(next, /BEFORE you answer from memory or search the web when a person cannot say exactly what they want/);
  assert.match(next, /which one/);
  assert.match(next, /looks or feels off/);
  // The link-first rules follow at once: the start in the first turn beside the first reads, the link in that turn, the
  // line on what the agent is doing, then the create with the same id.
  assert.match(INSTRUCTIONS, /In your first turn, call start_playground .* in the same turn as your first reads \(their file, kit_reference\), as parallel calls\. When their results are back, write the person a visible reply with its url before your next tool call: they cannot see tool results\./);
  assert.match(INSTRUCTIONS, /When a long step starts \(research, reading pages\), call start_playground again with playground_id and a new working_on, not more often than about once a minute\./);
  assert.match(INSTRUCTIONS, /Then build with create_playground, with that playground_id as the id of the spec\./);
  assert.ok(INSTRUCTIONS.indexOf("Link first.") < 800, "the link-first paragraph is the third one");
});

test("no text tells the agent to ask for a reload: an open page shows a build and a revision by itself", () => {
  for (const [name, text] of Object.entries({ INSTRUCTIONS, ...TOOLS, prompt: PROMPTS.playground.text("x") })) assert.doesNotMatch(text, /(?<!not )ask (the person|them) to reload|must reload|after a reload/i, name);
  assert.match(TOOLS.revise_playground, /shows the revision by itself within a few seconds, with their control values kept/);
  assert.match(TOOLS.start_playground, /^Call this first, before you read a file or a web page, when a person asks for a lab: it answers at once with a working link/);
  assert.match(TOOLS.create_playground, /Start first: call start_playground in your first turn, give the person its url in that turn, and put its playground_id in the id of this spec\./);
});

test("the prompts: the person's own request with the whole loop, short, with and without what they want", () => {
  const withWhat = PROMPTS.playground.text("  the hover on the button in button.css ");
  assert.ok(withWhat.startsWith("Build me a Sorvi lab for this: the hover on the button in button.css\n"));
  // Claude Code 2.1.321 gives the prompt only the first word after the command ("the"): the text then points at the
  // person's whole line, which that client puts just above the prompt.
  assert.match(PROMPTS.playground.text("the"), /^Build me a Sorvi lab for this: the\n\(Some clients pass only the first word here: when my words after the command, just above, say more, they are my request\.\)/);
  assert.match(PROMPTS.recheck.text("the"), /about the still right\? \(Some clients pass only the first word here/);
  // The loop, in order: the start and the real file in the first turn, the link at once, research later, the reference
  // and the build with the started id, then the repairs and the wait, the hand-back. (The link came with the create
  // result before, and after the repairs before that: the person then waited for the build with nothing to open.)
  const order = ["In your first turn call start_playground", "read my real file", "in parallel", "give me its link at once", "Research comes later, with revise_playground", "Build with its id", "kit_reference", "create_playground", "price_ranking", "Write the spec straight into the call", 'Follow "next" in each tool result until the build is done and repaired', "wait until I say I am done", "read_playground", "or tell me the decision I saved", "decision_record"].map((x) => withWhat.indexOf(x));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), JSON.stringify(order));
  assert.match(withWhat, /Do not guess, edit my files or answer the question before that/);
  // Without it, the agent asks first, then builds by the same loop.
  const bare = PROMPTS.playground.text();
  assert.match(bare, /^I want a Sorvi lab\. Ask me in one line what I want to try, tune or decide/);
  assert.ok(bare.includes("create_playground") && bare.includes("read_playground"));
  assert.equal(PROMPTS.playground.text("   "), bare);
  // The return path.
  assert.match(PROMPTS.recheck.text(), /^Is my saved decision still right\? Find the decision files in this repository \(\.sorvi\/decisions\/\*\.md, or the older \.clay\/decisions\/\), call recheck_playground with the lab id in each/);
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
  assert.match(STANDING_INSTRUCTION, /exact instruction .* needs no lab/);
});

test("the workflow file that people copy holds the re-check script as it is", () => {
  // public/sorvi-recheck.yml carries connect/github/sorvi-recheck.sh inline (evals/recheck-workflow.test.ts runs it).
  const yml = readFileSync(new URL("../public/sorvi-recheck.yml", import.meta.url), "utf8");
  const inline = yml.slice(yml.indexOf("        run: |\n") + "        run: |\n".length).split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
  assert.equal(inline.trimEnd(), readFileSync(new URL("../connect/github/sorvi-recheck.sh", import.meta.url), "utf8").trimEnd());
});

test("the first sentence of every tool description says when to call it", () => {
  for (const [name, text] of Object.entries(TOOLS)) {
    const first = text.slice(0, text.search(/[.:](\s|$)/) + 1);
    assert.match(first, /^Call this /, name);
    assert.match(first, / when | to repair | once before | first, before /, name);
    assert.ok(first.length <= 330, `${name}: the first sentence has ${first.length} characters`);
  }
  assert.match(TOOLS.create_playground.slice(0, 200), /before you answer from memory or search the web/);
  // "first" belongs to the start tool now: the create builds what was started.
  assert.match(TOOLS.create_playground, /^Call this to build the lab, /);
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
