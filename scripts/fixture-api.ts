// A local stand-in for the Context.dev scrape endpoint, for checks that must not spend real requests.
// It serves one fictional pricing page per vendor URL. POST /control sets the page text and a queue of reads. A read is a
// base price, or [base price, price per 1,000 extra emails]. Each structured extraction takes the next read from the queue
// (the last one repeats), so two extractions can disagree, fully or on one fact only. The read "fail" answers 500. The read
// "none" answers with no plan at all, as a capture does that was taken before a page filled in its prices.
// Usage: node scripts/fixture-api.ts <port>, then start the app with
//   CONTEXT_DEV_BASE_URL=http://127.0.0.1:<port> CONTEXT_DEV_API_KEY=fixture pnpm dev
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 0);
let text = "Fixture Mail pricing. Pro plan: $20 per month. 50,000 emails included, then $1 per 1,000 emails.";
let prices: (number | [number, number] | "fail" | "none")[] = [20];

const body = (req: import("node:http").IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
  });

createServer(async (req, res) => {
  const b = await body(req);
  const send = (data: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  if (req.url === "/control") {
    text = String(b.text ?? text);
    prices = (b.prices as typeof prices | undefined) ?? prices;
    return send({ text, prices });
  }
  // A fictional brand, so a preview lab with data.brand can be built without a real request.
  if (req.url === "/brand/retrieve") return send({ status: "ok", key_metadata: { credits_consumed: 0 }, brand: { domain: b.domain, title: "Fixture Brand", colors: [{ hex: "#5e6ad2", name: "Iris" }, { hex: "#0f1011", name: "Ink" }, { hex: "#f7f8f8", name: "Paper" }], logos: [] } });
  if (req.url !== "/web/scrape") return res.writeHead(404).end("{}");
  const wantsJson = (b.formats as { json?: boolean } | undefined)?.json === true;
  const read = wantsJson ? (prices.length > 1 ? prices.shift()! : prices[0]) : null;
  if (read === "fail") return res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error_code: "FIXTURE_FAILURE", message: "fixture read failed" }));
  const [price, extra] = Array.isArray(read) ? read : [read, 1];
  const none = read === "none";
  // The meter is keyed by the first metric of the lab's extraction schema, so any agent-built price spec gets a price.
  const metric = Object.keys((b.jsonParams as { schema?: { properties?: { plans?: { items?: { properties?: { meters?: { properties?: object } } } } } } } | undefined)?.schema?.properties?.plans?.items?.properties?.meters?.properties ?? {})[0] ?? "emails";
  send({
    url: b.url,
    request_id: "fixture",
    cache_metadata: { status: "miss", age_ms: 0 },
    key_metadata: { credits_consumed: 0 },
    markdown: { requested: true, success: true, data: text },
    json: wantsJson
      ? {
          requested: true,
          success: true,
          data: {
            vendor: "Fixture Mail",
            currency: "USD",
            plans: none ? [] : [{ name: "Pro", base_price: price, custom_pricing: false, price_quote: null, meters: { [metric]: { status: "priced", included: 50000, overage_allowed: true, tiers: [{ up_to: null, price: extra, per_units: 1000 }], quote: "50,000 emails included, then $1 per 1,000 emails" } }, features: {} }],
          },
        }
      : { requested: false, success: null, data: null },
  });
}).listen(port, "127.0.0.1", function (this: import("node:net").Server) {
  console.log(`fixture API on http://127.0.0.1:${(this.address() as import("node:net").AddressInfo).port}`);
});
