#!/usr/bin/env node
// Prototype A: the real rendered component, with the app's own compiled CSS, as static markup for Clay's hosted preview.
// It opens a page of the RUNNING app in a headless browser, takes the markup of one element as the app rendered it,
// and keeps only the CSS rules of the page that apply to that element and its children (hover, focus, disabled and
// dark variants included), the theme variables, registered properties and keyframes those rules use.
//
//   node snapshot.mjs --url http://localhost:3000/dashboard --selector 'button:has-text("Deploy")' --out .clay/snapshot/deploy
//        [--click '<selector>']   click this first (to open a dialog)   [--wait 500]   [--width 1280]
// Writes <out>/snapshot.html, snapshot.css and snapshot.json (sizes, the fonts the page uses, what is not carried).
// Needs playwright-core and a Chromium (CHROME=/path/to/chromium). Nothing is sent anywhere: it reads your local app.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const url = arg("url"), selector = arg("selector"), out = arg("out", ".clay/snapshot");
if (!url || !selector) { console.error("Give --url and --selector."); process.exit(2); }
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/snap/bin/chromium" });
const page = await browser.newPage({ viewport: { width: Number(arg("width", 1280)), height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
if (arg("click")) await page.locator(arg("click")).first().click();
await page.waitForTimeout(Number(arg("wait", 500)));
const target = page.locator(selector).first();
if (!(await target.count())) { console.error(`No element for ${selector} on ${url}.`); await browser.close(); process.exit(1); }
await target.evaluate((el) => el.setAttribute("data-clay-snapshot", ""));

const snap = await page.evaluate(() => {
  const root = document.querySelector("[data-clay-snapshot]");
  const els = [root, ...root.querySelectorAll("*")];
  const html = document.documentElement;
  // A rule applies when its selector matches an element in any state: the state pseudo-classes are taken out for the test.
  const bare = (s) => s.replace(/::?(hover|focus-visible|focus-within|focus|active|disabled|enabled|checked|visited|placeholder-shown|placeholder|before|after|selection|marker|file-selector-button|backdrop|autofill|-webkit-[a-z-]+|-moz-[a-z-]+)\b/g, "") || "*";
  const applies = (sel) => { try { const b = bare(sel); return els.some((e) => e.matches(b)); } catch { return false; } };
  const onRoot = (sel) => { try { return html.matches(sel) || document.body.matches(sel); } catch { return false; } };
  const kept = [], keyframes = new Map(), properties = new Map(), rootRules = [];
  const walk = (rules, wrap) => {
    for (const r of rules) {
      if (r instanceof CSSStyleRule) {
        const parts = r.selectorText.split(/,(?![^(]*\))/).map((s) => s.trim());
        const hit = parts.filter(applies);
        // Declarations of this rule only (nested rules are walked below), so nothing is kept twice.
        if (hit.length && r.style.length) kept.push(wrap(`${hit.join(", ")} { ${r.style.cssText} }`));
        if (parts.some(onRoot)) rootRules.push({ wrap, rule: r });
        if (r.cssRules?.length) walk(r.cssRules, (t) => wrap(`${r.selectorText} { ${t} }`));
      } else if (r instanceof CSSKeyframesRule) keyframes.set(r.name, r.cssText);
      else if (typeof CSSPropertyRule !== "undefined" && r instanceof CSSPropertyRule) properties.set(r.name, r.cssText);
      else if (r.cssRules) {
        const head = r.cssText.slice(0, r.cssText.indexOf("{")).trim();
        walk(r.cssRules, (t) => wrap(`${head} { ${t} }`));
      }
    }
  };
  const passes = [false, true]; // light, then dark: rules of both are kept
  const had = html.classList.contains("dark");
  const seen = new Set();
  for (const dark of passes) {
    html.classList.toggle("dark", dark);
    kept.length = 0;
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, (t) => t); } catch {} }
    for (const k of kept) seen.add(k);
  }
  html.classList.toggle("dark", had);
  let css = [...seen];
  // The custom properties, registered properties and keyframes that the kept rules use, followed through their own values.
  const used = new Set();
  const collect = (text) => { for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1]); };
  css.forEach(collect);
  const decls = new Map(); // "selector" -> {name: value}
  for (let round = 0; round < 6; round++) {
    const before = used.size;
    for (const { rule } of rootRules) for (const name of rule.style) if (name.startsWith("--") && used.has(name)) {
      const value = rule.style.getPropertyValue(name);
      const block = decls.get(rule.selectorText) ?? decls.set(rule.selectorText, {}).get(rule.selectorText);
      block[name] = value; collect(value);
    }
    if (used.size === before) break;
  }
  const names = new Set(css.flatMap((t) => [...t.matchAll(/animation(?:-name)?:\s*([^;}]+)/g)].flatMap((m) => m[1].split(/[\s,]+/))));
  const cs = getComputedStyle(root.parentElement ?? document.body);
  const fonts = [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, ""));
  return {
    html: root.outerHTML.replace(' data-clay-snapshot=""', ""),
    css: [
      ...[...properties].filter(([n]) => used.has(n)).map(([, t]) => t),
      ...[...decls].map(([sel, d]) => `${sel} { ${Object.entries(d).map(([n, v]) => `${n}: ${v};`).join(" ")} }`),
      ...css,
      ...[...keyframes].filter(([n]) => names.has(n)).map(([, t]) => t),
    ].join("\n"),
    inherited: { "font-family": cs.fontFamily, "font-size": cs.fontSize, "line-height": cs.lineHeight, color: cs.color, "background-color": getComputedStyle(document.body).backgroundColor },
    fonts: [...new Set(fonts)],
    box: (({ width, height }) => ({ width: Math.round(width), height: Math.round(height) }))(root.getBoundingClientRect()),
    darkNow: had,
  };
});
await browser.close();
mkdirSync(out, { recursive: true });
// The wrapper carries what the element inherits on the real page (type, colour, background), so it does not depend on the frame.
const wrapper = `<div class="clay-root" style="${Object.entries(snap.inherited).map(([k, v]) => `${k}: ${v}`).join("; ").replace(/"/g, "'")}">\n${snap.html}\n</div>`;
writeFileSync(`${out}/snapshot.html`, wrapper);
writeFileSync(`${out}/snapshot.css`, snap.css);
const note = { url, selector, htmlChars: wrapper.length, cssChars: snap.css.length, box: snap.box, inherited: snap.inherited, webFontsOfThePage: snap.fonts, notCarried: ["web fonts (the hosted frame loads no font file: the family falls back)", "images and background images by URL", "behaviour: React state and handlers are not in static markup"], dark: "rules for both light and dark are kept; add class \"dark\" on a wrapper to show dark" };
writeFileSync(`${out}/snapshot.json`, JSON.stringify(note, null, 1));
console.log(JSON.stringify(note));
