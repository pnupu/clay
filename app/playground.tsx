"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOMAIN, type MetricDef, type PricingModel } from "@/lib/domain";
import { crossovers, rank, vendorCost, type Assumptions, type PlanCost, type VendorCost } from "@/lib/pricing";
import { demoFields, demoModel, type DemoFields } from "@/lib/demo";
import type { PublicState } from "@/lib/store";

type Src = PublicState["sources"][string];

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const num = (n: number) => n.toLocaleString("en-US");
const label = (id: string) => DOMAIN.metrics.find((m) => m.id === id)?.label ?? DOMAIN.features.find((f) => f.id === id)?.label ?? id;
/** Replace metric and feature ids in a computed message with their labels. */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const humanize = (s: string) => [...DOMAIN.metrics, ...DOMAIN.features].reduce((t, d) => t.replaceAll(d.id, lower(d.label)), s);
const color = (id: string) => `var(--series-${DOMAIN.vendors.findIndex((v) => v.id === id) + 1})`;

function ago(iso: string | null | undefined, now: number) {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

// ---- Slider scales: wide ranges need a non-linear slider.
const isLog = (m: MetricDef) => m.min > 0 && m.max / m.min > 50;
const round2 = (x: number) => {
  if (x < 100) return Math.round(x);
  const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.round(x / p) * p;
};
const toValue = (m: MetricDef, pos: number) => (isLog(m) ? round2(m.min * Math.pow(m.max / m.min, pos / 1000)) : m.max <= 1000 ? Math.round(m.min + ((m.max - m.min) * pos) / 1000) : round2(m.max * Math.pow(pos / 1000, 3)));
const toPos = (m: MetricDef, v: number) => (isLog(m) ? (1000 * Math.log(Math.max(v, m.min) / m.min)) / Math.log(m.max / m.min) : m.max <= 1000 ? (1000 * (v - m.min)) / (m.max - m.min) : 1000 * Math.cbrt(v / m.max));

async function call(path: string, method = "GET", body?: unknown): Promise<PublicState & { error?: string | null }> {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}

export default function Playground() {
  const [state, setState] = useState<PublicState | null>(null);
  const [usage, setUsage] = useState<Record<string, number>>(() => Object.fromEntries(DOMAIN.metrics.map((m) => [m.id, m.initial])));
  const [required, setRequired] = useState<string[]>([]);
  const [axis, setAxis] = useState(DOMAIN.metrics[0].id);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const busyRef = useRef(false);

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

  useEffect(() => {
    call("/api/state").then(setState);
  }, []);

  // Watch loop. The demo source on localhost is re-checked every 3 s by the app itself (no Context.dev call).
  // Everything else changes only through a webhook or the button, so the loop just reloads the state.
  const demoLocal = state?.sources.demo?.snapshot?.extractor === "local-demo-parser";
  useEffect(() => {
    const t = setInterval(async () => {
      setNow(Date.now());
      if (busyRef.current) return;
      const s = demoLocal ? await call("/api/recheck", "POST", { id: "demo", trigger: "auto" }) : await call("/api/state");
      if (s.sources && !busyRef.current) setState(s);
    }, 3000);
    return () => clearInterval(t);
  }, [demoLocal]);

  const sources = useMemo(() => state?.sources ?? {}, [state]);
  const models = useMemo(() => Object.fromEntries(Object.entries(sources).map(([id, s]) => [id, s.snapshot?.model ?? null])) as Record<string, PricingModel | null>, [sources]);
  const collected = Object.values(sources).filter((s) => s.snapshot);

  // Controls come from the data: only metrics and features that at least one extracted page mentions.
  const metrics = DOMAIN.metrics.filter((m) => collected.some((s) => s.snapshot!.model.plans?.some((p) => p.meters?.some((x) => x.metric === m.id))));
  const features = DOMAIN.features.filter((f) => collected.some((s) => s.snapshot!.model.plans?.some((p) => p.features?.some((x) => x.feature === f.id && x.status != null))));

  const a: Assumptions = useMemo(() => ({ usage, required }), [usage, required]);
  const ranking = useMemo(() => rank(models, a), [models, a]);
  const axisDef = DOMAIN.metrics.find((m) => m.id === axis) ?? DOMAIN.metrics[0];
  const cross = useMemo(() => crossovers(models, a, axisDef.id, axisDef.min, axisDef.max), [models, a, axisDef]);
  const nextCross = cross.find((c) => c.at > (usage[axisDef.id] ?? 0));
  const pick = chosen && ranking.ranked.some((v) => v.id === chosen) ? chosen : ranking.cheapest;

  const decision = state?.decision ?? null;
  const standing = useMemo(() => (decision ? rank(models, decision) : null), [models, decision]);

  if (!state) return <main className="shell"><p className="muted">Loading…</p></main>;

  const collectedAll = DOMAIN.vendors.every((v) => sources[v.id]?.snapshot || sources[v.id]?.error);

  return (
    <main className="shell">
      <header className="top">
        <div>
          <p className="eyebrow">Live decision playground · data read from the web by Context.dev</p>
          <h1>{DOMAIN.question}</h1>
        </div>
        <div className="actions">
          {busy ? <span className="muted">{busy}…</span> : collected.length > 0 && (
            <span className="live"><i />{collected.length} sources live · last check {ago(collected.map((x) => x.lastCheckedAt ?? "").sort().at(-1), now)}</span>
          )}
          {!collectedAll && <button className="primary" disabled={!!busy} onClick={() => run("Reading pricing pages", "/api/collect")}>Collect pricing pages</button>}
          {collected.length > 0 && <button disabled={!!busy} onClick={() => run("Re-checking sources", "/api/recheck")}>Re-check all now</button>}
        </div>
      </header>
      {error && <p className="alert">{error}</p>}

      {collected.length === 0 ? (
        <section className="card empty">
          <h2>No data yet</h2>
          <p>Collect reads each vendor&apos;s public pricing page with Context.dev (search to find the page, then structured extraction). It takes about 15 seconds and uses about 6 credits per vendor.</p>
        </section>
      ) : (
        <div className="grid">
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
            <p className="muted small">Every move recomputes in this browser. No network call and no agent is in the loop.</p>
          </section>

          <section className="results">
            <div className="card">
              <h2>Monthly cost under these assumptions</h2>
              {ranking.ranked[0] && (
                <p className="answer">
                  Cheapest: <b>{sources[ranking.ranked[0].id]?.name}</b> at <b>{money(ranking.ranked[0].best!.cost)}</b> per month
                  {ranking.ranked[1] ? `, ${money(ranking.ranked[1].best!.cost - ranking.ranked[0].best!.cost)} less than ${sources[ranking.ranked[1].id]?.name}` : ""}.
                  {nextCross && <span className="muted"> The cheapest changes at {num(nextCross.at)} {axisDef.unit}.</span>}
                </p>
              )}
              <ol className="rank">
                {ranking.ranked.map((v, i) => (
                  <VendorRow key={v.id} v={v} src={sources[v.id]} now={now} place={i + 1} chosen={pick === v.id} onChoose={() => setChosen(v.id)} />
                ))}
              </ol>
              {ranking.unranked.length > 0 && <h3>Cannot be ranked</h3>}
              <ul className="rank">
                {ranking.unranked.map((v) => (
                  <VendorRow key={v.id} v={v} src={sources[v.id]} now={now} effect={v.effect} />
                ))}
              </ul>
              {DOMAIN.vendors.filter((v) => sources[v.id]?.error && !sources[v.id]?.snapshot).map((v) => (
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
                  {cross.map((c) => (
                    <li key={c.at}>
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
              {!decision || !standing ? (
                <>
                  <p className="small">Settle the controls, pick a vendor, then save. The app keeps the decision live: when a source changes, it recomputes under the saved assumptions.</p>
                  <button className="primary" disabled={!pick || !!busy} onClick={() => run("Saving", "/api/decision", "POST", { usage, required, chosen: pick })}>
                    Save decision{pick ? `: ${sources[pick]?.name}` : ""}
                  </button>
                </>
              ) : (
                <Standing decision={decision} standing={standing} sources={sources} now={now} onLoad={() => { setUsage({ ...usage, ...decision.usage }); setRequired(decision.required); setChosen(decision.chosen); }} onClear={() => run("Clearing", "/api/decision", "DELETE")} />
              )}
              <h3>What changed</h3>
              {state.events.length === 0 && <p className="muted small">No source has changed since collection.</p>}
              <ul className="events">
                {state.events.map((e) => (
                  <li key={e.id}>
                    <p className="small muted">{sources[e.sourceId]?.name} · {ago(e.at, now)} · {e.trigger === "webhook" ? "webhook" : e.trigger === "auto" ? "watch loop" : "re-check"}</p>
                    {e.changes.slice(0, 6).map((c) => (
                      <p className="change" key={c.path}>{humanize(c.path)}: <s>{String(c.before ?? "not stated")}</s> → <b>{String(c.after ?? "not stated")}</b></p>
                    ))}
                    {e.changes.length > 6 && <p className="small muted">and {e.changes.length - 6} more facts</p>}
                    {e.verdict && (
                      <p className={e.verdict.holds ? "verdict ok" : "verdict bad"}>
                        {e.verdict.holds ? "✓ Decision holds. " : "✕ Decision no longer holds. "}
                        {e.verdict.reason}
                        {e.verdict.chosenCostBefore != null && e.verdict.chosenCostNow != null && e.verdict.chosenCostBefore !== e.verdict.chosenCostNow && ` Your choice: ${money(e.verdict.chosenCostBefore)} → ${money(e.verdict.chosenCostNow)} per month.`}
                        {e.verdict.cheapestNow && e.verdict.cheapestNow !== e.verdict.cheapestBefore && ` Cheapest is now ${sources[e.verdict.cheapestNow]?.name}.`}
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
                    <span className="dot" style={{ background: color(s.id) }} />
                    <div>
                      <a href={s.url ?? "#"} target="_blank" rel="noreferrer">{s.name}</a>
                      {s.demo && <span className="badge">Demo</span>}
                      <p className="small muted">
                        {s.snapshot ? `Extracted ${ago(s.snapshot.fetchedAt, now)} by ${s.snapshot.extractor === "context.dev" ? `Context.dev in ${(s.snapshot.latencyMs / 1000).toFixed(1)} s` : "the app (localhost)"}` : "Not read"} · last checked {ago(s.lastCheckedAt, now)}
                        {s.monitor ? " · webhook monitor on" : ""}
                      </p>
                      {s.error && <p className="small bad">{s.error}</p>}
                    </div>
                    <button className="small-btn" disabled={!!busy} onClick={() => run(`Re-checking ${s.name}`, "/api/recheck", "POST", { id: s.id })}>Re-check</button>
                  </li>
                ))}
              </ul>
              {state.publicBaseUrl ? (
                <button disabled={!!busy} onClick={() => run("Updating monitors", "/api/watch", Object.values(sources).some((s) => s.monitor) ? "DELETE" : "POST")}>
                  {Object.values(sources).some((s) => s.monitor) ? "Stop webhook monitors" : "Start webhook monitors"}
                </button>
              ) : (
                <p className="small muted">Webhook monitors are off: Context.dev needs a public URL to deliver to, and this app runs on localhost. Use Re-check. The demo source is watched every 3 seconds.</p>
              )}
            </section>

            {sources.demo && <DemoEditor key={JSON.stringify(state.demoPage)} page={state.demoPage} busy={!!busy} onPublish={(f) => run("Publishing demo page", "/api/demo", "POST", demoModel(f))} />}
          </aside>
        </div>
      )}
    </main>
  );
}

function VendorRow({ v, src, now, place, chosen, onChoose, effect }: { v: VendorCost; src: Src; now: number; place?: number; chosen?: boolean; onChoose?: () => void; effect?: string }) {
  const p = v.best;
  const snap = src?.snapshot;
  return (
    <li className={chosen ? "vendor chosen" : "vendor"}>
      <div className="vendor-head">
        <span className="dot" style={{ background: color(v.id) }} />
        <span className="name">{place ? `${place}. ` : ""}{src?.name}</span>
        {src?.demo && <span className="badge">Demo</span>}
        <span className="plan muted">{p ? `${p.plan} plan` : "no eligible plan"}</span>
        <span className="cost">{p ? (place ? money(p.cost) : `≥ ${money(p.cost)}`) : "—"}<span className="muted small"> / month</span></span>
        {onChoose && <button className="small-btn" onClick={onChoose} aria-pressed={chosen}>{chosen ? "Chosen" : "Choose"}</button>}
      </div>
      {effect && <p className="small warn">{effect}</p>}
      {p && (
        <details>
          <summary className="small muted">
            {p.lines.map((l) => `${label(l.label.replace(" add-on", ""))}${l.label.endsWith("add-on") ? " add-on" : ""} ${l.amount == null ? "unknown" : money(l.amount)}`).join(" + ")}
            {snap && ` · source read ${ago(snap.fetchedAt, now)}`}
          </summary>
          <Lines p={p} model={snap?.model ?? null} evidence={snap?.evidence ?? {}} url={snap?.url ?? src?.url ?? ""} age={ago(snap?.fetchedAt, now)} />
          {v.plans.filter((x) => x.ineligible).map((x) => <p className="small muted" key={x.plan}>{x.plan} plan is out: {humanize(x.ineligible!)}.</p>)}
          {snap?.truncated && <p className="small warn">The page was too long to read in full. Some values may be missing.</p>}
          {p.assumed.map((u) => <p className="small muted" key={u}>Counted as $0: {humanize(u)}.</p>)}
        </details>
      )}
      {p?.unknowns.map((u) => <p className="small warn" key={u}>Unknown: {humanize(u)}.</p>)}
      {p && snap?.quarantined?.filter((q) => q.path.startsWith(p.plan + " / ")).map((q) => (
        <p className="small warn" key={q.path}>Not used: the extraction returned {q.value} for {humanize(q.path)}, but that number is not in the page text.</p>
      ))}
    </li>
  );
}

/** One row per cost part, each with the page quote, a link to the source and whether the quote was found in the page text. */
function Lines({ p, model, evidence, url, age }: { p: PlanCost; model: PricingModel | null; evidence: Record<string, boolean>; url: string; age: string }) {
  const plan = model?.plans?.find((x) => x.name === p.plan);
  const quoteOf = (key: string) => {
    const [kind, id] = key.split("/");
    return kind === "base" ? plan?.price_quote : kind === "meter" ? plan?.meters?.find((m) => m.metric === id)?.quote : plan?.features?.find((f) => f.feature === id)?.quote;
  };
  return (
    <table className="lines">
      <tbody>
        {p.lines.map((l) => {
          const q = quoteOf(l.key)?.replace(/<br\s*\/?>/g, " · ") ?? null;
          const ok = evidence[`${p.plan}/${l.key}`];
          // Text fragment link: opens the source page scrolled to the quoted words where the browser supports it.
          const frag = q ? `#:~:text=${encodeURIComponent(q.split(" · ")[0].slice(0, 80))}` : "";
          return (
            <tr key={l.key}>
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

function Standing({ decision, standing, sources, now, onLoad, onClear }: { decision: NonNullable<PublicState["decision"]>; standing: ReturnType<typeof rank>; sources: Record<string, Src>; now: number; onLoad: () => void; onClear: () => void }) {
  const mine = standing.ranked.find((v) => v.id === decision.chosen);
  const holds = standing.cheapest === decision.chosen;
  const top = standing.ranked[0];
  return (
    <>
      <p className={holds ? "verdict ok" : "verdict bad"}>
        {holds
          ? `✓ Holds. ${sources[decision.chosen]?.name} is the cheapest at ${money(mine!.best!.cost)} per month.`
          : mine
            ? `✕ ${sources[decision.chosen]?.name} costs ${money(mine.best!.cost)} per month, but ${sources[top.id]?.name} is cheaper at ${money(top.best!.cost)}.`
            : `✕ ${sources[decision.chosen]?.name} can no longer be priced under the saved assumptions.`}
      </p>
      <p className="small muted">
        Saved {ago(decision.savedAt, now)} for {Object.entries(decision.usage).filter(([, n]) => n > 0).map(([k, n]) => `${num(n)} ${lower(label(k))}`).join(", ")}
        {decision.required.length ? `; must have ${decision.required.map((f) => lower(label(f))).join(", ")}` : ""}. Judged against the sources as they are now.
      </p>
      <div className="row">
        <button className="small-btn" onClick={onLoad}>Load into controls</button>
        <button className="small-btn" onClick={onClear}>Clear</button>
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
      <p className="small">Northwind Auth is a fictional vendor. Its <a href="/demo-vendor/pricing" target="_blank" rel="noreferrer">pricing page</a> is served by this app, so you can change a price and watch the standing decision react. It goes through the same re-check, diff and verdict as the real sources.</p>
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
          {yt.map((y) => <g key={y}><line x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} className="grid" /><text x={L - 8} y={sy(y) + 4} textAnchor="end" className="tick">${short(y)}</text></g>)}
          {xt.map((x, i) => <text key={i} x={sx(x)} y={H - 8} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} className="tick">{short(x)} {i === 2 ? axis.unit : ""}</text>)}
          {cross.filter((c) => c.at > lo && c.at < hi).map((c) => <line key={c.at} x1={sx(c.at)} x2={sx(c.at)} y1={T} y2={H - B} className="cross-line" />)}
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
