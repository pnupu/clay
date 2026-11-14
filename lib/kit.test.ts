import assert from "node:assert/strict";
import { test } from "node:test";
import { checkKit, runSignature, cleanValues, explorationWords, initialValues, mergeKitExploration, renderOutputs, type KitState } from "./kit.ts";
import { BUTTON_EXAMPLE, MODEL_EXAMPLE, SPRING_EXAMPLE } from "./reference.ts";
import { mergeSpec, parseSpec, toSpec, type Spec } from "./spec.ts";
import { newPlayground } from "./store.ts";

const errors = (s: unknown) => {
  const r = parseSpec(s);
  return r.ok ? [] : r.errors;
};
const edit = (fn: (s: Omit<Spec, "controls" | "outputs"> & { controls: Record<string, unknown>[]; outputs: { id: string; label: string; template: string }[] }) => void, base: Spec = BUTTON_EXAMPLE) => {
  const s = structuredClone(base) as Parameters<typeof fn>[0];
  fn(s);
  return s;
};
const kitOf = (s: Spec) => {
  const r = parseSpec(s);
  assert.ok(r.ok && r.kind === "preview", JSON.stringify(r));
  return r.kit;
};

test("the two worked examples of the kit reference are valid specs, and their outputs render at the initial values", () => {
  const button = kitOf(BUTTON_EXAMPLE);
  assert.deepEqual(renderOutputs(button, initialValues(button.controls)), { class_name: "bg-[#3b82f6] rounded-[4px] px-[12px] py-2 text-sm text-white font-normal" });
  const spring = kitOf(SPRING_EXAMPLE);
  assert.deepEqual(renderOutputs(spring, initialValues(spring.controls)), { spring: "{ stiffness: 120, damping: 26, mass: 1 }" });
});

