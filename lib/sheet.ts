// The stylesheet of a data view (view.data: true): a comparison, a ranking or a table of facts, not the person's own
// component. An agent that writes such a page by hand invents a typeface, a type scale and a set of colours every time,
// and no two pages agree with each other or with the page around them. Here the frame brings Clay's own: the page's
// colours and typeface (app/tokens.ts, app/clay.css), one type scale, and the few parts a comparison needs. The agent
// writes markup with these class names and no styles of its own; lib/reference.ts teaches them, and checkKit()
// (lib/kit.ts) warns about a data view that brings its own fonts, small text or colours.
// A string, like the rest of the frame document. Only a preview with view.data gets it: every other preview keeps the
// bare frame, because it shows the person's own component in its own styles.

/** The colours of the page, by the names a data view uses. The same values as app/tokens.ts and app/clay.css. */
const TOKENS = `--ink: #26251e; --muted: #5a5850; --pane: #ecebe8; --field: #f5f4f2; --accent: #2456d6;
  --line: rgb(38 37 30 / 0.13); --line-2: rgb(38 37 30 / 0.3); --tone: rgb(38 37 30 / 0.09);
  --accent-bg: color-mix(in oklab, var(--accent) 11%, var(--field));
  --ok: #1d5e2a; --ok-bg: #d5e3d0; --warn: #744500; --warn-bg: #ecdcc0; --bad: #9c241c; --bad-bg: #edd5d1; --r: 6px;`;

/**
 * The stylesheet. `font`: the page's text typeface (Figtree) as a data: URL, which the frame's policy allows
 * (font-src data:); without it the text falls back to the system typeface, and nothing else changes.
 * The smallest text is 12 px (a badge) and the body is 15 px. Top-level blocks and the blocks inside a card or a
 * details keep one rhythm, so the markup needs no margins. The margin reset and the rhythm of the top-level blocks are
 * written with :where(), so they weigh nothing: a part's own distance (.lead + p) and a line of view.css win over them.
 */
