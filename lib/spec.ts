// One playground = one spec that the agent writes. This is the trust boundary for it: a spec is untrusted data.
// A spec names its data sources, its view and, for a preview, its controls and outputs. Two kinds exist today:
// - view.type "price_ranking": the price engine (lib/config.ts, lib/pipeline.ts). Its metrics and features are its controls.
// - view.type "preview": the kit (lib/kit.ts): controls, a sandboxed preview that runs real code, and outputs.
import { z } from "zod";
import { feature, hostname, LIMITS, metric, parseConfig, toConfig, vendor } from "./config.ts";
import type { Domain } from "./domain.ts";
import { checkKit, KIT_LIMITS, type Kit } from "./kit.ts";
import { WEB_LIMITS } from "./web.ts";
import type { Playground } from "./store.ts";

/** A string with an upper bound. Its error states the limit and the length that was given, so the agent knows by how much to shorten. */
const upTo = (max: number) => z.string().max(max, { error: (issue) => `at most ${max} characters, this one has ${typeof issue.input === "string" ? issue.input.length : "?"}` });
const text = (min: number, max: number) => z.string().trim().min(min, { error: (issue) => `at least ${min} characters, this one has ${typeof issue.input === "string" ? issue.input.length : "?"}` }).max(max, { error: (issue) => `at most ${max} characters, this one has ${typeof issue.input === "string" ? issue.input.length : "?"}` });

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
  label: upTo(KIT_LIMITS.label).describe("What the person sees next to the control, 2 to 60 characters."),
  meaning: upTo(KIT_LIMITS.meaning).describe("The one thing this control changes in the real code, for example 'border-radius of the button, in px'. You read it again at hand-back."),
  min: z.number().optional().describe("slider: lowest value."),
  max: z.number().optional().describe("slider: highest value. Set the range around the person's current value, not around everything possible."),
  step: z.number().optional().describe("slider: step, default 1. initial must be reachable from min in steps."),
  unit: upTo(KIT_LIMITS.unit).optional().describe("slider: unit shown after the number, for example px."),
  initial: z.union([z.number(), z.string(), z.boolean()]).describe("Starting value: the value in the person's code now. slider: number. toggle: true or false. select: the value of one option. color: #rrggbb."),
  options: z.array(z.strictObject({ value: upTo(KIT_LIMITS.text), label: upTo(KIT_LIMITS.label).optional() })).max(KIT_LIMITS.options).optional().describe("select: 2 to 12 options. value is the text used in templates and code (for example a Tailwind class), label is what the person sees."),
  on: upTo(KIT_LIMITS.text).optional().describe("toggle: the text {{id}} stands for when on, for example 'shadow-md', or a few lines of code that are there or not; at most 2000 characters. It may hold {{other_control}}, which is filled in outputs. Default 'true'."),
  off: upTo(KIT_LIMITS.text).optional().describe("toggle: the text {{id}} stands for when off, for example ''. Default 'false'."),
  palette: z.union([z.literal("brand"), z.array(z.string().max(9)).max(KIT_LIMITS.palette)]).optional().describe("color: swatches to offer. 'brand' uses the colours of data.brand; or a list of #rrggbb."),
  free: z.boolean().optional().describe("color: true (default) lets the person pick any colour, false only the palette."),
});

