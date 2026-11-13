// The trust boundary for playgrounds created at runtime. A config comes from an agent or an HTTP caller: it is untrusted data.
// Everything is checked here (sizes, types, id formats, https only), and nothing else in the app accepts a Domain from outside.
import { z } from "zod";
import type { Domain } from "./domain.ts";

export const LIMITS = { vendors: [2, 6], metrics: [1, 5], features: [0, 6] } as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const controlId = z.string().regex(/^[a-z][a-z0-9_]{1,29}$/, "use 2 to 30 characters: lowercase letters, digits and underscores, starting with a letter");
export const hostname = z.string().trim().toLowerCase().max(100).regex(/^(?=.{4,100}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/, "use a public host name such as resend.com, with no scheme, path or port");
const amount = z.number().finite().min(0).max(1e12);

export const metric = z.strictObject({
  id: controlId.describe("Stable id, for example emails_per_month."),
  label: text(2, 60).describe("Control label the person sees, for example 'Emails per month'."),
  unit: text(1, 20).describe("Plural unit, for example 'emails'."),
  describe: text(10, 400).describe("What the pricing page calls this dimension and how it is counted, with synonyms. The extraction uses this text to find the included quantity and the price tiers on each page."),
  min: amount.describe("Lowest value of the control."),
  max: amount.describe("Highest value of the control. Cover the growth the person may want to try, not more."),
  initial: amount.describe("Starting value: the person's own number when they gave one, else your best estimate."),
});

export const feature = z.strictObject({
  id: controlId.describe("Stable id, for example dedicated_ip."),
  label: text(2, 60).describe("Checkbox label the person sees."),
  describe: text(10, 400).describe("What counts as having this feature, as a pricing page would state it."),
});

export const vendor = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,29}$/, "use 2 to 30 characters: lowercase letters, digits and hyphens, starting with a letter").describe("Stable id, for example postmark."),
  name: text(2, 60).describe("Vendor or product name as the person knows it."),
  domain: hostname.optional().describe("The vendor's own website host, for example postmarkapp.com. Search finds the pricing page there. Give this or pricing_url."),
  pricing_url: z.string().trim().max(300).optional().describe("The public pricing page, https only. Give it when you know it; it is more reliable than search, and it is the way to repair a vendor whose page was not found."),
});

export const configShape = {
  id: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/, "use 3 to 40 characters: lowercase letters, digits and hyphens, starting with a letter").describe("Id of the playground and the last part of its URL, for example email-api-for-acme."),
  question: text(10, 200).describe("The decision, as a question in the person's words."),
  product: text(3, 120).describe("What is being priced, in a few words, for example 'transactional email API'. Part of the extraction instructions."),
  notes: text(0, 600).optional().describe("Optional extra guidance for the extraction, for example how to tell two similar metrics apart or which product line of the page to read."),
  metrics: z.array(metric).min(LIMITS.metrics[0]).max(LIMITS.metrics[1]).describe("Usage dimensions that drive the cost. Each becomes a slider."),
  features: z.array(feature).max(LIMITS.features[1]).default([]).describe("Yes-or-no requirements. Each becomes a 'must have' checkbox that removes plans without it."),
  vendors: z.array(vendor).min(LIMITS.vendors[0]).max(LIMITS.vendors[1]).describe("The vendors to compare."),
};
const config = z.strictObject(configShape);
export type PlaygroundConfig = z.input<typeof config>;

const PRIVATE_HOST = /^(localhost|.*\.(local|internal|localhost|test|example|invalid))$/;

/** Validate an untrusted config. Returns the Domain, or every problem as a sentence that says how to fix it. */
export function parseConfig(input: unknown): { ok: true; domain: Domain } | { ok: false; errors: string[] } {
  const r = config.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`) };
  const c = r.data;
  const errors: string[] = [];
  const unique = (what: string, ids: string[]) => {
    const twice = ids.find((id, i) => ids.indexOf(id) !== i);
    if (twice) errors.push(`${what}: id "${twice}" is used twice. Give every entry its own id.`);
  };
  unique("vendors", c.vendors.map((v) => v.id));
  // Metric and feature ids share one namespace: both become keys of the extraction schema and of the saved decision.
  unique("metrics and features", [...c.metrics, ...c.features].map((x) => x.id));
  for (const m of c.metrics) {
    if (!(m.min < m.max)) errors.push(`metrics.${m.id}: min (${m.min}) must be below max (${m.max}).`);
    else if (m.initial < m.min || m.initial > m.max) errors.push(`metrics.${m.id}: initial (${m.initial}) must lie between min (${m.min}) and max (${m.max}).`);
  }
  const vendors = c.vendors.map((v) => {
    let host = v.domain;
    if (v.pricing_url != null) {
      let u: URL | null = null;
      try {
        u = new URL(v.pricing_url);
      } catch {}
      const urlHost = u?.hostname.toLowerCase() ?? "";
      if (!u || u.protocol !== "https:") errors.push(`vendors.${v.id}.pricing_url: must be a full https:// URL.`);
      else if (u.username || u.password || u.port) errors.push(`vendors.${v.id}.pricing_url: must not contain credentials or a port.`);
      else if (!hostname.safeParse(urlHost).success) errors.push(`vendors.${v.id}.pricing_url: the host must be a public host name, not an IP address.`);
      else if (host && urlHost !== host && !urlHost.endsWith("." + host)) errors.push(`vendors.${v.id}: pricing_url is on ${urlHost}, which is not on domain ${host}. Fix one of them or leave domain out.`);
      else host ??= urlHost;
    }
    if (!host) errors.push(`vendors.${v.id}: give domain or pricing_url.`);
    else if (PRIVATE_HOST.test(host)) errors.push(`vendors.${v.id}: ${host} is not a public host.`);
    return { id: v.id, name: v.name, domain: host ?? "", ...(v.pricing_url ? { url: v.pricing_url } : {}) };
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, domain: { id: c.id, question: c.question, product: c.product, ...(c.notes ? { notes: c.notes } : {}), metrics: c.metrics, features: c.features, vendors } };
}

/** The config that parseConfig() would turn into this Domain. Used to revise a playground. */
export function toConfig(d: Domain): PlaygroundConfig {
  return { id: d.id, question: d.question, product: d.product, notes: d.notes, metrics: d.metrics, features: d.features, vendors: d.vendors.filter((v) => !v.demo).map((v) => ({ id: v.id, name: v.name, domain: v.domain, ...(v.url ? { pricing_url: v.url } : {}) })) };
}
