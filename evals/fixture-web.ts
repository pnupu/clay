// A local stand-in for Context.dev (search, scrape, brand, and the data.web facts of preview playgrounds) for agent runs that must not spend real requests.
// Unlike scripts/fixture-api.ts it answers for ANY playground an agent designs: it reads the metric and feature ids from the
// extraction schema of the request and invents a fictional price list per vendor URL, the same on every read.
// The prices are fiction. A playground built on it proves the agent, the page and the hand-back, not the web data.
// Usage: node evals/fixture-web.ts <port> [fail]     ("fail": every scrape answers 500, for the deliberate-failure proof)
//   FIXTURE_DELAY_MS=<ms> makes every scrape slow. POST /control {"bump": n} changes every number of the data.web pages.
//   then start the app with CONTEXT_DEV_BASE_URL=http://127.0.0.1:<port> CONTEXT_DEV_API_KEY=fixture CONTEXT_DEV_DAILY_CAP=0
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo, Server } from "node:net";

const port = Number(process.argv[2] ?? 0);
const failing = process.argv[3] === "fail";
/** FIXTURE_DELAY_MS: every scrape answers this much later, to act out slow pricing pages (a build that outlasts a tool call). */
const delay = Number(process.env.FIXTURE_DELAY_MS ?? 0);
type Json = Record<string, unknown>;

const body = (req: IncomingMessage) =>
  new Promise<Json>((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

/** A small stable number from a string. */
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const dig = (o: unknown, ...path: string[]) => path.reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Json)[k] : undefined), o);

function priceList(url: string, schema: unknown) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const h = hash(host);
  const metrics = Object.keys((dig(schema, "properties", "plans", "items", "properties", "meters", "properties") as Json | undefined) ?? {});
  const features = Object.keys((dig(schema, "properties", "plans", "items", "properties", "features", "properties") as Json | undefined) ?? {});
  // Two plans: a cheap base with a high unit price, and a dear base with a low unit price, so rankings cross.
  const plans = [
    { name: "Starter", base: 5 + (h % 4) * 5, unit: 3 + (h % 5) },
    { name: "Scale", base: 60 + (h % 7) * 20, unit: 1 + (h % 2) },
  ];
  const lines: string[] = [`${host} pricing (fixture, fictional prices).`];
  const model = {
    vendor: host,
    currency: "USD",
    plans: plans.map((p, i) => {
      const priceQuote = `${p.name} plan: $${p.base} per month`;
      lines.push(priceQuote + ".");
      const meters = Object.fromEntries(
        metrics.map((m, j) => {
          // A price per 100 units: visible at small values (seats, GB) and at large ones (emails, tokens).
          const price = p.unit + j;
          const quote = `${p.name} ${m}: $${price} per 100 units`;
          lines.push(quote + ".");
          return [m, { status: "priced", included: 0, overage_allowed: true, tiers: [{ up_to: null, price, per_units: 100 }], quote }];
        }),
      );
      const feats = Object.fromEntries(
        features.map((f) => {
          // Not on the cheap plan, an add-on on the dear one: requiring it always changes a cost.
          const addon = 10 + ((h + f.length) % 4) * 10;
          const quote = i === 0 ? `${p.name} ${f}: not available` : `${p.name} ${f}: add-on for $${addon} per month`;
          lines.push(quote + ".");
          return [f, i === 0 ? { status: "not_available", addon_price: null, quote } : { status: "addon", addon_price: addon, quote }];
        }),
      );
      return { name: p.name, base_price: p.base, custom_pricing: false, price_quote: priceQuote, meters, features: feats };
    }),
  };
  return { text: lines.join("\n"), model };
}

/** The data.web pages that were read with a schema, so a later text-only read of the same URL serves the same page. */
const webPages = new Map<string, unknown>();
/** POST /control {"bump": n} adds n to every number of the data.web pages: the pages "change", for the staying-live proof. */
let bump = 0;

/**
 * A fictional page for a data.web source (lib/web.ts): the schema has `rows` (a table) or one {value, quote} object per
 * field. Numbers are stable per page and field, plus `bump`; every number is in the page text, so the guard keeps it.
 */
