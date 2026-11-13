// One playground = one spec that the agent writes. This is the trust boundary for it: a spec is untrusted data.
// A spec names its data sources, its view and, for a preview, its controls and outputs. Two kinds exist today:
// - view.type "price_ranking": the price engine (lib/config.ts, lib/pipeline.ts). Its metrics and features are its controls.
// - view.type "preview": the kit (lib/kit.ts): controls, a sandboxed preview that runs real code, and outputs.
import { z } from "zod";
import { feature, hostname, LIMITS, metric, parseConfig, toConfig, vendor } from "./config.ts";
import type { Domain } from "./domain.ts";
import { checkKit, KIT_LIMITS, type Kit } from "./kit.ts";
import type { Playground } from "./store.ts";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

const pricePages = z.strictObject({
  product: text(3, 120).describe("What is being priced, in a few words, for example 'transactional email API'. Part of the extraction instructions."),
  notes: text(0, 600).optional().describe("Optional extra guidance for the extraction, for example how to tell two similar metrics apart."),
  metrics: z.array(metric).min(LIMITS.metrics[0]).max(LIMITS.metrics[1]).describe("Usage dimensions that drive the cost. Each becomes a slider."),
  features: z.array(feature).max(LIMITS.features[1]).default([]).describe("Yes-or-no requirements. Each becomes a 'must have' checkbox that removes plans without it."),
  vendors: z.array(vendor).min(LIMITS.vendors[0]).max(LIMITS.vendors[1]).describe("The vendors to compare."),
});

const control = z.strictObject({
  id: z.string().max(40).describe("Stable id, for example radius. Lowercase letters, digits, underscores. It is the name in {{radius}} and clay.values.radius."),
  type: z.enum(["slider", "toggle", "select", "color"]).describe("slider: a number (min, max, step, initial, unit). toggle: on or off (initial, and the texts on/off that it stands for in templates). select: one of a few options (options, initial). color: a colour as #rrggbb (initial, palette, free)."),
  label: z.string().max(80).describe("What the person sees next to the control."),
  meaning: z.string().max(240).describe("The one thing this control changes in the real code, for example 'border-radius of the button, in px'. You read it again at hand-back."),
  min: z.number().optional().describe("slider: lowest value."),
  max: z.number().optional().describe("slider: highest value. Set the range around the person's current value, not around everything possible."),
  step: z.number().optional().describe("slider: step, default 1. initial must be reachable from min in steps."),
  unit: z.string().max(20).optional().describe("slider: unit shown after the number, for example px."),
  initial: z.union([z.number(), z.string(), z.boolean()]).describe("Starting value: the value in the person's code now. slider: number. toggle: true or false. select: the value of one option. color: #rrggbb."),
  options: z.array(z.strictObject({ value: z.string().max(200), label: z.string().max(80).optional() })).optional().describe("select: 2 to 12 options. value is the text used in templates and code (for example a Tailwind class), label is what the person sees."),
  on: z.string().max(200).optional().describe("toggle: the text {{id}} stands for when on, for example 'shadow-md'. Default 'true'."),
  off: z.string().max(200).optional().describe("toggle: the text {{id}} stands for when off, for example ''. Default 'false'."),
  palette: z.union([z.literal("brand"), z.array(z.string().max(9)).max(KIT_LIMITS.palette)]).optional().describe("color: swatches to offer. 'brand' uses the colours of data.brand; or a list of #rrggbb."),
  free: z.boolean().optional().describe("color: true (default) lets the person pick any colour, false only the palette."),
});

const view = z.strictObject({
  type: z.enum(["price_ranking", "preview"]).describe("price_ranking: vendors of one usage-priced product ranked by cost, on prices read from their pricing pages (needs data.price_pages). preview: the real artifact, running code you supply, bound to controls (needs controls and outputs)."),
  html: z.string().optional().describe("preview: the markup of the real thing, copied from the person's code. {{control_id}} is replaced by the control's value and updated in place on every move. No script tags."),
  css: z.string().optional().describe("preview: plain CSS. {{control_id}} works here too."),
  js: z.string().optional().describe("preview: JavaScript for what markup cannot show, such as motion. It runs once. clay.values.<id> is the value now; clay.onChange((values) => { ... }) runs at once and on every move; clay.data.brand and clay.data.inline are the declared data. No network, no imports."),
  tailwind: z.boolean().optional().describe("preview: true loads the in-browser Tailwind v4 build, so Tailwind classes in html work, arbitrary values such as rounded-[7px] and bg-[#123456] included."),
  height: z.number().optional().describe("preview: height of the preview in px, 120 to 900, default 360."),
});

const output = z.strictObject({
  id: z.string().max(40).describe("Stable id, for example classes."),
  label: z.string().max(80).describe("What it is, for example 'className of the signup button'."),
  template: z.string().describe("The final code or values with {{control_id}} placeholders, written so that you can paste the result into the person's file: a class string, a JSON object, a CSS rule."),
});

