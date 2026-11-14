// The kit reference that the kit_reference tool returns: the format of a preview playground and four worked examples.
// The examples are real specs: lib/spec.test.ts checks that they pass parseSpec(), so the reference cannot drift from the validator.
import { KIT_LIMITS } from "./kit.ts";
import { WEB_LIMITS } from "./web.ts";
import type { Spec } from "./spec.ts";

export const BUTTON_EXAMPLE: Spec = {
  id: "signup-button",
  title: "How should the signup button look?",
  notes: "Your button from src/SignupButton.tsx, with Acme's brand colours. Move the controls until it looks right, then press Settle.",
  data: { brand: { domain: "acme.com" } },
  controls: [
    { id: "bg", type: "color", label: "Background", meaning: "background colour of the button (bg-[...])", initial: "#3b82f6", palette: "brand" },
    { id: "radius", type: "slider", label: "Corner radius", meaning: "border-radius of the button in px (rounded-[...px])", min: 0, max: 24, step: 1, initial: 4, unit: "px" },
    { id: "pad_x", type: "slider", label: "Horizontal padding", meaning: "left and right padding in px (px-[...px])", min: 8, max: 40, step: 2, initial: 12, unit: "px" },
    { id: "weight", type: "select", label: "Text weight", meaning: "font weight class of the label", initial: "font-normal", options: [{ value: "font-normal", label: "Normal" }, { value: "font-medium", label: "Medium" }, { value: "font-semibold", label: "Semibold" }] },
    { id: "shadow", type: "toggle", label: "Shadow", meaning: "whether the button has shadow-md", initial: false, on: "shadow-md", off: "" },
  ],
  view: {
    type: "preview",
    tailwind: true,
    height: 240,
    html: '<div class="flex h-full min-h-[240px] items-center justify-center bg-white">\n  <button class="bg-[{{bg}}] rounded-[{{radius}}px] px-[{{pad_x}}px] py-2 text-sm text-white {{weight}} {{shadow}}">Sign up</button>\n</div>',
  },
  outputs: [{ id: "class_name", label: "className of the button in src/SignupButton.tsx", template: "bg-[{{bg}}] rounded-[{{radius}}px] px-[{{pad_x}}px] py-2 text-sm text-white {{weight}} {{shadow}}" }],
};

export const SPRING_EXAMPLE: Spec = {
  id: "card-snap-back",
  title: "How should the card snap back?",
  notes: "Drag the card and let go. The spring is the one from src/Card.tsx.",
  controls: [
    { id: "stiffness", type: "slider", label: "Stiffness", meaning: "spring stiffness (SPRING.stiffness in src/Card.tsx)", min: 20, max: 600, step: 10, initial: 120 },
    { id: "damping", type: "slider", label: "Damping", meaning: "spring damping (SPRING.damping)", min: 2, max: 60, step: 1, initial: 26 },
    { id: "mass", type: "slider", label: "Mass", meaning: "spring mass (SPRING.mass)", min: 0.2, max: 4, step: 0.1, initial: 1 },
  ],
  view: {
    type: "preview",
    height: 300,
    html: '<div class="stage"><div id="card" class="card">Drag me</div></div>',
    css: ".stage { height: 300px; display: grid; place-items: center; background: #f4f4f5; overflow: hidden; }\n.card { width: 160px; height: 100px; display: grid; place-items: center; border-radius: 14px; background: white; box-shadow: 0 8px 24px rgb(0 0 0 / 0.15); cursor: grab; user-select: none; touch-action: none; }",
    js: [
      'const card = document.getElementById("card");',
      "let x = 0, v = 0, dragging = false, grab = 0, last = performance.now();",
      'card.addEventListener("pointerdown", (e) => { dragging = true; grab = e.clientX - x; v = 0; card.setPointerCapture(e.pointerId); });',
      'card.addEventListener("pointermove", (e) => { if (dragging) x = e.clientX - grab; });',
      'card.addEventListener("pointerup", () => { dragging = false; });',
      "function frame(now) {",
      "  const dt = Math.min(0.032, (now - last) / 1000);",
      "  last = now;",
      "  if (!dragging) {",
      "    // The same spring equation as the real code, read from the controls on every frame.",
      "    const { stiffness, damping, mass } = clay.values;",
      "    v += ((-stiffness * x - damping * v) / mass) * dt;",
      "    x += v * dt;",
      "  }",
      "  card.style.transform = `translateX(${x}px)`;",
      "  requestAnimationFrame(frame);",
      "}",
      "requestAnimationFrame(frame);",
    ].join("\n"),
  },
  outputs: [{ id: "spring", label: "const SPRING in src/Card.tsx", template: "{ stiffness: {{stiffness}}, damping: {{damping}}, mass: {{mass}} }" }],
};

