// The kit of a preview playground: controls that always mean the same thing, a preview that runs real code, and outputs
// rendered from the control values. A kit comes from an agent: it is untrusted data, and checkKit() is its trust boundary.
// Pure functions only: no store, no network.

import { checkWeb, type WebSource, type WebState } from "./web.ts";

export const KIT_LIMITS = { controls: 12, outputs: 6, options: 12, palette: 16, label: 60, meaning: 200, unit: 12, text: 2000, html: 20_000, css: 20_000, js: 40_000, template: 4_000, inline: 8_000, steps: 10_000 } as const;

/** The brandError of a preview playground whose brand read has not ended yet. It is a state, not an error: the read stores its result when it ends. */
export const BRAND_PENDING = "The brand is still being read.";

/** A function instance lives at most 300 s. A brand read that is older and still marked as pending was cut off. */
const BRAND_STALE_MS = 330_000;
/** Is the brand of this preview still being read? A mark that is too old to belong to a living read counts as a failed read. */
export const brandPending = (k: { brandError: string | null; brandSince?: string | null }, now = Date.now()): boolean => k.brandError === BRAND_PENDING && now - Date.parse(k.brandSince ?? "") < BRAND_STALE_MS;

export type Value = number | string | boolean;
type Base = { id: string; label: string; meaning: string };
export type Control =
  | (Base & { type: "slider"; min: number; max: number; step: number; initial: number; unit?: string })
  | (Base & { type: "toggle"; initial: boolean; on: string; off: string })
  | (Base & { type: "select"; options: { value: string; label: string }[]; initial: string })
  | (Base & { type: "color"; initial: string; palette: string[] | "brand"; free: boolean });
export type Preview = { html: string; css: string; js: string; tailwind: boolean; /** The frame loads the map library and may load map tiles (lib/frame.ts, LEAFLET and TILES). Absent on a kit from before maps. */ map?: boolean; /** A data view: the frame brings Clay's own type, colours and parts (lib/sheet.ts), and the page shows it without the artboard. Absent on every other kit. */ data?: boolean; height: number };
export type Output = { id: string; label: string; template: string };
export type Kit = { notes?: string; controls: Control[]; preview: Preview; outputs: Output[]; brand: { domain: string } | null; inline: Record<string, unknown> | null; /** Live facts from web pages (lib/web.ts). */ web?: WebSource[] | null };

/** Brand facts of one site, read by Context.dev. Every fact keeps where it came from. */
export type BrandData = { domain: string; title: string; colors: { hex: string; name: string }[]; logos: { url: string; mode: string; type: string }[]; fetchedAt: string; source: "context.dev brand" };

export type Values = Record<string, Value>;
/** Per control: where it started, what was tried, where it ended. Sliders keep a range, the other controls a short list. */
export type KitExploration = { controls: Record<string, { start: Value; final: Value; min?: number; max?: number; tried: Value[] }>; updatedAt: string };
export type Settled = { values: Values; outputs: Record<string, string>; at: string };
export type KitState = {
  kit: Kit;
  /** Changes with every revision of the kit. A report from a page that still runs an older kit is refused (isCurrent). */
  rev?: string;
  brandData: BrandData | null;
  brandError: string | null;
  /** When the brand read that is pending (brandError BRAND_PENDING) was started. */
  brandSince?: string | null;
  /** The preview code cannot be run on the server. The page reports what happened when it was opened. */
  preview: { status: "unverified" | "ok" | "failed"; error: string | null; at: string | null };
  settled: Settled | null;
  exploration: KitExploration | null;
  /** Per source of kit.web: what was read, when, and what changed since (lib/web.ts). */
  web?: Record<string, WebState>;
};

const ID = /^[a-z][a-z0-9_]{1,29}$/;
const HEX = /^#[0-9a-f]{6}$/;
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
/** Decimal places of a number as written, also when JavaScript prints it with an exponent (1e-7 has 7). */
const decimals = (n: number) => {
  const [mantissa, exponent] = String(n).split("e-");
  return Math.min(12, (mantissa.split(".")[1] ?? "").length + Number(exponent ?? 0));
};
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown, max: number, min = 1): x is string => typeof x === "string" && x.trim().length >= min && x.length <= max;
/** How long the given text is, for an error that states the limit: the agent sees by how much to shorten. */
const had = (x: unknown) => (typeof x === "string" ? `this one has ${x.length}` : "none was given");

/** The value of a slider on its step grid, without floating-point dust (0.35, not 0.35000000000000003). */
export const snap = (c: Extract<Control, { type: "slider" }>, v: number) => {
  const n = c.min + Math.round((Math.min(c.max, Math.max(c.min, v)) - c.min) / c.step) * c.step;
  return Number(Math.min(c.max, n).toFixed(Math.max(decimals(c.step), decimals(c.min))));
};

