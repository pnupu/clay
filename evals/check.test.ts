// Unit tests of the checker's pure parts. Run: node --test evals/check.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { choiceHandback, namedInProse, creation, directAnswer, fileMatches, lastBuild, namesChoice, numbersIn, sources, unknowns, rangeProblem, ranges, readBack, toolUse, verdict, type Call } from "./check.ts";
import { dimensions, finalProblems, readFacts, withoutWebNumbers } from "./adapter.ts";
import { HELD_OUT } from "./heldout.ts";
import { CASES } from "./requests.ts";

const dim = (id: string, min: number, max: number, initial: number, label = id, unit = "units") => ({ id, label, unit, min, max, initial });
const call = (tool: string, input: Record<string, unknown> = {}, result: unknown = {}, isError = false): Call => ({ tool, mcp: true, input, result: typeof result === "string" ? result : JSON.stringify(result), isError });
const byId = (id: string) => CASES.find((c) => c.id === id)!;

test("the request set: 20 cases with unique ids, no product words in a request", () => {
  assert.equal(CASES.length, 24);
  assert.equal(new Set(CASES.map((c) => c.id)).size, 24);
  for (const c of CASES) assert.doesNotMatch(c.request, /clay|playground|slider|create_|mcp/i, c.id);
  assert.deepEqual(Object.fromEntries(["price", "look", "feel", "none", "return"].map((k) => [k, CASES.filter((c) => c.kind === k).length])), { price: 6, look: 5, feel: 4, none: 3, return: 2 });
  assert.deepEqual(CASES.filter((c) => c.kind === "data").map((c) => [c.needsKit, c.web]), [[true, true], [true, true], [true, true], [true, true]]);
  assert.ok(CASES.filter((c) => c.kind === "look" || c.kind === "feel").every((c) => c.needsKit));
});

test("the held-out set: 6 requests (2 price, 2 look, 2 feel) with their own ids and no product words", () => {
  assert.deepEqual(HELD_OUT.map((c) => c.kind), ["price", "price", "look", "look", "feel", "feel"]);
  assert.equal(new Set([...HELD_OUT, ...CASES].map((c) => c.id)).size, 30);
  for (const c of HELD_OUT) assert.doesNotMatch(c.request, /clay|playground|slider|create_|mcp/i, c.id);
});

test("range sanity: the given number must be the starting value", () => {
  const g = { about: /email/i, value: 30_000, mentioned: [30_000, 200_000] };
  assert.equal(rangeProblem(g, dim("emails", 5_000, 300_000, 30_000)), null);
  assert.match(rangeProblem(g, dim("emails", 5_000, 300_000, 50_000))!, /starts at 50,000, the person said 30,000/);
});

test("range sanity: the range must contain every number the person mentioned", () => {
  const g = { about: /email/i, value: 30_000, mentioned: [30_000, 200_000] };
  assert.match(rangeProblem(g, dim("emails", 10_000, 100_000, 30_000))!, /leaves out 200,000/);
  assert.match(rangeProblem(g, dim("emails", 30_001, 300_000, 30_001))!, /leaves out 30,000/);
});

test("range sanity: a range more than 20 times what the person mentioned fails", () => {
  const g = { about: /hour/i, value: 200 };
  assert.equal(rangeProblem(g, dim("hours", 0, 4_000, 200)), null);
  assert.match(rangeProblem(g, dim("hours", 0, 4_001, 200))!, /more than 20 times the 200/);
  assert.match(rangeProblem({ about: /email/i, value: 30_000 }, dim("emails", 0, 5_000_000, 30_000))!, /more than 20 times/);
});

