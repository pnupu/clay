"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Domain, MetricDef, PricingModel } from "@/lib/domain";
import { crossovers, productLike, rank, sameAssumptions, stand, standSentence, vendorCost, type Assumptions, type PlanCost, type Stand, type VendorCost } from "@/lib/pricing";
import { demoFields, demoModel, type DemoFields } from "@/lib/demo";
import type { Exploration, PublicState } from "@/lib/store";

type Src = PublicState["sources"][string];

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const num = (n: number) => n.toLocaleString("en-US");
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** Names and colours that depend on the playground's domain. */
const helpers = (d: Domain) => ({
  label: (id: string) => d.metrics.find((m) => m.id === id)?.label ?? d.features.find((f) => f.id === id)?.label ?? id,
  /** Replace metric and feature ids in a computed message with their labels. */
  humanize: (s: string) => [...d.metrics, ...d.features].reduce((t, x) => t.replaceAll(x.id, lower(x.label)), s),
  color: (id: string) => `var(--series-${d.vendors.findIndex((v) => v.id === id) + 1})`,
});
const Dom = createContext<ReturnType<typeof helpers>>(helpers({ id: "", question: "", product: "", metrics: [], features: [], vendors: [] }));

function ago(iso: string | null | undefined, now: number) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

// ---- Slider scales: a wide range needs a non-linear slider. Values always stay inside [min, max].
const isLog = (m: MetricDef) => m.min > 0 && m.max / m.min > 50;
const isCubic = (m: MetricDef) => m.min === 0 && m.max > 1000;
const round2 = (x: number) => {
  if (x < 100) return Math.round(x);
  const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.round(x / p) * p;
};
const clamp = (m: MetricDef, v: number) => Math.min(m.max, Math.max(m.min, v));
// A small range keeps every whole number; a large one moves in steps of two significant digits (the number field takes exact values).
const toValue = (m: MetricDef, pos: number) => clamp(m, (m.max <= 1000 ? Math.round : round2)(isLog(m) ? m.min * Math.pow(m.max / m.min, pos / 1000) : isCubic(m) ? m.max * Math.pow(pos / 1000, 3) : m.min + ((m.max - m.min) * pos) / 1000));
const toPos = (m: MetricDef, v: number) => (isLog(m) ? (1000 * Math.log(clamp(m, v) / m.min)) / Math.log(m.max / m.min) : isCubic(m) ? 1000 * Math.cbrt(clamp(m, v) / m.max) : (1000 * (clamp(m, v) - m.min)) / (m.max - m.min));

