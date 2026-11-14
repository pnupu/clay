// Tell a person when a saved price decision stops holding, and when it holds again: one message per change, to one
// Slack-compatible incoming webhook that the owner sets per playground. Node builtins and pure imports only.
//
// The address is a secret (anyone who has it can post to the channel): it is stored on the playground and never sent to
// a browser, an agent, a visitor or a log; the owner sees it masked (maskAlert). The server calls it, so only two hosts
// are accepted (alertAddress), the address is checked again before each send, no redirect is followed, and the body is a
// small fixed JSON object.
import type { Assumptions } from "./pricing.ts";
import { stand, standSentence } from "./pricing.ts";
import { changeSentence } from "./history.ts";
import { sayMetric } from "./quantity.ts";
import type { ChangeEvent, Playground } from "./store.ts";

export type Alert = {
  url: string;
  /** What was last told (or, before the first message, found): whether the saved decision held, for which save of it. */
  told?: { savedAt: string; holds: boolean } | null;
  /** The last message sent: when, and whether the address took it. */
  last?: { at: string; ok: boolean; status: number | null; kind: "test" | "change" } | null;
};

const SLACK = /^\/services\/[A-Za-z0-9]{6,40}\/[A-Za-z0-9]{6,40}\/[A-Za-z0-9]{10,80}$/;
const DISCORD = /^\/api\/webhooks\/\d{5,25}\/[A-Za-z0-9_-]{20,120}\/slack$/;
/**
 * The address in its one accepted form, or null. Accepted: https://hooks.slack.com/services/<a>/<b>/<c> and Discord's
 * Slack-compatible https://discord.com/api/webhooks/<id>/<token>/slack (also discordapp.com). Nothing else: no other
 * scheme, host, port, user part, query or fragment, and no encoded character in the path.
 */
export function alertAddress(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 300 || /[\s\\%]/.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash || raw.includes("@")) return null;
  const ok = (u.hostname === "hooks.slack.com" && SLACK.test(u.pathname)) || ((u.hostname === "discord.com" || u.hostname === "discordapp.com") && DISCORD.test(u.pathname));
  return ok ? `https://${u.hostname}${u.pathname}` : null;
}
export const ALERT_REFUSED = "This address is not accepted. Use a Slack incoming webhook (https://hooks.slack.com/services/…) or a Discord webhook in its Slack form (https://discord.com/api/webhooks/…/slack).";

/** What the owner sees of the address: the host and the last four characters of its token. */
export const maskAlert = (url: string) => `${new URL(url).hostname}/…${url.replace(/\/slack$/, "").slice(-4)}`;
/** The alert as its owner may see it (never the address itself). */
export const alertView = (a: Alert | null | undefined) => (a ? { address: maskAlert(a.url), last: a.last ?? null } : null);

export type Sender = (url: string, body: string) => Promise<{ ok: boolean; status: number | null }>;
const fetchSender: Sender = async (url, body) => {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, redirect: "manual", signal: AbortSignal.timeout(5000) });
    return { ok: r.status >= 200 && r.status < 300, status: r.status };
  } catch {
    return { ok: false, status: null };
  }
};
/**
 * Send one message. The address is checked again here, so a stored address that is no longer accepted is never called.
 * `sender` is for tests; a process may also set globalThis.__clayAlertSender (the local end-to-end run): it receives only
 * addresses that passed the check. Never throws.
 */
export async function sendAlert(url: string, text: string, sender?: Sender): Promise<{ ok: boolean; status: number | null }> {
  const safe = alertAddress(url);
  if (!safe) return { ok: false, status: null };
  const send = sender ?? (globalThis as { __clayAlertSender?: Sender }).__clayAlertSender ?? fetchSender;
  return send(safe, JSON.stringify({ text: text.slice(0, 3500) })).catch(() => ({ ok: false, status: null }));
}

/**
 * Text from the web or an agent, made plain for Slack and Discord: no markup, no link of its own, no mention of a channel
 * or of everyone (Slack reads <!here> and <@U…>, Discord reads @everyone), cut short.
 */
