import assert from "node:assert/strict";
import { test } from "node:test";
import { alertAddress, alertOnChange, alertText, alertView, holdsNow, maskAlert, sendAlert, type Sender } from "./alert.ts";
import { nonOwnerView } from "./report.ts";
import { publicState, type Playground } from "./store.ts";

const SLACK = "https://hooks.slack.com/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc";
const DISCORD = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-0123/slack";

test("the alert address: only the two Slack-compatible forms on their own hosts", () => {
  assert.equal(alertAddress(SLACK), SLACK);
  assert.equal(alertAddress(DISCORD), DISCORD);
  assert.equal(alertAddress(DISCORD.replace("discord.com", "discordapp.com")), DISCORD.replace("discord.com", "discordapp.com"));
  assert.equal(alertAddress("https://HOOKS.slack.com/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc"), SLACK); // one form is kept
  for (const bad of [
    SLACK.replace("https:", "http:"),
    "https://hooks.slack.com.evil.example/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc",
    "https://evil.example/hooks.slack.com/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc",
    "https://hooks.slack.com@evil.example/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc",
    "https://user:pw@hooks.slack.com/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc",
    "https://hooks.slack.com:8443/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc",
    "https://hooks.slack.com./services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc",
    "https://34.226.36.32/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc",
    "https://[::1]/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc",
    "https://hooks.slack.com/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc?x=1",
    "https://hooks.slack.com/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc#x",
    "https://hooks.slack.com/services/T0AAAAAA/B0BBBBBB/%2e%2e/cccccccccccccccccccccc",
    "https://hooks.slack.com/api/other",
    "https://slack.com/services/T0AAAAAA/B0BBBBBB/cccccccccccccccccccccccc",
    DISCORD.replace("/slack", ""),
    DISCORD.replace("/slack", "/github"),
    "https://discord.com.evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-0123/slack",
    "https://cdn.discordapp.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-0123/slack",
    "javascript:alert(1)",
    "",
    42,
    null,
  ])
    assert.equal(alertAddress(bad), null, String(bad));
  assert.equal(maskAlert(SLACK), "hooks.slack.com/…cccc");
});

test("sending: the address is checked again, nothing throws, the body is the fixed shape", async () => {
  const sent: [string, string][] = [];
  const ok: Sender = async (url, body) => (sent.push([url, body]), { ok: true, status: 200 });
  assert.deepEqual(await sendAlert(SLACK, "hello", ok), { ok: true, status: 200 });
  assert.deepEqual(sent, [[SLACK, JSON.stringify({ text: "hello" })]]);
  assert.deepEqual(await sendAlert("https://evil.example/x", "hello", ok), { ok: false, status: null });
  assert.equal(sent.length, 1);
  assert.deepEqual(await sendAlert(SLACK, "hello", async () => { throw new Error("network"); }), { ok: false, status: null });
});

// A price playground with two vendors; Beta's price is the one that moves.
const model = (price: number) => ({ vendor: "x", currency: "USD", plans: [{ name: "Pro", base_price: price, custom_pricing: false, price_quote: null, meters: [], features: [] }] });
function playground(beta: number): Playground {
  return {
    domain: { id: "mail", question: "Which <!here> mail @everyone service?", product: "mail", metrics: [{ id: "emails", label: "Emails", unit: "emails", describe: "per month", min: 0, max: 100000, initial: 1000 }], features: [], vendors: [{ id: "alpha", name: "Alpha", domain: "alpha.com" }, { id: "beta", name: "Beta", domain: "beta.com" }] },
    createdAt: "t",
    sources: { alpha: { id: "alpha", name: "Alpha", snapshot: { model: model(30) } }, beta: { id: "beta", name: "Beta", snapshot: { model: model(beta) } } },
    decision: { usage: { emails: 1000 }, required: [], chosen: "beta", tolerance: 5, savedAt: "s1" },
    events: [],
    exploration: null,
    alert: { url: SLACK, told: null, last: null },
  } as never;
}
const reprice = (p: Playground, beta: number) => (p.sources.beta.snapshot!.model = model(beta) as never);

test("one message per change of the verdict, in both directions, none on a repeat; a new save starts again", () => {
  const p = playground(20);
  const step = (beta: number) => {
    const before = holdsNow(p);
    reprice(p, beta);
    return alertOnChange(p, before, null, "https://clay.example/p/mail");
  };
  assert.equal(step(22), null); // still holds (cheapest)
  const broke = step(50); // $20 above Alpha: over the tolerance
  assert.ok(broke && /no longer holds/.test(broke.text) && broke.url === SLACK);
  assert.equal(step(60), null); // still broken: nothing more
  assert.equal(step(70), null);
  const back = step(31); // within $5 of Alpha
  assert.ok(back && /holds again/.test(back.text));
  assert.equal(step(31), null);
  // A failed send changes nothing here: what was told is recorded before the send, so a repeat stays silent.
  // A new save of the decision: the baseline is the verdict before the next write, not the old one.
  p.decision = { ...p.decision!, savedAt: "s2" };
  assert.equal(step(32), null);
  // Without an alert, or without a saved decision, nothing is sent.
  const q = playground(20);
  q.alert = null;
  assert.equal(alertOnChange(q, true, null, "u"), null);
});

test("the message: the numbers that decide, the change with old and new value, plain text with no mention or markup", () => {
  const p = playground(50);
  const text = alertText(p, false, { id: "e", at: "t", sourceId: "beta", trigger: "webhook", changes: [{ path: "Pro / base price", before: 20, after: 50 }], verdict: null } as never, "https://clay.example/p/mail");
  assert.match(text, /the saved choice of Beta no longer holds/);
  assert.match(text, /Beta costs \$50 per month, \$20 more than Alpha, the cheapest\. That is above the saved tolerance of \$5\./);
  assert.match(text, /What changed: Beta raised Pro from \$20 to \$50 a month\./);
  assert.match(text, /Pro \/ base price: 20 → 50/);
  assert.match(text, /Open it: https:\/\/clay\.example\/p\/mail$/);
  assert.ok(!text.includes("<!here>") && !text.includes("@everyone"), text);
});

test("the address never reaches the state, a visitor's view or the owner's view of the alert", () => {
  const p = playground(20);
  const s = { playgrounds: { mail: p }, users: {}, budget: null, demoPage: null, webhookEventIds: [] } as never;
  const secret = "cccccccccccccccccccccccc";
  assert.ok(!JSON.stringify(publicState(s, "mail")).includes(secret));
  assert.ok(!JSON.stringify(nonOwnerView(p)).includes(secret));
  assert.deepEqual(alertView(p.alert), { address: "hooks.slack.com/…cccc", last: null });
});