async function call(path: string, method = "GET", body?: unknown): Promise<PublicState & { error?: string | null }> {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

/**
 * `canWrite`: this viewer owns the playground (or is the admin) and may save a decision and re-read the sources. Anyone else
 * is looking at an example: every control, the ranking and the chart work for them in their browser, and nothing is saved.
 * `admin`: the operator of this deployment, who alone may start webhook monitors and edit the demo page.
 * `embedded`: shown inside another page (the landing page's "Try it here"), so it brings no page frame and its title is an h2.
 */
export default function Playground({ domain, explored, canWrite, admin, embedded = false }: { domain: Domain; explored: Exploration | null; canWrite: boolean; admin: boolean; embedded?: boolean }) {
  const Shell = embedded ? "div" : "main";
  const shell = embedded ? "embedded-playground" : "shell";
  const api = `/api/p/${domain.id}`;
  const h = useMemo(() => helpers(domain), [domain]);
  const [state, setState] = useState<PublicState | null>(null);
  // The controls start where the person left them, so the agent and the person see the same values.
  const [usage, setUsage] = useState<Record<string, number>>(() => Object.fromEntries(domain.metrics.map((m) => [m.id, explored?.metrics[m.id]?.final ?? m.initial])));
  const [required, setRequired] = useState<string[]>(() => domain.features.filter((f) => explored?.features[f.id]?.final).map((f) => f.id));
  const [axis, setAxis] = useState(domain.metrics[0].id);
  const [chosen, setChosen] = useState<string | null>(explored?.selected ?? null);
  const [tolerance, setTolerance] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const busyRef = useRef(false);
  const tickRef = useRef(false);
  /** The agent's build (or a re-check) is still reading pricing pages: the state is reloaded every 3 s until it ends. */
  const readingRef = useRef(false);

  const run = useCallback(async (what: string, path: string, method = "POST", body?: unknown) => {
    busyRef.current = true;
    setBusy(what);
    try {
      const s = await call(path, method, body);
      if (s.sources) setState(s);
      setError(s.error ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, []);

  /** Set when the controls are put on the saved assumptions: that is not the person exploring, so it is not reported. */
  const rebase = useRef(false);
  useEffect(() => {
    call(`${api}/state`).then((s) => {
      setState(s);
      if (!s.decision) return;
      // A playground with a saved decision opens on the saved assumptions, with no row selected: the ranking and the
      // verdict then speak about the same values, and the saved vendor shows only as "Your saved choice".
      rebase.current = true;
      setUsage((u) => ({ ...u, ...s.decision!.usage }));
      setRequired(s.decision.required);
      setChosen(null);
      setTolerance(s.decision.tolerance ?? 0);
    });
  }, [api]);

  // Nothing is re-checked on a timer: sources change through a webhook, a button, the agent, or a publish of the demo page.
  // The clock ticks for the "ago" labels, and the stored state is reloaded every 15 s while the tab is visible, so a
  // webhook result or a revision by the agent appears while its highlight (30 s) still shows.
  useEffect(() => {
    let n = 0;
    const t = setInterval(async () => {
      setNow(Date.now());
      if ((++n % 5 && !readingRef.current) || document.hidden || busyRef.current || tickRef.current) return;
      tickRef.current = true;
      const s = await call(`${api}/state`).catch(() => null).finally(() => (tickRef.current = false));
      if (s?.sources && !busyRef.current) setState(s);
    }, 3000);
    return () => clearInterval(t);
  }, [api]);

  useEffect(() => {
    readingRef.current = state?.work?.status === "running";
  }, [state]);

  const sources = useMemo(() => state?.sources ?? {}, [state]);
  const models = useMemo(() => Object.fromEntries(Object.entries(sources).map(([id, s]) => [id, s.snapshot?.model ?? null])) as Record<string, PricingModel | null>, [sources]);
  const collected = Object.values(sources).filter((s) => s.snapshot);

  // Controls come from the data: only metrics and features that at least one extracted page mentions.
  const metrics = domain.metrics.filter((m) => collected.some((s) => s.snapshot!.model.plans?.some((p) => p.meters?.some((x) => x.metric === m.id))));
  const features = domain.features.filter((f) => collected.some((s) => s.snapshot!.model.plans?.some((p) => p.features?.some((x) => x.feature === f.id && x.status != null))));

  const a: Assumptions = useMemo(() => ({ usage, required }), [usage, required]);
  const ranking = useMemo(() => rank(models, a), [models, a]);
  const axisDef = domain.metrics.find((m) => m.id === axis) ?? domain.metrics[0];
  const cross = useMemo(() => crossovers(models, a, axisDef.id, axisDef.min, axisDef.max), [models, a, axisDef]);
  const nextCross = cross.find((c) => c.at > (usage[axisDef.id] ?? 0));
  const topCost = ranking.ranked[0]?.best?.cost ?? 0;
  const gap = (ranking.ranked[1]?.best?.cost ?? 0) - topCost;
  /** Vendors that cannot be fully priced and whose known cost is below the cheapest ranked vendor. */
  const maybeCheaper = ranking.unranked.filter((v) => v.best && v.best.cost < topCost);
  /** The header states the oldest check, so a fresh demo check cannot make old real data look fresh. */
  const healthy = collected.filter((x) => !x.error);
  const oldestCheck = healthy.map((x) => x.lastCheckedAt ?? "").sort()[0];
  /** The vendor the person clicked, while it can still be ranked. Nothing is selected by default: the cheapest row is a fact, not a choice. */
  const pick = chosen && ranking.ranked.some((v) => v.id === chosen) ? chosen : null;

  // Exploration summary for the agent: per control, the range tried since the last report and the value now.
  // It is sent after the person pauses, so no network call sits between a move and its result.
  const seen = useRef<Record<string, { min: number; max: number }>>({});
  const reported = useRef<string | null>(null);
  /** The person changed something since the last report, also when the controls are back at the reported values. */
  const moved = useRef(false);
  useEffect(() => {
    if (rebase.current) {
      rebase.current = false;
      seen.current = {};
      reported.current = null;
      moved.current = false;
    }
    for (const [k, v] of Object.entries(usage)) seen.current[k] = { min: Math.min(seen.current[k]?.min ?? v, v), max: Math.max(seen.current[k]?.max ?? v, v) };
    // Nothing is sent until the person changes something: opening the page is not exploring, and neither is a change of
    // the sources in the background. The reported selection is the vendor the person clicked, and only while the screen
    // shows it as selected.
    const selected = chosen === pick ? chosen : null;
    const now = JSON.stringify([usage, required, chosen]);
    reported.current ??= now;
    if (reported.current !== now) moved.current = true;
    if (!moved.current || !canWrite) return;
    const t = setTimeout(() => {
      const metrics = Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, { ...seen.current[k], final: v }]));
      seen.current = {};
      reported.current = now;
      moved.current = false;
      fetch(`${api}/explore`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metrics, required, selected }) }).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
    // `chosen` is the vendor the person clicked.
  }, [usage, required, chosen, pick, api, canWrite]);

  const decision = state?.decision ?? null;
  // Two separate things, never mixed on the screen (lib/pricing.ts, stand): the saved choice under the assumptions it was
  // saved with, and the same vendor under the values the person is trying now.
  const atSaved = !decision || sameAssumptions(a, decision);
  const savedStand = useMemo(() => (decision ? stand(models, decision, decision.chosen, decision.tolerance ?? 0) : null), [models, decision]);
  const triedStand = useMemo(() => (decision && !atSaved ? stand(models, a, decision.chosen, decision.tolerance ?? 0) : null), [models, decision, atSaved, a]);
  /** The selection or the controls differ from the saved decision, so saving means something. */
  const unsaved = !decision || decision.chosen !== pick || (decision.tolerance ?? 0) !== tolerance || !atSaved;
  const loadSaved = () => {
    if (!decision) return;
    setUsage({ ...usage, ...decision.usage });
    setRequired(decision.required);
    setChosen(null);
    setTolerance(decision.tolerance ?? 0);
  };
  const nameOf = (id: string | null) => (id ? (state?.sources[id]?.name ?? domain.vendors.find((v) => v.id === id)?.name ?? id) : null);
  /** A quantity in words: "120,000 emails per month", "5 team members", "50 GB bandwidth per month" (a short unit such as GB is said). */
  const qty = (k: string, n: number) => {
    const m = domain.metrics.find((x) => x.id === k);
    const label = lower(h.label(k));
    return m && m.unit.length <= 3 && !label.toLowerCase().includes(m.unit.toLowerCase()) ? `${num(n)} ${m.unit} ${label}` : `${num(n)} ${label}`;
  };
  /** Assumptions in words: "120,000 emails per month; must have SSO". */
  const wordsOf = (x: Assumptions) => [Object.entries(x.usage).filter(([, n]) => n > 0).map(([k, n]) => qty(k, n)).join(", "), x.required.length ? `must have ${x.required.map((f) => lower(h.label(f))).join(", ")}` : ""].filter(Boolean).join("; ");
  /** Only what differs from the saved assumptions: "250,000 emails per month (saved: 120,000)". */
  const triedWords = !decision ? "" : [
    ...Object.entries(decision.usage).filter(([k, n]) => usage[k] !== n).map(([k, n]) => `${qty(k, usage[k] ?? 0)} (saved: ${num(n)})`),
    ...required.filter((f) => !decision.required.includes(f)).map((f) => `must have ${lower(h.label(f))} (not in the saved decision)`),
    ...decision.required.filter((f) => !required.includes(f)).map((f) => `${lower(h.label(f))} not required (it is in the saved decision)`),
  ].join(", ");
  /** Vendors whose rows on the page are separate products, not tiers: their price is for the cheapest product that fits. */
  const productVendors = Object.values(sources).filter((x) => productLike((x.snapshot?.model.plans ?? []).map((p) => p.name)));

  if (!state) return <Shell className={shell}><p className="muted">Loading…</p></Shell>;

  const collectedAll = domain.vendors.every((v) => sources[v.id]?.snapshot || sources[v.id]?.error);
  // Web reads started by the agent go on after its tool call has answered. While they run, sources arrive one by one.
  const work = state.work;
  const reading = work?.status === "running";
  const missing = domain.vendors.filter((v) => !sources[v.id]?.snapshot && !sources[v.id]?.error);

  return (
    <Dom.Provider value={h}>
    <Shell className={shell}>
      <header className="top">
        <div>
          <p className="eyebrow">{canWrite ? <><Link href="/">Clay</Link> · data read from the web by Context.dev</> : "An example · prices read from the web by Context.dev"}</p>
          {embedded ? <h2 className="question">{domain.question}</h2> : <h1>{domain.question}</h1>}
          {domain.note && <p className="muted" style={{ maxWidth: "70ch", margin: "6px 0 0" }}>{domain.note}</p>}
        </div>
        <div className="actions">
          {busy ? <span className="muted">{busy}…</span> : reading ? (
            <span className="live" data-building><i />{work.kind === "recheck" ? `Re-reading the pricing pages: ${work.pending.length} to go…` : `Reading the pricing pages: ${collected.length} of ${domain.vendors.length} read…`}</span>
          ) : collected.length > 0 && (
            <span className="live"><i />{healthy.length} of {domain.vendors.length} sources read · oldest check {ago(oldestCheck, now)}</span>
          )}
          {!collectedAll && !reading && canWrite && <button className="primary" disabled={!!busy} onClick={() => run("Reading pricing pages", `${api}/collect`)}>Collect pricing pages</button>}
          {collected.length > 0 && canWrite && <button disabled={!!busy} onClick={() => run("Re-checking sources", `${api}/recheck`)}>Re-check all now</button>}
        </div>
      </header>
      {error && <p className="alert">{error}</p>}
      {work?.status === "stalled" && missing.length > 0 && <p className="alert">The reading of the pricing pages stopped before the end. Not read: {missing.map((v) => v.name).join(", ")}.{canWrite ? " Press Collect pricing pages to read them." : ""}</p>}
      {work?.status === "done" && work.stop && missing.length > 0 && <p className="alert">The reading of the pricing pages stopped early: {work.stop}</p>}

      {collected.length === 0 && reading ? (
        <section className="card" data-building>
          <h2>Reading the pricing pages…</h2>
          <p>Your agent is building this comparison from the public pricing pages of {domain.vendors.map((v) => v.name).join(", ")}. Each vendor appears here as soon as its page is read, usually within a minute. You do not need to reload.</p>
        </section>
      ) : collected.length === 0 ? (
        <section className="card empty">
          <h2>No data yet</h2>
          <p>Collect reads each vendor&apos;s public pricing page with Context.dev (search to find the page, then structured extraction). It takes about 10 seconds and uses about 6 credits per vendor.</p>
        </section>
      ) : (
        <div className="grid">
          {/* Narrow screens only (globals.css): the answer in one line, in view while the controls are moved. */}
          {ranking.ranked[0] && <p className="answer-bar" aria-hidden="true">Cheapest: <b>{sources[ranking.ranked[0].id]?.name}</b> at <b>{money(ranking.ranked[0].best!.cost)}</b> per month</p>}
          <section className="card controls">
            <h2>Your situation</h2>
            {metrics.map((m) => (
              <div className="control" key={m.id}>
                <label htmlFor={m.id}>{m.label}</label>
                <input className="value" type="number" min={0} value={usage[m.id]} onChange={(e) => setUsage({ ...usage, [m.id]: Math.max(0, Number(e.target.value) || 0) })} aria-label={`${m.label}, exact value`} />
                <input id={m.id} type="range" min={0} max={1000} value={toPos(m, usage[m.id])} onChange={(e) => setUsage({ ...usage, [m.id]: toValue(m, Number(e.target.value)) })} />
              </div>
            ))}
            {features.length > 0 && <h3>Must have</h3>}
            {features.map((f) => (
              <label className="check" key={f.id}>
                <input type="checkbox" checked={required.includes(f.id)} onChange={(e) => setRequired(e.target.checked ? [...required, f.id] : required.filter((x) => x !== f.id))} />
                {f.label}
              </label>
            ))}
            <p className="muted small">Every move recomputes in this browser. No network call and no agent is in the loop. {canWrite ? "A short summary of what you tried is kept for your agent." : "Nothing you try here is saved."}</p>
          </section>

          <section className="results">
            <div className="card">
              <h2>Monthly cost under these assumptions</h2>
              {decision && triedStand && (
                <p className="small" data-trying style={{ border: "1px solid var(--warn)", borderRadius: 8, padding: "8px 12px", margin: "0 0 10px" }}>
                  <b>{canWrite ? "You are trying other values than you saved:" : "You are trying other values than the saved ones:"}</b> {triedWords}. At these values {standSentence(triedStand, nameOf(decision.chosen)!, nameOf(triedStand.cheapest), true, h.humanize, canWrite)} {canWrite ? "Your saved decision is unchanged." : "The saved decision is unchanged."}{" "}
                  <button className="link" onClick={loadSaved}>{canWrite ? "Back to my saved values" : "Back to the saved values"}</button>
                </p>
              )}
              {ranking.ranked[0] && (
                <p className="answer">
                  {maybeCheaper.length ? "Cheapest of the fully priced vendors" : "Cheapest"}: <b>{sources[ranking.ranked[0].id]?.name}</b> at <b>{money(ranking.ranked[0].best!.cost)}</b> per month
                  {ranking.ranked[1] ? (gap < 0.5 ? `, level with ${sources[ranking.ranked[1].id]?.name}` : `, ${money(gap)} less than ${sources[ranking.ranked[1].id]?.name}`) : ""}.
                  {maybeCheaper.length > 0 && <span className="warn"> {maybeCheaper.map((v) => sources[v.id]?.name).join(", ")} could be cheaper: a price is unknown.</span>}
                  {nextCross && <span className="muted"> The cheapest changes at {num(nextCross.at)} {lower(axisDef.label)}.</span>}
                </p>
              )}
              {productVendors.length > 0 && (
                <p className="small warn" data-not-like-for-like>
                  Not like-for-like: {productVendors.map((x) => x.name).join(", ")} {productVendors.length === 1 ? "lists" : "list"} separate products on {productVendors.length === 1 ? "its" : "their"} page (for example different GPU models), not tiers of one product. Each row shows the cheapest product of that vendor that fits your values, so the ranking does not compare the same thing. Each row names the product its price is for.
                </p>
              )}
              <ol className="rank">
                {ranking.ranked.map((v, i) => (
                  <VendorRow key={v.id} v={v} src={sources[v.id]} required={required} now={now} place={i + 1} cheapest={i === 0} chosen={pick === v.id} saved={decision?.chosen === v.id} own={canWrite} onChoose={() => setChosen(pick === v.id ? null : v.id)} />
                ))}
              </ol>
              {ranking.unranked.length > 0 && <h3>Cannot be ranked</h3>}
              <ul className="rank">
                {ranking.unranked.map((v) => (
                  <VendorRow key={v.id} v={v} src={sources[v.id]} required={required} now={now} saved={decision?.chosen === v.id} own={canWrite} effect={v.effect} />
                ))}
              </ul>
              {domain.vendors.filter((v) => sources[v.id]?.error && !sources[v.id]?.snapshot).map((v) => (
                <p className="alert" key={v.id}>{v.name}: {sources[v.id].error}</p>
              ))}
            </div>

            <div className="card">
              <div className="chart-head">
                <h2>Where the cheapest vendor changes</h2>
                <label className="muted small">
                  Along{" "}
                  <select value={axis} onChange={(e) => setAxis(e.target.value)}>
                    {metrics.map((m) => <option key={m.id} value={m.id}>{lower(m.label)}</option>)}
                  </select>
                </label>
              </div>
              <Chart models={models} a={a} axis={axisDef} cross={cross} names={Object.fromEntries(Object.values(sources).map((s) => [s.id, s.name]))} />
              {cross.length === 0 ? (
                <p className="muted small">The cheapest vendor does not change anywhere between {num(axisDef.min)} and {num(axisDef.max)} {axisDef.unit}.</p>
              ) : (
                <ul className="cross">
                  {cross.map((c, ci) => (
                    <li key={`${ci}:${c.at}`}>
                      At <button className="link" onClick={() => setUsage({ ...usage, [axisDef.id]: c.at })}>{num(c.at)} {axisDef.unit}</button> the cheapest changes from <b>{c.from ? sources[c.from]?.name : "none"}</b> to <b>{c.to ? sources[c.to]?.name : "none"}</b>.
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <aside className="side">
            <section className="card">
              <h2>Standing decision</h2>
              {!decision || !savedStand ? (
                canWrite && <p className="small">Move the controls to your situation, select a vendor in the ranking, then save it here. Clay keeps the decision live: when a price changes, it is judged again under the values you saved.</p>
              ) : (
                <Standing decision={decision} st={savedStand} name={nameOf(decision.chosen)!} cheapestName={nameOf(savedStand.cheapest)} savedWords={wordsOf(decision)} atSaved={atSaved} own={canWrite} now={now} onLoad={loadSaved} onClear={canWrite ? () => run("Clearing", `${api}/decision`, "DELETE") : null} />
              )}
              {!canWrite && <p className="small" data-example style={{ marginTop: 10 }}>This is an example, so no decision is saved here. <Link href="/connect">Connect your own agent</Link> to build one and save your own.</p>}
              {canWrite && decision && !pick && !atSaved && <p className="small muted" style={{ marginTop: 10 }}>To save a decision for the values you are trying, select a vendor in the ranking.</p>}
              {pick && unsaved && canWrite && (
                <div className="save">
                  <p className="small">You selected <b>{sources[pick]?.name}</b> for {wordsOf(a)}. {decision ? "It is not saved: your saved decision is still as shown above." : "It is not saved yet."}</p>
                  <label className="small tolerance">
                    Still fine if within $
                    <input type="number" min={0} step={10} value={tolerance} onChange={(e) => setTolerance(Math.max(0, Number(e.target.value) || 0))} aria-label="Tolerance in dollars per month" />
                    per month of the cheapest
                  </label>
                  <button className="primary" disabled={!!busy} onClick={() => run("Saving", `${api}/decision`, "POST", { usage, required, chosen: pick, tolerance })}>
                    {!decision ? "Save decision:" : decision.chosen === pick ? "Update saved decision:" : "Replace saved decision with"} {sources[pick]?.name}
                  </button>
                </div>
              )}
              <h3>What changed</h3>
              {state.events.length === 0 && <p className="muted small">No source has changed since collection.</p>}
              <ul className="events">
                {state.events.map((e) => (
                  <li key={e.id} className={now - Date.parse(e.at) < 30000 ? "new" : undefined}>
                    <p className="small muted">{sources[e.sourceId]?.name} · {ago(e.at, now)} · {e.trigger === "webhook" ? "webhook" : e.trigger === "auto" ? "demo page published" : "re-check"}</p>
                    {e.changes.slice(0, 6).map((c, ci) => (
                      <p className="change" key={`${ci}:${c.path}`}>{h.humanize(c.path)}: <s>{String(c.before ?? "not stated")}</s> → <b>{String(c.after ?? "not stated")}</b></p>
                    ))}
                    {e.changes.length > 6 && <p className="small muted">and {e.changes.length - 6} more facts</p>}
                    {e.unconfirmed ? <p className="small muted">Confirmed by a second read. {e.unconfirmed} more {e.unconfirmed === 1 ? "difference" : "differences"} appeared in only one of the two reads and {e.unconfirmed === 1 ? "is" : "are"} not reported.</p> : null}
                    {/* A verdict speaks about the decision that was saved when the change came. After a new decision is
                        saved, the older changes stay as facts, without a verdict that is about another choice. */}
                    {e.verdict && decision && Date.parse(e.at) >= Date.parse(decision.savedAt) && (
                      <p className={e.verdict.holds ? "verdict ok" : "verdict bad"}>
                        {e.verdict.holds ? "✓ Decision holds. " : "✕ Decision no longer holds. "}
                        {/* The stored reason speaks of "the chosen vendor" and "your tolerance": say the vendor, and to a visitor "the saved". */}
                        {e.verdict.reason.replace(/^The chosen vendor/, nameOf(decision.chosen) ?? "The chosen vendor").replace(/\byour (tolerance|assumptions)/g, canWrite ? "your $1" : "the saved $1")}
                        {e.verdict.chosenCostBefore != null && e.verdict.chosenCostNow != null && e.verdict.chosenCostBefore !== e.verdict.chosenCostNow && ` ${canWrite ? "Your choice" : "The saved choice"}: ${money(e.verdict.chosenCostBefore)} → ${money(e.verdict.chosenCostNow)} per month.`}
                        {e.verdict.cheapestNow && e.verdict.cheapestNow !== e.verdict.cheapestBefore && e.verdict.cheapestNow !== decision.chosen && ` Cheapest is now ${sources[e.verdict.cheapestNow]?.name}.`}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <h2>Sources</h2>
              <ul className="sources">
                {Object.values(sources).map((s) => (
                  <li key={s.id}>
                    <span className="dot" style={{ background: h.color(s.id) }} />
                    <div>
                      <a href={s.url ?? "#"} target="_blank" rel="noreferrer">{s.name}</a>
                      {s.demo && <span className="badge">Demo</span>}
                      <p className="small muted">
                        {s.snapshot ? `Extracted ${ago(s.snapshot.fetchedAt, now)} by ${s.snapshot.extractor === "context.dev" ? `Context.dev in ${(s.snapshot.latencyMs / 1000).toFixed(1)} s` : "the app (localhost)"}` : "Not read"} · last checked {ago(s.lastCheckedAt, now)}
                        {s.monitor ? " · webhook monitor on" : ""}
                      </p>
                      {s.error && <p className="small bad">{s.error}</p>}
                    </div>
                    {canWrite && <button className="small-btn" disabled={!!busy} onClick={() => run(`Re-checking ${s.name}`, `${api}/recheck`, "POST", { id: s.id })}>Re-check</button>}
                  </li>
                ))}
                {domain.vendors.filter((v) => !sources[v.id]).map((v) => (
                  <li key={v.id}>
                    <span className="dot" style={{ background: h.color(v.id) }} />
                    <div>
                      <span>{v.name}</span>
                      <p className="small muted">{reading ? "Reading its pricing page…" : "Not read"}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {/* Webhook monitors are the operator's: their runs are not counted against a person (app/api/respond.ts). */}
              {!admin ? null : state.publicBaseUrl ? (
                <button disabled={!!busy} onClick={() => run("Updating monitors", `${api}/watch`, Object.values(sources).some((s) => s.monitor) ? "DELETE" : "POST")}>
                  {Object.values(sources).some((s) => s.monitor) ? "Stop webhook monitors" : "Start webhook monitors"}
                </button>
              ) : (
                <p className="small muted">Webhook monitors are off: Context.dev needs a public URL to deliver to, and this app runs on localhost. Use Re-check.{sources.demo?.demo ? " The demo source is re-checked when its page is published." : ""}</p>
              )}
            </section>

            {sources.demo?.demo && admin && <DemoEditor key={JSON.stringify(state.demoPage)} page={state.demoPage} busy={!!busy} onPublish={(f) => run("Publishing demo page", "/api/demo", "POST", demoModel(f))} />}
          </aside>
        </div>
      )}
    </Shell>
    </Dom.Provider>
  );
}

/**
 * One vendor. `cheapest`: the first row of the ranking, which is a fact about the values on the page. `chosen`: the person
 * clicked Select on this row. `saved`: the vendor of the saved decision. The three are shown apart, so that neither the
 * cheapest row nor the saved vendor looks like a recommendation.
 */
function VendorRow({ v, src, required, now, place, cheapest, chosen, saved, own, onChoose, effect }: { v: VendorCost; src: Src; required: string[]; now: number; place?: number; cheapest?: boolean; chosen?: boolean; saved?: boolean; own?: boolean; onChoose?: () => void; effect?: string }) {
  const { label, humanize, color } = useContext(Dom);
  const p = v.best;
  const snap = src?.snapshot;
  // The must-haves that this plan includes at no extra cost. Without this line, ticking a requirement that every plan
  // meets changed nothing on the page, and the person could not tell whether it was taken into account.
  const facts = snap?.model.plans?.find((x) => x.name === p?.plan)?.features ?? [];
  const meets = required.filter((f) => facts.some((x) => x.feature === f && x.status === "included"));
  // Rows that are separate products (GPU models, instance types): the price is for one of them, and the row says which.
  const names = (snap?.model.plans ?? []).map((x) => x.name);
  const products = productLike(names);
  const others = names.filter((n) => n !== p?.plan);
  return (
    <li className={chosen ? "vendor chosen" : "vendor"}>
      {/* The head wraps: with two badges and a long product name the cost and the button must stay inside the card. */}
      <div className="vendor-head" style={{ flexWrap: "wrap", rowGap: 2 }}>
        <span className="dot" style={{ background: color(v.id) }} />
        <span className="name">{place ? `${place}. ` : ""}{src?.name}</span>
        {src?.demo && <span className="badge">Demo</span>}
        {cheapest && <span className="badge" data-cheapest style={{ borderColor: "var(--axis)", color: "var(--ink-2)", whiteSpace: "nowrap" }}>Cheapest at these values</span>}
        {saved && <span className="badge saved" style={{ whiteSpace: "nowrap" }}>{own ? "Your saved choice" : "Saved choice"}</span>}
        <span className="plan" title={p?.plan}>{p ? <>{products ? "product" : "plan"}: <b>{p.plan}</b></> : <span className="muted">no eligible plan</span>}</span>
        <span className="cost">{p ? (place ? money(p.cost) : `≥ ${money(p.cost)}`) : "—"}<span className="muted small"> / month</span></span>
        {onChoose && <button className="small-btn" onClick={onChoose} aria-pressed={chosen}>{chosen ? "Selected" : "Select"}</button>}
      </div>
      {effect && <p className="small warn">{effect}</p>}
      {products && p && <p className="small warn" data-products>This price is for <b>{p.plan}</b>, the cheapest of {names.length} separate products on this page that fits your values. Also there: {others.slice(0, 4).join(", ")}{others.length > 4 ? ` and ${others.length - 4} more` : ""}.</p>}
      {meets.length > 0 && <p className="small ok">Includes {meets.map((f) => lower(label(f))).join(", ")}.</p>}
      {p && (
        <details>
          <summary className="small muted">
            {p.lines.map((l) => `${label(l.label.replace(" add-on", ""))}${l.label.endsWith("add-on") ? " add-on" : ""} ${l.amount == null ? "unknown" : money(l.amount)}`).join(" + ")}
            {snap && ` · source read ${ago(snap.fetchedAt, now)}`}
          </summary>
          <Lines p={p} model={snap?.model ?? null} evidence={snap?.evidence ?? {}} url={snap?.url ?? src?.url ?? ""} age={ago(snap?.fetchedAt, now)} />
          {v.plans.filter((x) => x.ineligible).map((x, i) => <p className="small muted" key={`${i}:${x.plan}`}>{x.plan} plan is out: {humanize(x.ineligible!)}.</p>)}
          {snap?.truncated && <p className="small warn">The page was too long to read in full. Some values may be missing.</p>}
          {p.assumed.map((u, i) => <p className="small muted" key={`${i}:${u}`}>Counted as $0: {humanize(u)}.</p>)}
        </details>
      )}
      {p?.unknowns.map((u, i) => <p className="small warn" key={`${i}:${u}`}>Unknown: {humanize(u)}.</p>)}
      {p && snap?.quarantined?.filter((q) => q.path.startsWith(p.plan + " / ")).map((q, qi) => (
        <p className="small warn" key={`${qi}:${q.path}`}>Not used: the extraction returned {q.value} for {humanize(q.path)}, but that number is not in the page text.</p>
      ))}
    </li>
  );
}

/** One row per cost part, each with the page quote, a link to the source and whether the quote was found in the page text. */
function Lines({ p, model, evidence, url, age }: { p: PlanCost; model: PricingModel | null; evidence: Record<string, boolean>; url: string; age: string }) {
  const { label } = useContext(Dom);
  const plan = model?.plans?.find((x) => x.name === p.plan);
  const quoteOf = (key: string) => {
    const [kind, id] = key.split("/");
    return kind === "base" ? plan?.price_quote : kind === "meter" ? plan?.meters?.find((m) => m.metric === id)?.quote : plan?.features?.find((f) => f.feature === id)?.quote;
  };
  return (
    <table className="lines">
      <tbody>
        {p.lines.map((l, li) => {
          const q = quoteOf(l.key)?.replace(/<br\s*\/?>/g, " · ") ?? null;
          const ok = evidence[`${p.plan}/${l.key}`];
          // Text fragment link: opens the source page scrolled to the quoted words where the browser supports it.
          const frag = q ? `#:~:text=${encodeURIComponent(q.split(" · ")[0].slice(0, 80))}` : "";
          return (
            <tr key={`${li}:${l.key}`}>
              <td>{label(l.label.replace(" add-on", ""))}</td>
              <td className="amt">{l.amount == null ? <span className="warn">unknown</span> : money(l.amount)}</td>
              <td className="small">
                {q ? <q>{q.length > 140 ? q.slice(0, 140) + "…" : q}</q> : <span className="muted">no quote</span>}{" "}
                <a href={url + frag} target="_blank" rel="noreferrer">source ↗</a> <span className="muted">· {age}</span>{" "}
                {ok === true && <span className="ok" title="The quote or its numbers were found in the page text of the same capture">✓ on page</span>}
                {ok === false && <span className="warn" title="The quote and its numbers were not found in the page text. Check the source.">⚠ not found on page</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The saved decision, always judged under the assumptions it was saved with, and always labelled with them. What the saved
 * vendor would cost under other values is said elsewhere (the "You are trying other values" notice above the ranking).
 */
function Standing({ decision, st, name, cheapestName, savedWords, atSaved, own, now, onLoad, onClear }: { decision: NonNullable<PublicState["decision"]>; st: Stand; name: string; cheapestName: string | null; savedWords: string; atSaved: boolean; own: boolean; now: number; onLoad: () => void; onClear: (() => void) | null }) {
  return (
    <>
      <p className="small" style={{ margin: "0 0 6px" }}>{own ? "Your saved choice" : "The saved choice of this example"}: <b>{name}</b></p>
      <p className={st.holds ? "verdict ok" : "verdict bad"} data-verdict>
        {st.holds ? "✓ Holds. " : "✕ No longer holds. "}At {own ? "your" : "the"} saved values ({savedWords}): {standSentence(st, name, cheapestName, false, undefined, own)}
      </p>
      <p className="small">
        Rule: the decision holds while {name} costs {st.tolerance > 0 ? `at most ${money(st.tolerance)} per month more than the cheapest vendor` : "no more than the cheapest vendor"} at the saved values.
      </p>
      <p className="small muted">Saved {ago(decision.savedAt, now)}. Judged against the prices as last read.{atSaved ? "" : " The ranking now shows other values than these."}</p>
      <div className="row">
        <button className="small-btn" disabled={atSaved} onClick={onLoad}>{own ? "Back to my saved values" : "Back to the saved values"}</button>
        {onClear && <button className="small-btn" onClick={onClear}>Clear</button>}
      </div>
    </>
  );
}

function DemoEditor({ page, busy, onPublish }: { page: PricingModel | null; busy: boolean; onPublish: (f: DemoFields) => void }) {
  const [f, setF] = useState<DemoFields>(() => demoFields(page));
  const field = (k: keyof DemoFields, text: string, step: number) => (
    <label className="demo-field">
      {text}
      <input type="number" step={step} min={0} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) || 0 })} />
    </label>
  );
  return (
    <section className="card demo">
      <h2>Demo source <span className="badge">Demo</span></h2>
      <p className="small">Northwind Auth is a fictional vendor. Its <a href="/demo-vendor/pricing" target="_blank" rel="noreferrer">pricing page</a> is served by this app, so you can change a price and watch the standing decision react. Publishing re-checks the source at once, through the same read, diff and verdict as the real sources; on a public deployment Context.dev reads the page, which takes 10 to 40 seconds.</p>
      {field("base", "Base price, $ per month", 1)}
      {field("mauIncluded", "Users included", 1000)}
      {field("mauPrice", "Price per extra user, $", 0.001)}
      {field("ssoPrice", "Price per extra SSO connection, $", 5)}
      <button disabled={busy} onClick={() => onPublish(f)}>Publish to demo page</button>
    </section>
  );
}

// ---- Cost curves along one metric, with crossovers. Form: lines over a continuous axis (change of a magnitude along a control).
function Chart({ models, a, axis, cross, names }: { models: Record<string, PricingModel | null>; a: Assumptions; axis: MetricDef; cross: { at: number }[]; names: Record<string, string> }) {
  const { color } = useContext(Dom);
  const W = 640, H = 250, L = 56, R = 12, T = 10, B = 28;
  const v = a.usage[axis.id] ?? axis.initial;
  const log = isLog(axis);
  // Window around the current value, so nearby crossovers stay readable.
  const lo = log ? Math.max(axis.min, v / 10) : axis.min;
  const hi = log ? Math.min(axis.max, Math.max(v * 10, axis.min * 100)) : Math.min(axis.max, Math.max(v * 2.5, axis.max / 20));
  const N = 96;
  const xs = useMemo(() => Array.from({ length: N + 1 }, (_, i) => (log ? lo * Math.pow(hi / lo, i / N) : lo + ((hi - lo) * i) / N)), [log, lo, hi]);
  const series = useMemo(
    () => Object.keys(models).filter((id) => models[id]).map((id) => ({ id, ys: xs.map((x) => { const c = vendorCost(id, models[id], { ...a, usage: { ...a.usage, [axis.id]: Math.round(x) } }); return c.complete ? c.best!.cost : null; }) })),
    [models, a, axis.id, xs],
  );
  const [hover, setHover] = useState<number | null>(null);
  const at = (x: number) => ({ x, rows: series.map((s) => ({ id: s.id, y: vendorCost(s.id, models[s.id], { ...a, usage: { ...a.usage, [axis.id]: Math.round(x) } }) })) });
  const here = at(v);
  const yMax = Math.max(1, ...series.flatMap((s) => s.ys.filter((y): y is number => y != null)), ...here.rows.filter((r) => r.y.complete).map((r) => r.y.best!.cost)) * 1.08;
  const sx = (x: number) => L + (W - L - R) * (log ? Math.log(x / lo) / Math.log(hi / lo) : (x - lo) / (hi - lo || 1));
  const sy = (y: number) => T + (H - T - B) * (1 - y / yMax);
  const inv = (px: number) => { const t = Math.min(1, Math.max(0, (px - L) / (W - L - R))); return log ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t; };
  const path = (ys: (number | null)[]) => ys.map((y, i) => (y == null ? "" : `${i === 0 || ys[i - 1] == null ? "M" : "L"}${sx(xs[i]).toFixed(1)},${sy(y).toFixed(1)}`)).join("");
  const xt = log ? [lo, Math.sqrt(lo * hi), hi] : [lo, (lo + hi) / 2, hi];
  const yt = [0, yMax / 2 / 1.08, yMax / 1.08];
  const tip = hover == null ? null : at(hover);
  const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`);

  return (
    <figure className="chart">
      <ul className="legend">
        {series.map((s) => <li key={s.id}><span className="swatch" style={{ background: color(s.id) }} />{names[s.id]}</li>)}
      </ul>
      <div className="plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Monthly cost per vendor along ${lower(axis.label)}`}
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(inv(((e.clientX - r.left) / r.width) * W)); }} onMouseLeave={() => setHover(null)}>
          {yt.map((y, i) => <g key={`${i}:${y}`}><line x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} className="grid" /><text x={L - 8} y={sy(y) + 4} textAnchor="end" className="tick">${short(y)}</text></g>)}
          {xt.map((x, i) => <text key={i} x={sx(x)} y={H - 8} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} className="tick">{short(x)} {i === 2 ? axis.unit : ""}</text>)}
          {cross.filter((c) => c.at > lo && c.at < hi).map((c, i) => <line key={`${i}:${c.at}`} x1={sx(c.at)} x2={sx(c.at)} y1={T} y2={H - B} className="cross-line" />)}
          {v >= lo && v <= hi && <line x1={sx(v)} x2={sx(v)} y1={T} y2={H - B} className="here" />}
          {series.map((s) => <path key={s.id} d={path(s.ys)} fill="none" stroke={color(s.id)} strokeWidth={2} strokeLinejoin="round" />)}
          {v >= lo && v <= hi && here.rows.filter((r) => r.y.complete).map((r) => <circle key={r.id} cx={sx(v)} cy={sy(r.y.best!.cost)} r={4.5} fill={color(r.id)} className="marker" />)}
          {tip && <line x1={sx(tip.x)} x2={sx(tip.x)} y1={T} y2={H - B} className="crosshair" />}
        </svg>
        {tip && (
          <div className="tip" style={{ left: `${(sx(tip.x) / W) * 100}%`, transform: sx(tip.x) > W * 0.6 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}>
            <b>{num(Math.round(tip.x))} {axis.unit}</b>
            {tip.rows.sort((p, q) => (p.y.complete ? p.y.best!.cost : Infinity) - (q.y.complete ? q.y.best!.cost : Infinity)).map((r) => (
              <span key={r.id}><i className="swatch" style={{ background: color(r.id) }} />{names[r.id]} <em>{r.y.complete ? money(r.y.best!.cost) : r.y.best ? `≥ ${money(r.y.best.cost)}` : "not eligible"}</em></span>
            ))}
          </div>
        )}
      </div>
      <figcaption className="muted small">Solid line: your current value. Dashed lines: the cheapest vendor changes. A vendor without a line here cannot be fully priced in this range.</figcaption>
    </figure>
  );
}