test("range sanity: a growth multiplier control reaches the later number", () => {
  const given = [{ about: /input|prompt/i, value: 40_000_000, mentioned: [40_000_000, 200_000_000] }];
  const growth = { id: "growth", label: "Growth by spring", unit: "x", min: 1, max: 8, initial: 5 };
  // "40M now, 5 times that by spring": a slider to 100M and a multiplier to 8x reach 200M.
  assert.equal(ranges(given, [dim("input_m", 10, 100, 40), growth]).status, "pass");
  // A multiplier that does not reach it, a slider that is no multiplier, and no multiplier at all still fail.
  assert.match(ranges(given, [dim("input_m", 10, 100, 40), { ...growth, max: 1.5 }]).reason, /leaves out 200,000,000/);
  assert.match(ranges(given, [dim("input_m", 10, 100, 40), { id: "budget", label: "Budget", unit: "USD", min: 1, max: 8, initial: 5 }]).reason, /leaves out 200,000,000/);
  assert.match(ranges(given, [dim("input_m", 10, 100, 40)]).reason, /leaves out 200,000,000/);
  // A growth rate in percent is no multiplier, whatever its name; a multiplier named after the metric still counts.
  assert.match(ranges(given, [dim("input_m", 10, 100, 40), { id: "growth", label: "Monthly growth", unit: "%", min: 0, max: 50, initial: 10 }]).reason, /leaves out 200,000,000/);
  assert.equal(ranges(given, [dim("input_m", 10, 100, 40), { ...growth, id: "input_growth", label: "Input growth by spring" }]).status, "pass");
  // The starting value is still the person's own number, and the width limit still holds for the slider itself.
  assert.match(ranges(given, [dim("input_m", 10, 100, 60), growth]).reason, /starts at 60/);
});

test("range sanity: a unit of thousands or millions is the same number", () => {
  const g = { about: /input/i, value: 40_000_000, mentioned: [40_000_000, 200_000_000] };
  assert.equal(rangeProblem(g, dim("input_mtok", 5, 400, 40)), null);
  assert.match(rangeProblem(g, dim("input_mtok", 5, 100, 40))!, /leaves out 200,000,000/);
});

test("ranges: the control is found by id, label or unit; a missing control fails; no numbers is not applicable", () => {
  const given = byId("price-auth").given;
  assert.equal(ranges(given, [dim("mau", 1_000, 100_000, 12_000, "Monthly active users"), dim("sso", 0, 50, 5, "Enterprise SSO connections")]).status, "pass");
  const r = ranges(given, [dim("mau", 1_000, 100_000, 12_000)]);
  assert.equal(r.status, "fail");
  assert.match(r.reason, /no control for/);
  assert.equal(ranges(undefined, []).status, "na");
  assert.equal(ranges(given, null).status, "fail");
  // Two controls match "input": one of them being right is enough.
  assert.equal(ranges([{ about: /input/i, value: 40 }], [dim("cached_input", 0, 100, 10), dim("input", 0, 400, 40)]).status, "pass");
});

test("dimensions: read from the spec of the create call, replaced by a later revise; both tool shapes", () => {
  const metric = (id: string, initial: number) => ({ id, label: id, unit: "u", describe: "x", min: 0, max: 100, initial });
  const spec = call("create_playground", { id: "p1", view: { type: "price_ranking" }, data: { price_pages: { metrics: [metric("emails", 30)], vendors: [] } } });
  assert.deepEqual(dimensions([spec], "p1")?.map((d) => [d.id, d.initial]), [["emails", 30]]);
  const revised = call("revise_playground", { playground_id: "p1", data: { price_pages: { metrics: [metric("emails", 30), metric("seats", 4)] } } });
  assert.deepEqual(dimensions([spec, revised, call("revise_playground", { playground_id: "p1", title: "x" })], "p1")?.map((d) => d.id), ["emails", "seats"]);
  assert.deepEqual(dimensions([spec, { ...revised, isError: true }], "p1")?.map((d) => d.id), ["emails"]);
  const preview = call("create_playground", { id: "p2", view: { type: "preview" }, controls: [{ id: "radius", type: "slider", label: "Radius", unit: "px", min: 0, max: 24, initial: 2 }, { id: "shadow", type: "toggle", initial: false }] });
  assert.deepEqual(dimensions([preview], "p2"), [{ id: "radius", label: "Radius", unit: "px", min: 0, max: 24, initial: 2 }]);
  // The price config from before the kit.
  const legacy = [call("create_playground", { id: "p3", metrics: [metric("mau", 12)] }), call("revise_playground", { playground_id: "p3", add_metrics: [metric("sso", 5)], remove_metric_ids: ["mau"] })];
  assert.deepEqual(dimensions(legacy, "p3")?.map((d) => d.id), ["sso"]);
  assert.equal(dimensions([spec], "other"), null);
});

