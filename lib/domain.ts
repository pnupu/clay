// The decision domain. A Domain is plain data: the seed below is one, and an agent creates more at runtime (lib/config.ts validates them).
// The extraction schema, the extraction instructions and the playground controls are all generated from it.

export type MetricDef = { id: string; label: string; unit: string; describe: string; min: number; max: number; initial: number };
export type FeatureDef = { id: string; label: string; describe: string };
/** `url`: the pricing page, when the creator of the playground knows it. Without it, Search finds the page on `domain`. */
export type VendorDef = { id: string; name: string; domain: string; url?: string; demo?: boolean };

export type Domain = {
  id: string;
  question: string;
  /** What is being priced, in a few words. Part of the extraction instructions. */
  product: string;
  /** Optional extra guidance for the extraction, for example how to tell two similar metrics apart. */
  notes?: string;
  /** Optional short note for the person, shown under the question. Not part of the extraction. */
  note?: string;
  metrics: MetricDef[];
  features: FeatureDef[];
  vendors: VendorDef[];
};

export const DOMAIN: Domain = {
  id: "auth-providers",
  question: "Which auth provider should a B2B SaaS use?",
  product: "authentication product for a business-to-business SaaS customer",
  notes: "An SSO price per user or per MAU belongs to sso_users, never to sso_connections.",
  note: "Four real vendors, read from their own pricing pages, and one fictional vendor, Northwind Auth (marked Demo). Its price can be changed on purpose, to show how a saved decision is judged again when a price changes.",
  metrics: [
    {
      id: "mau",
      label: "Monthly active users",
      unit: "users",
      describe: "Monthly active users (also called monthly retained users, MRU, or active members) of the customer's application.",
      min: 1000,
      max: 5_000_000,
      initial: 20_000,
    },
    {
      id: "sso_connections",
      label: "Enterprise SSO connections",
      unit: "connections",
      describe: "Enterprise single sign-on (SAML or OIDC) priced PER CONNECTION or per connected organisation. Do not use this entry when the page prices SSO per user or per MAU.",
      min: 0,
      max: 200,
      initial: 3,
    },
    {
      id: "sso_users",
      label: "Users signing in through SSO",
      unit: "users",
      describe: "Enterprise single sign-on priced PER USER: monthly active users who sign in through SSO (for example '50 included, then $0.015 per MAU' in an SSO row). Use this entry only when the SSO price is per user or per MAU, not per connection.",
      min: 0,
      max: 100_000,
      initial: 500,
    },
  ],
  features: [
    { id: "mfa", label: "Multi-factor authentication", describe: "Multi-factor authentication (authenticator app, TOTP, or SMS codes) for end users." },
    { id: "remove_branding", label: "Remove vendor branding", describe: "Removing the vendor's branding from the login UI, or full brand customisation." },
    { id: "uptime_sla", label: "Uptime SLA", describe: "A contractual uptime service-level agreement." },
  ],
  vendors: [
    { id: "clerk", name: "Clerk", domain: "clerk.com" },
    { id: "workos", name: "WorkOS", domain: "workos.com" },
    { id: "supabase", name: "Supabase Auth", domain: "supabase.com" },
    { id: "stytch", name: "Stytch", domain: "stytch.com" },
    { id: "demo", name: "Northwind Auth", domain: "localhost", demo: true },
  ],
};

// ---- Extracted pricing model (what Context.dev returns in json.data). Every fact is nullable: null means "not on the page".

export type Tier = { up_to: number | null; price: number | null; per_units: number | null };
export type Meter = {
  metric: string;
  /** The page says this is unlimited on the plan ("Unlimited users"): any quantity is included. */
  unlimited?: boolean;
  included: number | null;
  overage_allowed: boolean | null;
  tiers: Tier[] | null;
  quote: string | null;
};
export type FeatureFact = { feature: string; status: "included" | "addon" | "not_available" | null; addon_price: number | null; quote: string | null };
/** Why a price cannot be read from the page text. interactive: it is shown only through a slider, dropdown or calculator. configuration: the page states several prices that depend on the product or configuration chosen. */
export type PriceGap = "interactive" | "configuration" | "trimmed";
export type Plan = {
  name: string;
  base_price: number | null;
  custom_pricing: boolean | null;
  price_gap?: PriceGap | null;
  price_quote: string | null;
  meters: Meter[] | null;
  features: FeatureFact[] | null;
};
/** `page_gap`: why the page gave no plan at all, when the extraction can tell. */
export type PricingModel = { vendor: string | null; currency: string | null; plans: Plan[] | null; page_gap?: "interactive" | "configuration" | "not_pricing" | "contact_sales" | null };

