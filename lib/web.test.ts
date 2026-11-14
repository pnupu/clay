// data.web: what an agent may ask for, the guard on what comes back, and the confirmation of a change.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWeb, confirmChanges, diffWeb, guard, numberOnPage, webData, webSchema, WEB_LIMITS, type WebRead, type WebSource } from "./web.ts";

const prices: WebSource = { id: "anthropic", url: "https://www.anthropic.com/pricing", rows: { describe: "one row per model of the API", fields: [{ id: "model", type: "text", describe: "model name" }, { id: "input", type: "number", unit: "USD per 1M tokens", describe: "price of input tokens per million" }, { id: "output", type: "number", describe: "price of output tokens per million" }] } };
const page = "Claude Opus 5.5: $5 / MTok input, $25 / MTok output. Claude Sonnet 5.5: $3.00 / MTok input, $15 / MTok output. Batch: 50% off. 1,000 requests.";
const meta = { url: prices.url!, fetchedAt: "2026-11-14T00:00:00.000Z" };
const read = (rows: unknown[], text = page): WebRead => guard(prices, { rows }, text, meta);

test("what an agent may ask for is bounded, and every refusal says how to fix it", () => {
  const ok = checkWeb([prices, { id: "plan", domain: "linear.app", find: "pricing per seat", fields: [{ id: "seat_price", type: "number", describe: "price per user per month" }] }]);
  assert.ok(ok.ok && ok.sources.length === 2 && ok.sources[1].domain === "linear.app");
  const errors = (raw: unknown) => { const r = checkWeb(raw); return r.ok ? [] : r.errors; };
  assert.match(errors(Array.from({ length: 7 }, (_, i) => ({ ...prices, id: `s${i}x` })))[0], /1 to 6 sources, this list has 7/);
  assert.match(errors([{ ...prices, rows: { describe: "one row per model", fields: Array.from({ length: 21 }, (_, i) => ({ id: `f${i}x`, type: "number", describe: "a number" })) } }])[0], /1 to 20 fields.*this list has 21/);
  assert.match(errors([{ ...prices, url: "http://example.org/pricing" }])[0], /must be a full https/);
  assert.match(errors([{ ...prices, url: "https://127.0.0.1/pricing" }])[0], /public host name/);
  assert.match(errors([{ ...prices, url: "https://intranet.local/pricing" }])[0], /public host name/);
  assert.match(errors([{ ...prices, url: "https://user:pw@anthropic.com/pricing" }])[0], /credentials or a port/);
  assert.match(errors([{ id: "x1", domain: "anthropic.com", fields: prices.rows!.fields }])[0], /with domain, say which page to find/);
  assert.match(errors([{ ...prices, fields: [{ id: "a1", type: "number", describe: "a number" }] }])[0], /either fields .* or rows/);
  assert.match(errors([{ id: "x1", url: prices.url }])[0], /either fields .* or rows/);
  assert.match(errors([{ ...prices, rows: { describe: "one row per model", fields: [{ id: "model", type: "money", describe: "the price" }] } }])[0], /use "number", "text" or "boolean"/);
  assert.match(errors([{ ...prices, extra: 1 }])[0], /a source has no extra/);
  assert.match(errors([prices, prices])[0], /used twice/);
  assert.match(errors("x")[0], /give a list of sources/);
  // The schema bounds the rows too: the extraction cannot return more than the limit.
  assert.equal((webSchema(prices).properties as { rows: { maxItems: number } }).rows.maxItems, WEB_LIMITS.rows);
});

test("a number that is not in the page text is quarantined: unknown, never a guess", () => {
  const r = read([{ model: "Claude Opus 5.5", input: 5, output: 25, quote: "Claude Opus 5.5: $5 / MTok input" }, { model: "Claude Sonnet 5.5", input: 3, output: 14 }]);
  assert.deepEqual(r.rows, [{ model: "Claude Opus 5.5", input: 5, output: 25 }, { model: "Claude Sonnet 5.5", input: 3, output: null }]);
  assert.deepEqual(r.quarantined, [{ path: "Claude Sonnet 5.5 / output", value: 14 }]);
  assert.equal(r.quotes["rows.Claude Opus 5.5"], "Claude Opus 5.5: $5 / MTok input");
  // A number counts only as a whole number of the page: 5 is not found in 5.5, 25 or 50; 3 is found as 3.00; 1000 as 1,000.
  assert.equal(numberOnPage(5, "Opus 5.5 costs $25, 50% off"), false);
  assert.equal(numberOnPage(3, page), true);
  assert.equal(numberOnPage(1000, page), true);
  assert.equal(numberOnPage(0.3, "$0.30 per million"), true);
  assert.equal(numberOnPage(0.02, "$0.020 / 1M cached"), true);
  assert.equal(numberOnPage(1.2, "$1.200"), true);
  assert.equal(numberOnPage(0.3, "$1.30 per million"), false);
  assert.equal(numberOnPage(35, "tiers: 3, 5 and 8"), false);
  assert.equal(numberOnPage(2000000, "2 million tokens"), true);
});