function webFacts(url: string, schema: unknown) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const name = host.split(".")[0];
  const kind = (f: unknown) => { const t = dig(f, "type"); return Array.isArray(t) ? String(t[0]) : String(t); };
  const num = (key: string, i: number) => 5 + (hash(host + key) % 40) + i * (1 + (hash(key) % 7)) + bump;
  const rowsProps = dig(schema, "properties", "rows", "items", "properties") as Json | undefined;
  const lines: string[] = [`${host} (fixture page, fictional facts).`];
  if (rowsProps) {
    const fields = Object.entries(rowsProps).filter(([id]) => id !== "quote");
    const rows = [0, 1, 2, 3].map((i) => {
      const row: Json = {};
      for (const [id, f] of fields) row[id] = kind(f) === "number" ? num(id, i) : kind(f) === "boolean" ? i % 2 === 0 : `${name} option ${i + 1}`;
      const quote = fields.map(([id]) => `${id} ${row[id]}`).join(", ");
      lines.push(quote + ".");
      return { ...row, quote };
    });
    return { text: lines.join("\n"), data: { rows } };
  }
  const data: Json = {};
  for (const [id, f] of Object.entries((dig(schema, "properties") as Json | undefined) ?? {})) {
    const value = kind(dig(f, "properties", "value")) === "number" ? num(id, 0) : kind(dig(f, "properties", "value")) === "boolean" ? true : `${name} ${id}`;
    const quote = `${id}: ${value}`;
    lines.push(quote + ".");
    data[id] = { value, quote };
  }
  return { text: lines.join("\n"), data };
}

createServer(async (req, res) => {
  const b = await body(req);
  const send = (status: number, data: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  if (req.url === "/web/search") {
    const domain = String((b.includeDomains as string[] | undefined)?.[0] ?? "example.com");
    return send(200, { results: [{ url: `https://${domain}/pricing`, title: `${domain} pricing` }], key_metadata: { credits_consumed: 0 } });
  }
  if (req.url === "/brand/retrieve") {
    // Fictional brand colours, stable per domain, for preview playgrounds with data.brand.
    const h = hash(String(b.domain ?? ""));
    const hex = (n: number) => "#" + ((h * (n + 3) * 2654435761) >>> 8).toString(16).padStart(6, "0").slice(-6);
    return send(failing ? 500 : 200, failing ? { error_code: "FIXTURE_FAILURE", message: "fixture read failed" } : { brand: { title: `${b.domain} (fixture brand)`, colors: [0, 1, 2, 3].map((n) => ({ hex: hex(n), name: `Fixture ${n + 1}` })), logos: [] }, key_metadata: { credits_consumed: 0 } });
  }
  if (req.url === "/control") {
    bump = Number(b.bump ?? bump) || 0;
    return send(200, { bump });
  }
  if (req.url !== "/web/scrape") return send(404, {});
  if (delay) await new Promise((r) => setTimeout(r, delay));
  if (failing) return send(500, { error_code: "FIXTURE_FAILURE", message: "fixture read failed" });
  const wantsJson = (b.formats as { json?: boolean } | undefined)?.json === true;
  // A data.web source: its schema has no `plans`. A read without a schema of a page that was read as a web source before
  // gets the same page text, so a re-check sees the same fingerprint until the facts change.
  const schema = dig(b, "jsonParams", "schema");
  const isWeb = wantsJson ? !dig(schema, "properties", "plans") : webPages.has(String(b.url));
  if (isWeb) {
    try {
      if (wantsJson) webPages.set(String(b.url), schema);
      const facts = webFacts(String(b.url), webPages.get(String(b.url)));
      return send(200, { url: b.url, request_id: "fixture", cache_metadata: { status: "miss", age_ms: 0 }, key_metadata: { credits_consumed: 0 }, markdown: { requested: true, success: true, data: facts.text }, json: wantsJson ? { requested: true, success: true, data: facts.data } : { requested: false, success: null, data: null } });
    } catch {
      return send(400, { error_code: "BAD_URL", message: "not a URL" });
    }
  }
  let list: ReturnType<typeof priceList>;
  try {
    list = priceList(String(b.url), dig(b, "jsonParams", "schema"));
  } catch {
    return send(400, { error_code: "BAD_URL", message: "not a URL" });
  }
  send(200, {
    url: b.url,
    request_id: "fixture",
    cache_metadata: { status: "miss", age_ms: 0 },
    key_metadata: { credits_consumed: 0 },
    markdown: { requested: true, success: true, data: list.text },
    json: wantsJson ? { requested: true, success: true, data: list.model } : { requested: false, success: null, data: null },
  });
}).listen(port, "127.0.0.1", function (this: Server) {
  console.log(`fixture web API on http://127.0.0.1:${(this.address() as AddressInfo).port}${failing ? " (failing)" : ""}`);
});
