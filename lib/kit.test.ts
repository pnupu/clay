import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanValues, explorationWords, initialValues, mergeKitExploration, renderOutputs, type KitState } from "./kit.ts";
import { BUTTON_EXAMPLE, SPRING_EXAMPLE } from "./reference.ts";
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
  const again = parseSpec(mergeSpec(toSpec(newPlayground(r.domain)), { title: "Which email API fits a salon booking app?" }));
  assert.ok(again.ok && again.kind === "price");
  assert.deepEqual({ ...again.domain, question: price.title }, r.domain);
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
  // A malformed report changes nothing.
  assert.equal(mergeKitExploration(kit.controls, e, { controls: { radius: { final: 999 } } }, "t3"), null);
  assert.equal(mergeKitExploration(kit.controls, e, { controls: { weight: { final: "font-black" } } }, "t3"), null);
  assert.equal(mergeKitExploration(kit.controls, e, null, "t3"), null);
});
