import test from "node:test";
import assert from "node:assert/strict";
import { changesAt, sayMetric, sayNumber, sayRange } from "./quantity.ts";
import { DOMAIN } from "./domain.ts";

// The metrics of the five price examples on production (their public pages, 2026-11-14), with the vendor names that a
// label can start with, the start value and a value where the cheapest vendor changes.
const EXAMPLES: { id: string; names: string[]; metrics: { label: string; unit: string; initial: number; min: number; max: number; crossing: number }[] }[] = [
  { id: "auth-providers", names: ["Clerk", "WorkOS", "Supabase Auth", "Stytch", "Northwind Auth"], metrics: [
    { label: "Monthly active users", unit: "users", initial: 20_000, min: 1_000, max: 5_000_000, crossing: 1_043_217 },
    { label: "Enterprise SSO connections", unit: "connections", initial: 3, min: 0, max: 200, crossing: 1 },
    { label: "Users signing in through SSO", unit: "users", initial: 500, min: 0, max: 100_000, crossing: 3_334 },
  ] },
  { id: "transactional-email-api", names: ["Postmark", "Resend", "Mailgun", "Amazon SES"], metrics: [{ label: "Emails per month", unit: "emails", initial: 40_000, min: 10_000, max: 500_000, crossing: 100_001 }] },
  { id: "h100-cloud-weekly-finetune", names: ["RunPod", "Lambda", "Vast.ai", "Hyperstack", "Nebius AI Cloud", "DataCrunch (Verda)"], metrics: [{ label: "H100 GPU hours per month", unit: "GPU hours", initial: 300, min: 50, max: 1_000, crossing: 412.5 }] },
  { id: "ticket-summary-small-model", names: ["OpenAI", "Anthropic", "Google Gemini", "Mistral"], metrics: [
    { label: "Input tokens per month", unit: "tokens", initial: 600_000_000, min: 100_000_000, max: 3_000_000_000, crossing: 360_050_000 },
    { label: "Output tokens per month", unit: "tokens", initial: 60_000_000, min: 10_000_000, max: 1_000_000_000, crossing: 100_000_000 },
  ] },
  { id: "managed-postgres-saas", names: ["Neon", "Supabase", "DigitalOcean Managed PostgreSQL"], metrics: [
    { label: "Database storage", unit: "GB", initial: 30, min: 10, max: 300, crossing: 31 },
    { label: "Neon compute (CU-hours/month)", unit: "CU-hours", initial: 183, min: 100, max: 2_920, crossing: 1_254.4 },
  ] },
];

/** The sentences of the hero and the price page, built as those two build them. */
const sentences = (names: string[], m: (typeof EXAMPLES)[number]["metrics"][number]) => ({
  headline: `At ${sayMetric(m, m.initial, { names })} the cheapest is Acme, $19 a month.`,
  crossing: `${changesAt(m, m.crossing, names)}: Acme takes over from Bolt.`,
  range: `The order stays the same from ${sayRange(m, m.min, m.max, { names })}.`,
});