/** A value from outside (the browser, the bridge) for one control, or undefined when it is not a value this control can have. */
export function cleanValue(c: Control, v: unknown): Value | undefined {
  if (c.type === "slider") return isNum(v) && v >= c.min && v <= c.max ? snap(c, v) : undefined;
  if (c.type === "toggle") return typeof v === "boolean" ? v : undefined;
  if (c.type === "select") return c.options.some((o) => o.value === v) ? (v as string) : undefined;
  const hex = typeof v === "string" && HEX.test(v.toLowerCase()) ? v.toLowerCase() : undefined;
  // lean: a closed palette "brand" is not enforced here, because the brand's colours are not part of the control. Only the
  // page offers them; the owner could settle another colour by calling the route by hand. Pass the brand in if that matters.
  return hex && !c.free && c.palette !== "brand" && hex !== c.initial && !c.palette.includes(hex) ? undefined : hex;
}

/** All values of a kit from outside. Returns null when a control is missing or has a value it cannot have. Unknown keys are dropped. */
export function cleanValues(controls: Control[], input: unknown): Values | null {
  if (!input || typeof input !== "object") return null;
  const out: Values = {};
  for (const c of controls) {
    const v = cleanValue(c, (input as Record<string, unknown>)[c.id]);
    if (v === undefined) return null;
    out[c.id] = v;
  }
  return out;
}

export const initialValues = (controls: Control[]): Values => Object.fromEntries(controls.map((c) => [c.id, c.initial]));

/** The text a control value stands for in a template: the number, the option value, the colour, or the toggle's on/off text. */
export const textOf = (c: Control, v: Value): string => (c.type === "toggle" ? (v ? c.on : c.off) : String(v));

/**
 * Fill `{{control_id}}` in an output template. Unknown names stay as written; checkKit() rejects them before anything is stored.
 * The text that a toggle or a select option stands for may itself hold placeholders of other controls (a badge that is on
 * or off, with the accent colour inside it): they are filled too, one level deep. So an output is complete code, with no
 * part left for the agent to patch by hand at hand-back.
 */
export function render(template: string, controls: Control[], values: Values): string {
  const text = (name: string, all: string, nested: boolean): string => {
    const c = controls.find((x) => x.id === name);
    if (!c || values[name] === undefined) return all;
    const t = textOf(c, values[name]);
    return nested && (c.type === "toggle" || c.type === "select") ? t.replace(new RegExp(PLACEHOLDER.source, "g"), (inner, n: string) => (n === name ? inner : text(n, inner, false))) : t;
  };
  return template.replace(PLACEHOLDER, (all, name: string) => text(name, all, true));
}
/**
 * The most text all outputs of a playground may hold together, in characters. A class string, a config or a CSS file is
 * far below it. checkKit() rejects a kit whose outputs could exceed it at any values; renderOutputs() checks the exact size
 * before it builds anything, so no path can produce or store more (a nested toggle text can otherwise multiply).
 */
export const OUTPUT_LIMIT = 32_000;
/** The longest decimal text a number can take here (sign, digits, point, rounding noise). */
const NUMBER_TEXT = 24;
/**
 * The size of a template once filled: exact for `values`, or the worst case over every value when `values` is null. Only
 * lengths are summed; nothing is built. Nesting is one level deep, as in render().
 */
function filledSize(template: string, controls: Control[], values: Values | null): number {
  const size = (name: string, all: string, nested: boolean): number => {
    const c = controls.find((x) => x.id === name);
    if (!c || (values && values[name] === undefined)) return all.length;
    const texts = values ? [textOf(c, values[name])] : c.type === "toggle" ? [c.on, c.off] : c.type === "select" ? c.options.map((o) => o.value) : c.type === "color" ? ["#rrggbb"] : ["x".repeat(NUMBER_TEXT)];
    const one = (t: string) => (nested && (c.type === "toggle" || c.type === "select") ? t.length + [...t.matchAll(new RegExp(PLACEHOLDER.source, "g"))].reduce((n, m) => n + (m[1] === name ? 0 : size(m[1], m[0], false) - m[0].length), 0) : t.length);
    return Math.max(0, ...texts.map(one));
  };
  return template.length + [...template.matchAll(new RegExp(PLACEHOLDER.source, "g"))].reduce((n, m) => n + size(m[1], m[0], true) - m[0].length, 0);
}
/** The size of all outputs together: at these values, or at worst (null). */
export const outputsSize = (kit: Pick<Kit, "outputs" | "controls">, values: Values | null): number => kit.outputs.reduce((n, o) => n + filledSize(o.template, kit.controls, values), 0);

/** The placeholders inside the texts that a toggle or a select can stand for. */
const nestedNames = (c: Control): string[] => (c.type === "toggle" ? [c.on, c.off] : c.type === "select" ? c.options.map((o) => o.value) : []).flatMap((t) => [...t.matchAll(PLACEHOLDER)].map((m) => m[1]));
/**
 * What decides how a preview runs: its code, its data and its controls without their words (label, meaning, option labels).
 * Two kits with the same signature run the same code with the same values, so a verified preview stays verified.
 */