export const MODEL_EXAMPLE: Spec = {
  id: "agent-model-choice",
  title: "Which model should the coding agent run on?",
  notes: "The question was whether the team's coding agent is on the right model. Tokens, time and pass rate per task are the team's own measurements (bench.json); the prices per million tokens are read live from the providers' pricing pages. Set your volume and limits, then choose a model.",
  data: {
    inline: {
      measured: "bench.json: 12 hard tasks, 2 repeats per model, measured by the team on 2026-11-14. Every model passed all 20 runs of the 10 easy tasks, so those are left out: tokens, time and pass rate are per hard task.",
      limits: "Each pass rate is from 24 runs: a gap of one or two tasks between two models is within the noise.",
      models: [
        { model: "claude-opus-5-5", hard_pass_rate: 1, median_seconds: 22.1, input_tokens_per_task: 67169, cached_input_tokens_per_task: 60546, output_tokens_per_task: 2360 },
        { model: "claude-sonnet-5-5", hard_pass_rate: 0.96, median_seconds: 11.1, input_tokens_per_task: 57201, cached_input_tokens_per_task: 51478, output_tokens_per_task: 1690 },
        { model: "gpt-6-luna", hard_pass_rate: 0.71, median_seconds: 21.6, input_tokens_per_task: 78673, cached_input_tokens_per_task: 68115, output_tokens_per_task: 1032 },
      ],
    },
    web: [
      { id: "anthropic", url: "https://docs.anthropic.com/en/docs/about-claude/pricing", rows: { describe: "one row per Claude model of the API", fields: [{ id: "model", type: "text", describe: "model name, for example Claude Opus 5.5" }, { id: "input", type: "number", unit: "USD per 1M tokens", describe: "price of input tokens per million tokens (base input, not batch)" }, { id: "cached_input", type: "number", unit: "USD per 1M tokens", describe: "price of cached input tokens per million (cache read, cache hit)" }, { id: "output", type: "number", unit: "USD per 1M tokens", describe: "price of output tokens per million tokens" }] } },
      { id: "openai", url: "https://platform.openai.com/docs/pricing", rows: { describe: "one row per text model of the API", fields: [{ id: "model", type: "text", describe: "model name, for example GPT-6 Luna" }, { id: "input", type: "number", unit: "USD per 1M tokens", describe: "price of input tokens per million tokens" }, { id: "cached_input", type: "number", unit: "USD per 1M tokens", describe: "price of cached input tokens per million" }, { id: "output", type: "number", unit: "USD per 1M tokens", describe: "price of output tokens per million tokens" }] } },
    ],
  },
  controls: [
    { id: "tasks", type: "slider", label: "Hard tasks per month", meaning: "how many hard agent tasks the team runs per month", min: 100, max: 20000, step: 100, initial: 2000 },
    { id: "cached_share", type: "slider", label: "Cached input that hits the cache", meaning: "share of the measured cached input tokens that is billed at the cached price", min: 0, max: 100, step: 5, initial: 100, unit: "%" },
    { id: "max_seconds", type: "slider", label: "Time limit per task", meaning: "longest median time per task the team accepts", min: 5, max: 60, step: 1, initial: 30, unit: "s" },
    { id: "min_pass", type: "slider", label: "Minimum pass rate on the hard tasks", meaning: "lowest pass rate on the hard tasks the team accepts", min: 50, max: 100, step: 1, initial: 90, unit: "%" },
    { id: "model", type: "select", label: "Model to use", meaning: "the model written into agent.config.json", initial: "claude-opus-5-5", options: [{ value: "claude-opus-5-5" }, { value: "claude-sonnet-5-5" }, { value: "gpt-6-luna" }] },
  ],
  view: {
    type: "preview",
    // A data view: Clay's typeface, colours and parts. The markup uses the parts and there is no view.css at all.
    data: true,
    height: 340,
    html: `<p class="lead" id="answer"></p>
<p id="chosen"></p>
<table class="stack">
  <thead><tr><th>Model</th><th class="num">Pass rate, hard tasks</th><th class="num">Median time</th><th class="num">Per passed hard task</th><th class="num">Per month</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<p class="note" id="limits"></p>
<details><summary>How the numbers are made</summary><p id="rule"></p></details>`,
    js: `const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const rows = [...clay.data.web.anthropic, ...clay.data.web.openai];
// Join a measured model to its price row by name. No row, or a missing price, is unknown: never 0.
const price = (model) => rows.find((r) => r.model && norm(r.model) === norm(model)) || null;
const usd = (n) => (n == null ? "unknown" : "$" + n.toFixed(n < 1 ? 3 : 2));
const el = (id) => document.getElementById(id);
const body = el("rows");
// One cell. data-label names its column when the table is one card per row on a phone (class "stack").
const cell = (tr, label, text, cls) => { const td = tr.appendChild(document.createElement("td")); if (label) td.dataset.label = label; if (cls) td.className = cls; td.textContent = text; return td; };
const badge = (td, text, cls) => { const b = td.appendChild(document.createElement("span")); b.className = "badge " + cls; b.textContent = text; };
clay.onChange((v) => {
  const list = clay.data.inline.models.map((m) => {
    const p = price(m.model);
    const cached = m.cached_input_tokens_per_task * (v.cached_share / 100);
    const fresh = m.input_tokens_per_task - cached;
    // Cached input has its own price. When the page does not state it, the cost is unknown, not cheaper.
    const known = p && p.input != null && p.output != null && (cached === 0 || p.cached_input != null);
    const perTask = known ? (fresh * p.input + cached * (p.cached_input || 0) + m.output_tokens_per_task * p.output) / 1e6 : null;
    // The limit is tested on the hard tasks: every model passes the easy ones, so a rate blended with them would hide the difference.
    const ok = m.hard_pass_rate * 100 >= v.min_pass && m.median_seconds <= v.max_seconds;
    // A failed task is paid for too, so models are compared on the cost per passed task. Cost and pass rate are of the same tasks.
    const perPassed = perTask == null || !m.hard_pass_rate ? null : perTask / m.hard_pass_rate;
    return { m, ok, perTask, perPassed };
  });
  // The pick: the cheapest per passed task among the models inside the limits. A model outside them, or with an unknown cost, is never the pick.
  const pick = list.filter((r) => r.ok && r.perPassed != null).sort((a, b) => a.perPassed - b.perPassed)[0];
  const month = (r) => usd(r.perTask == null ? null : r.perTask * v.tasks);
  // The answer first: one sentence that changes with the controls. Under it the rule behind it, with its numbers, and
  // the person's own choice.
  // The sentence names the measure of the mark and gives its number first (cost per passed task), then the bill: a
  // model with a lower bill and more failed tasks is not "cheaper".
  el("answer").textContent = pick ? pick.m.model + " costs the least per passed hard task inside your limits: " + usd(pick.perPassed) + ", " + month(pick) + " a month." : "No model inside your limits has a known price.";
  const own = list.find((r) => r.m.model === v.model);
  el("chosen").textContent = "Your limits: at least " + v.min_pass + "% of the hard tasks passed, within " + v.max_seconds + " s per task." + (!own ? "" : own === pick ? " It is the model you chose." : " You chose " + own.m.model + ": " + month(own) + " a month" + (own.ok ? "." : ", outside your limits."));
  body.textContent = "";
  for (const r of list) {
    const tr = body.appendChild(document.createElement("tr"));
    // .pick: the model the person chose (the select). .out: outside their limits. The mark of the rule is a badge.
    tr.className = (r.m.model === v.model ? "pick " : "") + (r.ok ? "" : "out");
    const name = cell(tr, "", r.m.model + " ");
    if (r === pick) badge(name, "Least per passed task inside your limits", "ok");
    if (!r.ok) badge(name, "Outside your limits", "warn");
    cell(tr, "Pass rate, hard tasks", Math.round(r.m.hard_pass_rate * 100) + "%", "num");
    cell(tr, "Median time", r.m.median_seconds + " s", "num");
    cell(tr, "Per passed hard task", usd(r.perPassed), "num");
    cell(tr, "Per month", month(r), "num");
  }
  // What the numbers cannot support stays in view, in one line. How the numbers are made is one click away.
  el("limits").textContent = clay.data.inline.limits;
  el("rule").textContent = "The mark goes to the lowest cost per passed hard task among the models inside your limits; a model with an unknown price is left out. Cost per task: the measured tokens times the prices read from the providers' pages, with " + v.cached_share + "% of the cached input at the cached price. Cost per passed task: that cost divided by the pass rate, because a failed task is paid for too.";
});`,
  },
  outputs: [
    { id: "config", label: "\"model\" in agent.config.json", template: '"model": "{{model}}"' },
    { id: "rule", label: "The rule behind the choice, in words", template: "Use {{model}} while it passes at least {{min_pass}}% of the hard tasks within {{max_seconds}} s, at {{tasks}} hard tasks per month with {{cached_share}}% of the cached input billed at the cached price." },
  ],
};