test("every metric of the five price examples on production reads as plain English", () => {
  const got = Object.fromEntries(EXAMPLES.flatMap((e) => e.metrics.map((m) => [`${e.id} / ${m.label}`, sentences(e.names, m)])));
  // The table, printed with the test run (node --test shows it with --test-reporter=spec, and in the diagnostics).
  for (const [k, s] of Object.entries(got)) console.log(`${k}\n   ${s.headline}\n   ${s.crossing}\n   ${s.range}`);
  assert.deepEqual(got, {
    "auth-providers / Monthly active users": {
      headline: "At 20,000 monthly active users the cheapest is Acme, $19 a month.",
      crossing: "The cheapest changes at about 1.04 million monthly active users: Acme takes over from Bolt.",
      range: "The order stays the same from 1,000 to 5 million monthly active users.",
    },
    "auth-providers / Enterprise SSO connections": {
      headline: "At 3 enterprise SSO connections the cheapest is Acme, $19 a month.",
      crossing: "The cheapest changes at 1 enterprise SSO connection: Acme takes over from Bolt.",
      range: "The order stays the same from 0 to 200 enterprise SSO connections.",
    },
    "auth-providers / Users signing in through SSO": {
      headline: "At 500 users signing in through SSO the cheapest is Acme, $19 a month.",
      crossing: "The cheapest changes at about 3,330 users signing in through SSO: Acme takes over from Bolt.",
      range: "The order stays the same from 0 to 100,000 users signing in through SSO.",
    },
    "transactional-email-api / Emails per month": {
      headline: "At 40,000 emails the cheapest is Acme, $19 a month.",
      crossing: "The cheapest changes at about 100,000 emails: Acme takes over from Bolt.",
      range: "The order stays the same from 10,000 to 500,000 emails.",
    },
    "h100-cloud-weekly-finetune / H100 GPU hours per month": {
      headline: "At 300 H100 GPU hours the cheapest is Acme, $19 a month.",
      crossing: "The cheapest changes at about 413 H100 GPU hours: Acme takes over from Bolt.",
      range: "The order stays the same from 50 to 1,000 H100 GPU hours.",
    },
    "ticket-summary-small-model / Input tokens per month": {
      headline: "At 600 million input tokens the cheapest is Acme, $19 a month.",
      crossing: "The cheapest changes at about 360 million input tokens: Acme takes over from Bolt.",
      range: "The order stays the same from 100 million to 3 billion input tokens.",
    },
    "ticket-summary-small-model / Output tokens per month": {
      headline: "At 60 million output tokens the cheapest is Acme, $19 a month.",
      crossing: "The cheapest changes at 100 million output tokens: Acme takes over from Bolt.",
      range: "The order stays the same from 10 million to 1 billion output tokens.",
    },
    "managed-postgres-saas / Database storage": {
      headline: "At 30 GB of database storage the cheapest is Acme, $19 a month.",
      crossing: "The cheapest changes at 31 GB of database storage: Acme takes over from Bolt.",
      range: "The order stays the same from 10 to 300 GB of database storage.",
    },
    "managed-postgres-saas / Neon compute (CU-hours/month)": {
      headline: "At 183 CU-hours of Neon compute the cheapest is Acme, $19 a month.",
      crossing: "The cheapest changes at about 1,250 CU-hours of Neon compute: Acme takes over from Bolt.",
      range: "The order stays the same from 100 to 2,920 CU-hours of Neon compute.",
    },
  });
});

test("the built-in domain and the fixture metrics read the same way", () => {
  // lib/domain.ts DOMAIN (the auth example as shipped) and the metric of the config and eval fixtures.
  assert.deepEqual(DOMAIN.metrics.map((m) => sayMetric(m, m.initial)), ["20,000 monthly active users", "3 enterprise SSO connections", "500 users signing in through SSO"]);
  assert.equal(sayMetric({ label: "Emails per month", unit: "emails" }, 40_000), "40,000 emails");
  // Other shapes an agent writes: a unit of measure that the label does not name, a counted thing that it does not
  // name, a label that is all capitals at its start, a unit with no label noun left, and exactly one.
  const say = (label: string, unit: string, n: number, names: string[] = []) => sayMetric({ label, unit }, n, { names });
  assert.equal(say("Bandwidth per month", "GB", 300), "300 GB of bandwidth");
  assert.equal(say("Build minutes / month", "minutes", 6_000), "6,000 build minutes");
  assert.equal(say("Compute time", "hours", 730), "730 hours of compute time");
  assert.equal(say("Team size", "members", 5), "5 members");
  assert.equal(say("Team seats", "seats", 1), "1 team seat");
  assert.equal(say("SSO users", "users", 50), "50 SSO users");
  assert.equal(say("Storage", "GB", 1), "1 GB of storage");
  assert.equal(say("Requests", "requests", 3_000_000), "3 million requests");
  assert.equal(say("Supabase egress", "GB", 250, ["Supabase", "Neon"]), "250 GB of Supabase egress");
  assert.equal(say("Supabase egress", "GB", 250), "250 GB of supabase egress");
  assert.equal(say("API calls (monthly)", "calls", 1_500_000), "1.5 million API calls");
  // A unit that is only part of a longer word in the label is not "named" by it.
  assert.equal(say("Username lookups", "users", 20), "20 users");
});

test("numbers: exact below a million, three figures above, and 'about' only when the number was cut", () => {
  assert.equal(sayNumber(31), "31");
  assert.equal(sayNumber(20_150), "20,150");
  assert.equal(sayNumber(20_150, true), "about 20,200");
  assert.equal(sayNumber(0.5), "0.5");
  assert.equal(sayNumber(600_000_000), "600 million");
  assert.equal(sayNumber(1_250_000), "1.25 million");
  assert.equal(sayNumber(360_050_000), "about 360 million");
  assert.equal(sayNumber(360_050_000, true), "about 360 million");
  assert.equal(sayNumber(3_000_000_000), "3 billion");
  assert.equal(sayNumber(1_000_000), "1 million");
  // Just below a million, three figures give a million: said as "about 1 million", never "1,000,000".
  assert.equal(sayNumber(999_999, true), "about 1 million");
  assert.equal(sayNumber(999_999), "about 1 million");
  assert.equal(sayNumber(999_000), "999,000");
  assert.equal(sayNumber(0), "0");
});