export const specShape = {
  id: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/, "use 3 to 40 characters: lowercase letters, digits and hyphens, starting with a letter").describe("Id of the playground and the last part of its URL, for example signup-button."),
  title: text(3, 200).describe("What the person is deciding, in their words. For a price playground, the decision as a question."),
  notes: text(0, 600).optional().describe("Optional short note shown under the title, for example what to look for."),
  data: z
    .strictObject({
      price_pages: pricePages.optional().describe("For view price_ranking: what to read from the vendors' public pricing pages. Never put prices here; they are read from the pages."),
      brand: z.strictObject({ domain: hostname.describe("The brand's own site, for example linear.app.") }).optional().describe("For view preview: brand facts of one site, read live by Context.dev: its colours and logos. Use it when the person names a brand. A color control with palette 'brand' offers these colours."),
      inline: z.record(z.string().max(40), z.unknown()).optional().describe("For view preview: values you supply yourself, read in view.js as clay.data.inline. The page marks them as provided by the agent, not checked."),
    })
    .optional()
    .describe("Where the facts come from. Each source keeps its origin on the page."),
  controls: z.array(control).optional().describe("For view preview: the controls, 1 to 12, only from the kit. Choose the few dimensions that matter for this person."),
  view,
  outputs: z.array(output).optional().describe("For view preview: what goes back to you when the person settles, as code-ready text. At least 1."),
};
const spec = z.strictObject(specShape);
export type Spec = z.input<typeof spec>;

export type ParsedSpec = { ok: true; kind: "price"; domain: Domain } | { ok: true; kind: "preview"; domain: Domain; kit: Kit; warnings: string[] } | { ok: false; errors: string[] };

/** Validate an untrusted spec. Returns what to build, or every problem as a sentence that says how to fix it. */
export function parseSpec(input: unknown): ParsedSpec {
  const r = spec.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "spec"}: ${i.message}`) };
  const s = r.data;
  const errors: string[] = [];
  if (s.view.type === "price_ranking") {
    if (!s.data?.price_pages) errors.push('data.price_pages: the price_ranking view needs it: {"product", "metrics", "features", "vendors"}.');
    for (const k of ["controls", "outputs"] as const) if (s[k]) errors.push(`${k}: the price_ranking view brings its own controls (one slider per metric, one checkbox per feature) and its own hand-back (the saved decision). Remove ${k}.`);
    if (s.notes) errors.push("notes: a price playground shows no note. Put guidance for the extraction in data.price_pages.notes, or remove notes.");
    for (const k of ["brand", "inline"] as const) if (s.data?.[k]) errors.push(`data.${k}: only a preview view can use it. Remove it, or build a second playground with view.type "preview".`);
    for (const k of ["html", "css", "js", "tailwind", "height"] as const) if (s.view[k] !== undefined) errors.push(`view.${k}: only a preview view has ${k}. Remove it.`);
    if (errors.length) return { ok: false, errors };
    const p = parseConfig({ id: s.id, question: s.title, ...s.data!.price_pages });
    if (!p.ok) return { ok: false, errors: p.errors.map((e) => (e.startsWith("question:") ? e.replace("question:", "title (for a price playground, the decision as a question of 10 characters or more):") : `data.price_pages.${e}`)) };
    return { ok: true, kind: "price", domain: p.domain };
  }
  if (s.data?.price_pages) errors.push('data.price_pages: a preview view has no price ranking. Remove it, or build a second playground with view.type "price_ranking".');
  const k = checkKit({ notes: s.notes, controls: s.controls, view: s.view, outputs: s.outputs, brand: s.data?.brand, inline: s.data?.inline });
  if (!k.ok) errors.push(...k.errors);
  if (errors.length || !k.ok) return { ok: false, errors };
  return { ok: true, kind: "preview", domain: { id: s.id, question: s.title, product: "", metrics: [], features: [], vendors: [] }, kit: k.kit, warnings: k.warnings };
}

/** The spec that parseSpec() would turn into this stored playground. Used to revise a playground part by part, and to show the agent what it built. */
export function toSpec(p: Playground): Spec {
  if (!p.kit) {
    const c = toConfig(p.domain);
    return { id: c.id, title: c.question, data: { price_pages: { product: c.product, ...(c.notes ? { notes: c.notes } : {}), metrics: c.metrics, features: c.features ?? [], vendors: c.vendors } }, view: { type: "price_ranking" } };
  }
  const { kit } = p.kit;
  return {
    id: p.domain.id,
    title: p.domain.question,
    ...(kit.notes ? { notes: kit.notes } : {}),
    ...(kit.brand || kit.inline ? { data: { ...(kit.brand ? { brand: kit.brand } : {}), ...(kit.inline ? { inline: kit.inline } : {}) } } : {}),
    controls: kit.controls,
    view: { type: "preview", html: kit.preview.html, ...(kit.preview.css ? { css: kit.preview.css } : {}), ...(kit.preview.js ? { js: kit.preview.js } : {}), tailwind: kit.preview.tailwind, height: kit.preview.height },
    outputs: kit.outputs,
  };
}

/** A revision: the parts given replace the same parts of the current spec; inside `data`, each source given replaces that source. */
export function mergeSpec(current: Spec, change: Partial<Spec>): unknown {
  const given = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined));
  return { ...current, ...given, id: current.id, ...(current.data || change.data ? { data: { ...current.data, ...change.data } } : {}) };
}
