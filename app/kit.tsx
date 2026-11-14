"use client";

// The screen of a preview playground: kit controls, the sandboxed preview of the real artifact, and the outputs that go
// back to the agent. Every move is local: the page posts the values to the frame, and nothing waits for a network call.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fromFrame, limiter } from "@/lib/frame";
import { cleanValue, initialValues, paletteOf, renderOutputs, snap, valuesNow, type Control, type KitState, type Value, type Values } from "@/lib/kit";
import type { WebSource, WebState, WebValue } from "@/lib/web";
import { becauseOf } from "@/lib/card";
import css from "./kit.module.css";

const noSubscription = () => () => {};
/**
 * Where the person has the controls, per playground and kit revision, kept in this tab's memory. The screen is mounted
 * again when web data or the brand arrives (the preview must load again with the data); the person may be moving
 * controls at that moment, and must find them where they left them.
 */
const held = new Map<string, Values>();
type Frame = { status: "loading" | "ok" | "failed"; error: string | null };

/**
 * `canWrite`: this viewer owns the playground (or is the admin). Anyone else is looking at an example: every control, the
 * preview and the outputs work for them in their browser, and nothing is settled, reported or saved. Their wording differs:
 * the agent that built an example is someone else's.
 * `embedded`: shown inside another page (the landing page's "Try it here"), so it brings no page frame and its title is an h2.
 */
