// The kit of a preview playground: controls that always mean the same thing, a preview that runs real code, and outputs
// rendered from the control values. A kit comes from an agent: it is untrusted data, and checkKit() is its trust boundary.
// Pure functions only: no store, no network.

export const KIT_LIMITS = { controls: 12, outputs: 6, options: 12, palette: 16, html: 20_000, css: 20_000, js: 40_000, template: 4_000, inline: 8_000, steps: 10_000 } as const;

export type Value = number | string | boolean;
type Base = { id: string; label: string; meaning: string };
export type Control =
  | (Base & { type: "slider"; min: number; max: number; step: number; initial: number; unit?: string })
  | (Base & { type: "toggle"; initial: boolean; on: string; off: string })
  | (Base & { type: "select"; options: { value: string; label: string }[]; initial: string })
  | (Base & { type: "color"; initial: string; palette: string[] | "brand"; free: boolean });
export type Preview = { html: string; css: string; js: string; tailwind: boolean; height: number };
export type Output = { id: string; label: string; template: string };
export type Kit = { notes?: string; controls: Control[]; preview: Preview; outputs: Output[]; brand: { domain: string } | null; inline: Record<string, unknown> | null };

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
  /** The preview code cannot be run on the server. The page reports what happened when it was opened. */
  preview: { status: "unverified" | "ok" | "failed"; error: string | null; at: string | null };
  settled: Settled | null;
  exploration: KitExploration | null;
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

/** Fill `{{control_id}}` in a template. Unknown names stay as written; checkKit() rejects them before anything is stored. */
export function render(template: string, controls: Control[], values: Values): string {
  return template.replace(PLACEHOLDER, (all, name: string) => {
    const c = controls.find((x) => x.id === name);
    return c && values[name] !== undefined ? textOf(c, values[name]) : all;
  });
}
/** A one-line output (a class string) loses the gaps that an empty toggle text leaves. A multi-line output (CSS, JSON) keeps its layout. */
const tidy = (text: string) => (text.includes("\n") ? text.replace(/[ \t]+$/gm, "").trim() : text.replace(/\s+/g, " ").trim());
export const renderOutputs = (kit: Kit, values: Values): Record<string, string> => Object.fromEntries(kit.outputs.map((o) => [o.id, tidy(render(o.template, kit.controls, values))]));

const names = (template: string) => [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
const word = (id: string) => new RegExp(`(?<![\\w$])${id}(?![\\w$])`);

/** What the agent sends for a preview playground, after the type check of lib/spec.ts. Every field is still untrusted. */
export type RawKit = {
  notes?: string;
  controls?: Record<string, unknown>[];
  view: { html?: string; css?: string; js?: string; tailwind?: boolean; height?: number };
  outputs?: { id: string; label: string; template: string }[];
  brand?: { domain: string };
  inline?: Record<string, unknown>;
};

const FIELDS: Record<Control["type"], string[]> = { slider: ["min", "max", "step", "initial", "unit"], toggle: ["initial", "on", "off"], select: ["options", "initial"], color: ["initial", "palette", "free"] };
const ALL_FIELDS = [...new Set(Object.values(FIELDS).flat())];

/**
 * Validate a preview kit. Returns the Kit, or every problem as a sentence that says how to fix it.
 * `warnings` are not errors: the playground is built, and the create result passes them on.
 */
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
    if (!isStr(r.label, 60, 2)) errors.push(`${at}.label: give a label of 2 to 60 characters. The person sees it next to the control.`);
    if (!isStr(r.meaning, 200, 5)) errors.push(`${at}.meaning: say in 5 to 200 characters what this control changes in the real code, for example "border-radius of the button in px".`);
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
      else if (r.unit !== undefined && !isStr(r.unit, 12)) errors.push(`${at}.unit: use 1 to 12 characters, for example "px" or "ms".`);
      else controls.push({ ...base, type, min, max, step, initial, ...(r.unit ? { unit: (r.unit as string).trim() } : {}) });
    } else if (type === "toggle") {
      const on = r.on ?? "true";
      const off = r.off ?? "false";
      if (typeof r.initial !== "boolean") errors.push(`${at}.initial: a toggle needs initial true or false.`);
      else if (typeof on !== "string" || typeof off !== "string" || on.length > 200 || off.length > 200) errors.push(`${at}: on and off are the texts that {{${base.id}}} stands for in a template (for example on "shadow-md", off ""), at most 200 characters each.`);
      else controls.push({ ...base, type, initial: r.initial, on, off });
    } else if (type === "select") {
      const options = Array.isArray(r.options) ? (r.options as { value?: unknown; label?: unknown }[]) : [];
      if (options.length < 2 || options.length > KIT_LIMITS.options || options.some((o) => !o || typeof o.value !== "string" || o.value.length > 200 || (o.label !== undefined && !isStr(o.label, 60)))) errors.push(`${at}.options: give 2 to ${KIT_LIMITS.options} options, each {"value": "<text used in templates and code>", "label": "<what the person sees>"}.`);
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
    if (!isStr(o.label, 60, 2)) errors.push(`${at}.label: give a label of 2 to 60 characters.`);
    if (!isStr(o.template, KIT_LIMITS.template)) errors.push(`${at}.template: give a template of 1 to ${KIT_LIMITS.template} characters.`);
    else {
      const used = names(o.template);
      for (const n of used) if (!ids.includes(n)) errors.push(`${at}.template: {{${n}}} references a control that does not exist. ${known}`);
      if (!used.length) errors.push(`${at}.template: it contains no {{control_id}}, so it never changes. Write the final code with a placeholder per control.`);
    }
  }

  // ---- Every control must do something, and should come back in an output.
  const templates = [html, css, ...outputs.map((o) => String(o.template ?? ""))];
  for (const c of controls) {
    const bound = templates.some((t) => names(t).includes(c.id));
    if (!bound && !word(c.id).test(js)) errors.push(`controls.${c.id}: nothing uses this control. Bind it with {{${c.id}}} in view.html, view.css or an output, or read clay.values.${c.id} in view.js; or remove the control.`);
    else if (!outputs.some((o) => names(String(o.template ?? "")).includes(c.id))) warnings.push(`controls.${c.id} is in no output. You will get its settled value, but no code-ready text for it.`);
  }

  if (raw.inline && JSON.stringify(raw.inline).length > KIT_LIMITS.inline) errors.push(`data.inline: at most ${KIT_LIMITS.inline} characters of JSON.`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, warnings, kit: { ...(raw.notes ? { notes: raw.notes } : {}), controls, preview: { html, css, js, tailwind: raw.view.tailwind === true, height }, outputs: outputs.map((o) => ({ id: o.id, label: o.label.trim(), template: o.template })), brand: raw.brand ?? null, inline: raw.inline ?? null } };
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