test("tool use: a build case needs the create tool, a no-playground case must not build", () => {
  assert.equal(toolUse(byId("price-email"), [call("create_playground")], null).status, "pass");
  const none = toolUse(byId("price-email"), [call("read_playground")], null);
  assert.deepEqual([none.id, none.status], ["tool_use", "fail"]);
  assert.match(toolUse(byId("price-email"), [], null).reason, /never called create_playground or any Clay tool/);
  assert.equal(toolUse(byId("none-fact"), [], null).status, "pass");
  assert.deepEqual([toolUse(byId("none-fact"), [call("create_playground")], null).id, toolUse(byId("none-exact"), [call("revise_playground")], null).status], ["no_playground", "fail"]);
  // A tool of the same name from another server does not count.
  assert.equal(toolUse(byId("price-email"), [{ ...call("create_playground"), mcp: false }], null).status, "fail");
});

test("tool use: return visits work on the prepared playground", () => {
  const holds = byId("return-holds");
  assert.equal(toolUse(holds, [call("read_playground", { playground_id: "p1" }), call("recheck_playground", { playground_id: "p1" })], "p1").status, "pass");
  assert.match(toolUse(holds, [call("read_playground", { playground_id: "p1" })], "p1").reason, /never called recheck_playground/);
  assert.match(toolUse(holds, [call("read_playground", { playground_id: "other" }), call("recheck_playground", { playground_id: "other" })], "p1").reason, /never called read_playground on p1/);
  assert.match(toolUse(holds, [call("create_playground")], "p1").reason, /built a new playground/);
  // A call that the server refused does not count, for the tool check and for the read-back.
  assert.equal(toolUse(holds, [call("read_playground", { playground_id: "p1" }), call("recheck_playground", { playground_id: "p1" }, "refused", true)], "p1").status, "fail");
  assert.equal(toolUse(byId("return-compare"), [call("revise_playground", { playground_id: "p1", add_vendors: [{ id: "ses", name: "Amazon SES" }] }, "not valid", true)], "p1").status, "fail");
  assert.equal(readBack([call("read_playground", { playground_id: "p1" }, "does not exist", true)], "p1").status, "fail");
  const compare = byId("return-compare");
  assert.equal(toolUse(compare, [call("revise_playground", { playground_id: "p1", add_vendors: [{ id: "ses", name: "Amazon SES" }] })], "p1").status, "pass");
  assert.match(toolUse(compare, [call("revise_playground", { playground_id: "p1", add_vendors: [{ id: "sendgrid", name: "SendGrid" }] })], "p1").reason, /did not add/);
  // The spec shape: a revise gives the whole new vendor list.
  const vendors = (...names: string[]) => ({ playground_id: "p1", data: { price_pages: { vendors: names.map((name) => ({ id: name.toLowerCase().replace(/ /g, "-"), name })) } } });
  assert.equal(toolUse(compare, [call("revise_playground", vendors("Resend", "Postmark", "Mailgun", "Amazon SES"))], "p1").status, "pass");
  assert.match(toolUse(compare, [call("revise_playground", vendors("Resend", "Postmark", "Mailgun"))], "p1").reason, /did not add/);
});

