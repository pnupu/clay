#!/usr/bin/env node
// Fidelity of a preview against the real thing: the same element on the real page of the app and in a playground
// (Clay's hosted preview frame, or a route of the app itself), screenshot at the same viewport, and the computed
// style of both side by side.
//   node compare.mjs --real <url> --play <url> --text "<visible text of the element>" --out <dir> --name <name>
//        [--real-click '<selector>'] [--play-click '<selector>'] [--tag button] [--key-env CLAY_ACCESS_KEY]
// For a Clay playground the key (owner or agent key) signs the browser in through /enter.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const real = arg("real"), play = arg("play"), text = arg("text"), out = arg("out", "."), name = arg("name", "cmp"), tag = arg("tag", "*");
const key = process.env[arg("key-env", "CLAY_ACCESS_KEY")];
mkdirSync(out, { recursive: true });
const PROPS = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color", "background-color", "border-top-width", "border-top-color", "border-radius", "padding-top", "padding-right", "padding-bottom", "padding-left", "height", "width", "gap", "box-shadow", "transition-duration", "transition-timing-function", "animation-name", "animation-duration", "animation-timing-function", "opacity", "transform"];
const measure = ([t, tg, props]) => {
  const all = [...document.querySelectorAll(tg)].filter((e) => (e.textContent ?? "").trim().includes(t) && e.getBoundingClientRect().width > 0);
  // The smallest element that holds the text: the element itself, not a wrapper.
  const el = all.sort((a, b) => a.textContent.length - b.textContent.length)[0];
  if (!el) return null;
  el.setAttribute("data-cmp", "");
  const c = getComputedStyle(el);
  const font = c.fontFamily.split(",")[0].replace(/["']/g, "").trim();
  // Colours are compared as the pixel they paint: lab(), oklch() and rgb() are notations of the same colour.
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const paint = (v) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = v; ctx.fillRect(0, 0, 1, 1); const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data; return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`; };
  return { tag: el.tagName.toLowerCase(), style: Object.fromEntries(props.map((p) => [p, /color$/.test(p) ? paint(c.getPropertyValue(p)) : c.getPropertyValue(p)])), firstFontLoaded: document.fonts.check(`${c.fontSize} "${font}"`) && [...document.fonts].some((f) => f.family.replace(/["']/g, "") === font && f.status === "loaded"), svgIcons: el.querySelectorAll("svg").length, text: el.textContent.trim().slice(0, 60) };
};
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/snap/bin/chromium" });
const result = {};
for (const [side, url, click] of [["real", real, arg("real-click")], ["play", play, arg("play-click")]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (side === "play" && key && /\/p\//.test(url)) { await page.goto(`${new URL(url).origin}/enter#key=${key}`); await page.waitForURL((u) => u.pathname === "/" && !u.hash, { timeout: 20000 }).catch(() => {}); }
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  // A playground is measured at its start values, as the agent built it, not where a person left the controls.
  if (side === "play") { const back = page.getByRole("button", { name: /Back to the start values/ }); if (await back.count().catch(() => 0)) { await back.first().click().catch(() => {}); await page.waitForTimeout(800); } }
  // The element may be in the page or in the playground's sandboxed frame.
  const frames = page.frames();
  if (click) for (const f of frames) { const l = f.locator(click).first(); if (await l.count().catch(() => 0)) { await l.click().catch(() => {}); break; } }
  await page.waitForTimeout(900);
  let found = null, where = null;
  for (const f of frames) { found = await f.evaluate(measure, [text, tag, PROPS]).catch(() => null); if (found) { where = f; break; } }
  result[side] = found ?? { missing: true };
  if (where) await where.locator("[data-cmp]").first().screenshot({ path: `${out}/${name}-${side}-element.png` }).catch(() => {});
  await page.screenshot({ path: `${out}/${name}-${side}.png` });
  await page.close();
}
await browser.close();
const diff = result.real.style && result.play.style ? Object.fromEntries(PROPS.filter((p) => result.real.style[p] !== result.play.style[p]).map((p) => [p, { real: result.real.style[p], play: result.play.style[p] }])) : null;
const summary = { text, real: { url: real, fontLoaded: result.real.firstFontLoaded, svgIcons: result.real.svgIcons, missing: result.real.missing }, play: { url: play.replace(/#.*/, ""), fontLoaded: result.play.firstFontLoaded, svgIcons: result.play.svgIcons, missing: result.play.missing }, sameProps: diff ? PROPS.length - Object.keys(diff).length : null, of: PROPS.length, differences: diff };
writeFileSync(`${out}/${name}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
