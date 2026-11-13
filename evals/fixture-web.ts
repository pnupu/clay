// A local stand-in for Context.dev (search and scrape) for agent runs that must not spend real requests.
// Unlike scripts/fixture-api.ts it answers for ANY playground an agent designs: it reads the metric and feature ids from the
// extraction schema of the request and invents a fictional price list per vendor URL, the same on every read.
// The prices are fiction. A playground built on it proves the agent, the page and the hand-back, not the web data.
// Usage: node evals/fixture-web.ts <port> [fail]     ("fail": every scrape answers 500, for the deliberate-failure proof)
//   then start the app with CONTEXT_DEV_BASE_URL=http://127.0.0.1:<port> CONTEXT_DEV_API_KEY=fixture CONTEXT_DEV_DAILY_CAP=0
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo, Server } from "node:net";

const port = Number(process.argv[2] ?? 0);
const failing = process.argv[3] === "fail";
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

createServer(async (req, res) => {
  const b = await body(req);
  const send = (status: number, data: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  if (req.url === "/web/search") {
    const domain = String((b.includeDomains as string[] | undefined)?.[0] ?? "example.com");
    return send(200, { results: [{ url: `https://${domain}/pricing`, title: `${domain} pricing` }], key_metadata: { credits_consumed: 0 } });
  }
  if (req.url !== "/web/scrape") return send(404, {});
  if (failing) return send(500, { error_code: "FIXTURE_FAILURE", message: "fixture read failed" });
  const wantsJson = (b.formats as { json?: boolean } | undefined)?.json === true;
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