test("creation: a failed build, a repaired build, and a problem left untold", () => {
  const broken = { playground_id: "p1", url: "http://x/p/p1", problems: ["mailgun: the pricing page was not read (timeout). Fix: ..."] };
  const fine = { playground_id: "p1", url: "http://x/p/p1", problems: ["resend: cannot be ranked at the current values because the page does not state: x. ... it is a fact about the page"] };
  assert.equal(creation([call("create_playground", {}, "The config is not valid.", true)], "").status, "fail");
  assert.equal(creation([call("create_playground", {}, "invalid", true), call("create_playground", {}, fine)], "").status, "pass");
  assert.equal(creation([call("create_playground", {}, broken), call("revise_playground", {}, fine)], "").status, "pass");
  const left = creation([call("create_playground", {}, broken)], "Here is your page.");
  assert.equal(left.status, "fail");
  assert.match(left.reason, /not told: mailgun/);
  assert.equal(creation([call("create_playground", {}, broken)], "Mailgun's page could not be read, so its row is empty.").status, "pass");
  assert.equal(creation([], "").status, "na");
  // A build that answered "running" has an empty list; the server's list after the build ended is what counts.
  const early = [call("create_playground", {}, { playground_id: "p1", url: "http://x/p/p1", build: { status: "running" }, problems: [] })];
  assert.equal(creation(early, "Here is your page.").status, "pass");
  assert.match(creation(early, "Here is your page.", ["resend: the pricing page was not read (timeout). Fix: ..."]).reason, /not told: resend/);
  assert.equal(creation(early, "Resend could not be read, so I left it out.", ["resend: the pricing page was not read (timeout)."]).status, "pass");
  const nothing = creation(early, "Only Resend could be priced, so the page compares nothing yet.", ["BROKEN BUILD: only 1 of 4 vendors can be ranked at the starting values"]);
  assert.equal(nothing.status, "fail");
  assert.match(nothing.reason, /handed over although it compares nothing/);
  assert.deepEqual(finalProblems(JSON.stringify({ build: { status: "running" }, problems: [] })), null);
  assert.deepEqual(finalProblems(JSON.stringify({ build: { status: "done" }, problems: ["x: y"] })), ["x: y"]);
  assert.deepEqual(finalProblems(JSON.stringify({ kind: "preview" })), null);
  // An id that an earlier run left on the server: the sample is void, and the cause is the harness, not the agent.
  const collided = creation([call("create_playground", { id: "p1" }, 'A playground with id "p1" already exists at http://x/p/p1. To change it, call revise_playground.', true), call("revise_playground", {}, fine)], "");
  assert.deepEqual([collided.id, collided.status], ["agent_run", "fail"]);
  assert.match(collided.reason, /left by an earlier run/);
  // Every build call timed out at the client: its own cause, and the id the agent asked for is still checked.
  const timedOut = [call("create_playground", { id: "p9" }, "The operation timed out.", true), call("revise_playground", { playground_id: "p9" }, "The operation timed out.", true)];
  assert.deepEqual([creation(timedOut, "").id, creation(timedOut, "").status, lastBuild(timedOut).attempted, lastBuild(timedOut).last], ["build_timeout", "fail", "p9", null]);
  assert.equal(creation([call("create_playground", {}, { playground_id: "p1", stopped: "Reading stopped early: 429" })], "").id, "agent_run");
});

test("hand-back: the agent must read the playground and name the saved choice", () => {
  assert.equal(readBack([call("read_playground", { playground_id: "p1" })], "p1").status, "pass");
  assert.equal(readBack([call("read_playground", {})], "p1").status, "fail");
  assert.equal(namesChoice("You settled on postmark at 45,000 emails.", "Postmark").status, "pass");
  assert.equal(namesChoice("You settled on the cheapest one.", "Postmark").status, "fail");
  // The agent may use the vendor's id instead of the row's display name, as a whole word.
  assert.equal(namesChoice("You saved **OpenAI** as your choice.", "OpenAI GPT", "openai").status, "pass");
  assert.equal(namesChoice("You saved Amazon SES.", "Amazon Simple Email Service", "amazon-ses").status, "pass");
  assert.equal(namesChoice("You saved Google.", "OpenAI GPT", "openai").status, "fail");
  assert.equal(namesChoice("It is an open AIrline.", "OpenAI GPT", "ses").status, "fail");
  assert.equal(namesChoice("It addresses your needs.", "Amazon", "ses").status, "fail");
});

