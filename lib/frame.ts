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
/**
 * BEST EFFORT, not a guarantee. Before any author code runs, the frame closes the known ways to add elements that make
 * the browser send requests the frame's CSP does not cover: resource hints (<link rel=prerender|prefetch|preload|
 * modulepreload|preconnect|dns-prefetch>), <meta http-equiv>, <base>, frames, plugins, and scripts added later
 * (speculation rules). It refuses creating them, strips them from every inserted node and every parsed HTML string, and
 * removes WebRTC (STUN requests can carry data). Each replaced API is locked (not configurable). Browsers give no
 * complete block for hint-based requests from a document that runs scripts, so the page's label says that a preview can
 * make outgoing requests in some browsers; this hardening narrows that, it does not close it.
 */
export const HARDEN = `
(function () {
  // Created by script: refused. In inserted or parsed content: stripped (a parsed or cloned script never runs, and a meta
  // without http-equiv does nothing, so the frame's own charset and viewport metas survive "head.innerHTML += ...").
  var BLOCKED = /^(link|meta|base|iframe|frame|frameset|object|embed|portal|applet|script)$/i;
  var TAGS = "link,meta[http-equiv],base,iframe,frame,frameset,object,embed,portal,applet";
  // Read through the original prototype getters: an element's own "localName" or "hasAttribute" property can be shadowed.
  var nameOf = Object.getOwnPropertyDescriptor(Element.prototype, "localName").get, nsOf = Object.getOwnPropertyDescriptor(Element.prototype, "namespaceURI").get, hasAttr = Element.prototype.hasAttribute, nodeTypeGet = Object.getOwnPropertyDescriptor(Node.prototype, "nodeType").get;
  var typeOf = { call: function (n) { try { return nodeTypeGet.call(n); } catch (e) { return 0; } } };
  function bad(n) { if (!n || typeof n !== "object" || typeOf.call(n) !== 1) return false; var t = nameOf.call(n); return /^(link|base|iframe|frame|frameset|object|embed|portal|applet)$/i.test(t) || (t === "meta" && hasAttr.call(n, "http-equiv")); }
  var D = Document.prototype, E = Element.prototype, N = Node.prototype;
  function lock(o, k, v) { try { Object.defineProperty(o, k, { value: v, writable: false, configurable: false }); } catch (e) {} }
  function lockSetter(o, k, set) { var d = Object.getOwnPropertyDescriptor(o, k); if (!d || !d.set) return; try { Object.defineProperty(o, k, { get: d.get, set: set, configurable: false }); } catch (e) {} }
  function refuse(t) { throw new DOMException("<" + String(t).toLowerCase() + "> is not allowed in a preview: it could send requests the sandbox does not cover.", "NotSupportedError"); }
  var qsa = E.querySelectorAll, fqsa = DocumentFragment.prototype.querySelectorAll, remove = E.remove;
  /** Remove every blocked element from a node (and from the content of templates in it). Returns false when the node itself is blocked. */
  function clean(node) {
    if (!node || typeof node !== "object") return true;
    if (bad(node)) return false;
    var kind = typeOf.call(node), find = kind === 1 ? qsa : kind === 11 ? fqsa : null;
    if (!find) return true;
    var all = find.call(node, TAGS), i;
    for (i = 0; i < all.length; i++) remove.call(all[i]);
    var tpl = find.call(node, "template");
    for (i = 0; i < tpl.length; i++) clean(tpl[i].content);
    if (kind === 1 && nameOf.call(node) === "template") clean(node.content);
    return true;
  }
  /** Clean the inserted nodes only: the argument at "only" (insertBefore's and replaceChild's first), or all of them. */
  function cleanArgs(args, only) { for (var i = 0; i < args.length; i++) if ((only == null || i === only) && !clean(args[i])) refuse(nameOf.call(args[i])); return args; }
  var createEl = D.createElement, createNS = D.createElementNS;
  lock(D, "createElement", function (t) { if (BLOCKED.test(String(t))) refuse(t); return createEl.apply(this, arguments); });
  lock(D, "createElementNS", function (ns, t) { if (BLOCKED.test(String(t).split(":").pop())) refuse(t); return createNS.apply(this, arguments); });
  // Every way to insert a node: the inserted subtree is cleaned first.
  [[N, ["appendChild"]], [E, ["append", "prepend", "before", "after", "replaceWith", "replaceChildren"]], [D, ["append", "prepend", "replaceChildren"]], [DocumentFragment.prototype, ["append", "prepend", "replaceChildren"]], [CharacterData.prototype, ["before", "after", "replaceWith"]]].forEach(function (pair) {
    pair[1].forEach(function (k) { var f = pair[0][k]; if (typeof f === "function") lock(pair[0], k, function () { return f.apply(this, cleanArgs(arguments)); }); });
  });
  [[N, "insertBefore", 0], [N, "replaceChild", 0], [E, "insertAdjacentElement", 1], [E, "moveBefore", 0], [D, "moveBefore", 0], [DocumentFragment.prototype, "moveBefore", 0], [Range.prototype, "insertNode", 0], [Range.prototype, "surroundContents", 0]].forEach(function (t) {
    var f = t[0][t[1]]; if (typeof f === "function") lock(t[0], t[1], function () { return f.apply(this, cleanArgs(arguments, t[2])); });
  });
  var exec = D.execCommand;
  if (typeof exec === "function") lock(D, "execCommand", function (cmd) { if (/^insertHTML$/i.test(String(cmd))) refuse("execCommand insertHTML"); return exec.apply(this, arguments); });
  if (window.customElements) { var define = customElements.define; lock(customElements, "define", function (name, ctor, options) { if (options && options.extends && BLOCKED.test(String(options.extends))) refuse(options.extends); return define.apply(this, arguments); }); }
  ["importNode", "adoptNode"].forEach(function (k) { var f = D[k]; if (typeof f === "function") lock(D, k, function (n) { var r = f.apply(this, arguments); if (!clean(r)) refuse(r.localName); return r; }); });
  // HTML strings are parsed inertly (a fragment, or a template's content), cleaned, and only then inserted.
  var range = D.createRange, ccf = Range.prototype.createContextualFragment, selectContents = Range.prototype.selectNodeContents, selectNode = Range.prototype.selectNode;
  var innerSet = Object.getOwnPropertyDescriptor(E, "innerHTML").set;
  var origReplaceChildren = E.replaceChildren, origReplaceWith = E.replaceWith, origBefore = E.before, origAfter = E.after, origPrepend = E.prepend, origAppend = E.append;
  // Parsed INERTLY, as the native setters do: a template's content, where a script is marked as already started and never
  // runs when the nodes are moved into the page (createContextualFragment would make it run). Markup for an svg or math
  // element is parsed inside a wrapper of that kind, so its elements get the right namespace.
  var SVG = "http://www.w3.org/2000/svg", MATH = "http://www.w3.org/1998/Math/MathML";
  function parse(ctx, html) {
    var t = createEl.call(document, "template"), text = html == null ? "" : String(html);
    var ns = ctx && typeOf.call(ctx) === 1 ? nsOf.call(ctx) : null, local = ns ? nameOf.call(ctx) : "";
    // foreignObject (and annotation-xml) are HTML integration points: their content is HTML, as natively.
    var wrap = ns === SVG && local !== "foreignObject" ? "svg" : ns === MATH && local !== "annotation-xml" ? "math" : null;
    // Table and select contexts are parsed inside the same structure, so "<tr>" for a table gets its implicit tbody and
    // "<tr>" for a tbody does not, as natively. depth: how many wrapper levels to step into.
    var html5 = ns === "http://www.w3.org/1999/xhtml";
    var nest = !html5 ? null : local === "table" ? ["<table>", "</table>", 1] : /^(tbody|thead|tfoot)$/.test(local) ? ["<table><" + local + ">", "</" + local + "></table>", 2] : local === "tr" ? ["<table><tbody><tr>", "</tr></tbody></table>", 3] : local === "select" ? ["<select>", "</select>", 1] : null;
    innerSet.call(t, wrap ? "<" + wrap + ">" + text + "</" + wrap + ">" : nest ? nest[0] + text + nest[1] : text);
    var f = t.content;
    if ((wrap || nest) && f.firstChild) {
      // The wrapper's children, then whatever the parser moved out of the wrapper (it follows it).
      var w = f.firstChild, out = document.createDocumentFragment(), r = range.call(document);
      for (var d = 1; nest && d < nest[2] && w.lastChild; d++) w = w.lastChild;
      selectContents.call(r, w); out.appendChild(r.extractContents());
      var top = f.firstChild; while (top.nextSibling) out.appendChild(top.nextSibling);
      f = out;
    }
    clean(f);
    return f;
  }
  /** Elements whose content is text, not markup (RAWTEXT and RCDATA): innerHTML sets their text, as natively. */
  var TEXT_ONLY = /^(style|textarea|title|xmp|noscript|noembed|noframes|plaintext|script|iframe)$/;
  lock(Range.prototype, "createContextualFragment", function (html) { var f = ccf.call(this, html); clean(f); return f; });
  // A template's markup goes to its content (an inert fragment), read with the saved getter; a fragment's children are
  // replaced with the saved DocumentFragment method.
  var contentOf = Object.getOwnPropertyDescriptor(HTMLTemplateElement.prototype, "content").get, fragReplace = DocumentFragment.prototype.replaceChildren;
  var isTemplate = function (el) { return nameOf.call(el) === "template" && nsOf.call(el) === "http://www.w3.org/1999/xhtml"; };
  // innerHTML, and setHTMLUnsafe on an element (the same fragment parsing, without declarative shadow roots here).
  function setInner(html) {
    if (isTemplate(this)) { innerSet.call(this, html); clean(contentOf.call(this)); return; }
    // Natively these parse to text only (RCDATA decodes entities, raw text does not); no element can be created there, so
    // the saved native setter is both safe and exact.
    if (TEXT_ONLY.test(nameOf.call(this)) && nsOf.call(this) === "http://www.w3.org/1999/xhtml") { innerSet.call(this, html == null ? "" : String(html)); return; }
    origReplaceChildren.call(this, parse(this, html));
  }
  lockSetter(E, "innerHTML", setInner);
  if (window.ShadowRoot) { var shadowSet = (Object.getOwnPropertyDescriptor(ShadowRoot.prototype, "innerHTML") || {}).set; if (shadowSet) lockSetter(ShadowRoot.prototype, "innerHTML", function (html) { var t = createEl.call(document, "template"); innerSet.call(t, html); clean(t.content); this.replaceChildren(t.content); }); }
  lockSetter(E, "outerHTML", function (html) { origReplaceWith.call(this, parse(this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null, html)); });
  lock(E, "insertAdjacentHTML", function (where, html) {
    var w = String(where).toLowerCase(), outside = w === "beforebegin" || w === "afterend";
    var f = parse(outside ? (this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null) : this, html);
    if (w === "beforebegin") origBefore.call(this, f); else if (w === "afterbegin") origPrepend.call(this, f); else if (w === "beforeend") origAppend.call(this, f); else if (w === "afterend") origAfter.call(this, f); else throw new DOMException("insertAdjacentHTML: bad position", "SyntaxError");
  });
  // setHTML is the browser's sanitizer: it keeps its own semantics (no scripts, no handlers), and the guard cleans its
  // result. setHTMLUnsafe is parsed inertly like innerHTML (declarative shadow roots in it are not created).
  [E, window.ShadowRoot && ShadowRoot.prototype].forEach(function (P) {
    if (!P) return;
    // The sanitizer runs on a detached element (nothing in it is fetched), the guard cleans that, and only then are the
    // nodes moved in: a sanitizer config that keeps <link> or <base> cannot connect them first.
    // The receiver keeps its type: an element sanitizes into a detached element of the same namespace and local name (a
    // tbody parses "<tr>" as rows), a ShadowRoot into a detached shadow root.
    var safe = P.setHTML; if (typeof safe === "function") lock(P, "setHTML", function () {
      var shadow = window.ShadowRoot && this instanceof ShadowRoot;
      var tmp = shadow ? E.attachShadow.call(createEl.call(document, "div"), { mode: "open" }) : createNS.call(document, nsOf.call(this), nameOf.call(this));
      safe.apply(tmp, arguments);
      // A template sanitizes into its content, as natively.
      var into = !shadow && isTemplate(this), src = into ? contentOf.call(tmp) : tmp;
      clean(src);
      var f = document.createDocumentFragment(); while (src.firstChild) f.appendChild(src.firstChild);
      if (into) fragReplace.call(contentOf.call(this), f); else this.replaceChildren(f);
    });
    if (typeof P.setHTMLUnsafe === "function") lock(P, "setHTMLUnsafe", function (html) { if (P === E) return setInner.call(this, html); var f = parse(this.host || this, html); this.replaceChildren(f); });
  });
  if (Document.parseHTMLUnsafe) lock(Document, "parseHTMLUnsafe", function () { refuse("parsed document"); });
  var parseFrom = DOMParser.prototype.parseFromString;
  lock(DOMParser.prototype, "parseFromString", function () { var d = parseFrom.apply(this, arguments); if (d && d.documentElement) clean(d.documentElement); return d; });
  ["write", "writeln", "open"].forEach(function (k) { lock(D, k, function () { refuse("document." + k); }); });
  ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "RTCIceTransport"].forEach(function (k) { if (k in window) lock(window, k, undefined); });
  // A backstop for any insertion route not listed above: added blocked elements are removed (possibly after a request
  // started, which is why the routes above come first). The observer was made before author code and is not reachable.
  new MutationObserver(function (ms) { for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].addedNodes.length; j++) { var n = ms[i].addedNodes[j]; if (bad(n)) remove.call(n); else clean(n); } }).observe(document.documentElement, { childList: true, subtree: true });
})();
`;

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
  fail("Blocked by the sandbox (" + e.effectiveDirective + "): " + (e.blockedURI || "inline") + ". A preview must not use the network, forms or popups; the sandbox blocks this one. Put images in data: URLs and code inline; brand logos from clay.data.brand.logos are allowed.");
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
  // New values can change the height of the content. A browser pauses resize observation in a frame that is outside the
  // screen (the preview under a long list of controls on a phone), so the height is also measured here: once, shortly
  // after the values (one pending timer, however many messages a drag sends). reportHeight keeps its limit of one
  // message per second.
  if (!measure) measure = setTimeout(function () { measure = null; reportHeight(); }, 80);
});
window.clay = Object.freeze({
  get values() { return view(); },
  data: cfg.data,
  onChange: function (fn) { if (typeof fn === "function") { listeners.push(fn); call(fn); } }
});
draw();
window.addEventListener("load", function () { setTimeout(function () { post({ type: "ready" }); }, 0); });
// The height of the content, so the page can size the frame to it. At most one report per second, and only on a change:
// an animation that resizes on every frame cannot flood the page (it counts the messages and stops a preview at 30 in 10 s).
var lastH = 0, lastT = 0, later = null, measure = null;
function contentHeight() {
  var h = 0, kids = root.children;
  for (var i = 0; i < kids.length; i++) { var r = kids[i].getBoundingClientRect(); h = Math.max(h, r.bottom + window.scrollY + (parseFloat(getComputedStyle(kids[i]).marginBottom) || 0)); }
  return Math.ceil(h);
}
function reportHeight() {
  var h = Math.min(contentHeight(), 4000), now = Date.now(); // the page accepts up to MAX_FRAME_HEIGHT
  if (Math.abs(h - lastH) < 2) return;
  if (now - lastT < 1000) { if (!later) later = setTimeout(function () { later = null; reportHeight(); }, 1000 - (now - lastT)); return; }
  lastH = h; lastT = now;
  post({ type: "height", height: h });
}
if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(root);
window.addEventListener("load", reportHeight);`;

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
<script>${HARDEN}(function () { var cfg = ${inScript(cfg)};${BRIDGE_PURE}${BRIDGE_DOM}
})();</script>
<script>`;
  };
  // The line of the last <script> tag, so an error in view.js is reported with its own line number.
  const jsLine = head(0).split("\n").length;
  return `${head(jsLine)}\n${js}\n</script>\n</body>\n</html>\n`;
}

// ---- Page side of the bridge.

export type FrameMessage = { type: "ready" } | { type: "error"; message: string } | { type: "height"; height: number };
/** The largest content height the page accepts from a frame, in CSS pixels. */
export const MAX_FRAME_HEIGHT = 4000;

/**
 * Validate a message from the frame. Only the three known shapes pass; only `type`, `message` and `height` are read, the
 * message is cut to 500 characters and the height must be a number from 1 to MAX_FRAME_HEIGHT, so what the page keeps is
 * bounded whatever the frame sends.
 * The caller checks the source window and the origin ("null": the frame's origin is opaque).
 */
export function fromFrame(data: unknown): FrameMessage | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as { clay?: unknown; type?: unknown; message?: unknown };
  if (d.clay !== 1) return null;
  if (d.type === "ready") return { type: "ready" };
  if (d.type === "error" && typeof d.message === "string") return { type: "error", message: d.message.slice(0, 500) };
  const h = (d as { height?: unknown }).height;
  if (d.type === "height" && typeof h === "number" && Number.isFinite(h) && h >= 1 && h <= MAX_FRAME_HEIGHT) return { type: "height", height: Math.round(h) };
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
