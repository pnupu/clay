// The decision domain. Everything domain-specific lives in this file: swap DOMAIN to change the use case.
// The extraction schema, the playground controls and the demo page are all generated from it.

export type MetricDef = { id: string; label: string; unit: string; describe: string; min: number; max: number; initial: number };
export type FeatureDef = { id: string; label: string; describe: string };
export type VendorDef = { id: string; name: string; domain: string; demo?: boolean };

export type Domain = {
  id: string;
  question: string;
  searchQuery: (vendor: VendorDef) => string;
  metrics: MetricDef[];
  features: FeatureDef[];
  vendors: VendorDef[];
};

export const DOMAIN: Domain = {
  id: "auth-providers",
  question: "Which auth provider should a B2B SaaS use?",
  searchQuery: (v) => `${v.name} pricing`,
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
  included: number | null;
  overage_allowed: boolean | null;
  tiers: Tier[] | null;
  quote: string | null;
};
export type FeatureFact = { feature: string; status: "included" | "addon" | "not_available" | null; addon_price: number | null; quote: string | null };
export type Plan = {
  name: string;
  base_price: number | null;
  custom_pricing: boolean | null;
  price_quote: string | null;
  meters: Meter[] | null;
  features: FeatureFact[] | null;
};
export type PricingModel = { vendor: string | null; currency: string | null; plans: Plan[] | null };

const nullable = (type: string, description: string) => ({ type: [type, "null"], description });

/** JSON Schema sent to Context.dev as jsonParams.schema. Nothing is required except plan names, so a missing fact stays null. */
export function extractionSchema(d: Domain) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      vendor: nullable("string", "Vendor name as written on the page."),
      currency: nullable("string", "ISO currency code of the prices, for example USD."),
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

export const EXTRACTION_INSTRUCTIONS =
  "Extract the pricing of this vendor's authentication product for a business-to-business SaaS customer. " +
  "Use only facts stated on this page. Never estimate, infer or calculate a number: when the page does not state it, return null. " +
  "Keep prices and quantities exactly as written (monthly billing prices, not annual-discount prices). " +
  "If the page has no named plans, describe it as one plan named after the pricing model (for example 'Pay as you go'). " +
  "If a plan is described as usage-based, pay-as-you-go or free with no fixed fee, its base_price is 0. " +
  "An SSO price per user or per MAU belongs to sso_users, never to sso_connections. " +
  "Quotes must be copied verbatim from one place on the page.";

/** Shape returned by the schema above: meters and features keyed by id. normalise() turns it into PricingModel. */
type RawMeter = Omit<Meter, "metric"> & { status?: "priced" | "not_available" | null };
type RawPlan = Omit<Plan, "meters" | "features"> & { meters?: Record<string, RawMeter | null> | null; features?: Record<string, Omit<FeatureFact, "feature"> | null> | null };
export type RawModel = { vendor: string | null; currency: string | null; plans: RawPlan[] | null };

export function normalise(raw: RawModel): PricingModel {
  return {
    vendor: raw.vendor ?? null,
    currency: raw.currency ?? null,
    plans: (raw.plans ?? []).map((p) => ({
      name: p.name,
      base_price: p.base_price ?? null,
      custom_pricing: p.custom_pricing ?? null,
      price_quote: p.price_quote ?? null,
      meters: Object.entries(p.meters ?? {}).flatMap(([metric, m]): Meter[] => {
        if (!m) return [];
        const quote = m.quote ?? null;
        // "Not available on this plan" is a hard limit of 0.
        if (m.status === "not_available") return [{ metric, included: 0, overage_allowed: false, tiers: [], quote }];
        // An entry with no content says nothing: leave it out, so the metric counts as "no charge stated".
        if (m.included == null && m.overage_allowed == null && !m.tiers?.length && !quote) return [];
        return [{ metric, included: m.included ?? null, overage_allowed: m.overage_allowed ?? null, tiers: m.tiers ?? [], quote }];
      }),
      features: Object.entries(p.features ?? {}).flatMap(([feature, f]): FeatureFact[] => (f?.status ? [{ feature, status: f.status, addon_price: f.addon_price ?? null, quote: f.quote ?? null }] : [])),
    })),
  };
}
