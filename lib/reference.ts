// The kit reference that the kit_reference tool returns: the format of a preview playground and three worked examples.
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
    height: 340,
    html: '<table><thead><tr><th>Model</th><th>Pass rate, hard tasks</th><th>Median time</th><th>Cost per hard task</th><th>Per passed hard task</th><th>Per month</th><th></th></tr></thead><tbody id="rows"></tbody></table><p id="rule"></p>',
    css: "table { border-collapse: collapse; font: 14px system-ui; margin: 16px; max-width: 100%; } th, td { text-align: left; padding: 6px 12px; border-bottom: 1px solid #e5e7eb; } tr.out td { color: #9ca3af; } tr.chosen td { font-weight: 600; background: #eff6ff; } #rule { font: 13px system-ui; color: #4b5563; margin: 0 16px 16px; }",
    js: `const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const rows = [...clay.data.web.anthropic, ...clay.data.web.openai];
// Join a measured model to its price row by name. No row, or a missing price, is unknown: never 0.
const price = (model) => rows.find((r) => r.model && norm(r.model) === norm(model)) || null;
const usd = (n) => (n == null ? "unknown" : "$" + n.toFixed(n < 1 ? 3 : 2));
const body = document.getElementById("rows");
const rule = document.getElementById("rule");
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
  body.textContent = "";
  for (const r of list) {
    const tr = document.createElement("tr");
    tr.className = (r.ok ? "" : "out ") + (r.m.model === v.model ? "chosen" : "");
    for (const t of [r.m.model, Math.round(r.m.hard_pass_rate * 100) + "%", r.m.median_seconds + " s", usd(r.perTask), usd(r.perPassed), usd(r.perTask == null ? null : r.perTask * v.tasks), !r.ok ? "outside your limits" : r === pick ? "cheapest inside your limits" : ""]) tr.appendChild(document.createElement("td")).textContent = t;
    body.appendChild(tr);
  }
  // The rule behind the mark and what the numbers cannot support, in words on the page.
  const how = "the lowest cost per passed hard task among the models that pass at least " + v.min_pass + "% of the hard tasks within " + v.max_seconds + " s; a model with an unknown price is left out";
  rule.textContent = (pick ? "Marked: " + how + ". " : "No model is marked. The mark goes to " + how + ". ") + clay.data.inline.limits;
});`,
  },
  outputs: [
    { id: "config", label: "\"model\" in agent.config.json", template: '"model": "{{model}}"' },
    { id: "rule", label: "The rule behind the choice, in words", template: "Use {{model}} while it passes at least {{min_pass}}% of the hard tasks within {{max_seconds}} s, at {{tasks}} hard tasks per month with {{cached_share}}% of the cached input billed at the cached price." },
  ],
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
- view.js: runs once, after the html is in the page. Use it for what markup cannot show: motion, dragging, timing.
  - clay.values.<id>: the value now. Read it inside your animation loop or event handler, so a move takes effect at once.
  - clay.onChange((values) => { ... }): runs at once and after every move.
  - clay.data.brand: {domain, title, colors: [{hex, name}], logos: [{url, mode, type}]} when the spec has data.brand. clay.data.inline: your data.inline.
