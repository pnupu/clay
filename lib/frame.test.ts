import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { BRIDGE_PURE, frameCsp, frameDocument, fromFrame, limiter, TAILWIND } from "./frame.ts";
import type { KitState } from "./kit.ts";
import { BUTTON_EXAMPLE } from "./reference.ts";
import { parseSpec } from "./spec.ts";

const state = (over: Partial<KitState> = {}): KitState => {
  const r = parseSpec(BUTTON_EXAMPLE);
  assert.ok(r.ok && r.kind === "preview");
  return { kit: r.kit, brandData: null, brandError: null, preview: { status: "unverified", error: null, at: null }, settled: null, exploration: null, ...over };
};

test("page side of the bridge: only the two known message shapes pass, and the kept text is bounded", () => {
  assert.deepEqual(fromFrame({ clay: 1, type: "ready" }), { type: "ready" });
  assert.deepEqual(fromFrame({ clay: 1, type: "ready", extra: "x".repeat(1e6) }), { type: "ready" });
  assert.deepEqual(fromFrame({ clay: 1, type: "error", message: "boom" }), { type: "error", message: "boom" });
  assert.equal((fromFrame({ clay: 1, type: "error", message: "x".repeat(100_000) }) as { message: string }).message.length, 500);
  for (const bad of [null, undefined, "ready", 1, [], [{ clay: 1, type: "ready" }], {}, { type: "ready" }, { clay: 2, type: "ready" }, { clay: 1, type: "values", values: {} }, { clay: 1, type: "error" }, { clay: 1, type: "error", message: { toString: () => "x" } }, { clay: 1, type: "settle" }]) assert.equal(fromFrame(bad), null);
});

test("the message rate cap lets a burst through up to the cap, then refuses until the window has passed", () => {
  const allow = limiter(3, 1000);
  assert.deepEqual([0, 1, 2, 3, 999].map(allow), [true, true, true, false, false]);
  assert.equal(allow(1000), true); // the event at 0 left the window
  assert.equal(allow(1000), false);
});

test("frame side of the bridge: values from the page are accepted only when every control gets a value it can have", () => {
  const { check, fill } = vm.runInNewContext(`(function () {${BRIDGE_PURE}; return { check: check, fill: fill }; })()`) as { check: (c: unknown, v: unknown) => Record<string, unknown> | null; fill: (c: unknown, v: unknown, t: string, e: boolean) => string };
  const controls = [{ id: "radius", type: "slider", min: 0, max: 24 }, { id: "bg", type: "color" }, { id: "weight", type: "select", options: ["a", "b"] }, { id: "shadow", type: "toggle", on: "shadow-md", off: "" }];
  const ok = { radius: 8, bg: "#ff0000", weight: "b", shadow: true };
  assert.deepEqual({ ...check(controls, { ...ok, extra: 1 }) }, ok);
  for (const bad of [{ ...ok, radius: 25 }, { ...ok, radius: "8" }, { ...ok, radius: NaN }, { ...ok, bg: "red" }, { ...ok, bg: '#ff0000"><img>' }, { ...ok, weight: "c" }, { ...ok, shadow: 1 }, { radius: 8 }, null, "x"]) assert.equal(check(controls, bad), null);
  assert.equal(fill(controls, ok, 'rounded-[{{radius}}px] bg-[{{ bg }}] {{weight}} {{shadow}} {{nope}}', false), "rounded-[8px] bg-[#ff0000] b shadow-md {{nope}}");
  // In html a value is escaped, so an option value cannot add markup.
  assert.equal(fill([{ id: "weight", type: "select", options: ['"><b>'] }], { weight: '"><b>' }, '<i class="{{weight}}">', true), '<i class="&#34;&#62;&#60;b&#62;">');
});

test("the frame document is sandboxed by its own policy, and agent text cannot close a script early", () => {
  const csp = frameCsp(state());
  assert.match(csp, /^sandbox allow-scripts; default-src 'none';/);
  assert.ok(!/allow-same-origin|allow-forms|allow-popups|allow-top-navigation|allow-downloads|allow-modals/.test(csp));
  assert.ok(csp.includes("connect-src 'none'") && csp.includes("frame-ancestors 'self'") && csp.includes("form-action 'none'"));
  assert.ok(csp.includes(`script-src 'unsafe-inline' ${TAILWIND.url};`));
  assert.ok(csp.includes("img-src data:;"));
  // Images load only from the https origins of the brand's logos.
  const withLogos = state({ brandData: { domain: "acme.com", title: "", colors: [], logos: [{ url: "https://media.example-cdn.com/a/logo.svg", mode: "light", type: "logo" }, { url: "http://insecure.example/x.png", mode: "", type: "" }], fetchedAt: "t", source: "context.dev brand" } });
  assert.ok(frameCsp(withLogos).includes("img-src data: https://media.example-cdn.com;"));
  const s = state();
  s.kit.preview.tailwind = false;
  assert.ok(frameCsp(s).includes("script-src 'unsafe-inline';"));

  s.kit.preview.js = 'const a = "</script><script>alert(1)</script>";\nthrow new Error("line 2");';
  s.kit.inline = { text: "</script><!--  " };
  s.kit.preview.html = '<b title="</script>">x</b>';
  const doc = frameDocument(s, { bg: "#3b82f6", radius: 4, pad_x: 12, weight: "font-normal", shadow: false });
  // Exactly two script elements end: the bridge and view.js (no Tailwind here). Agent text ends none of them early.
  assert.equal(doc.match(/<\/script/gi)!.length, 2);
  assert.ok(!doc.includes("<!--"));
  // The line of view.js that the bridge reports is the line in the agent's own text.
  const jsLine = Number(/"jsLine":(\d+)/.exec(doc)![1]);
  assert.equal(doc.split("\n")[jsLine + 1], 'throw new Error("line 2");');
});