const webField = z.strictObject({
  id: z.string().max(30).describe("Stable id, for example input_price. Lowercase letters, digits, underscores."),
  type: z.enum(["number", "text", "boolean"]).describe("number: a number exactly as the page writes it. text: a short text such as a model or plan name. boolean: yes or no."),
  unit: upTo(WEB_LIMITS.unit).optional().describe("The unit of a number, for example 'USD per 1M tokens'. Shown next to the value."),
  describe: upTo(WEB_LIMITS.describe).describe("What the page calls this fact, with synonyms and its unit. The extraction finds the value with this text. Ask for the number as the page states it; do your arithmetic in view.js."),
});
const webSource = z.strictObject({
  id: z.string().max(30).describe("Stable id, for example anthropic. It is the name in clay.data.web.<id>."),
  url: upTo(300).optional().describe("The exact public https page. Give it when you know it: it is more reliable than search."),
  domain: hostname.optional().describe("The site's own host, for example anthropic.com, when you do not know the page: search finds it with `find`."),
  find: upTo(WEB_LIMITS.find).optional().describe("Which page of the site to read, for example 'API pricing per million tokens'. Required with domain."),
  fields: z.array(webField).max(WEB_LIMITS.fields).optional().describe("Single facts of the page (a plan's price, a limit). Give fields or rows."),
  rows: z.strictObject({ describe: upTo(WEB_LIMITS.describe).describe("What one row is, for example 'one row per model of the API, with its prices'."), fields: z.array(webField).max(WEB_LIMITS.fields).describe("The facts of each row. Make the first text field the row's name: it identifies the row.") }).optional().describe("A table of the page: up to 60 rows."),
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
  label: upTo(KIT_LIMITS.label).describe("What it is, in 2 to 60 characters, for example 'className of the signup button'."),
  template: upTo(KIT_LIMITS.template).describe("The final code or values with {{control_id}} placeholders, written so that you can paste the result into the person's file: a class string, a JSON object, a CSS rule."),
});

export const specShape = {
  id: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/, "use 3 to 40 characters: lowercase letters, digits and hyphens, starting with a letter").describe("Id of the playground and the last part of its URL, for example signup-button. When it is taken, the playground gets it with a short suffix: use the playground_id of the result."),
  title: text(3, 200).describe("What the person is deciding, in their words. For a price playground, the decision as a question."),
  notes: text(0, 600).optional().describe("Optional short note shown under the title: what was asked, what the page is built from, and what to try. The playground may be shared or become a public example, so write it for any reader: no 'your file' or 'you asked', and no 'press Settle' (the page has that button and says what it does)."),
  data: z
    .strictObject({
      price_pages: pricePages.optional().describe("For view price_ranking: what to read from the vendors' public pricing pages. Never put prices here; they are read from the pages."),
      brand: z.strictObject({ domain: hostname.describe("The brand's own site, for example linear.app.") }).nullish().describe("For view preview: brand facts of one site, read live by Context.dev: its colours and logos. Use it when the person names a brand. A color control with palette 'brand' offers these colours."),
      inline: z.record(z.string().max(40), z.unknown()).nullish().describe("For view preview: values you supply yourself, read in view.js as clay.data.inline. The page marks them as provided by the agent, not checked."),
      web: z.array(webSource).max(WEB_LIMITS.sources).nullish().describe("For view preview: live facts from web pages, read by Context.dev when the playground is built and again on recheck_playground. Up to 6 sources. view.js reads clay.data.web.<id>: an object of the fields, or a list of the rows; a value the page does not state, or a number that is not in the page text, is null. Use it when the comparison needs facts that change (prices, limits, versions) and a dimension the price engine lacks. null removes it."),
    })
    .optional()
    .describe("Where the facts come from. Each source keeps its origin on the page."),
  controls: z.array(control).max(KIT_LIMITS.controls).optional().describe("For view preview: the controls, 1 to 12, only from the kit. Choose the few dimensions that matter for this person."),
  view,
  outputs: z.array(output).max(KIT_LIMITS.outputs).optional().describe("For view preview: what goes back to you when the person settles, as code-ready text. At least 1."),
};
const spec = z.strictObject(specShape);
export type Spec = z.input<typeof spec>;

export type ParsedSpec = { ok: true; kind: "price"; domain: Domain } | { ok: true; kind: "preview"; domain: Domain; kit: Kit; warnings: string[] } | { ok: false; errors: string[] };