const nullable = (type: string, description: string) => ({ type: [type, "null"], description });

/** JSON Schema sent to Context.dev as jsonParams.schema. Nothing is required except plan names, so a missing fact stays null. */
export function extractionSchema(d: Domain) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      vendor: nullable("string", "Vendor name as written on the page."),
      currency: nullable("string", "ISO currency code of the prices, for example USD."),
      page_gap: { type: ["string", "null"], enum: ["interactive", "configuration", "not_pricing", "contact_sales", null], description: "Only when `plans` is empty: why. interactive: prices appear only through a slider, dropdown or calculator. configuration: prices depend on a configuration that the text does not list. not_pricing: this is not a pricing page (documentation, a sign-up or trial page, an error page). contact_sales: the page gives no prices, only a contact form. null when plans were read." },
      plans: {
        type: "array",
        description: "Every self-serve or enterprise plan on the page, in page order.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", description: "Plan name as written on the page." },
            base_price: nullable("number", "Fixed platform fee per month when billed MONTHLY (not the annual-billing discount price). 0 for a free plan. null if the page does not state it or pricing is custom."),
            custom_pricing: nullable("boolean", "true if the plan price is 'Custom' or 'Contact sales'."),
            price_quote: nullable("string", "Short verbatim text from the page that states the base price."),
            price_gap: { type: ["string", "null"], enum: ["interactive", "configuration", null], description: "Only when the page text does not state this plan's price or its included quantity. interactive: the price is shown only through a volume slider, dropdown or calculator. configuration: the price depends on a product or configuration choice that the text does not list. null when the text states the price and what it includes." },
            meters: {
              type: "object",
              additionalProperties: false,
              description: "Usage-priced dimensions of this plan, one entry per metric.",
              properties: Object.fromEntries(
                d.metrics.map((m) => [
                  m.id,
                  {
                    type: ["object", "null"],
                    additionalProperties: false,
                    description: `${m.describe} null if the page says nothing about this for this plan.`,
                    properties: {
                      status: { type: ["string", "null"], enum: ["priced", "not_available", null], description: "not_available: the page says this plan does not include or offer it. priced: the page states an included quantity or a price." },
                      unlimited: nullable("boolean", "true when the page says this is unlimited on the plan, for example 'Unlimited users'. Then `included` is null."),
                      included: nullable("number", "Units included in the base price. 0 if none are included. null if not stated."),
                      overage_allowed: nullable("boolean", "true if usage above `included` is billed, false if `included` is a hard limit, null if not stated."),
                      tiers: {
                        type: ["array", "null"],
                        description: "Graduated prices for usage above `included`, in ascending order. One entry if there is a single overage price. Empty or null if the page states no overage price.",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            up_to: nullable("number", "Highest total usage this tier covers. null for the last, open-ended tier."),
                            price: nullable("number", "Price per month for `per_units` units, exactly as on the page."),
                            per_units: nullable("number", "Number of units the price buys, for example 1 for '$0.02 each' and 1000000 for '$2,500 per 1M users'."),
                          },
                        },
                      },
                      quote: nullable("string", "Short verbatim text from the page that states these numbers."),
                    },
                  },
                ]),
              ),
            },
            features: {
              type: "object",
              additionalProperties: false,
              properties: Object.fromEntries(
                d.features.map((f) => [
                  f.id,
                  {
                    type: ["object", "null"],
                    additionalProperties: false,
                    description: `${f.describe} null if the page does not say whether this plan has it.`,
                    properties: {
                      status: { type: ["string", "null"], enum: ["included", "addon", "not_available", null], description: "included: part of the plan. addon: available for an extra fee. not_available: the page says the plan lacks it. null: the page does not say." },
                      addon_price: nullable("number", "Extra fixed fee per month (monthly billing) when status is addon. null if not stated."),
                      quote: nullable("string", "Short verbatim text from the page that supports the status."),
                    },
                  },
                ]),
              ),
            },
          },
        },
      },
    },
  };
}

