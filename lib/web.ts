// data.web: live facts from web pages for a preview playground. The agent names the facts (single fields, or a table of
// rows); Context.dev reads them; this module is the trust boundary and the honesty guard for them:
// - checkWeb(): what the agent may ask for (bounded sources, fields and rows; public https pages only).
// - webSchema(), webInstructions(): the structured extraction that is asked of Context.dev.
// - guard(): a number that is not in the text of the same page capture is quarantined: it arrives as null and is listed,
//   never used. Text is cut and kept as data. Missing is null.
// - diffWeb(), confirmChanges(): what changed between two reads, and the two-read confirmation of a change.
// No Node builtins: the kit page and the frame import it too. The reads themselves are in lib/pipeline.ts.
import { hostname } from "./config.ts";

export const WEB_LIMITS = { sources: 6, fields: 20, rows: 60, text: 200, unit: 40, quote: 160, describe: 300, find: 120, changes: 40, quoteBytes: 16_000 } as const;
/**
 * The quotes of one read, for what the read still holds: its fields, or its retained rows. At most one quote per field or
 * row (so at most max(fields, rows) entries) and WEB_LIMITS.quoteBytes characters per source; per playground at most
 * WEB_LIMITS.sources times that. A quote of a removed row or an unknown key is dropped.
 */
export function keptQuotes(s: WebSource, quotes: Record<string, string>, rows: WebRow[] | undefined): Record<string, string> {
  const wanted = s.fields ? s.fields.map((f) => f.id) : rowKeys(s, rows ?? []).map((k) => `rows.${k}`);
  const out: Record<string, string> = {};
  let bytes = 0;
  for (const k of wanted) {
    const q = quotes[k];
    if (typeof q !== "string") continue;
    const cutQ = q.slice(0, WEB_LIMITS.quote);
    if (bytes + cutQ.length > WEB_LIMITS.quoteBytes) break;
    out[k] = cutQ;
    bytes += cutQ.length;
  }
  return out;
}

export type WebField = { id: string; type: "number" | "text" | "boolean"; unit?: string; describe: string };
/** One page and what to read from it: single named fields, or a table (`rows`). `domain` + `find`: search finds the page. */
export type WebSource = { id: string; url?: string; domain?: string; find?: string; fields?: WebField[]; rows?: { describe: string; fields: WebField[] } };
export type WebValue = number | string | boolean | null;
export type WebRow = Record<string, WebValue>;
/** One read of one source. `fields` or `rows` as the source asks. Every number in it was found in the page text. */
export type WebRead = {
  url: string;
  fetchedAt: string;
  fields?: WebRow;
  rows?: WebRow[];
  /** Verbatim page text per fact, where the extraction gave one: "price" for a field, "rows.<key>" for a row. Untrusted text. */
  quotes: Record<string, string>;
  /** Numbers the extraction returned that are not in the page text. They are null in the values. */
  quarantined: { path: string; value: number }[];
  textHash: string;
  truncated: boolean;
};
/**
 * One changed fact. `path` is for people ("Claude Opus 5.5 / input"). `row` and `field` say where it is: a field of the
 * source (no row), a cell of a row, or a whole row that came or went (no field; before and after are ROW_HERE or ROW_GONE).
 */
export type WebChange = { at: string; source: string; path: string; before: WebValue; after: WebValue; row?: string; field?: string };
export const ROW_HERE = "(row on the page)";
export const ROW_GONE = "(row not on the page)";
/** What is stored per source. `read` null: not read yet, or the read failed (`error`). */
export type WebState = { url: string | null; foundVia: "spec" | "context.dev search" | null; read: WebRead | null; error: string | null; lastCheckedAt: string | null; changes: WebChange[]; /** When a re-check last read this page again without an error (not the build read). */ recheckedAt?: string | null };

const ID = /^[a-z][a-z0-9_]{1,29}$/;
const PRIVATE_HOST = /^(localhost|.*\.(local|internal|localhost|test|example|invalid))$/;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown, max: number, min = 1): x is string => typeof x === "string" && x.trim().length >= min && x.length <= max;