/** A spec larger than this is refused unread. The largest valid one (every text at its limit) is well below it. */
export const MAX_SPEC_BYTES = 200_000;
/** At most this many problems are returned; the rest is counted. A caller cannot make the answer larger than the request. */
export const MAX_ERRORS = 20;
/** The most JSON-RPC messages in one request to the MCP endpoint. An agent sends one. */
export const MAX_BATCH = 10;
export const capErrors = (errors: string[]): string[] => (errors.length > MAX_ERRORS ? [...errors.slice(0, MAX_ERRORS), `and ${errors.length - MAX_ERRORS} more problems. Fix these first.`] : errors);

/**
 * The size check of an untrusted spec, BEFORE any element is validated: every collection against its bound. It looks only
 * at lengths, so a request with ten thousand entries costs one pass over the top-level shape and gets one sentence back.
 * Used by parseSpec() and by the MCP route, which must refuse such a call before the SDK validates the tool input.
 */
export function oversize(input: unknown): string[] {
  const errors: string[] = [];
  const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
  const bound = (path: string, value: unknown, max: number) => {
    if (errors.length >= MAX_ERRORS) return;
    const n = Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 0;
    if (n > max) errors.push(`${path}: at most ${max} entries, got ${n}. Nothing was checked or created.`);
  };
  const s = obj(input);
  bound("spec", s, 12);
  bound("controls", s.controls, KIT_LIMITS.controls);
  bound("outputs", s.outputs, KIT_LIMITS.outputs);
  if (Array.isArray(s.controls) && s.controls.length <= KIT_LIMITS.controls)
    for (const [i, c] of s.controls.entries()) {
      bound(`controls.${i}`, obj(c), 16);
      bound(`controls.${i}.options`, obj(c).options, KIT_LIMITS.options);
      bound(`controls.${i}.palette`, obj(c).palette, KIT_LIMITS.palette);
    }
  const data = obj(s.data);
  bound("data", data, 6);
  bound("data.inline", data.inline, 40);
  bound("data.web", data.web, WEB_LIMITS.sources);
  if (Array.isArray(data.web) && data.web.length <= WEB_LIMITS.sources)
    for (const [i, s] of data.web.entries()) {
      bound(`data.web.${i}`, obj(s), 8);
      bound(`data.web.${i}.fields`, obj(s).fields, WEB_LIMITS.fields);
      bound(`data.web.${i}.rows.fields`, obj(obj(s).rows).fields, WEB_LIMITS.fields);
    }
  const pages = obj(data.price_pages);
  bound("data.price_pages", pages, 8);
  bound("data.price_pages.metrics", pages.metrics, LIMITS.metrics[1]);
  bound("data.price_pages.features", pages.features, LIMITS.features[1]);
  bound("data.price_pages.vendors", pages.vendors, LIMITS.vendors[1]);
  bound("view", s.view, 8);
  return errors;
}

/**
 * The refusal for a tool call whose spec has a collection over its bound, or null. The route calls it BEFORE the MCP SDK
 * sees the request: the SDK validates every element of the tool input and reports every issue, so ten thousand empty
 * controls would cost fifty thousand error messages. Here they cost one sentence.
 */
export function refuseOversize(message: unknown): { id: unknown; text: string } | null {
  // A batch is inspected whole, and it is bounded: a tool call must not hide behind other messages.
  if (Array.isArray(message) && message.length > MAX_BATCH) return { id: null, text: `A batch may hold at most ${MAX_BATCH} messages, this one has ${message.length}. Nothing was read.` };
  for (const m of Array.isArray(message) ? message : [message]) {
    const call = m && typeof m === "object" ? (m as { id?: unknown; method?: unknown; params?: { arguments?: unknown } }) : {};
    const errors = call.method === "tools/call" ? oversize(call.params?.arguments) : [];
    if (errors.length) return { id: call.id ?? null, text: `The spec is too large. Nothing was checked or created. Fix these and call the tool again:\n- ${errors.join("\n- ")}` };
  }
  return null;
}

/** Validate an untrusted spec. Returns what to build, or the problems (at most MAX_ERRORS), each as a sentence that says how to fix it. */
export function parseSpec(input: unknown): ParsedSpec {
  const big = oversize(input);
  if (big.length) return { ok: false, errors: big };
  const r = validate(input);
  return r.ok ? r : { ok: false, errors: capErrors(r.errors) };
}