export const runSignature = (kit: Kit): string => JSON.stringify([kit.preview, kit.inline, kit.brand, kit.web ?? null, kit.controls.map((c) => ({ ...c, label: "", meaning: "", ...(c.type === "select" ? { options: c.options.map((o) => o.value) } : {}) }))]);
/** A one-line output (a class string) loses the gaps that an empty toggle text leaves. A multi-line output (CSS, JSON) keeps its layout. */
const tidy = (text: string) => (text.includes("\n") ? text.replace(/[ \t]+$/gm, "").trim() : text.replace(/\s+/g, " ").trim());
export const renderOutputs = (kit: Kit, values: Values): Record<string, string> => {
  // The exact size first, from lengths alone: a kit stored before the limit existed cannot make this allocate gigabytes.
  const size = outputsSize(kit, values);
  if (size > OUTPUT_LIMIT) return Object.fromEntries(kit.outputs.map((o) => [o.id, `(not rendered: the outputs would hold ${size} characters, the limit is ${OUTPUT_LIMIT})`]));
  return Object.fromEntries(kit.outputs.map((o) => [o.id, tidy(render(o.template, kit.controls, values))]));
};

const names = (template: string) => [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
const word = (id: string) => new RegExp(`(?<![\\w$])${id}(?![\\w$])`);

/** What the agent sends for a preview playground, after the type check of lib/spec.ts. Every field is still untrusted. */
export type RawKit = {
  notes?: string;
  controls?: Record<string, unknown>[];
  view: { html?: string; css?: string; js?: string; tailwind?: boolean; map?: boolean; data?: boolean; height?: number };
  outputs?: { id: string; label: string; template: string }[];
  brand?: { domain: string };
  inline?: Record<string, unknown>;
  web?: unknown;
};

const FIELDS: Record<Control["type"], string[]> = { slider: ["min", "max", "step", "initial", "unit"], toggle: ["initial", "on", "off"], select: ["options", "initial"], color: ["initial", "palette", "free"] };
const ALL_FIELDS = [...new Set(Object.values(FIELDS).flat())];

/**
 * Validate a preview kit. Returns the Kit, or every problem as a sentence that says how to fix it.
 * `warnings` are not errors: the playground is built, and the create result passes them on.
 */
/** The common ways view.js can turn a string into markup. Not every way: code can hide a name, so this is a warning's net, not a guard. */
// The map library's calls that take a string as markup are in the list too: a popup, a tooltip, an overlay's content, a
// div icon, an attribution, and openPopup or openTooltip when they are given content (without an argument they only
// open what is bound). (Not caught: a string in an options object, such as L.popup({content}); the reference names it.) Each also takes an element or a text node, which is the way to show web text on a map.
const MARKUP_SINK = /\b(innerHTML|outerHTML|insertAdjacentHTML|setHTMLUnsafe|createContextualFragment|srcdoc|bindPopup|bindTooltip|setPopupContent|setTooltipContent|setContent|divIcon|addAttribution)\b|\bopen(?:Popup|Tooltip)(?=\s*\(\s*[^)\s])|\bdocument\s*\.\s*write(?:ln)?\b/g;
/**
 * Text from a web page or a brand is not the agent's text: a page can change a price or a name into markup, and markup
 * that view.js writes with innerHTML, outerHTML or insertAdjacentHTML is then built in every visitor's preview. So a
 * preview that has such data and uses one of these gets a warning in problems: in the build answer for the agent, and in
 * read_playground for anyone who reads the playground before it becomes an example. A warning, not a refusal: the string may be the agent's own, which no
 * pattern can see for certain. Null: no web or brand data, or none of the three in view.js.
 */
export function markupWarning(kit: { preview: { js: string }; web?: unknown[] | null; brand: unknown | null }): string | null {
  if (!kit.web?.length && !kit.brand) return null;
  const used = [...new Set((kit.preview.js.match(MARKUP_SINK) ?? []).map((x) => x.replace(/\s+/g, "")))];
  if (!used.length) return null;
  return `view.js: ${used.join(", ")} ${used.length === 1 ? "builds" : "build"} markup from a string, and this playground reads ${kit.web?.length ? "web pages (data.web)" : "a brand (data.brand)"}. Text from clay.data.web and clay.data.brand is copied from web pages: when it reaches such a string, a page can turn it into markup that is built in every visitor's preview. Put that text into the page with textContent (or createTextNode), never as markup (on a map: bindPopup, bindTooltip and setContent take an element or a text node, document.createTextNode(text)); revise view.js with revise_playground. If the string holds only your own text, say so to the person and leave it.`;
}

/** The smallest text of a data view, in px (a badge of lib/sheet.ts). */
const SMALLEST_TEXT = 12;
/** A data view may bring this many colours of its own (a brand colour, a series) before it is told to use the variables. */
const OWN_COLOURS = 2;
/**
 * How a preview that shows data looks: problems for the agent that builds it, in the build and revise results. A page
 * of facts written in styles of its own (a typeface, 11 px text, a dozen colours) does not match the page around it or
 * any other playground, so:
 * - a preview that reads web pages and is not a data view is told to become one. Not a map, and not a Tailwind
 *   preview: those are a place and the person's own component, and view.data is refused with view.tailwind;
 * - a data view is told about each thing it brings that the frame already has: a typeface, text under 12 px, colours.
 * Advice, not a refusal: the playground is built. Only view.css and the style attributes of view.html are read; what
 * view.js sets is not seen, and neither is a colour by name or a size in em or %.
 */
export function styleProblems(kit: { preview: Pick<Preview, "html" | "css" | "data" | "map"> & { tailwind?: boolean }; web?: unknown[] | null }): string[] {
  const { preview } = kit;
  if (!preview.data) {
    return kit.web?.length && !preview.map && !preview.tailwind
      ? ['view: this preview shows facts read from web pages (data.web) in styles of its own. Make it a data view: set view.data: true and write view.html with Clay\'s parts (kit_reference, "A data view": .lead, table, .cards, .badge, .note), with view.css empty or nearly so. The typeface, the sizes and the colours are then the page\'s own, on a desktop and on a phone. Revise with revise_playground. It may stay as it is only when the preview is the person\'s own component with one or two facts in it.']
      : [];
  }
  const out: string[] = [];
  // Every style attribute ends its last declaration, so a value is always the text between a colon and ";" or "}".
  // A comment is not a style: each closed comment is taken out as a space, as a browser reads it, before the ";" is
  // added. (Not seen: a comment that is never closed, and "/*" inside a string or a url(), which is no comment.)
  const plain = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ");
  const styles = [plain(preview.css), ...[...preview.html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => `${plain(m[1] ?? m[2])};`)].join("\n");
  // A declaration, not a selector (".font:hover"), and not "font: inherit", which takes Clay's typeface.
  if (/(?<![\w.#-])font(?:-family)?\s*:(?!\s*(?:inherit|unset|initial)\b)/i.test(styles)) out.push("view.css: a data view (view.data) has Clay's typeface. Remove font-family and the font shorthand. A size goes in font-size alone, and only where no part fits: the parts have the sizes (.lead 21 px, body 15 px, .small 13 px).");
  // The size of font-size and of the font shorthand, in px or rem (16 px).
  const small = [...new Set([...styles.matchAll(/(?<![\w.#-])font(?:-size)?\s*:[^;{}]*?(\d*\.?\d+)(px|rem)\b/gi)].map((m) => ({ text: `${m[1]}${m[2].toLowerCase()}`, px: Number(m[1]) * (m[2].toLowerCase() === "rem" ? 16 : 1) })).filter((s) => s.px < SMALLEST_TEXT).map((s) => s.text))];
  if (small.length) out.push(`view.css: font-size ${small.join(", ")} is under ${SMALLEST_TEXT} px, the smallest text of a data view. Text that small is a sign of too much text: use .small (13 px), and move the long part into <details>.`);
  // Colours in the values of declarations only (the text after a colon, up to ";" or "}"): "#add" in a selector is an id.
  // One colour written in two ways is one colour: #fff, #FFFFFF and #ffffffff.
  const hex = (c: string) => {
    const h = c.length <= 5 ? `#${[...c.slice(1)].map((x) => x + x).join("")}` : c;
    return h.length === 9 && h.endsWith("ff") ? h.slice(0, 7) : h;
  };
  const values = [...styles.matchAll(/:([^;{}]*)(?=[;}])/g)].map((m) => m[1]).join("\n");
  const colours = [...new Set((values.match(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/gi) ?? []).map((c) => c.toLowerCase().replace(/\s*([,/()])\s*/g, "$1").replace(/\s+/g, " ")).map((c) => (c.startsWith("#") ? hex(c) : c)))];
  if (colours.length > OWN_COLOURS) out.push(`view.css: ${colours.length} colours of its own (${colours.slice(0, 4).join(", ")}${colours.length > 4 ? ", ..." : ""}). A data view takes its colours from the variables: var(--ink), var(--muted), var(--line), var(--field), var(--accent), var(--ok), var(--warn), var(--bad), and --accent-bg, --ok-bg, --warn-bg, --bad-bg behind them; the parts .pick, .out, .badge and .note use them already. Keep a colour of your own only when it is data: a brand colour, a series in a chart.`);
  return out;
}

export function checkKit(raw: RawKit): { ok: true; kit: Kit; warnings: string[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const controls: Control[] = [];
  const list = raw.controls ?? [];
  if (list.length < 1) errors.push("controls: a preview playground needs at least 1 control. Add the few dimensions this person wants to try.");
  if (list.length > KIT_LIMITS.controls) errors.push(`controls: at most ${KIT_LIMITS.controls} controls. Keep the dimensions that matter for this person.`);

  for (const [i, r] of list.entries()) {
    const at = `controls.${typeof r.id === "string" ? r.id : i}`;
    const before = errors.length;
    if (typeof r.id !== "string" || !ID.test(r.id)) errors.push(`controls.${i}.id: use 2 to 30 characters: lowercase letters, digits and underscores, starting with a letter.`);
    else if (controls.some((c) => c.id === r.id)) errors.push(`${at}: id "${r.id}" is used twice. Give every control its own id.`);
    if (!isStr(r.label, KIT_LIMITS.label, 2)) errors.push(`${at}.label: give a label of 2 to ${KIT_LIMITS.label} characters (${had(r.label)}). The person sees it next to the control.`);
    if (!isStr(r.meaning, KIT_LIMITS.meaning, 5)) errors.push(`${at}.meaning: say in 5 to ${KIT_LIMITS.meaning} characters (${had(r.meaning)}) what this control changes in the real code, for example "border-radius of the button in px".`);
    const type = r.type as Control["type"];
    if (!(type in FIELDS)) {
      errors.push(`${at}.type: "${String(r.type)}" is not a control of the kit. Use one of: slider, toggle, select, color.`);
      continue;
    }
    for (const f of ALL_FIELDS) if (r[f] !== undefined && !FIELDS[type].includes(f)) errors.push(`${at}.${f}: a ${type} has no ${f}. Remove it. A ${type} takes: ${FIELDS[type].join(", ")}.`);
    const base = { id: r.id as string, label: String(r.label ?? "").trim(), meaning: String(r.meaning ?? "").trim() };
    if (type === "slider") {
      const { min, max, initial } = r;
      const step = r.step ?? 1;
      if (!isNum(min) || !isNum(max) || !isNum(initial) || !isNum(step)) errors.push(`${at}: a slider needs min, max and initial as numbers (step is optional, default 1).`);
      else if (!(min < max)) errors.push(`${at}: min (${min}) must be below max (${max}).`);
      else if (!(step > 0) || (max - min) / step > KIT_LIMITS.steps) errors.push(`${at}.step: step must be above 0 and give at most ${KIT_LIMITS.steps} positions between min and max.`);
      else if (initial < min || initial > max) errors.push(`${at}.initial: ${initial} is outside the range ${min} to ${max}. Widen the range or change initial; initial should be the value in the person's code now.`);
      else if (Math.abs((initial - min) / step - Math.round((initial - min) / step)) > 1e-6) errors.push(`${at}.initial: ${initial} is not reachable from min ${min} in steps of ${step}. Use a smaller step or move min, so that the slider can show the person's current value exactly.`);
      else if (r.unit !== undefined && !isStr(r.unit, KIT_LIMITS.unit)) errors.push(`${at}.unit: use 1 to ${KIT_LIMITS.unit} characters (${had(r.unit)}), for example "px" or "ms".`);
      else controls.push({ ...base, type, min, max, step, initial, ...(r.unit ? { unit: (r.unit as string).trim() } : {}) });
    } else if (type === "toggle") {
      const on = r.on ?? "true";
      const off = r.off ?? "false";
      if (typeof r.initial !== "boolean") errors.push(`${at}.initial: a toggle needs initial true or false.`);
      else if (typeof on !== "string" || typeof off !== "string" || on.length > KIT_LIMITS.text || off.length > KIT_LIMITS.text) errors.push(`${at}: on and off are the texts that {{${base.id}}} stands for in a template (for example on "shadow-md", off ""; a few lines of code are fine), at most ${KIT_LIMITS.text} characters each (on: ${had(on)}, off: ${had(off)}).`);
      else controls.push({ ...base, type, initial: r.initial, on, off });
    } else if (type === "select") {
      const options = Array.isArray(r.options) ? (r.options as { value?: unknown; label?: unknown }[]) : [];
      if (options.length < 2 || options.length > KIT_LIMITS.options || options.some((o) => !o || typeof o.value !== "string" || o.value.length > KIT_LIMITS.text || (o.label !== undefined && !isStr(o.label, KIT_LIMITS.label)))) errors.push(`${at}.options: give 2 to ${KIT_LIMITS.options} options, each {"value": "<text used in templates and code, at most ${KIT_LIMITS.text} characters>", "label": "<what the person sees, at most ${KIT_LIMITS.label} characters>"}. The longest value here has ${Math.max(0, ...options.map((o) => (typeof o?.value === "string" ? o.value.length : 0)))} characters, the longest label ${Math.max(0, ...options.map((o) => (typeof o?.label === "string" ? o.label.length : 0)))}.`);
      else if (new Set(options.map((o) => o.value)).size !== options.length) errors.push(`${at}.options: two options have the same value.`);
      else if (!options.some((o) => o.value === r.initial)) errors.push(`${at}.initial: must be the value of one of the options: ${options.map((o) => JSON.stringify(o.value)).join(", ")}.`);
      else controls.push({ ...base, type, options: options.map((o) => ({ value: o.value as string, label: ((o.label as string | undefined) ?? (o.value as string)).trim() || "(none)" })), initial: r.initial as string });
    } else {
      const initial = typeof r.initial === "string" ? r.initial.toLowerCase() : "";
      const palette = r.palette === "brand" ? "brand" : Array.isArray(r.palette) ? (r.palette as unknown[]).map((x) => (typeof x === "string" ? x.toLowerCase() : "")) : r.palette === undefined ? [] : null;
      const free = r.free ?? true;
      if (!HEX.test(initial)) errors.push(`${at}.initial: give the colour as #rrggbb (six hex digits), for example "#2563eb".`);
      else if (palette === null || (palette !== "brand" && (palette.length > KIT_LIMITS.palette || palette.some((x) => !HEX.test(x))))) errors.push(`${at}.palette: use "brand" (the colours of data.brand) or a list of at most ${KIT_LIMITS.palette} colours as #rrggbb.`);
      else if (palette === "brand" && !raw.brand) errors.push(`${at}.palette: "brand" needs data.brand. Add data: {"brand": {"domain": "<the brand's site>"}}, or give a list of colours.`);
      else if (typeof free !== "boolean") errors.push(`${at}.free: true (any colour, the default) or false (only the palette).`);
      else if (!free && palette !== "brand" && !palette.length) errors.push(`${at}: free is false and there is no palette, so the person could pick nothing. Give a palette or leave free out.`);
      else controls.push({ ...base, type, initial, palette, free });
    }
    if (errors.length > before) continue;
  }

  // ---- The preview: real code in a sandboxed frame.
  const html = raw.view.html ?? "";
  const css = raw.view.css ?? "";
  const js = raw.view.js ?? "";
  const height = raw.view.height ?? 360;
  if (!html.trim()) errors.push('view.html: the preview needs html: the markup of the real thing (for example the person\'s button), with {{control_id}} where a control value goes.');
  for (const [k, text] of [["html", html], ["css", css], ["js", js]] as const) if (text.length > KIT_LIMITS[k]) errors.push(`view.${k}: ${text.length} characters, the limit is ${KIT_LIMITS[k]}. Keep only the part the person tunes.`);
  if (/<script/i.test(html)) errors.push("view.html: script tags in the html do not run. Put the JavaScript in view.js.");
  // Best effort against requests the frame's policy does not cover (resource hints, refresh, a base URL, nested frames):
  // these elements have no place in a preview body. The frame also blocks adding them from view.js (lib/frame.ts, HARDEN).
  const banned = [...new Set([...html.matchAll(/<(link|meta|base|iframe|frame|frameset|object|embed|portal|applet)(?=[\s/>])/gi)].map((m) => m[1].toLowerCase()))];
  if (banned.length) errors.push(`view.html: ${banned.map((t) => `<${t}>`).join(", ")} ${banned.length === 1 ? "is" : "are"} not allowed in a preview: ${banned.length === 1 ? "it" : "they"} can make the browser send requests or navigate outside the sandbox. Put styles in view.css or style attributes, fonts and images as data: URLs, and leave out meta and base; the preview shows the real component, not a page around it.`);
  if (!isNum(height) || height < 120 || height > 900) errors.push("view.height: the height of the preview in px, 120 to 900 (default 360).");

  const ids = controls.map((c) => c.id);
  const known = `Controls: ${ids.join(", ") || "none"}.`;
  for (const [where, text] of [["view.html", html], ["view.css", css]] as const) for (const n of names(text)) if (!ids.includes(n)) errors.push(`${where}: {{${n}}} is bound to a control that does not exist. ${known}`);
  for (const n of names(js)) if (ids.includes(n)) errors.push(`view.js: {{${n}}} is not filled in JavaScript. Read the value as clay.values.${n}, and react to changes with clay.onChange((values) => { ... }).`);
  for (const m of js.matchAll(/clay\s*\.\s*values\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["']([^"']+)["']\s*\])/g)) {
    const n = m[1] ?? m[2];
    if (!ids.includes(n)) errors.push(`view.js: clay.values.${n} reads a control that does not exist. ${known}`);
  }
  if (/clay\s*\.\s*data\s*\.\s*brand/.test(js) && !raw.brand) errors.push('view.js: clay.data.brand is read, but the spec has no data.brand. Add data: {"brand": {"domain": "<site>"}}.');

  // ---- Outputs: the code-ready text that goes back to the agent.
  const outputs = raw.outputs ?? [];
  if (outputs.length < 1) errors.push('outputs: a preview playground needs at least 1 output: the text that goes back to you when the person settles, for example {"id": "classes", "label": "Button className", "template": "rounded-[{{radius}}px] bg-[{{bg}}]"}.');
  if (outputs.length > KIT_LIMITS.outputs) errors.push(`outputs: at most ${KIT_LIMITS.outputs} outputs.`);
  for (const [i, o] of outputs.entries()) {
    const at = `outputs.${typeof o.id === "string" ? o.id : i}`;
    if (typeof o.id !== "string" || !ID.test(o.id)) errors.push(`outputs.${i}.id: use 2 to 30 characters: lowercase letters, digits and underscores, starting with a letter.`);
    else if (outputs.findIndex((x) => x.id === o.id) !== i) errors.push(`${at}: id "${o.id}" is used twice.`);
    if (!isStr(o.label, KIT_LIMITS.label, 2)) errors.push(`${at}.label: give a label of 2 to ${KIT_LIMITS.label} characters (${had(o.label)}).`);
    if (!isStr(o.template, KIT_LIMITS.template)) errors.push(`${at}.template: give a template of 1 to ${KIT_LIMITS.template} characters (${had(o.template)}).`);
    else {
      const used = names(o.template);
      for (const n of used) if (!ids.includes(n)) errors.push(`${at}.template: {{${n}}} references a control that does not exist. ${known}`);
      if (!used.length) errors.push(`${at}.template: it contains no {{control_id}}, so it never changes. Write the final code with a placeholder per control.`);
    }
  }

  // ---- A toggle or option text may hold {{other_control}}: it is filled in outputs (render()), one level deep.
  for (const c of controls) for (const n of nestedNames(c)) if (!ids.includes(n) || n === c.id) errors.push(`controls.${c.id}: its text holds {{${n}}}, which ${n === c.id ? "is the control itself" : "is not a control"}. ${known}`);
  /** The controls an output shows: the ones in its template, and the ones inside the texts of those. */
  const shown = (template: string) => names(template).flatMap((n) => [n, ...controls.filter((c) => c.id === n).flatMap(nestedNames)]);

  // ---- Every control must do something, and should come back in an output.
  // The preview fills {{id}} one level only (lib/frame.ts): a toggle or option text that is used in view.html or view.css
  // must not hold placeholders, or the preview shows the literal "{{accent}}" while the output looks right.
  for (const [where, text] of [["view.html", html], ["view.css", css]] as const)
    for (const n of names(text)) {
      const inner = controls.filter((c) => c.id === n).flatMap(nestedNames);
      if (inner.length) errors.push(`${where}: {{${n}}} stands for a text that holds ${[...new Set(inner)].map((x) => `{{${x}}}`).join(", ")}. That is filled in outputs only, not in the preview. Use ${[...new Set(inner)].map((x) => `{{${x}}}`).join(", ")} directly in ${where}, or build that part in view.js from clay.values.`);
    }
  for (const c of controls) {
    // Bound: named in the preview's html or css, or returned by an output (also inside a toggle or option text there).
    const bound = [html, css].some((t) => names(t).includes(c.id)) || outputs.some((o) => shown(String(o.template ?? "")).includes(c.id));
    if (!bound && !word(c.id).test(js)) errors.push(`controls.${c.id}: nothing uses this control. Bind it with {{${c.id}}} in view.html, view.css or an output, or read clay.values.${c.id} in view.js; or remove the control.`);
    else if (!outputs.some((o) => shown(String(o.template ?? "")).includes(c.id))) warnings.push(`controls.${c.id} is in no output. You will get its settled value, but no code-ready text for it.`);
  }

  // ---- The outputs at their largest: a toggle or option text that holds another control's text, used many times, multiplies.
  if (!errors.length) {
    const worst = outputsSize({ outputs: outputs as Kit["outputs"], controls: controls as Control[] }, null);
    if (worst > OUTPUT_LIMIT) errors.push(`outputs: at their largest the outputs would hold ${worst} characters; the limit is ${OUTPUT_LIMIT} for all outputs together. A toggle or option text that holds {{another_control}}, used many times, multiplies. Use each placeholder once and keep long texts out of nested toggle and option texts.`);
  }

  if (raw.inline && JSON.stringify(raw.inline).length > KIT_LIMITS.inline) errors.push(`data.inline: at most ${KIT_LIMITS.inline} characters of JSON.`);

  // ---- data.web: live facts from web pages. The preview reads them in view.js, so every source must be read there.
  let web: WebSource[] | null = null;
  if (raw.web != null) {
    const w = checkWeb(raw.web);
    if (!w.ok) errors.push(...w.errors);
    else {
      web = w.sources;
// A source that view.js does not seem to read: a warning, not an error. The code may reach it through a variable
      // (const w = clay.data.web; w[id]), which no pattern can see for certain.
      for (const s of web) if (!new RegExp(`(?<![\\w$])${s.id}(?![\\w$])`).test(js) && !/(?<![\w$])web(?![\w$])\s*(?![.[\w$])/.test(js)) warnings.push(`data.web.${s.id}: view.js does not seem to read clay.data.web.${s.id}. A source that the preview does not use is read for nothing: use it, or remove it.`);
    }
  }
  // Web text written as markup: a warning (markupWarning below), so the agent sees it and repairs it.
  const sink = markupWarning({ preview: { js }, web, brand: raw.brand ?? null });
  if (sink && !errors.length) warnings.push(sink);
  for (const m of js.matchAll(/clay\s*\.\s*data\s*\.\s*web\s*\.\s*([A-Za-z_$][\w$]*)/g)) if (!(web ?? []).some((s) => s.id === m[1])) errors.push(`view.js: clay.data.web.${m[1]} reads a web source that does not exist. Sources: ${(web ?? []).map((s) => s.id).join(", ") || "none (add data.web)"}.`);
  if (raw.view.map !== true && /\bclay\s*\.\s*map\s*\(/.test(js)) errors.push("view.js: clay.map() needs view.map: true. Without it the frame loads no map library and no map tiles.");
  // ---- A data view brings Clay's own styles (lib/sheet.ts). Tailwind's reset would change them, and its utilities are
  // one more set of sizes and colours: the two do not go together.
  if (raw.view.data === true && raw.view.tailwind === true) errors.push("view: view.data and view.tailwind do not go together. A data view (a comparison, a table of facts) is written with Clay's parts and needs no Tailwind: remove view.tailwind. When the preview is the person's own Tailwind component, remove view.data.");
  if (errors.length) return { ok: false, errors };
  warnings.push(...styleProblems({ preview: { html, css, data: raw.view.data === true, map: raw.view.map === true, tailwind: raw.view.tailwind === true }, web }));
  return { ok: true, warnings, kit: { ...(raw.notes ? { notes: raw.notes } : {}), controls, preview: { html, css, js, tailwind: raw.view.tailwind === true, ...(raw.view.map === true ? { map: true } : {}), ...(raw.view.data === true ? { data: true } : {}), height }, outputs: outputs.map((o) => ({ id: o.id, label: o.label.trim(), template: o.template })), brand: raw.brand ?? null, inline: raw.inline ?? null, ...(web ? { web } : {}) } };
}

/** Does a report from the page belong to the kit as it is now? A kit stored before revisions were marked accepts every report. */
export const isCurrent = (k: KitState, rev: unknown): boolean => !k.rev || rev === k.rev;

/** The colours a colour control offers: its palette (the brand's colours for "brand"), always with the initial colour. */
export function paletteOf(c: Extract<Control, { type: "color" }>, brand: BrandData | null): string[] {
  const list = c.palette === "brand" ? (brand?.colors.map((x) => x.hex) ?? []) : c.palette;
  return [...new Set([c.initial, ...list])];
}

/**
 * Merge a report from the browser into the exploration summary. Returns null when the report is malformed.
 * Report: {controls: {<id>: {final, min?, max?, tried?: []}}}. Controls the kit does not have are ignored.
 */
export function mergeKitExploration(controls: Control[], prev: KitExploration | null, report: unknown, now: string): KitExploration | null {
  const r = (report as { controls?: unknown } | null)?.controls;
  if (!r || typeof r !== "object") return null;
  const out: KitExploration = { controls: {}, updatedAt: now };
  for (const c of controls) {
    const was = prev?.controls[c.id] ?? { start: c.initial, final: c.initial, ...(c.type === "slider" ? { min: c.initial, max: c.initial } : {}), tried: [] };
    const seen = (r as Record<string, { final?: unknown; min?: unknown; max?: unknown; tried?: unknown }>)[c.id];
    if (seen === undefined) {
      out.controls[c.id] = was;
      continue;
    }
    const final = seen ? cleanValue(c, seen.final) : undefined;
    if (final === undefined) return null;
    if (c.type === "slider") {
      const lo = cleanValue(c, seen.min ?? final);
      const hi = cleanValue(c, seen.max ?? final);
      if (typeof lo !== "number" || typeof hi !== "number") return null;
      out.controls[c.id] = { start: was.start, final, min: Math.min(was.min as number, lo, final as number), max: Math.max(was.max as number, hi, final as number), tried: [] };
    } else {
      const tried = Array.isArray(seen.tried) ? seen.tried.slice(0, 40).map((v) => cleanValue(c, v)) : [];
      if (tried.some((v) => v === undefined)) return null;
      // The last 12 distinct values the person moved to, oldest first. The final value counts only when it is a move:
      // a settle reports every control, also the ones the person never touched.
      out.controls[c.id] = { start: was.start, final, tried: [...was.tried, ...(tried as Value[]), ...(final !== was.final ? [final] : [])].filter((v, i, all) => all.lastIndexOf(v) === i).slice(-12) };
    }
  }
  return out;
}

/** The values now: where the person left the controls, else the initial values. */
export const valuesNow = (k: KitState): Values => Object.fromEntries(k.kit.controls.map((c) => [c.id, k.exploration?.controls[c.id]?.final ?? c.initial]));

/** The exploration summary in words, one line per control. */
export function explorationWords(k: KitState): string[] {
  return k.kit.controls.map((c) => {
    const x = k.exploration?.controls[c.id];
    const unit = c.type === "slider" && c.unit ? ` ${c.unit}` : "";
    const show = (v: Value) => (c.type === "toggle" ? (v ? "on" : "off") : c.type === "select" ? (c.options.find((o) => o.value === v)?.label ?? String(v)) : String(v));
    if (!x || (c.type === "slider" ? x.min === x.max && x.final === x.start : !x.tried.length)) return `${c.label}: left at ${show(c.initial)}${unit}, never moved.`;
    if (c.type === "slider") return `${c.label}: tried ${x.min} to ${x.max}${unit}, settled on ${x.final}${unit} (started at ${x.start}${unit}).`;
    return `${c.label}: tried ${x.tried.map(show).join(", ")}; settled on ${show(x.final)} (started at ${show(x.start)}).`;
  });
}
