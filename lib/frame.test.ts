import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { BRIDGE_PURE, frameCsp, frameDocument, fromFrame, LEAFLET, limiter, requestOrigin, TAILWIND, tileOf, tilePathOf, TILES } from "./frame.ts";
import type { KitState } from "./kit.ts";
import { BUTTON_EXAMPLE, MAP_EXAMPLE } from "./reference.ts";
import { parseSpec } from "./spec.ts";

const state = (over: Partial<KitState> = {}): KitState => {
  const r = parseSpec(BUTTON_EXAMPLE);
  assert.ok(r.ok && r.kind === "preview");
  return { kit: r.kit, brandData: null, brandError: null, preview: { status: "unverified", error: null, at: null }, settled: null, exploration: null, ...over };
};

test("page side of the bridge: only the two known message shapes pass, and the kept text is bounded", () => {
  assert.deepEqual(fromFrame({ clay: 1, type: "ready" }), { type: "ready" });
  // The content height: a bounded number, nothing else.
  assert.deepEqual(fromFrame({ clay: 1, type: "height", height: 520.4 }), { type: "height", height: 520 });
  for (const height of [0, -5, 4001, Infinity, NaN, "520", null]) assert.equal(fromFrame({ clay: 1, type: "height", height }), null);
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

test("a map preview may load the pinned map library and tiles from this app's tile path; every other preview keeps its policy to the letter", () => {
  // The policy of a preview without a map, as it was before maps existed (the Tailwind button example), written out.
  const before = `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${TAILWIND.url}; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`;
  const site = "https://clay.example";
  assert.equal(frameCsp(state()), before);
  // The app's address changes nothing for a preview without a map.
  assert.equal(frameCsp(state(), site), before);
  // A stored kit from before maps has no `map` at all, and one with map: false is the same.
  const off = state();
  (off.kit.preview as { map?: boolean }).map = false;
  assert.equal(frameCsp(off, site), before);
  const plain = frameDocument(state(), { bg: "#3b82f6", radius: 4, pad_x: 12, weight: "font-normal", shadow: false }, site);
  assert.ok(!plain.includes("leaflet") && !plain.includes("/api/tiles") && plain.includes('"map":null'));

  const r = parseSpec(MAP_EXAMPLE);
  assert.ok(r.ok && r.kind === "preview" && r.kit.preview.map === true);
  const map: KitState = { ...state(), kit: r.kit };
  // With a map: the library's script and stylesheet by their exact URLs, and exactly one image source, the tile path.
  assert.equal(
    frameCsp(map, site),
    `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${LEAFLET.js.url}; style-src 'unsafe-inline' ${LEAFLET.css.url}; img-src data: https://clay.example/api/tiles/; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'`,
  );
  // The brand's logo hosts stay; the tile path is added after them. No outside tile host is in the policy.
  const withLogo = frameCsp({ ...map, brandData: { domain: "acme.com", title: "", colors: [], logos: [{ url: "https://media.example-cdn.com/a/logo.svg", mode: "light", type: "logo" }], fetchedAt: "", source: "context.dev brand" } }, site);
  assert.ok(withLogo.includes("img-src data: https://media.example-cdn.com https://clay.example/api/tiles/;"));
  assert.ok(!frameCsp(map, site).includes("openstreetmap"));
  const doc = frameDocument(map, { radius: 400, place: "A Bloc" }, site);
  // Both files are pinned by a content hash, and the tile layer of clay.map() is the frame's, with its attribution.
  assert.ok(doc.includes(`<link rel="stylesheet" href="${LEAFLET.css.url}" integrity="${LEAFLET.css.integrity}" crossorigin="anonymous"><script src="${LEAFLET.js.url}" integrity="${LEAFLET.js.integrity}" crossorigin="anonymous"></script>`));
  assert.match(LEAFLET.js.integrity + LEAFLET.css.integrity, /^sha384-[A-Za-z0-9+/]{64}sha384-[A-Za-z0-9+/]{64}$/);
  assert.ok(doc.includes('"map":{"tiles":"https://clay.example/api/tiles/","url":"https://clay.example/api/tiles/{z}/{x}/{y}.png","attribution":'), "the tile layer of clay.map() is in the frame's configuration");
  // A map frame is ready when its scripts have run, not when every tile has loaded; another frame, at the load event as before.
  assert.ok(doc.includes('if (cfg.map) document.addEventListener("DOMContentLoaded"') && plain.includes('else window.addEventListener("load", function () { setTimeout(function () { post({ type: "ready" }); }, 0); });'));
  assert.match(doc, /"attribution":"[^"]*OpenStreetMap contributors","maxZoom":19\}/);
  assert.equal(TILES.attribution, "\u00a9 OpenStreetMap contributors");
});

test("the tile path of a map frame is on the host the browser asked for, and a header cannot add to the policy", () => {
  assert.equal(requestOrigin("http://localhost:3000/p/x/frame", "127.0.0.1:3000", null), "http://127.0.0.1:3000");
  assert.equal(requestOrigin("http://internal:3000/p/x/frame", "Clay-Steel-Nu.vercel.app", "https"), "https://clay-steel-nu.vercel.app");
  assert.equal(requestOrigin("https://clay.example/p/x/frame", null, null), "https://clay.example");
  // Anything but a host name with a port falls back to the request's own origin.
  for (const bad of ["evil.example; script-src *", "a b", "evil.example/path", "user@evil.example", "evil.example:99999999", "", "'self'", "*.example"]) assert.equal(requestOrigin("https://clay.example/p/x/frame", bad, "https"), "https://clay.example", bad);
  assert.equal(requestOrigin("https://clay.example/p/x/frame", "clay.example", "javascript"), "https://clay.example");
  // Behind a proxy, Host is the app's own address and X-Forwarded-Host is the one the browser used.
  assert.equal(requestOrigin("http://127.0.0.1:43117/p/x/frame", "127.0.0.1:43117", "https", "clay.example"), "https://clay.example");
  assert.equal(requestOrigin("http://127.0.0.1:43117/p/x/frame", "127.0.0.1:43117", "https", "clay.example, edge.internal"), "https://clay.example");
  assert.equal(requestOrigin("https://clay.example/p/x/frame", "clay.example", "https", "evil.example; img-src *"), "https://clay.example");
  // A forwarded value that is not a plain host name (an IPv6 literal here) leaves the Host header in force.
  assert.equal(requestOrigin("http://127.0.0.1:43117/p/x/frame", "clay.example", "https", "[2001:db8::1]:8443"), "https://clay.example");
});

test("the tile route serves tiles of the standard grid and nothing else", () => {
  assert.deepEqual(tileOf("15", "18642", "9477.png"), { z: 15, x: 18642, y: 9477 });
  assert.deepEqual(tileOf("0", "0", "0.png"), { z: 0, x: 0, y: 0 });
  // The route answers one spelling of a tile's address: this one, with no query.
  assert.equal(tilePathOf({ z: 15, x: 18642, y: 9477 }), "/api/tiles/15/18642/9477.png");
  assert.deepEqual(tileOf("19", "524287", "524287.png"), { z: 19, x: 524287, y: 524287 });
  // Outside the grid, beyond the deepest zoom, or not a tile address at all (a path, a query, another file type).
  for (const bad of [["20", "1", "1.png"], ["15", "32768", "1.png"], ["15", "1", "32768.png"], ["1", "2", "0.png"], ["15", "18642", "9477"], ["15", "18642", "9477.jpg"], ["-1", "0", "0.png"], ["1.0", "0", "0.png"], ["15", "../x", "1.png"], ["15", "18642", "9477.png?x=1"], ["15", "1e3", "1.png"], ["", "", ".png"], ["015", "1", "1.png"], ["15", "01", "1.png"], ["15", " 1", "1.png"], ["15", "1", "1.PNG"]]) assert.equal(tileOf(bad[0], bad[1], bad[2]), null, bad.join("/"));
});