function validate(input: unknown): ParsedSpec {
  const r = spec.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "spec"}: ${i.message}`) };
  const s = r.data;
  const errors: string[] = [];
  if (s.view.type === "price_ranking") {
    if (!s.data?.price_pages) errors.push('data.price_pages: the price_ranking view needs it: {"product", "metrics", "features", "vendors"}.');
    for (const k of ["controls", "outputs"] as const) if (s[k]) errors.push(`${k}: the price_ranking view brings its own controls (one slider per metric, one checkbox per feature) and its own hand-back (the saved decision). Remove ${k}.`);
    for (const k of ["brand", "inline", "web"] as const) if (s.data?.[k]) errors.push(`data.${k}: only a preview view can use it. Remove it, or build a second playground with view.type "preview".`);
    for (const k of ["html", "css", "js", "tailwind", "height"] as const) if (s.view[k] !== undefined) errors.push(`view.${k}: only a preview view has ${k}. Remove it.`);
    if (errors.length) return { ok: false, errors };
    const p = parseConfig({ id: s.id, question: s.title, ...s.data!.price_pages });
    if (!p.ok) return { ok: false, errors: p.errors.map((e) => (e.startsWith("question:") ? e.replace("question:", "title (for a price playground, the decision as a question of 10 characters or more):") : `data.price_pages.${e}`)) };
    return { ok: true, kind: "price", domain: { ...p.domain, ...(s.notes ? { note: s.notes } : {}) } };
  }
  if (s.data?.price_pages) errors.push('data.price_pages: a preview view has no price ranking. Remove it, or build a second playground with view.type "price_ranking".');
  const k = checkKit({ notes: s.notes, controls: s.controls, view: s.view, outputs: s.outputs, brand: s.data?.brand ?? undefined, inline: s.data?.inline ?? undefined, web: s.data?.web ?? undefined });
  if (!k.ok) errors.push(...k.errors);
  if (errors.length || !k.ok) return { ok: false, errors };
  return { ok: true, kind: "preview", domain: { id: s.id, question: s.title, product: "", metrics: [], features: [], vendors: [] }, kit: k.kit, warnings: k.warnings };
}

/** The spec that parseSpec() would turn into this stored playground. Used to revise a playground part by part, and to show the agent what it built. */
export function toSpec(p: Playground): Spec {
  if (!p.kit) {
    const c = toConfig(p.domain);
    return { id: c.id, title: c.question, ...(p.domain.note ? { notes: p.domain.note } : {}), data: { price_pages: { product: c.product, ...(c.notes ? { notes: c.notes } : {}), metrics: c.metrics, features: c.features ?? [], vendors: c.vendors } }, view: { type: "price_ranking" } };
  }
  const { kit } = p.kit;
  return {
    id: p.domain.id,
    title: p.domain.question,
    ...(kit.notes ? { notes: kit.notes } : {}),
    ...(kit.brand || kit.inline || kit.web ? { data: { ...(kit.brand ? { brand: kit.brand } : {}), ...(kit.inline ? { inline: kit.inline } : {}), ...(kit.web ? { web: kit.web } : {}) } } : {}),
    controls: kit.controls,
    view: { type: "preview", html: kit.preview.html, ...(kit.preview.css ? { css: kit.preview.css } : {}), ...(kit.preview.js ? { js: kit.preview.js } : {}), tailwind: kit.preview.tailwind, height: kit.preview.height },
    outputs: kit.outputs,
  };
}

/** A revision: the parts given replace the same parts of the current spec; inside `data`, each source given replaces that source, and null removes it. */
export function mergeSpec(current: Spec, change: Partial<Spec>): unknown {
  const given = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined));
  return { ...current, ...given, id: current.id, ...(current.data || change.data ? { data: { ...current.data, ...change.data } } : {}) };
}