/** Validate the data.web of a spec. Returns the sources, or every problem as a sentence that says how to fix it. */
export function checkWeb(raw: unknown): { ok: true; sources: WebSource[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { ok: false, errors: ['data.web: give a list of sources: [{"id", "url" or "domain" with "find", "fields" or "rows"}].'] };
  if (raw.length < 1 || raw.length > WEB_LIMITS.sources) return { ok: false, errors: [`data.web: 1 to ${WEB_LIMITS.sources} sources, this list has ${raw.length}. Read only the pages this playground needs.`] };
  const sources: WebSource[] = [];
  for (const [i, r] of raw.entries()) {
    const at = `data.web.${isObj(r) && typeof r.id === "string" ? r.id : i}`;
    if (!isObj(r)) {
      errors.push(`${at}: a source is an object {"id", "url" or "domain" with "find", "fields" or "rows"}.`);
      continue;
    }
    const before = errors.length;
    if (typeof r.id !== "string" || !ID.test(r.id)) errors.push(`data.web.${i}.id: use 2 to 30 characters: lowercase letters, digits and underscores, starting with a letter. It is the name in clay.data.web.<id>.`);
    else if (sources.some((s) => s.id === r.id)) errors.push(`${at}: id "${r.id}" is used twice.`);
    // The page: a public https URL, or the site's host name with what to look for (search finds the page).
    let url: string | undefined;
    let domain: string | undefined;
    if (r.url !== undefined) {
      let u: URL | null = null;
      try {
        u = new URL(String(r.url));
      } catch {}
      const host = u?.hostname.toLowerCase() ?? "";
      if (!u || u.protocol !== "https:" || String(r.url).length > 300) errors.push(`${at}.url: must be a full https:// URL of at most 300 characters.`);
      else if (u.username || u.password || u.port) errors.push(`${at}.url: must not contain credentials or a port.`);
      else if (!hostname.safeParse(host).success || PRIVATE_HOST.test(host)) errors.push(`${at}.url: the host must be a public host name, not an IP address or a local name.`);
      else url = u.toString();
    }
    if (r.domain !== undefined) {
      const d = hostname.safeParse(r.domain);
      if (!d.success || PRIVATE_HOST.test(d.data)) errors.push(`${at}.domain: use the site's public host name, for example anthropic.com, with no scheme or path.`);
      else domain = d.data;
    }
    if (r.url === undefined && r.domain === undefined) errors.push(`${at}: give url (the exact page, best) or domain with find (search finds the page on that site).`);
    if (r.find !== undefined && !str(r.find, WEB_LIMITS.find, 3)) errors.push(`${at}.find: say in 3 to ${WEB_LIMITS.find} characters which page of the site to find, for example "API pricing per million tokens".`);
    if (r.url === undefined && r.domain !== undefined && r.find === undefined) errors.push(`${at}.find: with domain, say which page to find, for example "API pricing per million tokens".`);
    const fields = (list: unknown, where: string): WebField[] => {
      if (!Array.isArray(list) || list.length < 1 || list.length > WEB_LIMITS.fields) {
        errors.push(`${where}: 1 to ${WEB_LIMITS.fields} fields, each {"id", "type": "number" | "text" | "boolean", "describe", "unit"?}${Array.isArray(list) ? ` (this list has ${list.length})` : ""}.`);
        return [];
      }
      const out: WebField[] = [];
      for (const [j, f] of list.entries()) {
        const fa = `${where}.${isObj(f) && typeof f.id === "string" ? f.id : j}`;
        if (!isObj(f)) errors.push(`${fa}: a field is an object {"id", "type", "describe"}.`);
        else if (typeof f.id !== "string" || !ID.test(f.id)) errors.push(`${where}.${j}.id: use 2 to 30 characters: lowercase letters, digits and underscores, starting with a letter.`);
        else if (out.some((x) => x.id === f.id) || f.id === "quote") errors.push(`${fa}: id "${f.id}" is used twice or is reserved.`);
        else if (f.type !== "number" && f.type !== "text" && f.type !== "boolean") errors.push(`${fa}.type: use "number", "text" or "boolean" (yes or no).`);
        else if (!str(f.describe, WEB_LIMITS.describe, 5)) errors.push(`${fa}.describe: say in 5 to ${WEB_LIMITS.describe} characters what the page calls this fact, with synonyms and its unit. The extraction finds it with this text.`);
        else if (f.unit !== undefined && !str(f.unit, WEB_LIMITS.unit)) errors.push(`${fa}.unit: 1 to ${WEB_LIMITS.unit} characters, for example "USD per 1M tokens".`);
        else out.push({ id: f.id, type: f.type, describe: f.describe.trim(), ...(f.unit ? { unit: (f.unit as string).trim() } : {}) });
      }
      return out;
    };
    let single: WebField[] | undefined;
    let rows: WebSource["rows"];
    if ((r.fields === undefined) === (r.rows === undefined)) errors.push(`${at}: give either fields (single facts of the page) or rows (a table: {"describe", "fields"}), not both and not neither.`);
    else if (r.fields !== undefined) single = fields(r.fields, `${at}.fields`);
    else if (!isObj(r.rows) || !str(r.rows.describe, WEB_LIMITS.describe, 5)) errors.push(`${at}.rows: give {"describe": "<what one row is, for example 'one row per model of the API'>", "fields": [...]}.`);
    else rows = { describe: (r.rows.describe as string).trim(), fields: fields(r.rows.fields, `${at}.rows.fields`) };
    for (const k of Object.keys(r)) if (!["id", "url", "domain", "find", "fields", "rows"].includes(k)) errors.push(`${at}.${k}: a source has no ${k}. It takes: id, url, domain, find, fields, rows.`);
    if (errors.length === before) sources.push({ id: r.id as string, ...(url ? { url } : {}), ...(domain ? { domain } : {}), ...(r.find ? { find: (r.find as string).trim() } : {}), ...(single ? { fields: single } : {}), ...(rows ? { rows } : {}) });
  }
  return errors.length ? { ok: false, errors } : { ok: true, sources };
}

const jsonType = (f: WebField) => (f.type === "text" ? "string" : f.type);
const nullable = (type: string, description: string) => ({ type: [type, "null"], description });

/** The JSON Schema sent to Context.dev. Nothing is required, so a fact the page does not state stays null. */
export function webSchema(s: WebSource) {
  const one = (f: WebField) => nullable(jsonType(f), `${f.describe}${f.unit ? ` Unit: ${f.unit}.` : ""} null if the page does not state it.`);
  if (s.fields)
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(s.fields.map((f) => [f.id, { type: "object", additionalProperties: false, properties: { value: one(f), quote: nullable("string", "Short verbatim text of the page that states this value.") } }])),
    };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        maxItems: WEB_LIMITS.rows,
        description: `${s.rows!.describe} In page order, at most ${WEB_LIMITS.rows} rows.`,
        items: { type: "object", additionalProperties: false, properties: { ...Object.fromEntries(s.rows!.fields.map((f) => [f.id, one(f)])), quote: nullable("string", "Short verbatim text of the page for this row.") } },
      },
    },
  };
}

