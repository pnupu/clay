import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { frameCsp, frameDocument } from "./frame.ts";
import { styleProblems, type KitState } from "./kit.ts";
import { BUTTON_EXAMPLE, KIT_REFERENCE, MODEL_EXAMPLE } from "./reference.ts";
import { DATA_PARTS, dataSheet } from "./sheet.ts";
import { parseSpec, toSpec, type Spec } from "./spec.ts";
import type { Playground } from "./store.ts";

const parsed = (s: unknown) => {
  const r = parseSpec(s);
  assert.ok(r.ok && r.kind === "preview", JSON.stringify(r));
  return r;
};
const state = (s: unknown): KitState => ({ kit: parsed(s).kit, brandData: null, brandError: null, preview: { status: "unverified", error: null, at: null }, settled: null, exploration: null });
const model = (view: object) => ({ ...MODEL_EXAMPLE, view: { ...MODEL_EXAMPLE.view, ...view } });

test("view.data makes a data view: the kit keeps the mark, a spec made from it has it, and every other kit is as before", () => {
  assert.equal(parsed(MODEL_EXAMPLE).kit.preview.data, true);
  assert.equal("data" in parsed(BUTTON_EXAMPLE).kit.preview, false);
  assert.equal("data" in parsed({ ...BUTTON_EXAMPLE, view: { ...BUTTON_EXAMPLE.view, data: false } }).kit.preview, false);
  const stored = (s: Spec) => ({ domain: parsed(s).domain, kit: state(s) }) as unknown as Playground;
  assert.equal(toSpec(stored(MODEL_EXAMPLE)).view.data, true);
  assert.equal("data" in toSpec(stored(BUTTON_EXAMPLE)).view, false);
  // Sorvi's styles and Tailwind's reset do not go together, and a price lab has no preview to style.
  const both = parseSpec({ ...BUTTON_EXAMPLE, view: { ...BUTTON_EXAMPLE.view, data: true } });
  assert.ok(!both.ok && both.errors.some((e) => /view\.data and view\.tailwind do not go together/.test(e)));
  const price = parseSpec({ id: "mail-price", title: "Which email service should we use?", view: { type: "price_ranking", data: true }, data: { price_pages: { product: "transactional email API", metrics: [{ id: "emails", label: "Emails per month", unit: "emails", describe: "emails sent per month", min: 1000, max: 100000, initial: 10000 }], vendors: [{ id: "one", name: "One", domain: "one.example.org" }, { id: "two", name: "Two", domain: "two.example.org" }] } } });
  assert.ok(!price.ok && price.errors.some((e) => /view\.data: only a preview view has data/.test(e)));
});

test("the frame of a data view brings Sorvi's styles and typeface; no other frame does, and the policy is the same", () => {
  const font = "data:font/woff2;base64,AAAA";
  const doc = frameDocument(state(MODEL_EXAMPLE), {}, "", font);
  assert.ok(doc.includes(dataSheet(font)));
  assert.ok(doc.includes(`src: url(${font}) format("woff2")`));
  // The agent's own css comes after the sheet, so a line of it still wins.
  assert.ok(doc.indexOf(dataSheet(font)) < doc.indexOf('<style id="clay-css">'));
  // Without the font file the sheet names no font to load: the text falls back to the system typeface.
  assert.equal(frameDocument(state(MODEL_EXAMPLE), {}).includes("@font-face"), false);
  assert.equal(frameDocument(state(BUTTON_EXAMPLE), {}, "", font).includes("--accent-bg"), false);
  // A font from a data: URL was allowed before data views existed: the policy of a data view is that of the same preview without the mark.
  assert.equal(frameCsp(state(MODEL_EXAMPLE)), frameCsp(state(model({ data: undefined }))));
  assert.match(frameCsp(state(MODEL_EXAMPLE)), /font-src data:;/);
});