test("a bad spec is rejected with an error that says how to fix it", () => {
  const has = (s: unknown, part: RegExp) => assert.ok(errors(s).some((e) => part.test(e)), `no error like ${part} in:\n${errors(s).join("\n")}`);
  has(edit((s) => (s.controls[1].type = "knob")), /controls\.1\.type/); // zod: not a kit control
  has(edit((s) => s.controls.push({ id: "gap", type: "slider", label: "Gap", meaning: "gap between items in px", min: 0, max: 10, initial: 2 })), /controls\.gap: nothing uses this control/);
  has(edit((s) => (s.view.html = s.view.html!.replace("{{radius}}", "{{raduis}}"))), /view\.html: \{\{raduis\}\} is bound to a control that does not exist/);
  has(edit((s) => (s.outputs[0].template += " {{missing}}")), /outputs\.class_name\.template: \{\{missing\}\} references a control that does not exist/);
  has(edit((s) => (s.outputs[0].template = "constant")), /contains no \{\{control_id\}\}/);
  has(edit((s) => (s.controls[1].initial = 40)), /controls\.radius\.initial: 40 is outside the range 0 to 24/);
  has(edit((s) => (s.controls[2].initial = 13)), /not reachable from min 8 in steps of 2/);
  has(edit((s) => (s.controls[3].initial = "font-bold")), /controls\.weight\.initial: must be the value of one of the options/);
  has(edit((s) => (s.controls[0].initial = "blue")), /controls\.bg\.initial: give the colour as #rrggbb/);
  has(edit((s) => delete s.data), /"brand" needs data\.brand/);
  has(edit((s) => (s.controls[4].min = 0)), /controls\.shadow\.min: a toggle has no min/);
  has(edit((s) => (s.controls[1].id = "Radius")), /controls\.1\.id: use 2 to 30 characters/);
  has(edit((s) => (s.controls[1].id = "bg")), /id "bg" is used twice/);
  has(edit((s) => (s.view.html += "<script>alert(1)</script>")), /script tags in the html do not run/);
  has(edit((s) => (s.view.js = "x".repeat(40_001))), /view\.js: 40001 characters, the limit is 40000/);
  has(edit((s) => (s.view.js = "el.style.left = clay.values.offset + 'px'"), SPRING_EXAMPLE), /clay\.values\.offset reads a control that does not exist/);
  has(edit((s) => (s.outputs = [])), /needs at least 1 output/);
  has(edit((s) => (s.view.type = "price_ranking")), /data\.price_pages: the price_ranking view needs it/);
  has({ ...BUTTON_EXAMPLE, id: "No Spaces" }, /^id: /);
  has({ ...BUTTON_EXAMPLE, extra: 1 }, /Unrecognized key/);
});

test("a price spec goes to the price engine; price and preview parts cannot be mixed", () => {
  const price: Spec = { id: "email-api", title: "Which transactional email API should we use?", data: { price_pages: { product: "transactional email API", metrics: [{ id: "emails", label: "Emails per month", unit: "emails", describe: "Emails sent per month through the API.", min: 1000, max: 500_000, initial: 40_000 }], vendors: [{ id: "resend", name: "Resend", pricing_url: "https://resend.com/pricing" }, { id: "postmark", name: "Postmark", domain: "postmarkapp.com" }] } }, view: { type: "price_ranking" } };
  const r = parseSpec(price);
  assert.ok(r.ok && r.kind === "price");
  assert.equal(r.domain.question, price.title);
  assert.equal(r.domain.vendors[0].url, "https://resend.com/pricing");
  // toSpec() gives back a spec that parses to the same domain, and a revision replaces whole parts.
  const again = parseSpec(mergeSpec(toSpec(newPlayground(r.domain)), { title: "Which email API fits a salon booking app?", notes: "Drag the slider from 40k to 150k." }));
  assert.ok(again.ok && again.kind === "price");
  assert.equal(again.domain.note, "Drag the slider from 40k to 150k.");
  assert.deepEqual({ ...again.domain, question: price.title, note: undefined }, { ...r.domain, note: undefined });
  assert.equal(toSpec(newPlayground(again.domain)).notes, "Drag the slider from 40k to 150k.");
  // A revision removes a data source with null; the palette that needed it must then be a list.
  const noBrand = mergeSpec(BUTTON_EXAMPLE, { data: { brand: null } });
  assert.ok(errors(noBrand).some((e) => /"brand" needs data\.brand/.test(e)));
  const listed = parseSpec(mergeSpec(BUTTON_EXAMPLE, { data: { brand: null }, controls: [{ ...BUTTON_EXAMPLE.controls![0], palette: ["#533afd"] }, ...BUTTON_EXAMPLE.controls!.slice(1)] }));
  assert.ok(listed.ok && listed.kind === "preview" && listed.kit.brand === null);
  assert.ok(errors({ ...price, controls: BUTTON_EXAMPLE.controls }).some((e) => /controls: the price_ranking view brings its own controls/.test(e)));
  assert.ok(errors({ ...BUTTON_EXAMPLE, data: { ...BUTTON_EXAMPLE.data, price_pages: price.data!.price_pages } }).some((e) => /a preview view has no price ranking/.test(e)));
  assert.ok(errors({ ...price, data: { price_pages: { ...price.data!.price_pages!, vendors: [price.data!.price_pages!.vendors[0]] } } }).some((e) => e.startsWith("data.price_pages.vendors")));
});

test("values from the browser: only values a control can have are stored; outputs follow them", () => {
  const kit = kitOf(BUTTON_EXAMPLE);
  const ok = { bg: "#FF0000", radius: 9.4, pad_x: 20, weight: "font-semibold", shadow: true, extra: "dropped" };
  assert.deepEqual(cleanValues(kit.controls, ok), { bg: "#ff0000", radius: 9, pad_x: 20, weight: "font-semibold", shadow: true });
  assert.equal(renderOutputs(kit, cleanValues(kit.controls, ok)!).class_name, "bg-[#ff0000] rounded-[9px] px-[20px] py-2 text-sm text-white font-semibold shadow-md");
  for (const bad of [{ ...ok, radius: 25 }, { ...ok, radius: "9" }, { ...ok, weight: "font-black" }, { ...ok, bg: "red" }, { ...ok, bg: "#ff0000;x" }, { ...ok, shadow: "yes" }, { bg: "#ff0000" }, null, "x"]) assert.equal(cleanValues(kit.controls, bad), null);
  // A multi-line output keeps its indentation; only a one-line output is collapsed.
  const css = { ...kit, outputs: [{ id: "css", label: "Rule", template: ".btn {\n  border-radius: {{radius}}px;\n  {{shadow}}\n}\n" }] };
  assert.equal(renderOutputs(css, { ...cleanValues(kit.controls, ok)!, shadow: false }).css, ".btn {\n  border-radius: 9px;\n\n}");
  // A closed palette takes only its own colours and the start colour.
  const closed = kitOf({ ...BUTTON_EXAMPLE, data: undefined, controls: [{ ...BUTTON_EXAMPLE.controls![0], palette: ["#111111", "#222222"], free: false }, ...BUTTON_EXAMPLE.controls!.slice(1)] });
  assert.equal(cleanValues(closed.controls, { ...ok, bg: "#222222" })!.bg, "#222222");
  assert.equal(cleanValues(closed.controls, { ...ok, bg: "#3b82f6" })!.bg, "#3b82f6");
  assert.equal(cleanValues(closed.controls, { ...ok, bg: "#ff00ff" }), null);
  // A very small step keeps its decimals (JavaScript prints 1e-7 with an exponent).
  const tiny = kitOf({ ...SPRING_EXAMPLE, controls: [...SPRING_EXAMPLE.controls!.slice(0, 2), { ...SPRING_EXAMPLE.controls![2], min: 0, max: 0.001, step: 1e-7, initial: 0.0005 }] });
  assert.equal(cleanValues(tiny.controls, { stiffness: 120, damping: 26, mass: 0.0003217 })!.mass, 0.0003217);
  // A slider on a fractional grid has no floating-point dust.
  const spring = kitOf(SPRING_EXAMPLE);
  assert.equal(cleanValues(spring.controls, { stiffness: 120, damping: 26, mass: 0.1 + 0.2 })!.mass, 0.3);
});

test("the exploration summary keeps the path: the range tried per slider, the values tried per other control", () => {
  const kit = kitOf(BUTTON_EXAMPLE);
  let e = mergeKitExploration(kit.controls, null, { controls: { radius: { min: 2, max: 16, final: 10 }, bg: { tried: ["#111111", "#222222"], final: "#222222" } } }, "t1");
  e = mergeKitExploration(kit.controls, e, { controls: { radius: { min: 8, max: 20, final: 12 }, unknown: { final: 1 } } }, "t2");
  assert.deepEqual(e!.controls.radius, { start: 4, final: 12, min: 2, max: 20, tried: [] });
  assert.deepEqual(e!.controls.bg, { start: "#3b82f6", final: "#222222", tried: ["#111111", "#222222"] });
  const words = explorationWords({ kit, exploration: e } as KitState);
  assert.equal(words[1], "Corner radius: tried 2 to 20 px, settled on 12 px (started at 4 px).");
  assert.equal(words[0], "Background: tried #111111, #222222; settled on #222222 (started at #3b82f6).");
  assert.equal(words[4], "Shadow: left at off, never moved.");
  // A settle reports every control. A control the person never touched stays "never moved"; a slider keeps its range.
  const settled = mergeKitExploration(kit.controls, e, { controls: { bg: { final: "#222222" }, radius: { final: 12 }, pad_x: { final: 12 }, weight: { final: "font-normal" }, shadow: { final: false } } }, "t3");
  assert.deepEqual(settled!.controls.shadow, { start: false, final: false, tried: [] });
  assert.deepEqual(settled!.controls.bg.tried, ["#111111", "#222222"]);
  assert.equal(explorationWords({ kit, exploration: settled } as KitState)[3], "Text weight: left at Normal, never moved.");
  // Back to the start value is a move, and it is reported as one.
  const back = mergeKitExploration(kit.controls, settled, { controls: { bg: { tried: ["#3b82f6"], final: "#3b82f6" }, radius: { min: 4, max: 4, final: 4 } } }, "t4");
  assert.deepEqual(back!.controls.bg, { start: "#3b82f6", final: "#3b82f6", tried: ["#111111", "#222222", "#3b82f6"] });
  assert.equal(back!.controls.radius.final, 4);
  // A malformed report changes nothing.
  assert.equal(mergeKitExploration(kit.controls, e, { controls: { radius: { final: 999 } } }, "t3"), null);
  assert.equal(mergeKitExploration(kit.controls, e, { controls: { weight: { final: "font-black" } } }, "t3"), null);
  assert.equal(mergeKitExploration(kit.controls, e, null, "t3"), null);
});

test("a toggle or option text may use another control's value in an output, one level deep", () => {
  const raw = {
    controls: [
      { id: "accent", type: "color", label: "Accent", meaning: "accent colour of the badge", initial: "#7170ff" },
      { id: "badge", type: "toggle", label: "Badge", meaning: "show the Most popular badge", initial: true, on: '<span className="bg-[{{accent}}]">Most popular</span>', off: "" },
      { id: "size", type: "select", label: "Size", meaning: "text size class", initial: "text-sm", options: [{ value: "text-sm" }, { value: "text-[{{accent}}]" }] },
    ],
    view: { html: '<p style="color:{{accent}}">x</p>' },
    outputs: [{ id: "code", label: "the badge", template: "<div>{{badge}}</div> {{size}}" }],
  };
  const r = checkKit(raw);
  assert.ok(r.ok);
  if (!r.ok) return;
  // The accent is in no output template by name, but it comes back inside the badge: no warning that it is lost.
  assert.deepEqual(r.warnings, []);
  assert.equal(renderOutputs(r.kit, { accent: "#ff0000", badge: true, size: "text-sm" }).code, '<div><span className="bg-[#ff0000]">Most popular</span></div> text-sm');
  assert.equal(renderOutputs(r.kit, { accent: "#ff0000", badge: false, size: "text-[{{accent}}]" }).code, "<div></div> text-[#ff0000]");
  // In the preview a placeholder is filled one level only: a text with a placeholder inside must not be used in html or css.
  const inCss = checkKit({ ...raw, view: { html: "<p>x</p>", css: "p { color: {{accent}}; } .b::after { content: '{{size}}'; }" } });
  assert.ok(!inCss.ok && inCss.errors.some((e: string) => /view\.css: \{\{size\}\} stands for a text that holds \{\{accent\}\}. That is filled in outputs only/.test(e)));
  // And a control that only appears inside such a text of the preview is not bound by it.
  const onlyNested = checkKit({ controls: [raw.controls[0], { id: "ring", type: "toggle", label: "Ring", meaning: "show a ring", initial: false, on: "2px solid {{accent}}", off: "0" }], view: { html: "<p>x</p>", css: "p { outline: {{ring}}; }" }, outputs: [{ id: "o", label: "ring on or off", template: "{{ring}}" }] });
  assert.ok(!onlyNested.ok && onlyNested.errors.some((e: string) => /view\.css: \{\{ring\}\} stands for a text that holds \{\{accent\}\}/.test(e)));
  // A text that names a control that does not exist, or itself, is refused with the fix.
  const bad = checkKit({ ...raw, controls: [raw.controls[0], { ...raw.controls[1], on: "{{nope}} {{badge}}" }, raw.controls[2]] });
  assert.ok(!bad.ok && bad.errors.some((e: string) => /controls\.badge: its text holds \{\{nope\}\}, which is not a control/.test(e)) && bad.errors.some((e: string) => /is the control itself/.test(e)));
});

test("length errors state the limit and the given length, and the schema and the validator agree", () => {
  const spec = (over: object) => ({ id: "btn", title: "How should it look?", view: { type: "preview", html: '<b style="border-radius:{{radius}}px">x</b>' }, controls: [{ id: "radius", type: "slider", label: "Radius", meaning: "border-radius in px", min: 0, max: 24, initial: 2 }], outputs: [{ id: "css", label: "radius", template: "border-radius: {{radius}}px" }], ...over });
  const errorsOf = (over: object) => { const r = parseSpec(spec(over)); return r.ok ? [] : r.errors; };
  // The case from production: an output label of 70 characters passed the schema (80) and failed the validator (60).
  assert.deepEqual(errorsOf({ outputs: [{ id: "css", label: "x".repeat(70), template: "{{radius}}" }] }), ["outputs.0.label: at most 60 characters, this one has 70"]);
  assert.deepEqual(errorsOf({ outputs: [{ id: "css", label: "x".repeat(60), template: "{{radius}}" }] }), []);
  assert.match(errorsOf({ controls: [{ id: "radius", type: "slider", label: "y".repeat(61), meaning: "border-radius in px", min: 0, max: 24, initial: 2 }] })[0], /controls\.0\.label: at most 60 characters, this one has 61/);
  assert.match(errorsOf({ title: "ab" })[0], /title: at least 3 characters, this one has 2/);
  assert.match(errorsOf({ notes: "n".repeat(700) })[0], /notes: at most 600 characters, this one has 700/);
  // The validator's own messages (a raw kit that did not pass the schema first) state both numbers too.
  const raw = checkKit({ controls: [{ id: "radius", type: "slider", label: "y".repeat(61), meaning: "m", min: 0, max: 24, initial: 2 }], view: { html: "<b>{{radius}}</b>" }, outputs: [{ id: "css", label: "z".repeat(99), template: "{{radius}}" }] });
  assert.ok(!raw.ok);
  if (raw.ok) return;
  assert.ok(raw.errors.some((e: string) => /label: give a label of 2 to 60 characters \(this one has 61\)/.test(e)));
  assert.ok(raw.errors.some((e: string) => /meaning: say in 5 to 200 characters \(this one has 1\)/.test(e)));
  assert.ok(raw.errors.some((e: string) => /outputs\.css\.label: give a label of 2 to 60 characters \(this one has 99\)/.test(e)));
});

test("a toggle text holds a small patch: up to 2000 characters, and the error over that states both lengths", () => {
  const kit = (on: string) => checkKit({ controls: [{ id: "badge", type: "toggle", label: "Badge", meaning: "show the badge markup", initial: false, on, off: "" }], view: { html: "<b>{{badge}}</b>" }, outputs: [{ id: "code", label: "badge", template: "{{badge}}" }] });
  assert.ok(kit("<span>" + "x".repeat(1500) + "</span>").ok);
  const long = kit("x".repeat(2001));
  assert.ok(!long.ok && long.errors.some((e: string) => /at most 2000 characters each \(on: this one has 2001, off: this one has 0\)/.test(e)));
  const r = parseSpec({ id: "btn", title: "How should it look?", view: { type: "preview", html: "<b>{{badge}}</b>" }, controls: [{ id: "badge", type: "toggle", label: "Badge", meaning: "show the badge markup", initial: false, on: "x".repeat(2001) }], outputs: [{ id: "code", label: "badge", template: "{{badge}}" }] });
  assert.deepEqual(!r.ok && r.errors, ["controls.0.on: at most 2000 characters, this one has 2001"]);
});

test("a revision of words only runs the same preview; a change of code, data or a control's values does not", () => {
  const base = checkKit({ controls: [{ id: "radius", type: "slider", label: "Radius", meaning: "border-radius in px", min: 0, max: 24, initial: 2 }, { id: "size", type: "select", label: "Size", meaning: "text size class", initial: "sm", options: [{ value: "sm", label: "Small" }, { value: "lg", label: "Large" }] }], view: { html: "<b class='{{size}}' style='border-radius:{{radius}}px'>x</b>" }, outputs: [{ id: "css", label: "radius", template: "{{radius}} {{size}}" }] });
  assert.ok(base.ok);
  if (!base.ok) return;
  const k = base.kit;
  const words = { ...k, notes: "A new note", controls: k.controls.map((c) => ({ ...c, label: c.label + " (px)", meaning: "said differently", ...(c.type === "select" ? { options: c.options.map((o) => ({ ...o, label: o.label + "!" })) } : {}) })), outputs: k.outputs.map((o) => ({ ...o, label: "renamed" })) };
  assert.equal(runSignature(words as typeof k), runSignature(k));
  assert.notEqual(runSignature({ ...k, preview: { ...k.preview, css: "b { color: red }" } }), runSignature(k));
  assert.notEqual(runSignature({ ...k, controls: k.controls.map((c) => (c.type === "slider" ? { ...c, max: 48 } : c)) }), runSignature(k));
  assert.notEqual(runSignature({ ...k, inline: { a: 1 } }), runSignature(k));
  assert.notEqual(runSignature({ ...k, brand: { domain: "linear.app" } }), runSignature(k));
});

test("the worked example with live web facts passes the validator, and data.web is checked like the rest of a spec", () => {
  const ok = parseSpec(MODEL_EXAMPLE);
  assert.ok(ok.ok && ok.kind === "preview", ok.ok ? "" : ok.errors.join("\n"));
  if (!ok.ok || ok.kind !== "preview") return;
  assert.deepEqual(ok.kit.web?.map((s) => s.id), ["anthropic", "openai"]);
  assert.deepEqual(ok.warnings, []);
  const errorsOf = (spec: unknown) => { const r = parseSpec(spec); return r.ok ? [] : r.errors; };
  const data = (web: unknown) => ({ ...MODEL_EXAMPLE, data: { ...MODEL_EXAMPLE.data, web } });
  // A source that the preview never reads would be read for nothing; a source that does not exist is a mistake in view.js.
  const unused = parseSpec(data([...MODEL_EXAMPLE.data!.web!, { id: "google", url: "https://ai.google.dev/pricing", fields: [{ id: "price", type: "number", describe: "price per million tokens" }] }]));
  assert.ok(unused.ok && unused.kind === "preview" && unused.warnings.some((w) => /data\.web\.google: view\.js does not seem to read/.test(w)));
  // Code that reaches the sources through a variable is not refused: it is the first GPU spec a real agent wrote.
  const viaVariable = parseSpec({ ...data([{ id: "runpod", url: "https://www.runpod.io/pricing", rows: MODEL_EXAMPLE.data!.web![0].rows }, { id: "vast", url: "https://vast.ai/pricing", rows: MODEL_EXAMPLE.data!.web![0].rows }]), view: { ...MODEL_EXAMPLE.view, js: 'const web = clay.data.web || {}; const out = document.getElementById("rows"); clay.onChange((v) => { out.textContent = ["runpod", "vast"].map((p) => (web[p] || []).length + " rows at " + v.tasks + v.cached_share + v.max_seconds + v.min_pass + v.model).join(", "); });' } });
  assert.ok(viaVariable.ok && viaVariable.kind === "preview", viaVariable.ok ? "" : viaVariable.errors.join("\n"));
  assert.deepEqual(viaVariable.ok && viaVariable.kind === "preview" ? viaVariable.warnings : null, []);
  assert.match(errorsOf(data([MODEL_EXAMPLE.data!.web![0]])).join("\n"), /clay\.data\.web\.openai reads a web source that does not exist/);
  // Bounds, before any element is validated.
  assert.deepEqual(errorsOf(data(Array.from({ length: 5000 }, () => ({})))), ["data.web: at most 6 entries, got 5000. Nothing was checked or created."]);
  assert.match(errorsOf(data([{ ...MODEL_EXAMPLE.data!.web![0], rows: { describe: "one row per model", fields: Array.from({ length: 300 }, () => ({})) } }, MODEL_EXAMPLE.data!.web![1]]))[0], /data\.web\.0\.rows\.fields: at most 20 entries, got 300/);
  // A private or non-https page is refused; a price playground cannot carry data.web.
  assert.match(errorsOf(data([{ ...MODEL_EXAMPLE.data!.web![0], domain: undefined, find: undefined, url: "http://169.254.169.254/latest" }, MODEL_EXAMPLE.data!.web![1]])).join("\n"), /must be a full https/);
  assert.match(errorsOf({ id: "price-with-web", title: "Which email service should we use?", view: { type: "price_ranking" }, data: { web: MODEL_EXAMPLE.data!.web } }).join("\n"), /data\.web: only a preview view can use it/);
  // The web spec is part of what decides how the preview runs: changing a source is not a words-only revision.
  const other = parseSpec(data([{ ...MODEL_EXAMPLE.data!.web![0], find: "another page of the site" }, MODEL_EXAMPLE.data!.web![1]]));
  assert.ok(other.ok && other.kind === "preview" && runSignature(other.kit) !== runSignature(ok.kit));
});

test("outputs: a spec whose outputs could expand past the limit is refused; a stored one renders a short notice", async () => {
  const { OUTPUT_LIMIT, outputsSize, initialValues: init, renderOutputs: rend, checkKit: check } = await import("./kit.ts");
  // The reviewer's case: a toggle text that repeats another toggle's text, repeated again in the output template.
  const raw = (n: number, m: number, l: number) => ({
    controls: [
      { id: "aa", type: "toggle", label: "Outer", meaning: "outer repeated output", initial: true, on: "{{bb}}".repeat(n), off: "" },
      { id: "bb", type: "toggle", label: "Inner", meaning: "inner repeated output", initial: true, on: "x".repeat(l), off: "" },
    ],
    view: { type: "preview", html: "<p>Output probe</p>" },
    outputs: [{ id: "out0", label: "Output 0", template: "{{aa}}".repeat(m) }],
  });
  const big = check(raw(30, 100, 1000) as never);
  assert.equal(big.ok, false);
  assert.match((big as { errors: string[] }).errors.join(" "), /would hold 3000000 characters; the limit is 32000/);
  // A kit already stored with such outputs (from before the limit) is not rendered: nothing large is built.
  const stored = { controls: raw(30, 100, 1000).controls, outputs: raw(30, 100, 1000).outputs } as never;
  assert.equal(outputsSize(stored, null), 3_000_000);
  const out = rend(stored, init((stored as { controls: never[] }).controls));
  assert.ok(JSON.stringify(out).length < 200);
  assert.match(out.out0, /not rendered: the outputs would hold 3000000 characters, the limit is 32000/);
  // An ordinary nested toggle stays valid and renders.
  const ok = check(raw(1, 1, 40) as never);
  assert.equal(ok.ok, true);
  assert.ok(OUTPUT_LIMIT >= 32_000);
});

test("view.html: elements that can send requests outside the sandbox are refused, with what to use instead", async () => {
  const { checkKit: check } = await import("./kit.ts");
  const kit = (html: string) => check({ controls: [{ id: "size", type: "slider", label: "Size", meaning: "font size of the text in px", min: 8, max: 20, initial: 12 }], view: { type: "preview", html }, outputs: [{ id: "result", label: "Result", template: "{{size}}px" }] } as never);
  for (const html of ['<p>{{size}}</p><link rel="prerender" href="https://x.example/?s={{size}}">', '<META http-equiv="refresh" content="0;url=https://x.example">{{size}}', '<base href="https://x.example/">{{size}}', '<iframe src="https://x.example"></iframe>{{size}}', '< link rel=preload href=x>{{size}}']) {
    const r = check === undefined ? null : kit(html);
    assert.equal(r!.ok, false, html);
    assert.match((r as { errors: string[] }).errors.join(" "), /not allowed in a preview.*view\.css or style attributes/);
  }
  assert.equal(kit('<p style="font-size:{{size}}px">Linked text, meta data, a base layer</p>').ok, true); // words are fine, only tags are refused
});