export const webInstructions = (s: WebSource) =>
  `${s.find ? `This page should be: ${s.find}. ` : ""}Read the facts below from this page. Use only what the page states. Never estimate, infer, convert or calculate a number: ` +
  "copy numbers exactly as written, and return null when the page does not state a fact. Quotes must be copied verbatim from one place on the page.";

/** Page text for the number check: lower case, and thousands separators removed ("1,000" is 1000). Other text stays, so "3, 5" is not 35. */
const plain = (s: string) => s.toLowerCase().replace(/(\d),(?=\d{3}(\D|$))/g, "$1");
/**
 * The ways a page may write this exact number: 3 or 3.0 or 3.00, 0.3 or 0.30 or .3, 1000 or 1k, 2000000 or 2M or 2 million.
 * Only spellings of the same value: no rounding (0.0004 is not "0.00", 2.996 is not "3.00").
 */
function numberForms(n: number): { text: string; unit: boolean }[] {
  // A very small or very large number prints with an exponent; a page writes it out (0.0000004).
  const plainText = String(n).includes("e") ? n.toFixed(20).replace(/0+$/, "").replace(/\.$/, "") : String(n);
  const decimals = plainText.includes(".") ? plainText.split(".")[1].length : 0;
  const forms = [plainText, ...[1, 2, 3].filter((d) => d > decimals).map((d) => n.toFixed(d))];
  if (Math.abs(n) > 0 && Math.abs(n) < 1) forms.push(...forms.map((f) => f.replace(/^(-?)0\./, "$1.")));
  const out = [...new Set(forms)].map((text) => ({ text, unit: false }));
  if (n >= 1000 && n % 1000 === 0) out.push({ text: `${n / 1000}k`, unit: true });
  if (n >= 1_000_000 && n % 100_000 === 0) out.push({ text: `${n / 1_000_000}m`, unit: true }, { text: `${n / 1_000_000} million`, unit: true });
  return out;
}
/** Is this number in the page text? As a whole number: 3 is not found inside 30, 13 or 1.35, and 5k is not found in "5kg". */
export function numberOnPage(n: number, pageText: string): boolean {
  const page = plain(pageText);
  return numberForms(n).some(({ text: f, unit }) => {
    for (let i = page.indexOf(f); i >= 0; i = page.indexOf(f, i + 1)) {
      const [a, b, c] = [page[i - 1] ?? "", page[i + f.length] ?? "", page[i + f.length + 1] ?? ""];
      // Not a part of a longer number: no digit or decimal point before it, no digit after it, no decimal part after it.
      // A k or M form must end there: the "m" of "1MB" and the "k" of "5kg" are units of something else.
      // A plain number must not carry a multiplier: the 5 of "5k" and the 2 of "2 million" are other numbers.
      // lean: this also refuses a number that the page writes in thousands on purpose ("128K context" for a field asked
      // in thousands): it arrives as unknown with a "not used" note. An unknown is the safer error than a value that is
      // wrong by a factor of 1000. "b" is not a multiplier here: "70B" is a size in a model name.
      const multiplied = !unit && (/^[km](?![a-z])/.test(page.slice(i + f.length, i + f.length + 2)) || /^\s?(thousand|million|billion)/.test(page.slice(i + f.length, i + f.length + 9)));
      if (!/[\d.]/.test(a) && !/\d/.test(b) && !(b === "." && /\d/.test(c)) && !(unit && /[a-z]/.test(b)) && !multiplied) return true;
    }
    return false;
  });
}