export const plain = (s: unknown, n = 200) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, "＠")
    .replace(/[*_~`|]/g, (c) => `​${c}​`)
    .slice(0, n);

const modelsOf = (p: Pick<Playground, "sources">) => Object.fromEntries(Object.entries(p.sources).map(([k, s]) => [k, s.snapshot?.model ?? null]));
/** Does the saved decision hold on the data as stored now? The same rule as the page (stand() in lib/pricing.ts). */
export const holdsNow = (p: Pick<Playground, "sources" | "decision">) => (p.decision ? stand(modelsOf(p), p.decision, p.decision.chosen, p.decision.tolerance ?? 0).holds : null);

const savedWords = (p: Playground, a: Assumptions) =>
  [Object.entries(a.usage).filter(([, n]) => n > 0).map(([k, n]) => { const m = p.domain.metrics.find((x) => x.id === k); return m ? sayMetric(m, n) : `${n} ${k}`; }).join(", "), a.required.length ? `must have ${a.required.map((f) => p.domain.features.find((x) => x.id === f)?.label.toLowerCase() ?? f).join(", ")}` : ""].filter(Boolean).join("; ");

/** The message about a change of the verdict: in words a manager reads without opening the page. */
export function alertText(p: Playground, holds: boolean, event: ChangeEvent | null, link: string): string {
  const d = p.decision!;
  const name = (id: string | null) => (id ? (p.sources[id]?.name ?? p.domain.vendors.find((v) => v.id === id)?.name ?? id) : null);
  const st = stand(modelsOf(p), d, d.chosen, d.tolerance ?? 0);
  const lines = [
    `${holds ? "✅" : "⚠️"} "${plain(p.domain.question)}": the saved choice of ${plain(name(d.chosen))} ${holds ? "holds again" : "no longer holds"}.`,
    `At the saved values (${plain(savedWords(p, d), 300)}): ${plain(standSentence(st, name(d.chosen)!, name(st.cheapest), false, undefined, false), 400)}`,
    `The rule: it holds while ${plain(name(d.chosen))} costs ${st.tolerance > 0 ? `at most $${Math.round(st.tolerance).toLocaleString("en-US")} per month more than the cheapest vendor` : "no more than the cheapest vendor"}.`,
  ];
  if (event?.changes.length) {
    lines.push(`What changed: ${plain(changeSentence(name(event.sourceId)!, event.changes), 400)}`);
    for (const c of event.changes.slice(0, 3)) lines.push(`• ${plain(c.path, 100)}: ${plain(c.before ?? "not stated", 60)} → ${plain(c.after ?? "not stated", 60)}`);
    if (event.changes.length > 3) lines.push(`• and ${event.changes.length - 3} more facts`);
  }
  lines.push(`Open it: ${link}`);
  return lines.join("\n");
}

/**
 * Called inside the store update that stores a re-checked source (lib/pipeline.ts, recheckOnce), the one place where the
 * data a saved decision is judged on changes after a re-check. `before`: whether it held before this write. Records what
 * is now known and returns the message to send when the verdict changed since it was last told, else null. One message
 * per change: a second re-check that finds the same verdict says nothing. A new save of the decision starts again from
 * the verdict before the write.
 */
export type Tell = { url: string; text: string; told: { savedAt: string; holds: boolean } };
export function alertOnChange(p: Playground, before: boolean | null, event: ChangeEvent | null, link: string): Tell | null {
  const a = p.alert;
  const now = holdsNow(p);
  if (!a || !p.decision || now == null) return null;
  const was = a.told?.savedAt === p.decision.savedAt ? a.told.holds : before;
  a.told = { savedAt: p.decision.savedAt, holds: now };
  return was == null || was === now ? null : { url: a.url, text: alertText(p, now, event, link), told: a.told };
}

const sending = new Map<string, Promise<unknown>>();
/**
 * Send what alertOnChange returned, after its store update: only when the store still holds that address and that verdict
 * (a guard may have discarded the write, or the owner removed or replaced the address meanwhile), one message of a
 * playground after the other (so they arrive in order), and the result is kept for the owner. A failed send gives the
 * verdict back as not told, so the next re-check tries again. Never throws.
 */
export function deliverAlert(pg: string, tell: Tell, store: { load: () => Promise<{ playgrounds: Record<string, Playground> }>; update: (fn: (s: { playgrounds: Record<string, Playground> }) => void) => Promise<unknown> }, sender?: Sender): Promise<void> {
  const same = (a: Alert | null | undefined) => !!a && a.url === tell.url && a.told?.savedAt === tell.told.savedAt && a.told?.holds === tell.told.holds;
  const run = (sending.get(pg) ?? Promise.resolve()).then(async () => {
    if (!same((await store.load()).playgrounds[pg]?.alert)) return;
    const r = await sendAlert(tell.url, tell.text, sender);
    await store.update((s) => {
      const a = s.playgrounds[pg]?.alert;
      if (!a || a.url !== tell.url) return;
      a.last = { at: new Date().toISOString(), ok: r.ok, status: r.status, kind: "change" };
      if (!r.ok && same(a)) a.told = { ...tell.told, holds: !tell.told.holds };
    });
  }).catch(() => {});
  sending.set(pg, run);
  return run;
}
