// The kit reference that the kit_reference tool returns: the format of a preview playground and two worked examples.
// The examples are real specs: lib/spec.test.ts checks that they pass parseSpec(), so the reference cannot drift from the validator.
import { KIT_LIMITS } from "./kit.ts";
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
  - clay.fill("...{{id}}..."): fills a template with the values now.
- The sandbox: the preview runs in a frame with no network, no imports, no forms, no popups, no storage. Images: data: URLs, or the brand's logo URLs from clay.data.brand.logos. A library the real code uses (Framer Motion, react-spring, GSAP) cannot be loaded: write the same behaviour in a few lines of plain JavaScript, with the same parameters, so that the settled values mean the same in the real code. Say so in notes when the match is approximate.
- Size: html ${KIT_LIMITS.html}, css ${KIT_LIMITS.css}, js ${KIT_LIMITS.js} characters. view.height: 120 to 900 px.

## 3. Data (each source keeps its origin on the page)
- data.brand: {domain}. Clay reads the brand's colours and logos live with Context.dev (about 10 to 30 seconds once). Use it whenever the person names a brand or a site; do not write brand colours from memory.
- data.inline: values you supply. The page shows them as "provided by your agent, not checked".

## 4. Outputs: what comes back to you
outputs: [{id, label, template}]. The template is the final text with {{control_id}} placeholders: the class string, the config object, the CSS rule, in the exact form of the person's file. The page shows the outputs live as "What goes back to your agent". When the person presses Settle, read_playground returns them rendered. Paste them; do not re-derive them from the values.

## The loop
1. Read the person's real file. 2. create_playground. Fix every validation error it lists and call again. 3. Give the person the URL: "move the controls until it is right, then press Settle". The preview code is unverified until the page is opened. 4. When they say they are done, read_playground: it returns settled.outputs, the path they took per control, and the preview status. If the preview failed, the error is there: repair with revise_playground and ask them to reload. 5. Write the settled outputs into their file.

## Worked example 1: a Tailwind button, colours from the brand
The person: "this signup button looks off, our brand is acme.com". Their file has <button className="bg-[#3b82f6] rounded-[4px] px-[12px] py-2 text-sm text-white font-normal">Sign up</button>.
${JSON.stringify(BUTTON_EXAMPLE, null, 1)}

## Worked example 2: spring physics, tuned by feel
The person: "the card snap-back feels dead". Their file has const SPRING = { stiffness: 120, damping: 26, mass: 1 }.
${JSON.stringify(SPRING_EXAMPLE, null, 1)}
`;