/**
 * A "where" decision on a map. The coordinates are real: OpenStreetMap data, looked up by place name with Nominatim on
 * 2026-11-14 (Otaniemi, Espoo). Distances are straight lines from the metro station, computed in view.js.
 */
export const MAP_EXAMPLE: Spec = {
  id: "otaniemi-meeting-place",
  title: "Where in Otaniemi should the team meet?",
  notes: "We told our agent: we arrive by metro, where should we meet, and how far are we willing to walk? Places and coordinates: OpenStreetMap data, looked up by name on 2026-11-14. Distances are straight lines from the Aalto University metro station, not walking routes.",
  data: {
    inline: {
      start: { name: "Aalto University metro station", lat: 60.18446, lng: 24.82357 },
      places: [
        { name: "A Bloc", lat: 60.18486, lng: 24.82504 },
        { name: "Väre", lat: 60.18563, lng: 24.82506 },
        { name: "Harald Herlin Learning Centre", lat: 60.1847, lng: 24.82805 },
        { name: "Undergraduate Centre", lat: 60.18609, lng: 24.82961 },
        { name: "Dipoli", lat: 60.18513, lng: 24.83249 },
        { name: "Otahalli", lat: 60.18427, lng: 24.83509 },
      ],
    },
  },
  controls: [
    { id: "radius", type: "slider", label: "Walking radius", meaning: "how far from the metro station the meeting place may be, in metres (straight line)", min: 100, max: 800, step: 50, initial: 400, unit: "m" },
    { id: "place", type: "select", label: "Meeting place", meaning: "the place the team meets at", initial: "A Bloc", options: [{ value: "A Bloc" }, { value: "Väre" }, { value: "Harald Herlin Learning Centre" }, { value: "Undergraduate Centre" }, { value: "Dipoli" }, { value: "Otahalli" }] },
  ],
  view: {
    type: "preview",
    map: true,
    height: 470,
    html: `<div class="wrap">
  <div id="map" role="application" aria-label="Map of Otaniemi with the candidate meeting places"></div>
  <p id="inside"></p>
</div>`,
    css: `.wrap { padding: 12px; font: 14px/1.45 system-ui, sans-serif; color: #1f2937; }
#map { height: 360px; border-radius: 10px; border: 1px solid #d1d5db; }
#inside { margin: 10px 2px 0; }`,
    js: `const start = clay.data.inline.start;
const places = clay.data.inline.places;
// Names go onto the map as text nodes, never as markup strings.
const text = (s) => document.createTextNode(String(s));
// The map starts on an area that shows every place, whatever the width of the preview.
const map = clay.map(document.getElementById("map"), { bounds: places.concat([start]).map((p) => [p.lat, p.lng]), maxZoom: 15 });
L.circleMarker([start.lat, start.lng], { radius: 6, color: "#111827", fillColor: "#111827", fillOpacity: 1 }).addTo(map).bindTooltip(text(start.name));
const circle = L.circle([start.lat, start.lng], { radius: clay.values.radius, color: "#2563eb", weight: 2, fillOpacity: 0.06 }).addTo(map);
const marks = places.map((p) => ({
  p,
  metres: Math.round(map.distance([start.lat, start.lng], [p.lat, p.lng])),
  dot: L.circleMarker([p.lat, p.lng], { radius: 8, weight: 2 }).addTo(map),
}));
// On a wide map every place keeps its label. On a narrow one (a phone) the labels would cover each other: only the
// picked place keeps its label there, and a tap on another place shows that one's.
const wide = document.getElementById("map").clientWidth >= 480;
let labelled = null;
const line = document.getElementById("inside");
clay.onChange((v) => {
  circle.setRadius(v.radius);
  const inside = [];
  for (const x of marks) {
    const within = x.metres <= v.radius;
    const picked = x.p.name === v.place;
    const colour = picked ? "#dc2626" : "#2563eb";
    x.dot.setStyle({ color: colour, fillColor: colour, opacity: within ? 1 : 0.35, fillOpacity: within ? 0.9 : 0.12 });
    x.dot.setRadius(picked ? 11 : 8);
    // Labels are bound again only when the pick changes, not on every step of the radius.
    if (v.place !== labelled) x.dot.unbindTooltip().bindTooltip(text(x.p.name), { permanent: wide || picked, direction: "top", offset: [0, -8] });
    if (within) inside.push(x.p.name + " (" + x.metres + " m)");
  }
  labelled = v.place;
  const pick = marks.find((x) => x.p.name === v.place);
  line.textContent =
    (inside.length ? "Within " + v.radius + " m of the station: " + inside.join(", ") + "." : "No place is within " + v.radius + " m of the station.") +
    (pick && pick.metres > v.radius ? " Your pick, " + pick.p.name + ", is " + pick.metres + " m away: outside the radius." : "");
});`,
  },
  outputs: [{ id: "decision", label: "The decision, in words", template: "We meet at {{place}}. The meeting place must be within {{radius}} m (straight line) of the Aalto University metro station." }],
};