test("hand-back comparison: the file must change and hold every settled output exactly", () => {
  const before = 'const primary = "bg-blue-600 px-2 py-1 rounded-sm";\nexport const SPRING = { stiffness: 120, damping: 4, mass: 1 };';
  const outputs = { className: "bg-blue-600 px-4 py-2 rounded-lg shadow-sm", spring: { stiffness: 260, damping: 22.5, mass: 1 } };
  const good = 'const primary = "bg-blue-600 px-4 py-2 rounded-lg shadow-sm";\nexport const SPRING = { stiffness: 260, damping: 22.5, mass: 1 };';
  assert.equal(fileMatches(before, good, outputs).status, "pass");
  assert.match(fileMatches(before, before, outputs).reason, /did not change/);
  assert.match(fileMatches(before, null, outputs).reason, /gone/);
  // A class string with one class changed is not the settled string.
  assert.match(fileMatches(before, good.replace("rounded-lg", "rounded-md"), outputs).reason, /lacks the settled className/);
  // 22.5 must be there as a number: 22 or 225 do not count, 22.50 does.
  assert.match(fileMatches(before, good.replace("22.5", "22"), outputs).reason, /lacks the settled spring.damping/);
  assert.match(fileMatches(before, good.replace("22.5", "225"), outputs).reason, /spring.damping/);
  assert.equal(fileMatches(before, good.replace("22.5", "22.50"), outputs).status, "pass");
  assert.match(fileMatches(before, good, {}).reason, /no outputs/);
  // An output of several lines: every line must be in the file, but other code may sit between them.
  const css = { rules: ".article {\n  font-size: 18px;\n  line-height: 1.6;\n}\n.article p { margin: 0 0 19px; }" };
  const file = ".article {\n  font-size: 18px;\n  line-height: 1.6;\n}\n.article h1 { font-size: 22px; }\n.article p { margin: 0 0 19px; }";
  assert.equal(fileMatches(".article { font-size: 14px; }", file, css).status, "pass");
  assert.match(fileMatches(".article { font-size: 14px; }", file.replace("19px", "18px"), css).reason, /lacks the settled rules line 5/);
  assert.match(fileMatches(".article { font-size: 14px; }", file.replace("line-height: 1.6", "line-height: 1.5"), css).reason, /rules line 3/);
  // Outputs as the page shows them: texts. A JSON text is compared value by value; other text may differ in line breaks only.
  const shown = { className: "bg-blue-600 px-4 py-2\n  rounded-lg shadow-sm", spring: '{"stiffness": 260, "damping": 22.5, "mass": 1}' };
  assert.equal(fileMatches(before, good, shown).status, "pass");
  assert.match(fileMatches(before, good.replace("260", "250"), shown).reason, /lacks the settled spring.stiffness/);
  // A number written into hyphenated code (Tailwind classes) is that number, and a numeric text is not a substring match.
  assert.equal(fileMatches("px-2 duration-100", "px-4 duration-150", { paddingX: 4, duration: "150" }).status, "pass");
  assert.match(fileMatches("gap: 8px", "gap: 120px", { gap: "12" }).reason, /lacks the settled gap/);
  assert.equal(fileMatches("y: 0", "y: -4", { y: -4 }).status, "pass");
  // A wrong sign fails (security review of 7876ad2): -12 in the file is not the settled 12, and 12 is not the settled -12.
  assert.match(fileMatches("const x = 0;", "const x = -12;", { value: 12 }).reason, /lacks the settled value/);
  assert.match(fileMatches("const x = 0;", "const x = 12;", { value: -12 }).reason, /lacks the settled value/);
  assert.equal(fileMatches("const x = 0;", "const x = -12;", { value: -12 }).status, "pass");
  assert.deepEqual(numbersIn("px-4 duration-150 -translate-y-2 x = -12, y: -4 (-.5) [-3] 1e-3 a-1.5"), [4, 150, 2, -12, -4, -0.5, -3, 0.001, 1.5]);
  // A separator is not a sign either way: px-4 does not hold -4.
  assert.match(fileMatches("px-2", "px-4", { x: -4 }).reason, /lacks the settled x/);
});