test("the reference teaches the parts the sheet styles, and the sheet has no text under 12 px", () => {
  const css = dataSheet(null);
  for (const part of DATA_PARTS) {
    assert.match(css, new RegExp(`\\.${part}(?![\\w-])`), `the sheet styles .${part}`);
    assert.match(KIT_REFERENCE, new RegExp(`(?:[.\\s"]|class=")${part}(?![\\w-])`), `the reference names ${part}`);
  }
  assert.deepEqual([...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1])).filter((n) => n < 12), []);
  assert.equal(css.includes("</"), false); // it stands inside a <style> element
  // The head of a column of numbers may wrap, or five columns do not fit a frame of about 500 px (worked example 3).
  // The rule for a th weighs as much as the rule for .num, so it must come after it.
  // No later rule for .num brings nowrap back.
  const nowrap = [...css.matchAll(/\.num\b[^{}]*\{[^}]*white-space: nowrap/g)].map((m) => m.index);
  const wraps = css.search(/:where\(th\)\.num \{[^}]*white-space: normal/);
  assert.ok(nowrap.length === 1 && wraps > nowrap[0], "a number stays on one line, and the head of its column may wrap");
  // A badge may wrap in itself: a long one must not push its card or its column wider than a narrow frame.
  assert.doesNotMatch(css, /\.badge\b[^{}]*\{[^}]*nowrap/);
  assert.match(KIT_REFERENCE, /## A data view \(view\.data: true\)/);
});

test("the colours of a data view are the page's own: every colour of the sheet's variables is in the page's tokens", () => {
  // The sheet is a string in a sandboxed frame and cannot read the page's variables, so it states the values again.
  // This keeps them equal: a change of the palette (app/tokens.ts, app/clay.css) fails here until the sheet follows.
  const page = (readFileSync(new URL("../app/tokens.ts", import.meta.url), "utf8") + readFileSync(new URL("../app/clay.css", import.meta.url), "utf8")).toLowerCase();
  const root = dataSheet(null).match(/:root \{([^}]*)\}/)![1];
  // Each variable of the sheet against the page's token of the same meaning, by name.
  const value = (text: string, name: string) => text.match(new RegExp(`(?<![\\w-])${name}:\\s*(#[0-9a-f]{6})\\b`))?.[1];
  const same = { "--ink": "--p-ink", "--muted": "--p-muted", "--accent": "--p-accent", "--pane": "--c-pane", "--field": "--c-field", "--ok": "--ok", "--ok-bg": "--ok-bg", "--warn": "--warn", "--warn-bg": "--warn-bg", "--bad": "--bad", "--bad-bg": "--bad-bg" };
  for (const [mine, pages] of Object.entries(same)) {
    assert.ok(value(root, mine), `the sheet has ${mine}`);
    assert.equal(value(root, mine), value(page, pages), `${mine} of the sheet is ${pages} of the page`);
  }
  // The hairlines are the page's ink (38 37 30 is #26251e) at the page's shares.
  assert.match(root, /--ink: #26251e;/);
  assert.match(root, /--line: rgb\(38 37 30 \/ 0\.13\); --line-2: rgb\(38 37 30 \/ 0\.3\);/);
  assert.match(page, /--c-line: color-mix\(in oklab, var\(--p-ink\) 13%, transparent\)/);
  assert.match(page, /--c-line-2: color-mix\(in oklab, var\(--p-ink\) 30%, transparent\)/);
});

test("the look of a page is checked in a time that grows with its length: a view.css written to be slow costs milliseconds", () => {
  // The check runs on what an agent sends, before anything is stored. Each of these took seconds to hours with a
  // pattern that could start a number or a value at every character: 20,000 characters is the largest view.css.
  const hostile: Record<string, string> = {
    "a run of digits with no unit": `.a { font-size: ${"1".repeat(19_980)} }`,
    "colons before a brace": `${":".repeat(19_999)}{`,
    "colons with no end": ":".repeat(20_000),
    "colour functions that are never closed": `.a { color: ${"rgb(".repeat(4_990)} }`,
    "font declarations with no end": "font: ".repeat(3_333),
    "comments that are never closed": "/*".repeat(10_000),
    "placeholders that are never closed": "{{".repeat(10_000),
    "one placeholder with no end": `{{${"a".repeat(19_998)}`,
    "a placeholder that opens before a run of spaces": `{{${" ".repeat(19_998)}`,
    "a function that is never closed in a font": `.a { font: ${"calc(".repeat(3_990)} }`,
  };
  // A toggle text of the largest size, used as often as view.css has room for: the fill stops at its limit.
  const long = { id: "tg", type: "toggle" as const, label: "T", meaning: "m", initial: true, on: `font-size: 13px; ${"a".repeat(1_980)}`, off: "" };
  hostile["a long toggle text used 3,333 times"] = "{{tg}}".repeat(3_333);
  for (const [what, css] of Object.entries(hostile)) {
    const start = performance.now();
    styleProblems({ preview: { html: `<p${' style="font: 1"'.repeat(1_000)}>x</p>`, css, data: true }, controls: [long] });
    const ms = performance.now() - start;
    assert.ok(ms < 500, `${what}: ${Math.round(ms)} ms`);
  }
});