- The sandbox: the preview runs in a frame that cannot read the page around it, the person's Clay session or other sites, with no imports, no forms, no popups and no storage. It is not sealed from the network: browsers do not block every outgoing request from running code (resource hints, for example), and every visitor's page says so. Never send data anywhere from view.js; the preview must work with no network. Images: data: URLs, or the brand's logo URLs from clay.data.brand.logos. A library the real code uses (Framer Motion, react-spring, GSAP) cannot be loaded: write the same behaviour in a few lines of plain JavaScript, with the same parameters, so that the settled values mean the same in the real code. Say so in notes when the match is approximate.
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
  - Joins: when you join your own names to page rows (a model id from a measurements file to a pricing row), compare normalised names and show a row without a match as unknown. After the build, read the result: it lists the rows that were read, so check that every name you join on is there, and repair the source (the exact url, a better describe) when it is not.
  - A pick: when view.js marks or recommends one option, write the rule that makes the pick on the page, in words with its numbers, and apply it to the measure that decides for this person: the hard or realistic cases of their measurements, not a rate blended with easy cases that every option passes. An option outside the person's limits, or with an unknown cost, is never the pick. When options fail at different rates, compare the cost per passed task. Every assumption that moves the result a lot is a control, not a constant in the code (the share of input billed at the cached price, a retry rate, growth). Say on the page what the numbers cannot support (few runs, disputed results, a missing price).
  - The page lists every source with its link, the read time, every value and what was quarantined, so the person can check any number.
  - When to use it instead of a price playground (view.type "price_ranking"): when the comparison needs a dimension the price engine does not have (which GPU, which model), when the person's own numbers must be multiplied in (tokens per task, hours per job, seats), or when the question needs one or two facts of a page. The price engine is for "which vendor or plan of one usage-priced product" with plans, included quantities and overage.
  - Staying live: recheck_playground reads the pages again and reports the facts that changed (two fresh reads must agree). read_playground returns web_changes: what changed since the person settled. You judge whether the settled result still holds, with the settled values and the new facts, and tell the person or send them back to the page.

## 4. Outputs: what comes back to you
outputs: [{id, label, template}]. The template is the final text with {{control_id}} placeholders: the class string, the config object, the CSS rule, in the exact form of the person's file. In an output, the text of a toggle (on, off) or of a select option may itself contain {{other_control}}, and it is filled too: a piece of markup that is there or not, with a colour inside it, comes back complete. Never leave a marker word in an output for you to replace later: the person sees the outputs, and they must be the final code. The page shows the outputs live as "What goes back to your agent". When the person presses Settle, read_playground returns them rendered. Paste them; do not re-derive them from the values.

Outputs can hold only control values, not what view.js computes. So when the person must choose among things the preview compares (a model, a GPU, a plan), give them a select for the choice and return it, with the numbers they set, as a config line and as a rule in words that you can carry out.

## The loop
1. Read the person's real file. 2. create_playground. Fix every validation error it lists and call again. 3. Give the person the URL: "move the controls until it is right, then press Settle". The preview code is unverified until the page is opened. 4. When they say they are done, read_playground: it returns settled.outputs, the path they took per control, and the preview status. If the preview failed, the error is there: repair with revise_playground and ask them to reload. 5. Write the settled outputs into their file.

## Worked example 1: a Tailwind button, colours from the brand
The person: "this signup button looks off, our brand is acme.com". Their file has <button className="bg-[#3b82f6] rounded-[4px] px-[12px] py-2 text-sm text-white font-normal">Sign up</button>.
${JSON.stringify(BUTTON_EXAMPLE, null, 1)}

## Worked example 3: live web facts times the person's own measurements
The person: "we run a coding agent for our team and I have no idea if we're on the right model. bench.json has what we measured." Their agent.config.json has "model": "claude-opus-5-5". Per-token prices alone do not answer this: each model uses a different number of tokens per task and passes a different share of tasks. So the measurements go in data.inline, the prices come live from data.web, and view.js multiplies them. The page marks a pick, so it follows the rules for a pick: the limit is tested on the hard tasks (every model passes the easy ones), models are compared on the cost per passed task with cost and pass rate from the same tasks, the share of cached input is a control because it moves the cost a lot, and the rule and the size of the sample are written under the table.
${JSON.stringify(MODEL_EXAMPLE, null, 1)}

## Worked example 2: spring physics, tuned by feel
The person: "the card snap-back feels dead". Their file has const SPRING = { stiffness: 120, damping: 26, mass: 1 }.
${JSON.stringify(SPRING_EXAMPLE, null, 1)}
`;
