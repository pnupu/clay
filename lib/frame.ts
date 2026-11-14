// The sandboxed frame of a preview playground, and the bridge between it and the page.
// The preview code comes from an agent and is shown to every visitor: it is untrusted. It runs only in the document built
// here, which is served with a Content-Security-Policy that (1) gives it an opaque origin and scripts only (`sandbox`), also
// when the frame URL is opened directly, and (2) allows no network except the pinned Tailwind build and the brand's logos.
// The only channel to the page is postMessage, and both sides validate every message.
import type { KitState } from "./kit.ts";
import { webData } from "./web.ts";

/** The in-browser Tailwind build, pinned by version and content hash (checked against the registry and the CDN on 2026-11-14). */
export const TAILWIND = { url: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.5/dist/index.global.js", integrity: "sha384-t+qLIxS5zM/KF99/doWY+dxTsavdvgayaZt8A9ntLsUjEkiXzYl5M3Ij8zVFPL9j" };

/** https origins of the brand's logos: the only hosts an image in the preview may load from. */
const logoOrigins = (k: KitState): string[] => {
  const out = new Set<string>();
  for (const l of k.brandData?.logos ?? []) {
    try {
      const u = new URL(l.url);
      if (u.protocol === "https:") out.add(u.origin);
    } catch {}
  }
  return [...out].slice(0, 4);
};

/** The policy of the frame document. `sandbox allow-scripts`: an opaque origin, no forms, popups, top navigation, modals or downloads. */
export function frameCsp(k: KitState): string {
  return [
    "sandbox allow-scripts",
    "default-src 'none'",
    `script-src 'unsafe-inline'${k.kit.preview.tailwind ? ` ${TAILWIND.url}` : ""}`,
    "style-src 'unsafe-inline'",
    `img-src data: ${logoOrigins(k).join(" ")}`.trim(),
    "font-src data:",
    "media-src data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}

/**
 * Frame side of the bridge, pure part: validation of the values the page sends, and template filling.
 * Plain ES5 in a string, because it runs inside the frame document. lib/frame.test.ts runs it in a VM.
 */
export const BRIDGE_PURE = `
function check(controls, v) {
  if (!v || typeof v !== "object") return null;
  var out = {};
  for (var i = 0; i < controls.length; i++) {
    var c = controls[i], x = v[c.id];
    var ok = c.type === "slider" ? typeof x === "number" && isFinite(x) && x >= c.min && x <= c.max
      : c.type === "toggle" ? typeof x === "boolean"
      : c.type === "select" ? typeof x === "string" && c.options.indexOf(x) >= 0
      : typeof x === "string" && /^#[0-9a-f]{6}$/.test(x);
    if (!ok) return null;
    out[c.id] = x;
  }
  return out;
}
function fill(controls, values, tpl, escape) {
  return tpl.replace(/\\{\\{\\s*([^{}]*?)\\s*\\}\\}/g, function (all, name) {
    for (var i = 0; i < controls.length; i++) if (controls[i].id === name) {
      var c = controls[i], t = c.type === "toggle" ? (values[name] ? c.on : c.off) : String(values[name]);
      return escape ? t.replace(/[&<>"']/g, function (ch) { return "&#" + ch.charCodeAt(0) + ";"; }) : t;
    }
    return all;
  });
}`;

const BRIDGE_DOM = `
var values = cfg.values, listeners = [], errors = 0, firstError = null, prev = null;
var root = document.getElementById("clay-root"), style = document.getElementById("clay-css");
function post(m) { m.clay = 1; try { parent.postMessage(m, "*"); } catch (e) {} }
// At most 5 errors per load: an error in an animation loop must not flood the page.
function fail(text) { text = String(text).slice(0, 500); firstError = firstError || text; if (errors++ < 5) post({ type: "error", message: text }); }
window.addEventListener("error", function (e) {
  if (e.target && e.target !== window) return fail("A resource of the preview did not load: " + (e.target.src || e.target.href || e.target.nodeName));
  var line = (e.lineno || 0) - cfg.jsLine;
  fail((e.message || "Script error") + (line > 0 && line <= cfg.jsLines ? " (view.js line " + line + ")" : ""));
}, true);
window.addEventListener("unhandledrejection", function (e) { fail("Unhandled promise rejection: " + ((e.reason && e.reason.message) || e.reason)); });
document.addEventListener("securitypolicyviolation", function (e) {
  fail("Blocked by the sandbox (" + e.effectiveDirective + "): " + (e.blockedURI || "inline") + ". A preview cannot use the network, forms or popups. Put images in data: URLs and code inline; brand logos from clay.data.brand.logos are allowed.");
});
// Apply to the live DOM only what changed between two renders of the template, so what view.js did to the elements stays.
function sync(live, was, next) {
  if (!live || live.nodeName !== next.nodeName) return;
  if (next.nodeType === 3) { if (was.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue; return; }
  if (next.nodeType !== 1) return;
  var i, a;
  for (i = 0; i < next.attributes.length; i++) { a = next.attributes[i]; if (was.getAttribute(a.name) !== a.value) live.setAttribute(a.name, a.value); }
  for (i = 0; i < was.attributes.length; i++) { a = was.attributes[i]; if (!next.hasAttribute(a.name)) live.removeAttribute(a.name); }
  for (i = 0; i < next.childNodes.length; i++) sync(live.childNodes[i], was.childNodes[i], next.childNodes[i]);
}
function draw() {
  var css = fill(cfg.controls, values, cfg.css, false);
  if (style.textContent !== css) style.textContent = css;
  var next = document.createElement("template");
  next.innerHTML = fill(cfg.controls, values, cfg.html, true);
  if (!prev) root.innerHTML = next.innerHTML;
  else for (var i = 0; i < next.content.childNodes.length; i++) sync(root.childNodes[i], prev.content.childNodes[i], next.content.childNodes[i]);
  prev = next;
}
var ids = cfg.controls.map(function (c) { return c.id; }).join(", ");
// Reading a control that does not exist is the most likely mistake in view.js: it is reported, not left as undefined.
function view() {
  return new Proxy(values, { get: function (t, k) {
    if (typeof k === "string" && !(k in t) && k !== "toJSON" && k !== "then") fail("clay.values." + k + " is not a control. Controls: " + ids + ".");
    return t[k];
  }, set: function () { return true; } });
}
function call(fn) { try { fn(view()); } catch (e) { if (window.reportError) reportError(e); else fail((e && e.message) || e); } }
window.addEventListener("message", function (e) {
  if (e.source !== window.parent || !e.data || e.data.clay !== 1) return;
  // The page says hello when it starts to listen: it may have missed what this frame sent before that.
  if (e.data.type === "hello") { if (firstError) post({ type: "error", message: firstError }); if (document.readyState === "complete") post({ type: "ready" }); return; }
  if (e.data.type !== "values") return;
  var v = check(cfg.controls, e.data.values);
  if (!v) return;
  values = v;
  draw();
  for (var i = 0; i < listeners.length; i++) call(listeners[i]);
});
window.clay = Object.freeze({
  get values() { return view(); },
  data: cfg.data,
  onChange: function (fn) { if (typeof fn === "function") { listeners.push(fn); call(fn); } }
});
draw();
window.addEventListener("load", function () { setTimeout(function () { post({ type: "ready" }); }, 0); });`;

/** JSON inside a script element: no "<" (so no closing tag, no comment opener) and no raw line separators. */
const inScript = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => (c.charCodeAt(0) === 0x2028 ? "\\u2028" : "\\u2029"));

/** The complete frame document: the bridge, then the agent's html, css and js. */
export function frameDocument(k: KitState, values: Record<string, unknown>): string {
  const { preview, controls } = k.kit;
  const js = preview.js.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
  const head = (jsLine: number) => {
    const cfg = {
      controls: controls.map((c) => ({ id: c.id, type: c.type, ...(c.type === "slider" ? { min: c.min, max: c.max } : c.type === "toggle" ? { on: c.on, off: c.off } : c.type === "select" ? { options: c.options.map((o) => o.value) } : {}) })),
      values,
      // The brand object always exists, so a preview written for brand data still runs when the brand could not be read.
      data: { brand: k.kit.brand ? { domain: k.kit.brand.domain, title: k.brandData?.title ?? "", colors: k.brandData?.colors ?? [], logos: k.brandData?.logos ?? [] } : null, inline: k.kit.inline ?? {}, web: webData(k.kit.web, k.web) },
      html: preview.html,
      css: preview.css,
      jsLine,
      jsLines: js.split("\n").length,
    };
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview</title>
<style>html, body { margin: 0; } body { min-height: 100vh; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }</style>
${preview.tailwind ? `<script src="${TAILWIND.url}" integrity="${TAILWIND.integrity}" crossorigin="anonymous"></script>` : ""}
<style id="clay-css"></style>
</head>
<body>
<div id="clay-root"></div>
<script>(function () { var cfg = ${inScript(cfg)};${BRIDGE_PURE}${BRIDGE_DOM}
})();</script>
<script>`;
  };
  // The line of the last <script> tag, so an error in view.js is reported with its own line number.
  const jsLine = head(0).split("\n").length;
  return `${head(jsLine)}\n${js}\n</script>\n</body>\n</html>\n`;
}

// ---- Page side of the bridge.

export type FrameMessage = { type: "ready" } | { type: "error"; message: string };

/**
 * Validate a message from the frame. Only the two known shapes pass; only `type` and `message` are read, and the message
 * is cut to 500 characters, so the size of what the page keeps is bounded whatever the frame sends.
 * The caller checks the source window and the origin ("null": the frame's origin is opaque).
 */
export function fromFrame(data: unknown): FrameMessage | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as { clay?: unknown; type?: unknown; message?: unknown };
  if (d.clay !== 1) return null;
  if (d.type === "ready") return { type: "ready" };
  if (d.type === "error" && typeof d.message === "string") return { type: "error", message: d.message.slice(0, 500) };
  return null;
}

/** A rate cap: at most `max` events in any window of `windowMs`. Returns false for an event over the cap. */
export function limiter(max: number, windowMs: number): (now: number) => boolean {
  const times: number[] = [];
  return (now) => {
    while (times.length && now - times[0] >= windowMs) times.shift();
    if (times.length >= max) return false;
    times.push(now);
    return true;
  };
}