test("a page of data in styles of its own is a problem for the agent that builds it; a data view with Sorvi's parts has none", () => {
  assert.deepEqual(parsed(MODEL_EXAMPLE).warnings, []);
  // Web facts without view.data: told to become a data view. A map with web facts is not a table.
  const plain = parsed(model({ data: undefined, css: "table { font: 14px system-ui; }" }));
  assert.equal(plain.warnings.length, 1);
  assert.match(plain.warnings[0], /^view: this preview shows facts read from web pages \(data\.web\) in styles of its own\. Make it a data view: set view\.data: true/);
  assert.deepEqual(styleProblems({ preview: { html: "", css: "", map: true }, web: [{}] }), []);
  // Neither is the person's own Tailwind component with a fact in it: view.data is refused with view.tailwind, so the advice could not be followed.
  assert.deepEqual(styleProblems({ preview: { html: "", css: "", tailwind: true }, web: [{}] }), []);
  assert.equal(styleProblems({ preview: { html: "", css: "" }, web: [{}] }).length, 1);
  assert.deepEqual(styleProblems({ preview: { html: "", css: "p { font: 11px system-ui; color: #123456; }" }, web: null }), []);
  // A data view that brings a typeface, small text and colours is told about each, with what it found.
  const own = parsed(model({ css: "#rows td { font-family: Inter; font-size: 11px; } .a { color: #111827; background: #EFF6FF; border-color: rgb(1, 2, 3); } #add { font-size: 13px }", html: `${MODEL_EXAMPLE.view.html}<p style="font-size: 10.5px; color: #9ca3af">x</p>` })).warnings;
  assert.equal(own.length, 3);
  assert.match(own[0], /a data view \(view\.data\) has Sorvi's typeface/);
  assert.match(own[1], /font-size 11px, 10\.5px is under 12 px/);
  assert.match(own[2], /4 colours of its own \(#111827, #eff6ff, rgb\(1,2,3\), #9ca3af\)/);
  // The size in the font shorthand and a size in rem are read too.
  const data = (css: string) => styleProblems({ preview: { html: "", css, data: true } });
  assert.match(data("td { font: 500 10px/1.2 sans-serif }").join("\n"), /Sorvi's typeface[\s\S]*font-size 10px is under 12 px/);
  assert.match(data(".x { font-size: .65rem }")[0], /font-size \.65rem is under 12 px/);
  // The variables, a size of 12 px or more and up to two colours of its own (a brand colour, a series) are fine. An id
  // in a selector is not a colour, also in a list of selectors over two lines, and one colour written in three ways is one.
  assert.deepEqual(parsed(model({ css: "li:hover #add,\n#bad { color: var(--muted); font-size: 13px; font-weight: 600; } .series-a { background: #2a78d6; } .series-b { background: #eb6834; }" })).warnings, []);
  assert.deepEqual(data(".a { color: #fff; background: #FFFFFF; border-color: #ffffffff; outline-color: #2a78d6 }"), []);
  // One colour in several spellings of its spaces is one colour: two colours here, so nothing is said.
  assert.deepEqual(data(".a { color: rgb(1 10 0); border-color: rgb( 1  10 0 ); background: rgb(0 0 0 / 0.5); outline-color: rgb(0 0 0/0.5); fill: rgb(0 0 0 /0.5) }"), []);
  // Two colours that differ only in where their spaces are stay two colours: with a third, three.
  assert.match(data(".a { color: rgb(1 10 0); background: rgb(11 0 0); outline-color: #2a78d6 }")[0], /3 colours of its own \(rgb\(1 10 0\), rgb\(11 0 0\), #2a78d6\)/);
  // A comment is not a style: in view.css, in a style attribute, and one that is never closed.
  assert.deepEqual(data("/* td { font: 10px x; color: #111; background: #222; border-color: #333; } */ .a { margin: 0 }"), []);
  assert.deepEqual(data(".a { margin: 0 } /* old: td { font: 10px x; color: #111; background: #222; border-color: #333; }"), []);
  assert.deepEqual(styleProblems({ preview: { html: '<p style="/* font: 10px x; color: #111 */ margin: 0">x</p>', css: "", data: true } }), []);
  // A declaration ends with its own source: the size in the next style attribute is not read as its size, after a
  // comment that is never closed and after a view.css that does not close its last rule.
  assert.deepEqual(styleProblems({ preview: { html: '<p style="font-size: 1em /* n"><b style="padding: 4px">x</b></p>', css: "", data: true } }), []);
  assert.deepEqual(styleProblems({ preview: { html: '<b style="padding: 4px">x</b>', css: ".a { font-size: 1em", data: true } }), []);
  // The styles are read as the page opens: every {{control_id}} is filled with the start value of its control.
  const controls = parsed({
    ...MODEL_EXAMPLE,
    controls: [
      ...MODEL_EXAMPLE.controls!,
      { id: "size", type: "slider", label: "Text size", meaning: "font-size of the table in px", min: 6, max: 20, initial: 9, unit: "px" },
      { id: "big", type: "slider", label: "Head size", meaning: "font-size of the head in px", min: 12, max: 30, initial: 16, unit: "px" },
      { id: "face", type: "select", label: "Typeface", meaning: "font of the buttons", initial: "inherit", options: [{ value: "inherit" }, { value: "Inter" }] },
      { id: "shadow", type: "toggle", label: "Shadow", meaning: "box-shadow of a card", initial: true, on: "box-shadow: 0 1px 2px #111111;", off: "" },
      { id: "ink", type: "color", label: "Text colour", meaning: "colour of the head", initial: "#444444" },
    ],
    view: { ...MODEL_EXAMPLE.view, css: "td { font-size: {{size}}px } th { font-size: calc({{big}} * 1px); color: {{ ink }} } button { font: {{face}} } .card { {{shadow}} border-color: #222222; outline-color: #333333 }" },
  });
  // The slider that starts at 9 px is small text; the one that starts at 16 px is not. "inherit" from a control is no
  // typeface. The declaration inside the toggle text and the ones after it are all read: three colours; the colour of
  // a colour control is the person's to tune and is not counted. A term of calc() is not a size.
  const look = controls.warnings.filter((w) => w.startsWith("view.css"));
  assert.equal(look.length, 2, look.join("\n"));
  assert.match(look[0], /font-size 9px is under 12 px/);
  assert.match(look[1], /3 colours of its own \(#111111, #222222, #333333\)/);
  // A name that is no control is read as one word: the declaration around it stays whole.
  assert.match(data(".a { font-family: {{face}} }")[0], /Sorvi's typeface/);
  assert.match(data(".a { font: 600 10px/{{lh}} Arial }").join("\n"), /Sorvi's typeface[\s\S]*font-size 10px is under 12 px/);
  assert.deepEqual(data(".a { font-size: {{size}}px; color: {{ink}} }"), []);
  // The size before a function is read; the sizes inside one are not.
  assert.match(data(".a { font: 10px/1.2 var(--mono) }").join("\n"), /font-size 10px is under 12 px/);
  assert.deepEqual(data(".a { font-size: clamp(8px, 1vw, 10px) } .b { font-size: calc(var(--s) * 1px) }"), []);
  // A group of brackets of its own, a deep nesting and a function that is never closed: the size is not known, so nothing is said.
  assert.deepEqual(data(".a { font-size: calc((8px + 1vw) * 1.5) } .b { font-size: calc(1px * (2 + (3 + (4 + min(9px, 1vw))))) } .c { font-size: max(10px, 1vw }"), []);
  // Styles that fill to more than the limit are not judged: a long toggle text, named 150 times before a small size.
  const long = { id: "tg", type: "toggle" as const, label: "T", meaning: "m", initial: true, on: "a".repeat(2_000), off: "" };
  assert.deepEqual(styleProblems({ preview: { html: "", css: `.a { ${"{{tg}}".repeat(150)} } td { font-size: 9px } b { font: {{tg}} }`, data: true }, controls: [long] }), []);
  assert.equal(styleProblems({ preview: { html: "", css: `.a { ${"{{tg}}".repeat(50)} } td { font-size: 9px }`, data: true }, controls: [long] }).length, 1);
  // url(#grad) names a gradient or a clip path of a chart, not a colour.
  assert.deepEqual(data(".a { fill: url(#abc); stroke: url( '#def'); mask: url(#fed); color: #2a78d6 }"), []);
  // "font: inherit" takes Sorvi's typeface (a button does not by itself), and ".font:hover" is a selector.
  assert.deepEqual(data("button { font: inherit } .font:hover { font-weight: 600 }"), []);
});