export default function Kit({ id, title, state, canWrite, embedded = false, reading = false, leftOut = [] }: { id: string; title: string; state: KitState; canWrite: boolean; embedded?: boolean; reading?: boolean; leftOut?: { name: string; reason: string }[] }) {
  // `reading`: web sources or the brand are still being read (the agent's tool call answers before they arrive). The page
  // asks the server again every 3 seconds; when the data has arrived the screen is rendered with it and the preview
  // loads again with the new data (the page keys this component by the data, app/p/[pg]/page.tsx).
  const router = useRouter();
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [reading, router]);
  // The https logo hosts that the frame's img-src allows (lib/frame.ts): the preview can send requests there.
  const logoHosts = (state.brandData?.logos ?? []).filter((l) => {
    try {
      return new URL(l.url).protocol === "https:";
    } catch {
      return false;
    }
  }).length;
  const api = `/api/p/${id}`;
  const { kit } = state;
  // The owner comes back to where they left the controls. Anyone else gets the start values: an example opens on the
  // unsatisfying state that the person asked about, whatever its owner tried later.
  // Per view: the owner's page, a visitor's page and the embedded example each keep their own.
  const heldKey = `${id}:${state.rev ?? ""}:${canWrite ? "owner" : "visitor"}:${embedded ? "embedded" : "page"}`;
  const [values, setValues] = useState<Values>(() => held.get(heldKey) ?? (canWrite ? valuesNow(state) : initialValues(kit.controls)));
  useEffect(() => {
    held.set(heldKey, values);
  }, [heldKey, values]);
  const [settled, setSettled] = useState(state.settled);
  const [frame, setFrame] = useState<Frame>({ status: "loading", error: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  /** The frame is created in the browser only, after this page listens: no message and no load event of it is missed. */
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const ready = useRef(false);
  const latest = useRef(values);
  const outputs = useMemo(() => renderOutputs(kit, values), [kit, values]);

  // ---- The bridge. A message counts only when it comes from this frame's window, from an opaque origin, in a known shape.
  // More than 30 messages in 10 seconds stops the preview: the bridge of an honest preview sends a handful per load.
  const send = useCallback((v: Values) => iframe.current?.contentWindow?.postMessage({ clay: 1, type: "values", values: v }, "*"), []);
  useEffect(() => {
    const allow = limiter(30, 10_000);
    const onMessage = (e: MessageEvent) => {
      if (!iframe.current || e.source !== iframe.current.contentWindow || e.origin !== "null") return;
      if (!allow(Date.now())) return setFrame({ status: "failed", error: "The preview was stopped: it sent too many messages to the page." });
      const m = fromFrame(e.data);
      if (!m) return;
      // The first error stands: it is the cause, the later ones usually follow from it.
      if (m.type === "error") return setFrame((f) => (f.status === "failed" ? f : { status: "failed", error: m.message }));
      ready.current = true;
      send(latest.current);
      setFrame((f) => (f.status === "loading" ? { status: "ok", error: null } : f));
    };
    window.addEventListener("message", onMessage);
    // Should the frame already be loaded (a fast refresh in development), ask it to say again what it sent.
    iframe.current?.contentWindow?.postMessage({ clay: 1, type: "hello" }, "*");
    const slow = setTimeout(() => setFrame((f) => (f.status === "loading" ? { status: "failed", error: "The preview did not finish loading within 10 seconds: an endless loop in view.js, or a resource that did not load." } : f)), 10_000);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(slow);
    };
  }, [send]);
  useEffect(() => {
    latest.current = values;
    if (ready.current) send(values);
  }, [values, send]);
  /** The frame loads once. A second load means the preview navigated itself away from its document: it is removed. */
  const loads = useRef(0);
  const onLoad = () => {
    if (++loads.current > 1) setFrame({ status: "failed", error: "The preview was stopped: it navigated away from its own document." });
  };
  const stopped = frame.status === "failed" && /^The preview was stopped/.test(frame.error ?? "");

  // What happened is stored for the agent, only from the browser of someone who may write the playground: "ok" once the preview has run 1.5 s without an error, else the error.
  const reports = useRef(0);
  useEffect(() => {
    if (!canWrite || frame.status === "loading" || reports.current >= 3) return;
    const t = setTimeout(() => {
      reports.current++;
      fetch(`${api}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: state.rev, ...(frame.status === "ok" ? { ok: true } : { error: frame.error }) }) }).catch(() => {});
    }, frame.status === "ok" ? 1500 : 0);
    return () => clearTimeout(t);
  }, [frame, canWrite, api, state.rev]);

  // ---- The exploration summary for the agent: per control, what was tried since the last report. Sent after a pause.
  const seen = useRef<Record<string, { min?: number; max?: number; tried: Value[] }>>({});
  const moved = useRef(false);
  /** Remember a move for the next report: the range of a slider, the values of any other control. */
  const note = (c: Control, v: Value) => {
    const s = (seen.current[c.id] ??= { tried: [] });
    if (typeof v === "number") Object.assign(s, { min: Math.min(s.min ?? v, v), max: Math.max(s.max ?? v, v) });
    else if (s.tried.length < 40) s.tried.push(v);
    moved.current = true;
  };
  const set = (c: Control, raw: unknown) => {
    const v = cleanValue(c, raw);
    if (v === undefined || v === values[c.id]) return;
    note(c, v);
    setValues({ ...values, [c.id]: v });
  };
  useEffect(() => {
    if (!moved.current || !canWrite) return;
    const t = setTimeout(() => {
      const controls = Object.fromEntries(Object.entries(seen.current).map(([k, s]) => [k, { ...s, final: values[k] }]));
      seen.current = {};
      moved.current = false;
      fetch(`${api}/explore`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: state.rev, controls }) }).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [values, canWrite, api, state.rev]);

  // When the screen goes away with moves that were not reported yet (it is mounted again when data arrives), report them now.
  useEffect(() => {
    return () => {
      if (!moved.current || !canWrite) return;
      const controls = Object.fromEntries(Object.entries(seen.current).map(([k, s]) => [k, { ...s, final: latest.current[k] }]));
      fetch(`${api}/explore`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: state.rev, controls }) }).catch(() => {});
    };
  }, [api, canWrite, state.rev]);

  const reset = () => {
    for (const c of kit.controls) if (c.initial !== values[c.id]) note(c, c.initial);
    setValues(initialValues(kit.controls));
  };
  const settle = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${api}/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: state.rev, values }) });
      const body = (await r.json()) as { settled?: KitState["settled"]; error?: string };
      if (body.settled) setSettled(body.settled);
      setError(body.settled ? null : (body.error ?? "The values could not be saved."));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const isSettled = !!settled && JSON.stringify(settled.values) === JSON.stringify(values);
  const atStart = JSON.stringify(values) === JSON.stringify(initialValues(kit.controls));
  const copy = (key: string, text: string) => navigator.clipboard?.writeText(text).then(() => setCopied(key), () => {});

  const Shell = embedded ? "div" : "main";
  const Title = embedded ? "h2" : "h1";
  return (
    <Shell className={embedded ? css.embedded : "shell"}>
      <header className="top">
        <div>
          <p className="eyebrow">{canWrite ? <><Link href="/">Clay</Link> · a playground built by your agent</> : "An example · built by someone's own agent"}</p>
          <Title className={css.title}>{title}</Title>
        </div>
      </header>
      {error && <p className="alert">{error}</p>}
      {reading && <p className="small muted" data-building>Reading the web pages this playground is built from. The numbers fill in as each page is read; you do not need to reload.</p>}

      <div className={css.grid}>
        {/* The note is a grid item, so that on a narrow screen it can come after the preview: play first, read second. */}
        {kit.notes && <p className={css.notes}>{kit.notes}</p>}
        <section className="card controls">
          <h2>Controls</h2>
          {kit.controls.map((c) => <Field key={c.id} c={c} value={values[c.id]} palette={c.type === "color" ? paletteOf(c, state.brandData) : []} names={state.brandData?.colors ?? []} onChange={(v) => set(c, v)} />)}
          <button className="small-btn" disabled={atStart} onClick={reset}>Back to the start values</button>
          <p className="muted small" style={{ marginTop: 12 }}>Every move runs in this browser. No agent and no network call is in the loop. {canWrite ? "A short summary of what you tried is kept for your agent." : "Nothing you try here is saved."}</p>
        </section>

        <div className={css.main}>
          {/* The stage: the person's real component on a neutral mat, as a design tool shows an artboard. On a narrow screen it
              comes first and stays in view while the controls below it are moved (kit.module.css). */}
          <section className={`card ${css.stage}`} aria-label="Preview">
            <div className={css.stageHead}>
              <h2>Preview</h2>
            </div>
            {frame.status === "failed" && (
              <p className={`alert ${css.failed}`} role="alert">
                Preview failed: {frame.error} {canWrite ? "The error is saved. Tell your agent that the preview is broken; it can read the error and repair it." : ""}
              </p>
            )}
            <div className={css.mat}>
              {inBrowser && !stopped && <iframe ref={iframe} className={css.frame} style={{ height: kit.preview.height }} src={`/p/${id}/frame`} sandbox="allow-scripts" referrerPolicy="no-referrer" title="Preview built by the owner's agent" onLoad={onLoad} />}
            </div>
          </section>
          <p className={`small muted ${css.caption}`}>
                Built by the owner&apos;s agent. It runs in a sandbox and cannot read this page.{" "}
                {logoHosts > 0
                  ? "It can load images from the brand's logo hosts, and an image address can carry the values you set here, so those hosts can see them and your IP address."
                  : "It cannot send what you set here to other sites."}
                {state.kit.preview.tailwind ? " Your browser loads the Tailwind build from jsDelivr." : ""}
          </p>

          <section className="card">
            <h2>{canWrite ? "What goes back to your agent" : "If this were yours, your agent would now write this into the code"}</h2>
            {kit.outputs.map((o) => (
              <div className={css.output} key={o.id}>
                <div className={css.outputHead}>
                  <span className="small muted">{o.label}</span>
                  <button className="small-btn" onClick={() => copy(o.id, outputs[o.id])}>{copied === o.id ? "Copied" : "Copy"}</button>
                </div>
                <pre data-output={o.id}>{outputs[o.id]}</pre>
              </div>
            ))}
            {canWrite ? (
              <div className={css.settle}>
                <button className="primary" disabled={busy || isSettled} onClick={settle}>{isSettled ? "Settled" : settled ? "Settle again on these values" : "Settle on these values"}</button>
                {isSettled ? (
                  <span className="small ok" data-settled>✓ Settled. Tell your agent you are done: it reads these outputs and writes them into your code.</span>
                ) : settled ? (
                  <span className="small warn">The controls differ from what you settled.</span>
                ) : (
                  <span className="small muted">When it is right, settle. Your agent gets the values, this text, and the range you tried.</span>
                )}
              </div>
            ) : (
              <p className="small" data-example>This is an example, so there is nothing to settle here. <Link href="/connect">Connect your own agent</Link> to build and settle your own.</p>
            )}
          </section>

          {(kit.brand || kit.inline || kit.web?.length || leftOut.length > 0) && (
            <section className="card">
              <h2>Where the data comes from</h2>
              <ul className={css.data}>
                {kit.brand && (
                  <li>
                    {state.brandData ? (
                      <>
                        <p className="small">Brand colours of <b>{kit.brand.domain}</b>, read by Context.dev on {state.brandData.fetchedAt.slice(0, 10)}.</p>
                        <div className={css.chips}>{state.brandData.colors.map((x) => <span key={x.hex}><i style={{ background: x.hex }} />{x.hex} {x.name}</span>)}</div>
                      </>
                    ) : (
                      <p className="small warn">The brand of {kit.brand.domain} could not be read. No brand colours are offered.</p>
                    )}
                  </li>
                )}
                {(kit.web ?? []).map((s) => <WebSourceItem key={s.id} source={s} state={state.web?.[s.id]} reading={reading} since={settled?.at ?? null} />)}
                {kit.inline && <li><p className="small">Provided by your agent, not checked: {Object.keys(kit.inline).join(", ")}.</p></li>}
                {/* What the agent left out and why, as it said (left_out of the spec). */}
                {leftOut.map((x, i) => <li key={i} data-left-out><p className="small muted">Left out: <b>{x.name}</b>, because {becauseOf(x.reason)}</p></li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
    </Shell>
  );
}

/**
 * The exact-value field of a slider. While the person types, the text is theirs: "1" on the way to "120" is not pulled
 * into the range. A value inside the range takes effect at once; leaving the field brings any other text into the range.
 */
function Exact({ c, value, onChange }: { c: Extract<Control, { type: "slider" }>; value: number; onChange: (v: unknown) => void }) {
  const [text, setText] = useState<string | null>(null);
  const inRange = (raw: string) => raw.trim() !== "" && Number.isFinite(Number(raw)) && Number(raw) >= c.min && Number(raw) <= c.max;
  return (
    <input
      type="number"
      min={c.min}
      max={c.max}
      step={c.step}
      value={text ?? value}
      aria-label={`${c.label}, exact value`}
      onChange={(e) => {
        setText(e.target.value);
        if (inRange(e.target.value)) onChange(snap(c, Number(e.target.value)));
      }}
      onBlur={() => {
        if (text != null && text.trim() !== "" && Number.isFinite(Number(text)) && !inRange(text)) onChange(snap(c, Number(text)));
        setText(null);
      }}
    />
  );
}

function Field({ c, value, palette, names, onChange }: { c: Control; value: Value; palette: string[]; names: { hex: string; name: string }[]; onChange: (v: unknown) => void }) {
  if (c.type === "slider") {
    return (
      <div className={`${css.field} ${css.slider}`} data-control={c.id} title={c.meaning}>
        <label htmlFor={c.id}>{c.label}</label>
        <Exact c={c} value={value as number} onChange={onChange} />
        <span className="small muted">{c.unit ?? ""}</span>
        <input id={c.id} type="range" min={c.min} max={c.max} step={c.step} value={value as number} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    );
  }
  if (c.type === "toggle") {
    return (
      <label className={`check ${css.field}`} data-control={c.id} title={c.meaning}>
        <input type="checkbox" checked={value as boolean} onChange={(e) => onChange(e.target.checked)} />
        {c.label}
      </label>
    );
  }
  if (c.type === "select") {
    return (
      <div className={css.field} data-control={c.id} title={c.meaning}>
        <span className={css.label}>{c.label}</span>
        <div className={css.options} role="group" aria-label={c.label}>
          {c.options.map((o) => <button key={o.value} className="small-btn" data-value={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
        </div>
      </div>
    );
  }
  return (
    <div className={css.field} data-control={c.id} title={c.meaning}>
      <span className={css.label}>{c.label}</span>
      <div className={css.swatches} role="group" aria-label={c.label}>
        {palette.map((hex) => <button key={hex} data-color={hex} style={{ background: hex }} aria-pressed={value === hex} aria-label={`${names.find((n) => n.hex === hex)?.name || "Colour"} ${hex}${hex === c.initial ? ", the start colour" : ""}`} title={`${names.find((n) => n.hex === hex)?.name ?? ""} ${hex}${hex === c.initial ? " (start)" : ""}`.trim()} onClick={() => onChange(hex)} />)}
        {c.free && <input type="color" value={value as string} onChange={(e) => onChange(e.target.value)} aria-label={`${c.label}, any colour`} />}
        <code>{value as string}</code>
      </div>
    </div>
  );
}

/** A value read from a web page. Unknown is said, never shown as a number; text from the page is shown as text only. */
const shown = (v: WebValue | undefined) => (v == null ? <span className="warn">unknown</span> : v === true ? "yes" : v === false ? "no" : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 6 }) : v);
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

/**
 * One web source in "Where the data comes from": the page (a link), when it was read, every value that was read, what was
 * quarantined, and what changed since the person settled. So a person can check any number against its page.
 */
function WebSourceItem({ source: s, state: st, reading, since }: { source: WebSource; state: WebState | undefined; reading: boolean; since: string | null }) {
  const read = st?.read;
  const link = st?.url && /^https:\/\//.test(st.url) ? st.url : null;
  const host = (() => { try { return new URL(st?.url ?? "").hostname; } catch { return s.domain ?? s.id; } })();
  const changes = (st?.changes ?? []).filter((c) => !since || c.at > since);
  const fields = s.fields ?? s.rows!.fields;
  const fact = (v: WebValue) => (v === true ? "yes" : v === false ? "no" : v == null ? "unknown" : String(v));
  return (
    <li data-web-source={s.id}>
      <p className="small">
        <b>{s.id}</b>: {link ? <a href={link} target="_blank" rel="noreferrer">{host} ↗</a> : host}
        {read ? `, read by Context.dev ${when(read.fetchedAt)}` : reading ? ", being read…" : ", not read"}
        {st?.lastCheckedAt && read && when(st.lastCheckedAt) !== when(read.fetchedAt) ? `, checked again ${when(st.lastCheckedAt)}` : ""}
      </p>
      {!read && !reading && <p className="small warn">This page could not be read{st?.error ? `: ${st.error.slice(0, 200)}` : ""}. Its values are unknown.</p>}
      {read && st?.error && <p className="small warn">{st.error.slice(0, 200)}</p>}
      {read && s.fields && (
        <table className={css.web}>
          <tbody>
            {s.fields.map((f) => <tr key={f.id}><th title={f.describe}>{f.id}</th><td title={read.quotes[f.id] ?? ""}>{shown(read.fields?.[f.id])}{f.unit && read.fields?.[f.id] != null ? ` ${f.unit}` : ""}</td></tr>)}
          </tbody>
        </table>
      )}
      {read && s.rows && (
        <div className={css.webScroll}>
          <table className={css.web}>
            <thead><tr>{fields.map((f) => <th key={f.id} title={f.describe}>{f.id}{f.unit ? ` (${f.unit})` : ""}</th>)}</tr></thead>
            <tbody>
              {(read.rows ?? []).map((r, i) => <tr key={i}>{fields.map((f) => <td key={f.id}>{shown(r[f.id])}</td>)}</tr>)}
              {!read.rows?.length && <tr><td colSpan={fields.length}><span className="warn">No row was found on this page.</span></td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {read?.truncated && <p className="small warn">The page was too long to read in full. Rows may be missing.</p>}
      {read?.quarantined.map((q, i) => <p className="small warn" key={i}>Not used: the extraction returned {q.value} for {q.path}, but that number is not in the page text. It is shown as unknown.</p>)}
      {changes.length > 0 && (
        <div data-web-changes>
          <p className="small"><b>{since ? "Changed since you settled" : "Changed since this was built"}</b></p>
          {changes.slice(0, 12).map((c, i) => <p className="small" key={i}>{c.path}: <s>{fact(c.before)}</s> → <b>{fact(c.after)}</b> <span className="muted">({when(c.at)})</span></p>)}
        </div>
      )}
    </li>
  );
}