test("values get the type the field asks for; text is cut; rows are capped; nothing unexpected passes", () => {
  const long = "x".repeat(500);
  const r = read([{ model: long, input: "$5", output: { evil: 1 }, extra: "<script>" }, { model: null, input: null, output: null }, "junk", ...Array.from({ length: 80 }, (_, i) => ({ model: `m${i}`, input: 5, output: 25 }))]);
  assert.equal(r.rows!.length, WEB_LIMITS.rows - 2); // 60 raw rows are looked at; the empty row and the junk are dropped
  assert.equal((r.rows![0].model as string).length, WEB_LIMITS.text);
  assert.deepEqual([r.rows![0].input, r.rows![0].output, "extra" in r.rows![0]], [5, null, false]);
  const fields: WebSource = { id: "plan", url: "https://linear.app/pricing", fields: [{ id: "seat", type: "number", describe: "price per seat" }, { id: "sso", type: "boolean", describe: "SSO included" }, { id: "name", type: "text", describe: "plan name" }] };
  const f = guard(fields, { seat: { value: 99, quote: "from $8" }, sso: { value: "yes" }, name: { value: 12 }, other: { value: 1 } }, "Business $8 per user", { url: fields.url!, fetchedAt: meta.fetchedAt });
  assert.deepEqual(f.fields, { seat: null, sso: null, name: "12" });
  assert.deepEqual(f.quarantined, [{ path: "seat", value: 99 }]);
  assert.deepEqual(guard(fields, null, "", { url: fields.url!, fetchedAt: meta.fetchedAt }).fields, { seat: null, sso: null, name: null });
  // What the preview reads: nulls for a source that was not read, never zeros.
  assert.deepEqual(webData([fields, prices], undefined), { plan: { seat: null, sso: null, name: null }, anthropic: [] });
});

test("a change is what two fresh reads agree on; the rest keeps its old value", () => {
  const old = read([{ model: "Claude Opus 5.5", input: 5, output: 25 }, { model: "Claude Sonnet 5.5", input: 3, output: 15 }]);
  const newPage = page.replace("$5 / MTok input", "$4 / MTok input") + " Claude Haiku 5.5: $1 / MTok input, $5 / MTok output. $16";
  const first = read([{ model: "Claude Opus 5.5", input: 4, output: 25 }, { model: "Claude Sonnet 5.5", input: 3, output: 16 }, { model: "Claude Haiku 5.5", input: 1, output: 5 }], newPage);
  const second = read([{ model: "Claude Opus 5.5", input: 4, output: 25 }, { model: "Claude Sonnet 5.5", input: 3, output: 15 }, { model: "Claude Haiku 5.5", input: 1, output: 5 }], newPage);
  assert.deepEqual(diffWeb(prices, old, second), [{ path: "Claude Haiku 5.5", before: false, after: true }, { path: "Claude Opus 5.5 / input", before: 5, after: 4 }]);
  const c = confirmChanges(prices, old, first, second);
  assert.deepEqual(c.changes.map((x) => x.path), ["Claude Haiku 5.5", "Claude Opus 5.5 / input"]);
  assert.equal(c.unconfirmed, 1); // Sonnet's output: only the first read said 16
  assert.deepEqual(c.read.rows, [{ model: "Claude Opus 5.5", input: 4, output: 25 }, { model: "Claude Sonnet 5.5", input: 3, output: 15 }, { model: "Claude Haiku 5.5", input: 1, output: 5 }]);
  assert.equal(c.read.textHash, old.textHash); // the reads disagreed: the page is read again next time
  // A row that went away, and two reads that agree on everything.
  const gone = read([{ model: "Claude Opus 5.5", input: 5, output: 25 }]);
  const g = confirmChanges(prices, old, gone, gone);
  assert.deepEqual(g.changes, [{ path: "Claude Sonnet 5.5", before: true, after: false }]);
  assert.deepEqual([g.read.rows!.length, g.unconfirmed, g.read.textHash === gone.textHash], [1, 0, true]);
  assert.deepEqual(diffWeb(prices, old, old), []);
});