test("no-playground cases: the direct answer or the direct edit", () => {
  assert.equal(directAnswer(byId("none-fact"), "Return 429 Too Many Requests.", null, null).status, "pass");
  assert.equal(directAnswer(byId("none-fact"), "Return 503.", null, null).status, "fail");
  const exact = byId("none-exact");
  assert.equal(directAnswer(exact, "", "rounded-sm", "rounded-[8px]").status, "pass");
  assert.equal(directAnswer(exact, "", "rounded-sm", "rounded-lg").status, "pass");
  assert.match(directAnswer(exact, "", "rounded-sm", "rounded-md").reason, /not to what was asked/);
  assert.match(directAnswer(exact, "", "rounded-sm", "rounded-sm").reason, /did not change/);
});

test("verdict: one failing check fails the case, and the first one is reported", () => {
  assert.equal(verdict([{ id: "a", status: "pass", reason: "" }, { id: "b", status: "na", reason: "" }]).result, "pass");
  const v = verdict([{ id: "a", status: "pass", reason: "" }, { id: "b", status: "fail", reason: "x" }, { id: "c", status: "fail", reason: "y" }]);
  assert.deepEqual([v.result, v.firstFail?.id], ["fail", "b"]);
});

test("data cases: the facts carry sources, an unknown is not a number, the choice comes back", () => {
  const src = (over: object = {}) => ({ id: "anthropic", link: true, read: 12, unknown: 0, failed: false, ...over });
  assert.equal(sources([src(), src({ id: "openai" })]).status, "pass");
  assert.match(sources([]).reason, /lists no web source/);
  assert.match(sources([src({ failed: true, read: 0 })]).reason, /no web source was read/);
  assert.match(sources([src(), src({ id: "openai", read: 0 })]).reason, /1 of 2 web sources show no value: openai/);
  assert.match(sources([src({ link: false })]).reason, /no link/);
  // The probe loads the preview with every web number missing: it must say unknown, and must not show a broken number.
  assert.equal(unknowns("Opus: unknown, Sonnet: unknown (no price found)").status, "pass");
  assert.match(unknowns("Opus $NaN per task, unknown").reason, /shows "NaN"/);
  assert.match(unknowns("cost: undefined").reason, /undefined/);
  assert.match(unknowns("Opus $0.00 per task, Luna $0.00 per task").reason, /names nothing as unknown/);
  assert.match(unknowns("").reason, /names nothing as unknown/);
  assert.equal(unknowns(null).status, "fail");
  // The probe's document: every number of the web data is null, nothing else changes.
  const doc = '<script>(function () { var cfg = {"controls":[],"values":{"tasks":2000},"data":{"brand":null,"inline":{"n":5},"web":{"prices":[{"model":"a\\u003cb","input":4,"cached":0.2}],"plan":{"seat":8,"sso":true}}},"html":"x"};\nfunction check(controls, v) {}})();</script>';
  const probed = withoutWebNumbers(doc)!;
  assert.match(probed, /"web":\{"prices":\[\{"model":"a\\u003cb","input":null,"cached":null\}\],"plan":\{"seat":null,"sso":true\}\}/);
  assert.match(probed, /"values":\{"tasks":2000\}.*"inline":\{"n":5\}/);
  assert.equal(withoutWebNumbers(doc.replace(/"web":\{.*\}\},"html"/, '"web":{}},"html"')), null);
  assert.equal(withoutWebNumbers("<html>no config</html>"), null);
  // The choice the person settled must be in the file, or without a file in the answer.
  const before = '{ "model": "claude-opus-5-5" }';
  assert.equal(choiceHandback(["claude-sonnet-5-5"], before, '{ "model": "claude-sonnet-5-5" }', "").status, "pass");
  assert.match(choiceHandback(["claude-sonnet-5-5"], before, before, "").reason, /did not change/);
  assert.match(choiceHandback(["claude-sonnet-5-5"], before, '{ "model": "gpt-6-luna" }', "").reason, /does not hold the settled choice/);
  assert.equal(choiceHandback(["H100", "RunPod"], null, null, "You settled on an H100 at RunPod for 300 hours.").status, "pass");
  assert.match(choiceHandback(["H100"], null, null, "You settled on an A100.").reason, /names only 0 of the 1 settled choices/);
  // In words, more than half of the settled choices must be named, and a shared version number names nothing.
  assert.equal(choiceHandback(["claude-sonnet-4.5", "batch"], null, null, "Use Claude Opus 4.5 with batch billing.").status, "fail");
  assert.equal(choiceHandback(["claude-sonnet-4.5", "batch"], null, null, "Use Claude Sonnet 4.5 with batch billing.").status, "pass");
  assert.equal(unknowns("Opus — 0.00 USD per task").status, "fail");
  // A word form of the option names it ("moving to Paid now" for "move to Paid now"); another option does not.
  assert.equal(choiceHandback(["move to Paid now"], null, null, "You settled on moving to Paid now.").status, "pass");
  assert.equal(choiceHandback(["move to Paid now"], null, null, "You settled on staying on Free for now.").status, "fail");
  assert.equal(choiceHandback(["RTX 4090 24GB", "QLoRA (4-bit base)", "RTX 4090 24GB", "Lambda"], null, null, "You settled on RTX 4090 on Lambda with QLoRA.").status, "pass");
  assert.equal(choiceHandback(["RTX 4090 24GB", "QLoRA (4-bit base)", "Vast.ai", "Full fine-tune"], null, null, "You settled on an RTX 4090.").status, "fail");
  assert.equal(choiceHandback([], null, null, "").status, "na");
  // A spoken answer names a choice by its key word; a file must hold it as it is.
  assert.deepEqual([namedInProse("RTX 4090 24GB", "an RTX 4090 at Lambda"), namedInProse("H100 80GB", "one H100"), namedInProse("claude-sonnet-5-5", "switch to Claude Sonnet 5.5"), namedInProse("claude-sonnet-5-5", "switch to Claude Opus"), namedInProse("Lambda", "rent it elsewhere")], [true, true, true, false, false]);
  assert.equal(choiceHandback(["RTX 4090 24GB", "Lambda"], null, null, "You settled on RTX 4090 on Lambda, but that pair cannot be rented.").status, "pass");
  assert.equal(choiceHandback(["RTX 4090 24GB"], null, null, "You settled on an A6000.").status, "fail");
  assert.equal(choiceHandback(["claude-sonnet-5-5"], before, '{ "model": "sonnet" }', "").status, "fail");
  // What the harness reads from the server after the settle.
  const read = JSON.stringify({ settled: { values: { tasks: 3000, model: "claude-sonnet-5-5", accent: "#ff0000", on: true } }, data: [{ source: "web", status: "read", unknown: ["GPT-6 Luna / cached_input"] }, { source: "inline" }] });
  assert.deepEqual(readFacts(read), { choices: ["claude-sonnet-5-5"], anyUnknown: true });
  assert.deepEqual(readFacts(JSON.stringify({ settled: "none: ...", data: [{ source: "web", status: "read", unknown: [] }] })), { choices: [], anyUnknown: false });
  assert.deepEqual(readFacts("not json"), { choices: [], anyUnknown: false });
});