export const extractionInstructions = (d: Domain) =>
  `Extract the pricing of this vendor's ${d.product}. ` +
  "Use only facts stated on this page. Never estimate, infer or calculate a number: when the page does not state it, return null. " +
  "Keep prices and quantities exactly as written (monthly billing prices, not annual-discount prices). " +
  "If the page has no named plans, describe it as one plan named after the pricing model (for example 'Pay as you go'). " +
  "If a plan is described as usage-based, pay-as-you-go or free with no fixed fee, its base_price is 0. " +
  "A price per seat, per user, per member, per GB, per hour or per other unit belongs to the metric that counts that unit: put it in that metric's tiers as the price of 1 unit (per_units 1), with `included` set to the number the plan includes (0 if none). Do not also put it in base_price, unless the page states a separate fixed fee. " +
  "When the page says a metric is unlimited on a plan, set `unlimited` to true for it. " +
  "When the page lists several products, models or configurations with their own prices (for example GPU models or instance sizes), return each one as its own plan, named exactly as on the page. Never put the prices of different products into the tiers of one plan: tiers are only volume steps of one price. " +
  "When a price is shown only through a slider, a dropdown or a calculator and the text states no price for it, do not take the number that happens to be displayed: leave the price null and set price_gap to interactive. " +
  (d.notes ? d.notes.trim() + " " : "") +
  "Quotes must be copied verbatim from one place on the page.";

/** Shape returned by the schema above: meters and features keyed by id. normalise() turns it into PricingModel. */
type RawMeter = Omit<Meter, "metric" | "unlimited"> & { status?: "priced" | "not_available" | null; unlimited?: boolean | null };
type RawPlan = Omit<Plan, "meters" | "features"> & { meters?: Record<string, RawMeter | null> | null; features?: Record<string, Omit<FeatureFact, "feature"> | null> | null };
export type RawModel = { vendor: string | null; currency: string | null; plans: RawPlan[] | null; page_gap?: string | null };

const GAPS = ["interactive", "configuration"] as const;
type ReadGap = (typeof GAPS)[number];
const gap = (x: unknown): ReadGap | null => (GAPS.includes(x as ReadGap) ? (x as ReadGap) : null);

/**
 * Bounds of one stored price read, as lib/web.ts bounds a web read: the extraction is page data, and a page can be very
 * long. Only the permitted fields are copied, at every level (an allow-list), and texts are cut. A read with more plans
 * or more price steps than Clay keeps is never bridged: its plans are marked "trimmed", which makes the vendor "cannot be
 * ranked" with that reason (lib/pricing.ts) and names it in the agent's problems list (lib/report.ts).
 */