/** The fingerprint of a page's text: a re-check extracts again only when it changed. */
// Not a cryptographic hash: it only answers "is this the same text as last time". Two 32-bit FNV-1a sums, 16 hex digits.
export function pageHash(text: string): string {
  let [a, b] = [0x811c9dc5, 0x01000193];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
const cut = (x: unknown, n: number) => String(x).replace(/\s+/g, " ").trim().slice(0, n);
/** The name of a row: its first text field, else its position. It is page text: it names a row for people and in quotes. */
export const rowKey = (s: WebSource, row: WebRow, i: number): string => {
  const f = s.rows?.fields.find((x) => x.type === "text");
  const v = f ? row[f.id] : null;
  return typeof v === "string" && v ? v : `#${i + 1}`;
};
/** One key per row, unique within the read: a name that repeats (a standard and a batch row of one model) gets its count. */
export function rowKeys(s: WebSource, rows: WebRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row, i) => {
    const name = rowKey(s, row, i);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} (${n})`;
  });
}

/**
 * Turn an extraction answer into a read. Every value gets the type the field asks for, or null. A number that is not in
 * the page text of the same capture is quarantined: null in the values, listed with what the extraction returned.
 * Text is untrusted data: cut to a bound, never interpreted.
 */
export function guard(s: WebSource, raw: unknown, pageText: string, meta: { url: string; fetchedAt: string; truncated?: boolean }): WebRead {
  const quarantined: WebRead["quarantined"] = [];
  const quotes: Record<string, string> = {};
  const value = (f: WebField, v: unknown, path: string): WebValue => {
    if (v == null) return null;
    if (f.type === "number") {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[$€£,\s]/g, "")) : NaN;
      if (!Number.isFinite(n)) return null;
      if (numberOnPage(n, pageText)) return n;
      quarantined.push({ path, value: n });
      return null;
    }
    if (f.type === "boolean") return typeof v === "boolean" ? v : null;
    return typeof v === "string" && v.trim() ? cut(v, WEB_LIMITS.text) : typeof v === "number" ? String(v) : null;
  };
  const data = isObj(raw) ? raw : {};
  const base = { url: meta.url, fetchedAt: meta.fetchedAt, quotes, quarantined, textHash: pageHash(pageText), truncated: meta.truncated === true };
  if (s.fields) {
    const fields: WebRow = {};
    for (const f of s.fields) {
      const cell = isObj(data[f.id]) ? (data[f.id] as Record<string, unknown>) : {};
      fields[f.id] = value(f, cell.value, f.id);
      if (typeof cell.quote === "string" && cell.quote.trim()) quotes[f.id] = cut(cell.quote, WEB_LIMITS.quote);
    }
    return { ...base, fields };
  }
  const rows: WebRow[] = [];
  const names = new Map<string, number>();
  for (const r of (Array.isArray(data.rows) ? data.rows : []).slice(0, WEB_LIMITS.rows)) {
    if (!isObj(r)) continue;
    // The key is the row's own text, so a path names the row before its numbers are checked.
    const texts = Object.fromEntries(s.rows!.fields.filter((f) => f.type !== "number").map((f) => [f.id, value(f, r[f.id], f.id)]));
    // The same unique key as rowKeys() gives: a name that repeats gets its count, so quotes and quarantine paths of a
    // standard and a batch row of one model do not fall on each other.
    const name = rowKey(s, texts, rows.length);
    const nth = (names.get(name) ?? 0) + 1;
    const key = nth === 1 ? name : `${name} (${nth})`;
    const row: WebRow = Object.fromEntries(s.rows!.fields.map((f) => [f.id, f.type === "number" ? value(f, r[f.id], `${key} / ${f.id}`) : texts[f.id]]));
    if (Object.values(row).every((v) => v == null)) continue;
    // Counted only now: a row that is dropped must not shift the keys of the rows that stay (rowKeys() sees only those).
    names.set(name, nth);
    if (typeof r.quote === "string" && r.quote.trim()) quotes[`rows.${key}`] = cut(r.quote, WEB_LIMITS.quote);
    rows.push(row);
  }
  return { ...base, rows };
}

/** What the preview reads as clay.data.web.<id>: the fields (an object) or the rows (a list). Unknown is null; not read is all null or no rows. */
export function webData(sources: WebSource[] | null | undefined, state: Record<string, WebState> | undefined): Record<string, WebRow | WebRow[]> {
  return Object.fromEntries((sources ?? []).map((s) => [s.id, s.fields ? (state?.[s.id]?.read?.fields ?? Object.fromEntries(s.fields.map((f) => [f.id, null]))) : (state?.[s.id]?.read?.rows ?? [])]));
}

type Found = Omit<WebChange, "at" | "source">;

/** The facts that differ between two reads of one source. A row that came or went is one change; its cells are not listed. */
export function diffWeb(s: WebSource, before: WebRead, after: WebRead): Found[] {
  if (s.fields) return s.fields.filter((f) => (before.fields?.[f.id] ?? null) !== (after.fields?.[f.id] ?? null)).map((f) => ({ path: f.id, field: f.id, before: before.fields?.[f.id] ?? null, after: after.fields?.[f.id] ?? null }));
  const [was, now] = [before.rows ?? [], after.rows ?? []];
  const [wasKeys, nowKeys] = [rowKeys(s, was), rowKeys(s, now)];
  const out: Found[] = [];
  for (const k of wasKeys) if (!nowKeys.includes(k)) out.push({ path: k, row: k, before: ROW_HERE, after: ROW_GONE });
  for (const k of nowKeys) if (!wasKeys.includes(k)) out.push({ path: k, row: k, before: ROW_GONE, after: ROW_HERE });
  // The field that names the row is its identity: a new name is a row that went and a row that came.
  const nameField = s.rows!.fields.find((x) => x.type === "text")?.id;
  for (const [i, k] of nowKeys.entries()) {
    const j = wasKeys.indexOf(k);
    if (j < 0) continue;
    for (const f of s.rows!.fields) if (f.id !== nameField && (was[j][f.id] ?? null) !== (now[i][f.id] ?? null)) out.push({ path: `${k} / ${f.id}`, row: k, field: f.id, before: was[j][f.id] ?? null, after: now[i][f.id] ?? null });
  }
  return out;
}

/**
 * The two-read confirmation: extraction is not deterministic, so a change counts only when two fresh reads state the
 * same thing. Returns the read to store (the old one with only the confirmed changes applied) and those changes.
 * While the two reads disagree on something, the old page fingerprint stays, so the next re-check reads the page again.
 */
export function confirmChanges(s: WebSource, old: WebRead, first: WebRead, second: WebRead): { read: WebRead; changes: Found[]; unconfirmed: number } {
  const d1 = diffWeb(s, old, first);
  const d2 = diffWeb(s, old, second);
  const same = (x: Found, y: Found) => x.row === y.row && x.field === y.field && x.after === y.after;
  const changes = d2.filter((c) => d1.some((x) => same(x, c)));
  const unconfirmed = d2.length - changes.length + d1.filter((c) => !d2.some((x) => same(x, c))).length;
  const read: WebRead = { ...old, fetchedAt: second.fetchedAt, url: second.url, textHash: unconfirmed ? old.textHash : second.textHash, truncated: second.truncated, quotes: { ...old.quotes }, quarantined: second.quarantined };
  if (s.fields) {
    read.fields = { ...old.fields };
    for (const c of changes) {
      read.fields[c.field!] = c.after;
      if (second.quotes[c.field!]) read.quotes[c.field!] = second.quotes[c.field!];
    }
    read.quotes = keptQuotes(s, read.quotes, undefined);
    return { read, changes, unconfirmed };
  }
  // Rows are addressed by their unique keys, never by splitting a path: a row name is page text and may hold any character.
  const oldKeys = rowKeys(s, old.rows ?? []);
  const newKeys = rowKeys(s, second.rows ?? []);
  let rows = (old.rows ?? []).map((r, i) => ({ key: oldKeys[i], row: { ...r } }));
  for (const c of changes) {
    if (!c.field) {
      if (c.after === ROW_GONE) rows = rows.filter((r) => r.key !== c.row);
      else {
        const i = newKeys.indexOf(c.row!);
        if (i >= 0) rows.push({ key: c.row!, row: { ...second.rows![i] } });
      }
    } else {
      const r = rows.find((x) => x.key === c.row);
      if (r) r.row[c.field] = c.after;
    }
    if (c.row && second.quotes[`rows.${c.row}`]) read.quotes[`rows.${c.row}`] = second.quotes[`rows.${c.row}`];
  }
  read.rows = rows.map((r) => r.row);
  // Only the quotes of the rows that stay: without this, the quotes of removed rows piled up with every change.
  read.quotes = keptQuotes(s, read.quotes, read.rows);
  return { read, changes, unconfirmed };
}

/** A stamp that changes whenever the web data of a playground changes: the page reloads its preview when it does. */
export const webStamp = (state: Record<string, WebState> | undefined): string => Object.entries(state ?? {}).map(([id, s]) => `${id}:${s.read?.fetchedAt ?? ""}:${s.read?.textHash.slice(0, 8) ?? ""}:${s.error ? "e" : ""}:${s.changes.length}`).join("|");