export const dataSheet = (font: string | null): string => `${font ? `@font-face { font-family: "Figtree"; font-style: normal; font-weight: 400 600; font-display: swap; src: url(${font}) format("woff2"); }\n` : ""}:root { ${TOKENS} }
html, body { background: transparent; }
body { color: var(--ink); font: 15px/1.45 "Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }
*, *::before, *::after { box-sizing: border-box; }
:where(h2, h3, h4, p, ul, ol, dl, dd, table, figure, blockquote) { margin: 0; }
:where(#clay-root) > * + * { margin-top: 16px; }
.card > * + *, details > * + *, .note > * + * { margin-top: 6px; }
h2 { font-size: 17px; line-height: 1.3; font-weight: 500; letter-spacing: -0.01em; }
h3, h4 { font-size: 13px; line-height: 1.4; font-weight: 500; color: var(--muted); }
b, strong { font-weight: 600; }
small, .small { font-size: 13px; }
.muted { color: var(--muted); }
.ok { color: var(--ok); } .warn { color: var(--warn); } .bad { color: var(--bad); }
ul, ol { padding-left: 1.2em; } li + li { margin-top: 4px; }
/* The answer: one sentence, first on the page. */
.lead { font-size: 21px; line-height: 1.25; font-weight: 500; letter-spacing: -0.02em; text-wrap: balance; }
.lead + p { margin-top: 6px; }
/* A table: one row per option. The pick is marked, an option outside the person's limits is dimmed.
   The frame has a 10 px gutter (#clay-root) and a table reaches into it: the text of a cell stands on the same line as
   the text around the table, and the ground of a marked row runs from edge to edge. */
#clay-root { padding: 0 10px; }
table { width: calc(100% + 20px); margin-left: -10px; margin-right: -10px; border-collapse: collapse; }
.scroll > table { width: 100%; margin-left: 0; margin-right: 0; }
th { text-align: left; font-size: 13px; line-height: 1.3; font-weight: 500; color: var(--muted); padding: 0 10px 6px; vertical-align: bottom; border-bottom: 1px solid var(--line-2); }
td { padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
/* A number stays on one line; a th may wrap (the head of a column, with or without a thead), so five columns fit a
   frame of about 500 px. Both rules weigh one class and the second comes later, so it wins over the first, and a
   line of view.css for .num wins over both. */
.num { text-align: right; white-space: nowrap; }
:where(th).num { white-space: normal; }
tr.pick > td { background: var(--accent-bg); font-weight: 600; }
tr.pick > td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
tr.out > td, .card.out { color: var(--muted); }
.scroll { max-width: 100%; overflow-x: auto; }
/* Cards: one per option, when an option has more to say than a row holds. */
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 10px; }
.card { background: var(--field); border: 1px solid var(--line); border-radius: var(--r); padding: 12px 14px; min-width: 0; }
.card.pick { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: var(--accent-bg); }
.card.out { background: transparent; }
.card h3, .card h4 { font-size: 16px; color: inherit; letter-spacing: -0.01em; }
/* A mark next to a name. */
.badge { display: inline-block; font-size: 12px; line-height: 1.6; font-weight: 500; padding: 0 8px; border-radius: 999px; background: var(--tone); color: var(--ink); white-space: nowrap; vertical-align: 1px; }
.badge.pick { background: var(--accent); color: #fff; }
.badge.ok { background: var(--ok-bg); color: var(--ok); } .badge.warn { background: var(--warn-bg); color: var(--warn); } .badge.bad { background: var(--bad-bg); color: var(--bad); }
/* One number with its label: a span (the label) and a b (the number) in a .stat. */
.stat { display: grid; gap: 2px; }
.stat > span { font-size: 13px; color: var(--muted); }
.stat > b { font-size: 24px; line-height: 1.15; letter-spacing: -0.02em; }
/* Label and value pairs: dt and dd in a dl.kv. */
dl.kv { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 16px; }
dl.kv dt { color: var(--muted); }
dl.kv dd { text-align: right; font-weight: 500; }
/* What the numbers cannot support, in two or three lines. */
.note { border-left: 3px solid var(--line-2); padding: 2px 0 2px 12px; font-size: 14px; color: var(--muted); }
.note.warn { border-left-color: var(--warn); color: var(--warn); }
/* A share of a whole: a .bar with --v set in its style attribute, for example --v: 73%. */
.bar { display: block; height: 6px; min-width: 40px; border-radius: 3px; background: linear-gradient(to right, var(--accent) var(--v, 0%), var(--line) 0); }
/* The long part (the method, every caveat): closed until the person asks. */
details { border-top: 1px solid var(--line); padding-top: 10px; font-size: 14px; color: var(--muted); }
summary { cursor: pointer; font-weight: 500; }
/* On a phone a table with class "stack" becomes one card per row; each cell names its column with data-label. */
@media (max-width: 480px) {
  .lead { font-size: 19px; }
  table.stack { width: 100%; margin-left: 0; margin-right: 0; }
  table.stack, table.stack tbody, table.stack tr, table.stack td { display: block; }
  table.stack thead { display: none; }
  table.stack tr { background: var(--field); border: 1px solid var(--line); border-radius: var(--r); padding: 10px 12px; }
  table.stack tr + tr { margin-top: 8px; }
  table.stack td { display: flex; justify-content: space-between; gap: 16px; padding: 2px 0; border: 0; text-align: right; white-space: normal; background: none; box-shadow: none; }
  table.stack td::before { content: attr(data-label); color: var(--muted); font-weight: 400; text-align: left; }
  table.stack td:first-child { font-weight: 600; text-align: left; }
  table.stack td:first-child::before, table.stack td:not([data-label])::before { content: none; }
  table.stack tr.pick { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: var(--accent-bg); }
  table.stack tr.pick > td, table.stack tr.pick > td:first-child { background: none; box-shadow: none; }
}
`;

/** The class names of the sheet, for the reference and for its test: every name the reference teaches must be styled here. */
export const DATA_PARTS = ["lead", "muted", "small", "num", "pick", "out", "scroll", "cards", "card", "badge", "ok", "warn", "bad", "stat", "kv", "note", "bar", "stack"] as const;