export const PRICE_LIMITS = { plans: 20, meters: 5, tiers: 12, features: 6, name: 80, quote: 200, short: 40, bytes: 64_000 } as const;
const cutText = (t: unknown, n: number): string | null => (typeof t === "string" ? t.slice(0, n) : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const bool = (x: unknown): boolean | null => (typeof x === "boolean" ? x : null);
const pick = <T extends string>(x: unknown, allowed: readonly T[]): T | null => (allowed.includes(x as T) ? (x as T) : null);
const entries = (x: unknown): [string, unknown][] => (x && typeof x === "object" && !Array.isArray(x) ? Object.entries(x as object) : []);
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

export function normalise(raw: RawModel): PricingModel {
  const { model: bounded, trimmed } = boundRaw(raw);
  let model = normaliseUnbounded(bounded);
  if (trimmed) model = { ...model, plans: (model.plans ?? []).map((p) => ({ ...p, price_gap: p.price_gap ?? ("trimmed" as const) })) };
  // Still too large: the quotes go first, then plans from the end (the read is then trimmed), until it fits; at the end
  // even a single plan is dropped. No throw: a refused read made the collection try more pages, each a paid request.
  const size = () => JSON.stringify(model).length;
  if (size() > PRICE_LIMITS.bytes) model = { ...model, plans: (model.plans ?? []).map((p) => ({ ...p, price_quote: null, meters: (p.meters ?? []).map((m) => ({ ...m, quote: null })), features: (p.features ?? []).map((f) => ({ ...f, quote: null })) })) };
  while (size() > PRICE_LIMITS.bytes && (model.plans?.length ?? 0) > 0) model = { ...model, plans: model.plans!.slice(0, -1).map((p) => ({ ...p, price_gap: p.price_gap ?? ("trimmed" as const) })) };
  return model;
}

/** Copy only the permitted fields of a raw extraction, within PRICE_LIMITS. `trimmed`: plans or price steps were left out. */
function boundRaw(raw: RawModel): { model: RawModel; trimmed: boolean } {
  const q = (t: unknown) => cutText(t, PRICE_LIMITS.quote);
  const r = raw as unknown as Record<string, unknown>;
  const plansIn = list(r.plans);
  let trimmed = plansIn.length > PRICE_LIMITS.plans;
  const plans = plansIn.slice(0, PRICE_LIMITS.plans).map((pv) => {
    const p = (pv && typeof pv === "object" ? pv : {}) as Record<string, unknown>;
    const meters = Object.fromEntries(entries(p.meters).slice(0, PRICE_LIMITS.meters).map(([k, mv]) => {
      if (!mv || typeof mv !== "object") return [k.slice(0, PRICE_LIMITS.short), null];
      const m = mv as Record<string, unknown>;
      const tiersIn = list(m.tiers);
      // Several open-ended prices are separate products ("configuration" in normaliseUnbounded): two of them keep that
      // reading. Otherwise, more steps than Clay keeps are dropped, never bridged, and the read is trimmed.
      const openEnded = tiersIn.filter((tv) => tv && typeof tv === "object" && (tv as { up_to?: unknown }).up_to == null);
      const over = tiersIn.length > PRICE_LIMITS.tiers;
      if (over && openEnded.length <= 1) trimmed = true;
      const tiers = (over ? (openEnded.length > 1 ? openEnded.slice(0, 2) : []) : tiersIn).map((tv) => { const t = (tv && typeof tv === "object" ? tv : {}) as Record<string, unknown>; return { up_to: num(t.up_to), price: num(t.price), per_units: num(t.per_units) }; });
      return [k.slice(0, PRICE_LIMITS.short), { included: num(m.included), overage_allowed: bool(m.overage_allowed), tiers, quote: q(m.quote), status: pick(m.status, ["priced", "not_available"] as const), unlimited: bool(m.unlimited) }];
    }));
    const features = Object.fromEntries(entries(p.features).slice(0, PRICE_LIMITS.features).map(([k, fv]) => {
      if (!fv || typeof fv !== "object") return [k.slice(0, PRICE_LIMITS.short), null];
      const f = fv as Record<string, unknown>;
      return [k.slice(0, PRICE_LIMITS.short), { status: pick(f.status, ["included", "addon", "not_available"] as const), addon_price: num(f.addon_price), quote: q(f.quote) }];
    }));
    return { name: cutText(p.name, PRICE_LIMITS.name) ?? "", base_price: num(p.base_price), custom_pricing: bool(p.custom_pricing), price_gap: cutText(p.price_gap, PRICE_LIMITS.short), price_quote: q(p.price_quote), meters, features };
  });
  return { model: { vendor: cutText(r.vendor, PRICE_LIMITS.name), currency: cutText(r.currency, PRICE_LIMITS.short), plans, page_gap: cutText(r.page_gap, PRICE_LIMITS.short) } as unknown as RawModel, trimmed };
}

function normaliseUnbounded(raw: RawModel): PricingModel {
  const pageGap = raw.page_gap === "not_pricing" || raw.page_gap === "contact_sales" ? raw.page_gap : gap(raw.page_gap);
  return {
    vendor: raw.vendor ?? null,
    currency: raw.currency ?? null,
    ...(pageGap && !raw.plans?.length ? { page_gap: pageGap } : {}),
    plans: (raw.plans ?? []).map((p) => {
      let priceGap = gap(p.price_gap);
      const meters = Object.entries(p.meters ?? {}).flatMap(([metric, m]): Meter[] => {
        if (!m) return [];
        const quote = m.quote ?? null;
        // "Not available on this plan" is a hard limit of 0.
        if (m.status === "not_available") return [{ metric, included: 0, overage_allowed: false, tiers: [], quote }];
        if (m.unlimited === true) return [{ metric, unlimited: true, included: null, overage_allowed: null, tiers: [], quote }];
        // An entry with no content says nothing: leave it out, so the metric counts as "no charge stated".
        if (m.included == null && m.overage_allowed == null && !m.tiers?.length && !quote) return [];
        // Tiers are volume steps of one price, so only the last one is open-ended. Several open-ended prices are the
        // prices of different products (GPU models, instance sizes) put into one plan: none of them is "the" price.
        const mixed = (m.tiers ?? []).filter((t) => t.up_to == null).length > 1;
        if (mixed) priceGap ??= "configuration";
        return [{ metric, included: m.included ?? null, overage_allowed: m.overage_allowed ?? null, tiers: mixed ? [] : (m.tiers ?? []), quote }];
      });
      return {
        name: p.name,
        base_price: p.base_price ?? null,
        custom_pricing: p.custom_pricing ?? null,
        price_quote: p.price_quote ?? null,
        ...(priceGap ? { price_gap: priceGap } : {}),
        meters,
        features: Object.entries(p.features ?? {}).flatMap(([feature, f]): FeatureFact[] => (f?.status ? [{ feature, status: f.status, addon_price: f.addon_price ?? null, quote: f.quote ?? null }] : [])),
      };
    }),
  };
}

// ---- Where to look for a vendor's pricing page.

/**
 * Does a read of a page give anything to compute with? A plan counts when it states a base price, a price per unit, an
 * included quantity above zero or an unlimited metric. It does not count for what the cost rules discard: the number a
 * slider page shows at its start position (price_gap "interactive" with a base price of 0), or a metric that is only
 * "not available".
 */
export const hasPrices = (m: PricingModel | null | undefined): boolean =>
  (m?.plans ?? []).some((p) => (p.base_price != null && !(p.price_gap === "interactive" && !p.base_price)) || (p.meters ?? []).some((x) => x.unlimited || (x.included ?? 0) > 0 || (x.tiers ?? []).some((t) => t.price != null)));

/** Host labels of side sites, which rarely carry the prices: docs.acme.com, www.stage.acme.com. */
const OFF_SITE = /^(docs?|help|support|blog|status|community|forum|stage|staging|dev|developers?|api|app|dashboard|login|careers|investors?)$/;
const OFF_TOPIC = /\/(docs?|blog|help|support|changelog|legal|terms|privacy|sign-?up|sign-?in|login|register|free-trial|trial|careers|customers|case-stud)/;

/**
 * The pages to try for a vendor's pricing, in order. `results`: the search results on the vendor's domain, best first.
 * 1. results whose address says "pricing" (or "plans") on the main site: the pricing page itself (".../pricing") before
 *    its sub-pages (".../pricing/pro-vs-free"), then in search order;
 * 2. the site's own /pricing page, which most vendors have;
 * 3. the other results on the main site, then results on side hosts (docs., help., stage.), which rarely carry prices.
 * Addresses outside the domain, not https, or already tried are left out. At most `max` pages.
 */
export function pricingCandidates(results: { url: string }[], domain: string, tried: string[] = [], max = 3): string[] {
  const key = (u: string) => u.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/^https:\/\/www\./, "https://").toLowerCase();
  const seen = new Set(tried.map(key));
  const rank = (u: URL) => {
    const host = u.hostname.toLowerCase();
    const side = host !== domain && host.slice(0, -domain.length - 1).split(".").some((label) => OFF_SITE.test(label));
    const path = u.pathname.toLowerCase();
    const priced = /pricing|\/plans?(\/|$)/.test(path) && !OFF_TOPIC.test(path);
    return side ? 3 : priced ? (/\/(pricing|plans)\/?$/.test(path) ? 0 : 0.5) : OFF_TOPIC.test(path) ? 3 : 2;
  };
  const found = results.flatMap((r, i) => {
    try {
      const u = new URL(r.url);
      const host = u.hostname.toLowerCase();
      return u.protocol === "https:" && (host === domain || host.endsWith(`.${domain}`)) ? [{ url: r.url, rank: rank(u), i }] : [];
    } catch {
      return [];
    }
  });
  const all = [...found, { url: `https://${domain}/pricing`, rank: 1, i: -1 }].sort((x, y) => x.rank - y.rank || x.i - y.i);
  const out: string[] = [];
  for (const c of all) {
    if (seen.has(key(c.url))) continue;
    seen.add(key(c.url));
    out.push(c.url);
  }
  return out.slice(0, max);
}
