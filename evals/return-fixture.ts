// A local stand-in for Context.dev for the eval cases of kind "return" (evals/return.ts): three fictional price lists of
// email services whose prices the runner can change, so a saved decision can be made to stop holding.
// Fiction: a playground built on it proves the return path (file, re-check, answer), not the web data.
// Usage: node evals/return-fixture.ts <port>
//   POST /control {"prices": {"resend.com": 45}}   sets the monthly base price per host; {"reset": true} restores the start.
//   POST /control {"models": {"swift-2": [6, 30]}} sets a model's input and output price per 1M tokens on the model price page.
//   then start the app with CONTEXT_DEV_BASE_URL=http://127.0.0.1:<port> CONTEXT_DEV_API_KEY=fixture CONTEXT_DEV_DAILY_CAP=0
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo, Server } from "node:net";

type Json = Record<string, unknown>;
/** The start prices: Resend is the cheapest. USD per month for 50,000 emails; $1 per 1,000 emails above that. */
export const START: Record<string, number> = { "resend.com": 20, "postmarkapp.com": 25, "mailgun.com": 35 };
const prices = { ...START };
/** The model price page (a data.web source of a preview playground): USD per 1M input and output tokens. */
export const MODELS_START: Record<string, [number, number]> = { "swift-2": [1, 5], "deep-2": [3, 15] };
export const MODELS_HOST = "modelprices.dev";
const models: Record<string, [number, number]> = structuredClone(MODELS_START);

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
const dig = (o: unknown, ...path: string[]) => path.reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Json)[k] : undefined), o);

createServer(async (req, res) => {
  const b = await body(req);
  const send = (status: number, data: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  if (req.url === "/control") {
    if (b.reset) { Object.assign(prices, START); Object.assign(models, structuredClone(MODELS_START)); }
    for (const [name, pair] of Object.entries((b.models as Record<string, unknown> | undefined) ?? {})) if (name in models && Array.isArray(pair) && pair.length === 2) models[name] = [Number(pair[0]), Number(pair[1])];
    for (const [host, price] of Object.entries((b.prices as Record<string, unknown> | undefined) ?? {})) if (host in prices && typeof price === "number") prices[host] = price;
    return send(200, { prices, models });
  }
  if (req.url !== "/web/scrape") return send(404, {});
  let host: string;
  try {
    host = new URL(String(b.url)).hostname.replace(/^www\./, "");
  } catch {
    return send(400, { error_code: "BAD_URL", message: "not a URL" });
  }
  const wantsJson = (b.formats as { json?: boolean } | undefined)?.json === true;
  if (host === MODELS_HOST) {
    // One row per model, in the fields the playground's schema asks for (model, input, output), each with its quote.
    const rows = Object.entries(models).map(([model, [input, output]]) => ({ model, input, output, quote: `${model}: $${input} per 1M input tokens, $${output} per 1M output tokens` }));
    return send(200, { url: b.url, request_id: "fixture", cache_metadata: { status: "miss", age_ms: 0 }, key_metadata: { credits_consumed: 0 }, markdown: { requested: true, success: true, data: `${host} model prices (fixture, fictional prices).\n${rows.map((r) => r.quote + ".").join("\n")}` }, json: wantsJson ? { requested: true, success: true, data: { rows } } : { requested: false, success: null, data: null } });
  }
  if (!(host in prices)) return send(404, { error_code: "NOT_FOUND", message: "the fixture has no page for this host" });
  const base = prices[host];
  // The first metric of the playground's extraction schema, so the price list fits the spec the runner sends.
  const metric = Object.keys((dig(b, "jsonParams", "schema", "properties", "plans", "items", "properties", "meters", "properties") as Json | undefined) ?? {})[0] ?? "emails_per_month";
  const priceQuote = `Pro plan: $${base} per month`;
  const quote = "50,000 emails included, then $1 per 1,000 emails";
  send(200, {
    url: b.url,
    request_id: "fixture",
    cache_metadata: { status: "miss", age_ms: 0 },
    key_metadata: { credits_consumed: 0 },
    markdown: { requested: true, success: true, data: `${host} pricing (fixture, fictional prices).\n${priceQuote}.\n${quote}.` },
    json: wantsJson
      ? { requested: true, success: true, data: { vendor: host, currency: "USD", plans: [{ name: "Pro", base_price: base, custom_pricing: false, price_quote: priceQuote, meters: { [metric]: { status: "priced", included: 50000, overage_allowed: true, tiers: [{ up_to: null, price: 1, per_units: 1000 }], quote } }, features: {} }] } }
      : { requested: false, success: null, data: null },
  });
}).listen(Number(process.argv[2] ?? 0), "127.0.0.1", function (this: Server) {
  console.log(`return fixture API on http://127.0.0.1:${(this.address() as AddressInfo).port}`);
});