export const KIT_REFERENCE = `# Clay kit reference: preview playgrounds

A preview playground has four parts. You compose them; Clay validates the composition before it builds anything.

## 1. Controls (only these four types; each control means one thing)
- slider: {id, type: "slider", label, meaning, min, max, step (default 1), initial, unit?}. Value: a number.
- toggle: {id, type: "toggle", label, meaning, initial: true|false, on?, off?}. Value: a boolean in view.js; in a template {{id}} becomes the text "on" or "off" you gave (for example on "shadow-md", off "").
- select: {id, type: "select", label, meaning, options: [{value, label?}], initial}. Value: the option's value, for example a Tailwind class.
- color: {id, type: "color", label, meaning, initial: "#rrggbb", palette?: "brand" | ["#rrggbb", ...], free?: true}. Value: "#rrggbb".
Limits: 1 to ${KIT_LIMITS.controls} controls. initial must lie in the range and on the step grid. Every control must be used by the preview or by an output.

Good controls: the 3 to 6 dimensions behind THIS person's complaint, not every property. initial is the value in their code now, so the page opens on what they have. Ranges sit around that value (about half to double), not around everything possible. meaning names the property and where it lives in their code.

## 2. The preview (view.type "preview"): the real thing, running
- view.html: the real markup, copied from the person's file (JSX turned into plain HTML: className becomes class). Write {{control_id}} where a control value goes. On every move Clay updates only what changed, in place, so CSS transitions keep working. No script tags.
- view.css: plain CSS, {{control_id}} allowed.
- view.tailwind: true loads the in-browser Tailwind v4 build. Arbitrary values work: rounded-[{{radius}}px], bg-[{{bg}}], px-[{{pad}}px].
- view.map: true loads a map library (Leaflet 1.9, the global L) for a "where" question: which location, which radius, which area, which stop. Worked example 4 shows the whole of it.
  - clay.map(element, {bounds: [[lat, lng], ...], maxZoom?}) or clay.map(element, {center: [lat, lng], zoom}) returns the Leaflet map with its tiles (OpenStreetMap) and the attribution they require. bounds starts on an area that shows all your points at any width. Always make the map with it: no other tile layer or image host loads. Give the element a height in view.css.
  - Draw with L.circleMarker, L.circle, L.polyline, L.polygon and L.marker (its pin is built in). No other marker image and no layers control: their image files do not load. Bind the map to the controls in clay.onChange: move, restyle or filter what is drawn; map.setView or map.fitBounds only when a control asks for another area.
  - Coordinates come from you: data.inline (the person's places with lat and lng, and where you got them, in notes) or number fields of data.web. Clay has no geocoding or routing: map.distance(a, b) is a straight line in metres, so say "straight line" on the page.
  - Text on the map: bindPopup, bindTooltip, openPopup, openTooltip and setContent (and the content option of L.popup and L.tooltip) build markup from a string. Pass a text node or an element instead: marker.bindTooltip(document.createTextNode(place.name)). The rule for web and brand text below applies to them as to innerHTML.
  - The person's page scroll stays free: the wheel does not zoom the map, and on a phone one finger scrolls the page while two fingers move the map and the + and - buttons zoom it. So start on the area that matters: give clay.map the bounds of your points.
- view.data: true makes the preview a data view: the frame has Clay's typeface, colours and parts (table, cards, badge, note), and the page shows it as part of itself, with no artboard around it. Set it for every preview that shows data and not the person's own component: a comparison, a ranking, a table of facts, anything built on data.web. "A data view" below has the parts and the layout; worked example 3 is one. Not together with view.tailwind.
- view.js: runs once, after the html is in the page. Use it for what markup cannot show: motion, dragging, timing.
  - clay.values.<id>: the value now. Read it inside your animation loop or event handler, so a move takes effect at once.
  - clay.onChange((values) => { ... }): runs at once and after every move.
  - clay.data.brand: {domain, title, colors: [{hex, name}], logos: [{url, mode, type}]} when the spec has data.brand. clay.data.inline: your data.inline.
- The sandbox: the preview runs in a frame that cannot read the page around it, the person's Clay session or other sites, with no imports (view.tailwind and view.map load the only two libraries), no forms, no popups and no storage. It is not sealed from the network: browsers do not block every outgoing request from running code (resource hints, for example), and every visitor's page says so. Never send data anywhere from view.js; the preview must work with no network. <link>, <meta>, <base>, <iframe>, <object> and <embed> are refused in view.html, and Clay blocks creating them from view.js on a best-effort basis (do not try); put styles in view.css or style attributes. Images: data: URLs, or the brand's logo URLs from clay.data.brand.logos. A library the real code uses (Framer Motion, react-spring, GSAP) cannot be loaded: write the same behaviour in a few lines of plain JavaScript, with the same parameters, so that the settled values mean the same in the real code. Say so in notes when the match is approximate.
- Size: html ${KIT_LIMITS.html}, css ${KIT_LIMITS.css}, js ${KIT_LIMITS.js} characters. view.height: 120 to 900 px.
- Every control must change something the person can see at the start values: the preview or an output. A control that only matters once another control is switched (an accent colour used only by a badge that starts hidden) looks broken when the person moves it first. Start in a state that shows it, or fold it into the control it depends on (the options of that control carry the colour).
- Width: the preview is as wide as the page gives it. On a desktop that is 700 px or more; on a phone it is the screen width minus about 42 px, so as narrow as 320 px. Show the artifact at its real size, but never let it force a horizontal scroll: do not copy a fixed width (width: 420px) onto the outermost element; use max-width: 100% with the real width, centre it, and let a wide layout wrap or scroll inside its own box (overflow-x: auto).

## 3. Data (each source keeps its origin on the page)
- data.brand: {domain}. Clay reads the brand's colours and logos live with Context.dev (about 10 to 30 seconds once). Use it whenever the person names a brand or a site; do not write brand colours from memory.
- data.inline: values you supply: the person's own numbers (measurements from their files, their current settings). The page shows them as "provided by your agent, not checked", so say in notes or in the preview where they come from (the file, the date).
- data.web: live facts from web pages, [{id, url | domain + find, fields | rows}], up to ${WEB_LIMITS.sources} sources. Clay reads each page with Context.dev when the playground is built, and again on recheck_playground.
  - The page: give url, the exact page that states the facts (a provider's pricing table in its docs, not its home page or a blog post), whenever you know it. domain + find lets search pick a page of the site; search often lands on a news post or a help article, so use it only when you do not know the page, and check what was read.
  - fields: single facts of a page, [{id, type: "number" | "text" | "boolean", unit?, describe}], up to ${WEB_LIMITS.fields}. rows: a table, {describe: what one row is, fields: [...]}, up to ${WEB_LIMITS.rows} rows; make the first text field the row's name.
  - describe says what the page calls the fact, with synonyms and the unit. Ask for numbers as the page states them (a price per 1M tokens, per hour, per seat) and do the arithmetic in view.js.
  - view.js reads clay.data.web.<id>: an object of the fields, or a list of the rows. A value is null when the page does not state it, when the page could not be read, or when the number that was extracted is not in the page text (it is quarantined: Clay never passes on a number it cannot find on the page). Handle null in your code: show "unknown" and leave that row out of sums and rankings. Never let null become 0.
  - Text from clay.data.web and clay.data.brand (a row name, a text field, a brand title or colour name) is copied from web pages, and a page can change it to markup. Put it into the page as text: el.textContent = value, or document.createTextNode(value). Never build markup from it: no innerHTML, outerHTML or insertAdjacentHTML with a string that holds it. A preview that uses one of those three with web or brand data gets a warning in problems.
  - Joins: when you join your own names to page rows (a model id from a measurements file to a pricing row), compare normalised names and show a row without a match as unknown. After the build, read the result: it lists the rows that were read, so check that every name you join on is there, and repair the source (the exact url, a better describe) when it is not.
  - A pick: when view.js marks or recommends one option, write the rule that makes the pick on the page, in words with its numbers, and apply it to the measure that decides for this person: the hard or realistic cases of their measurements, not a rate blended with easy cases that every option passes. An option outside the person's limits, or with an unknown cost, is never the pick. When options fail at different rates, compare the cost per passed task. Every assumption that moves the result a lot is a control, not a constant in the code (the share of input billed at the cached price, a retry rate, growth). Say on the page what the numbers cannot support (few runs, disputed results, a missing price).
  - The page lists every source with its link, the read time, every value and what was quarantined, so the person can check any number.
  - When to use it instead of a price playground (view.type "price_ranking"): when the comparison needs a dimension the price engine does not have (which GPU, which model), when the person's own numbers must be multiplied in (tokens per task, hours per job, seats), or when the question needs one or two facts of a page. The price engine is for "which vendor or plan of one usage-priced product" with plans, included quantities and overage.
  - Staying live: recheck_playground reads the pages again and reports the facts that changed (two fresh reads must agree). read_playground returns web_changes: what changed since the person settled. You judge whether the settled result still holds, with the settled values and the new facts, and tell the person or send them back to the page.

## A data view (view.data: true): how a page of data must look
A page of data that an agent styles by hand comes out in a typeface, sizes and colours that match nothing: not the page around it, not the next playground. So do not style it. Set view.data: true, write view.html with the parts below, and leave view.css out (a few lines at most, for a layout the parts do not cover). A build result lists a preview that does otherwise under problems.

The parts (class names):
- p.lead: the answer, one sentence, first on the page. It changes with the controls.
- table with th and td. Class "num" on a th or td of numbers: right-aligned, and a number in a td stays on one line (so "num" is for a number with its unit, not for a phrase); a th may wrap. tr.pick: the option the person chose (the value of their select). tr.out: an option outside their limits. Class "stack" on the table and data-label="<column name>" on each td: on a phone every row is then a card of its own. A table that must stay a table on a phone goes in <div class="scroll">.
- div.cards with div.card in it, an h3 for the name of each: one card per option, when an option has more to say than a row holds. .card.pick and .card.out as for rows.
- span.badge, plain or with "ok", "warn", "bad" or "pick": a mark next to a name ("Cheapest inside your limits").
- div.stat: one number with its label, <div class="stat"><span>Per month</span><b>$218</b></div>.
- dl.kv: label and value pairs, <dt>Price per hour</dt><dd>$1.09</dd>.
- p.note, and p.note.warn: what the numbers cannot support, in two or three lines.
- span.bar with style="--v: 73%": a share of a whole.
- details with a summary: the long part, closed until the person opens it.
- Text: .muted, .small (13 px), and .ok, .warn, .bad for a word in that colour. h2 names a section, h3 is a small label. Where you must name a colour: var(--ink), var(--muted), var(--line), var(--field), var(--accent), var(--ok), var(--warn), var(--bad), and --accent-bg, --ok-bg, --warn-bg, --bad-bg behind them.

The layout, from the top:
1. The answer: one p.lead sentence. Under it at most one more sentence: the rule behind the answer with its numbers, and the person's own choice.
2. The comparison: ONE table or ONE set of cards, never both, with one row or card per option. A table has at most 5 columns, one number per cell, and the unit in the column head.
3. What the numbers cannot support: one p.note of at most three lines.
4. Everything else in one <details>: how the numbers are made, the method, every further caveat.

The rules:
- The preview is not a document. Outside <details>, keep the text under about 600 characters at the start values. Do not repeat notes (the page shows it above the preview). Do not list the sources, their read times or their rows: the page lists them under "Where the data comes from".
- No typeface, no font shorthand, no text under 12 px, and no colours of your own; a brand colour or a series of a chart is data and may stay. No borders, shadows or backgrounds on boxes of your own: use .card.
- One meaning per mark, the same on the whole page: .pick is the person's choice, .out is outside their limits, and a badge says why.
- Blocks need no margins: the top-level blocks, and the blocks inside a card, a note and a details, keep their distance by themselves.
- It must read at 320 px: table.stack or cards, never a fixed width.
- The id of a data.web field is its column head under "Where the data comes from", with _ shown as a space: write ids as words (price_per_hour, not pph).

## 4. Outputs: what comes back to you
outputs: [{id, label, template}]. The template is the final text with {{control_id}} placeholders: the class string, the config object, the CSS rule, in the exact form of the person's file. In an output, the text of a toggle (on, off) or of a select option may itself contain {{other_control}}, and it is filled too: a piece of markup that is there or not, with a colour inside it, comes back complete. Never leave a marker word in an output for you to replace later: the person sees the outputs, and they must be the final code. The page shows the outputs live as "What goes back to your agent". When the person presses Settle, read_playground returns them rendered. Paste them; do not re-derive them from the values.

Outputs can hold only control values, not what view.js computes. So when the person must choose among things the preview compares (a model, a GPU, a plan), give them a select for the choice and return it, with the numbers they set, as a config line and as a rule in words that you can carry out.

## The loop
1. Read the person's real file. 2. create_playground. Fix every validation error it lists and call again. 3. Give the person the URL: "move the controls until it is right, then press Settle". The preview code is unverified until the page is opened. 4. When they say they are done, read_playground: it returns settled.outputs, the path they took per control, and the preview status. If the preview failed, the error is there: repair with revise_playground and ask them to reload. 5. Write the settled outputs into their file.

## Worked example 1: a Tailwind button, colours from the brand
The person: "this signup button looks off, our brand is acme.com". Their file has <button className="bg-[#3b82f6] rounded-[4px] px-[12px] py-2 text-sm text-white font-normal">Sign up</button>.
${JSON.stringify(BUTTON_EXAMPLE, null, 1)}

## Worked example 3: live web facts times the person's own measurements
The person: "we run a coding agent for our team and I have no idea if we're on the right model. bench.json has what we measured." Their agent.config.json has "model": "claude-opus-5-5". Per-token prices alone do not answer this: each model uses a different number of tokens per task and passes a different share of tasks. So the measurements go in data.inline, the prices come live from data.web, and view.js multiplies them. The page marks a pick, so it follows the rules for a pick: the limit is tested on the hard tasks (every model passes the easy ones), models are compared on the cost per passed task with cost and pass rate from the same tasks, the share of cached input is a control because it moves the cost a lot, and the rule and the size of the sample are written on the page. It is a data view (view.data: true), in the layout of "A data view": the answer in one p.lead sentence, the rule with its numbers under it, one table.stack with the person's choice as tr.pick and the mark of the rule as a badge, one p.note for what the sample cannot support, and how the numbers are made in a details. It has no view.css.
${JSON.stringify(MODEL_EXAMPLE, null, 1)}

## Worked example 4: a "where" decision on a map
The person: "we arrive by metro in Otaniemi. where should the team meet, and how far are we willing to walk?" The places are theirs (data.inline, with real coordinates and their origin in notes). The slider is the radius circle, which also dims the places outside it; the select is the place they pick, drawn larger and red; the output is the decision in words. Names go onto the map as text nodes.
${JSON.stringify(MAP_EXAMPLE, null, 1)}

## Worked example 2: spring physics, tuned by feel
The person: "the card snap-back feels dead". Their file has const SPRING = { stiffness: 120, damping: 26, mass: 1 }.
${JSON.stringify(SPRING_EXAMPLE, null, 1)}
`;
