import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig, toConfig } from "./config.ts";
import { DOMAIN, extractionInstructions, INSTRUCTIONS_LIMIT } from "./domain.ts";

const good = () => ({
  id: "email-api",
  question: "Which transactional email API should we use?",
  product: "transactional email API",
  metrics: [{ id: "emails", label: "Emails per month", unit: "emails", describe: "Emails sent per month through the API.", min: 1000, max: 500_000, initial: 40_000 }],
  features: [{ id: "dedicated_ip", label: "Dedicated IP", describe: "A dedicated sending IP address." }],
  vendors: [
    { id: "resend", name: "Resend", pricing_url: "https://resend.com/pricing" },
    { id: "postmark", name: "Postmark", domain: "postmarkapp.com" },
  ],
});
const errors = (c: unknown) => {
  const r = parseConfig(c);
  return r.ok ? [] : r.errors;
};
const edit = (fn: (c: ReturnType<typeof good>) => void) => {
  const c = good();
  fn(c);
  return c;
};

test("a valid config becomes a Domain; a pricing URL supplies the vendor domain", () => {
  const r = parseConfig(good());
  assert.ok(r.ok);
  assert.deepEqual(r.domain.vendors[0], { id: "resend", name: "Resend", domain: "resend.com", url: "https://resend.com/pricing" });
  assert.deepEqual(r.domain.vendors[1], { id: "postmark", name: "Postmark", domain: "postmarkapp.com" });
  assert.deepEqual(parseConfig(toConfig(r.domain)), r); // revise round-trips
});

test("only https pricing URLs on public host names are accepted", () => {
  for (const url of ["http://resend.com/pricing", "file:///etc/passwd", "javascript:alert(1)", "https://127.0.0.1/pricing", "https://localhost/pricing", "https://user:pw@resend.com/pricing", "https://resend.com:8443/pricing", "resend.com/pricing"]) {
    assert.match(errors(edit((c) => void (c.vendors[0].pricing_url = url))).join(" "), /pricing_url/, url);
  }
  assert.match(errors(edit((c) => void (c.vendors[1].domain = "https://postmarkapp.com/pricing"))).join(" "), /public host name/);
  assert.match(errors(edit((c) => void Object.assign(c.vendors[0], { domain: "example.org" }))).join(" "), /not on domain example.org/);
});

test("ids, sizes and unknown keys are checked", () => {
  assert.match(errors(edit((c) => void (c.id = "../etc"))).join(" "), /^id: /);
  assert.match(errors(edit((c) => void (c.metrics[0].id = "Emails Sent"))).join(" "), /metrics.0.id/);
  assert.match(errors(edit((c) => void (c.vendors[1].id = "resend"))).join(" "), /used twice/);
  assert.match(errors(edit((c) => void (c.features[0].id = "emails"))).join(" "), /used twice/);
  assert.match(errors(edit((c) => void c.vendors.pop())).join(" "), /^vendors: /);
  assert.match(errors(edit((c) => void (c.vendors = Array.from({ length: 7 }, (_, i) => ({ id: `v${i}x`, name: `Vendor ${i}`, domain: `v${i}.com` }))))).join(" "), /^vendors: /);
  assert.match(errors(edit((c) => void (c.metrics = []))).join(" "), /^metrics: /);
  assert.match(errors(edit((c) => void (c.question = "x".repeat(201)))).join(" "), /^question: /);
  assert.match(errors(edit((c) => void Object.assign(c.vendors[0], { demo: true }))).join(" "), /vendors.0/);
  assert.match(errors(edit((c) => void Object.assign(c, { searchQuery: "x" }))).join(" "), /config: /);
  assert.match(errors("not an object").join(" "), /config: /);
});

test("product and notes must fit into the extraction instructions", () => {
  // The first build of the managed Postgres example (2026-11-14): a product of 73 and notes of 500 characters made the
  // instructions 2,054 characters, and Context.dev refused every page read with "too big, max 2000".
  const product = "managed PostgreSQL database hosting for one always-on production database";
  const room = INSTRUCTIONS_LIMIT - extractionInstructions({ ...DOMAIN, product, notes: "x" }).length + 1;
  assert.ok(room > 300 && room < 600, `room for notes is ${room}`);
  assert.deepEqual(errors(edit((c) => Object.assign(c, { product, notes: "n".repeat(room) }))), []);
  assert.deepEqual(errors(edit((c) => Object.assign(c, { product, notes: "n".repeat(500) }))), [`notes: product and notes are part of the extraction instructions, and together they are ${500 - room} characters too long. Shorten notes by at least ${500 - room} characters.`]);
  // What is accepted is never longer than the limit, also at the largest product.
  const r = parseConfig(edit((c) => Object.assign(c, { product: "p".repeat(120), notes: "n".repeat(room - 47) })));
  assert.ok(r.ok && extractionInstructions(r.domain).length <= INSTRUCTIONS_LIMIT);
});

test("metric ranges must be ordered and contain the initial value", () => {
  assert.match(errors(edit((c) => void (c.metrics[0].max = 500))).join(" "), /min \(1000\) must be below max \(500\)/);
  assert.match(errors(edit((c) => void (c.metrics[0].initial = 900))).join(" "), /initial \(900\) must lie between/);
  assert.match(errors(edit((c) => void (c.metrics[0].min = -1))).join(" "), /metrics.0.min/);
  assert.match(errors(edit((c) => void Object.assign(c.metrics[0], { max: "500000" }))).join(" "), /metrics.0.max/);
});
