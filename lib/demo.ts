// The demo vendor is fictional. Its pricing page is served by this app so a presenter can change a price live.
import type { PricingModel } from "./domain";

export type DemoFields = { base: number; mauIncluded: number; mauPrice: number; ssoIncluded: number; ssoPrice: number };
export const DEMO_FIELDS: DemoFields = { base: 49, mauIncluded: 25000, mauPrice: 0.01, ssoIncluded: 2, ssoPrice: 50 };

const n = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 6 });

/** The content of the demo pricing page, written from five editable numbers. */
export function demoModel(f: DemoFields): PricingModel {
  return {
    vendor: "Northwind Auth (demo)",
    currency: "USD",
    plans: [
      {
        name: "Growth",
        base_price: f.base,
        custom_pricing: false,
        price_quote: `$${n(f.base)} per month`,
        meters: [
          { metric: "mau", included: f.mauIncluded, overage_allowed: true, tiers: [{ up_to: null, price: f.mauPrice, per_units: 1 }], quote: `${n(f.mauIncluded)} monthly active users included, then $${n(f.mauPrice)} per user` },
          { metric: "sso_connections", included: f.ssoIncluded, overage_allowed: true, tiers: [{ up_to: null, price: f.ssoPrice, per_units: 1 }], quote: `${n(f.ssoIncluded)} SSO connections included, then $${n(f.ssoPrice)} per connection` },
        ],
        features: [
          { feature: "mfa", status: "included", addon_price: null, quote: "Multi-factor authentication included" },
          { feature: "remove_branding", status: "included", addon_price: null, quote: "Custom branding included" },
          { feature: "uptime_sla", status: "not_available", addon_price: null, quote: "No uptime SLA" },
        ],
      },
    ],
  };
}

export const demoFields = (m: PricingModel | null): DemoFields => {
  const p = m?.plans?.[0];
  const meter = (id: string) => p?.meters?.find((x) => x.metric === id);
  return {
    base: p?.base_price ?? DEMO_FIELDS.base,
    mauIncluded: meter("mau")?.included ?? DEMO_FIELDS.mauIncluded,
    mauPrice: meter("mau")?.tiers?.[0]?.price ?? DEMO_FIELDS.mauPrice,
    ssoIncluded: meter("sso_connections")?.included ?? DEMO_FIELDS.ssoIncluded,
    ssoPrice: meter("sso_connections")?.tiers?.[0]?.price ?? DEMO_FIELDS.ssoPrice,
  };
};

export const DEMO_DEFAULT = demoModel(DEMO_FIELDS);
