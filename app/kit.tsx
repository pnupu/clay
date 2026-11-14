"use client";

// The screen of a preview playground: kit controls, the sandboxed preview of the real artifact, and the outputs that go
// back to the agent. Every move is local: the page posts the values to the frame, and nothing waits for a network call.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fromFrame, limiter, TILES } from "@/lib/frame";
import { cleanValue, initialValues, paletteOf, renderOutputs, snap, valuesNow, type Control, type KitState, type Value, type Values } from "@/lib/kit";
import type { WebSource, WebState, WebValue } from "@/lib/web";
import { hostsOf, joinNames, reasonOf, recordPath, rowNamed, type JoinNames } from "@/lib/card";
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
export default function Kit({ id, title, state, canWrite, builtByViewer = canWrite, embedded = false, byTeam = false, reading = false, leftOut = [], version, connected = false }: { id: string; title: string; state: KitState; canWrite: boolean; /** The viewer's own agent built it (not the admin looking at another person's playground). */ builtByViewer?: boolean; embedded?: boolean; /** An example that the Clay team made itself (a playground without an owner), not a person's that the operator marked. */ byTeam?: boolean; reading?: boolean; leftOut?: { name: string; reason: string }[]; /** The admin on a person's playground: the frame shows only this version (the one the page's mark sends), and its status is not stored. */ version?: string; /** The viewer is past connecting an agent (lib/accounts.ts, agentConnected): an example does not ask them to connect one. */ connected?: boolean }) {
  // `reading`: web sources or the brand are still being read (the agent's tool call answers before they arrive). The page
  // asks the server again every 3 seconds; when the data has arrived the screen is rendered with it and the preview
  // loads again with the new data (the page keys this component by the data, app/p/[pg]/page.tsx).
  const router = useRouter();
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [reading, router]);
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
  /** A visitor's Settle on an example: the values it was pressed at, kept on this page only. A later move ends it. */
  const [tried, setTried] = useState<string | null>(null);
  /** The names this preview can join page rows on: its own data and its select options (lib/card.ts). */
  const names = useMemo(() => joinNames(kit.inline, kit.controls.flatMap((c) => (c.type === "select" ? c.options.flatMap((o) => [o.value, o.label ?? ""]) : []))), [kit]);
  const iframe = useRef<HTMLIFrameElement>(null);
  /** The height of the preview's content, as the frame reports it (lib/frame.ts, bounded). Null until the first report. */
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  /**
   * The frame is as tall as its content (the frame reports it, at most MAX_FRAME_HEIGHT), so the page is the only thing
   * that scrolls: there is no scroll inside the preview. A preview taller than half the screen is "tall": on a narrow
   * screen the controls then come first and the preview follows them (kit.module.css); a short one comes first.
   */
  const [screenH, setScreenH] = useState<number | null>(null);
  useEffect(() => {
    const on = () => setScreenH(window.innerHeight);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  /**
   * After a move the person must see what changed. When the preview is outside the screen at that moment (a narrow
   * screen with many controls and a tall preview), a line under the controls says that it changed and leads to it.
   */
  const stage = useRef<HTMLElement>(null);
  const stageSeen = useRef(true);
  const [unseenChange, setUnseenChange] = useState(false);
  useEffect(() => {
    const el = stage.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      stageSeen.current = e.isIntersecting;
      if (e.isIntersecting) setUnseenChange(false);
      // Seen: any part of the preview is in the middle half of the screen (a share of its own height would never be
      // reached by a preview several screens tall).
    }, { rootMargin: "-25% 0px -25% 0px", threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const frameHeight = Math.max(120, contentHeight ?? kit.preview.height);
  const tall = screenH != null && frameHeight > screenH * 0.5;
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
      if (m.type === "height") return setContentHeight(m.height);
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
    if (!canWrite || version || frame.status === "loading" || reports.current >= 3) return;
    const t = setTimeout(() => {
      reports.current++;
      fetch(`${api}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: state.rev, ...(frame.status === "ok" ? { ok: true } : { error: frame.error }) }) }).catch(() => {});
    }, frame.status === "ok" ? 1500 : 0);
    return () => clearTimeout(t);
  }, [frame, canWrite, version, api, state.rev]);

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
    if (!stageSeen.current) setUnseenChange(true);
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
    if (!stageSeen.current && !atStart) setUnseenChange(true);
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
  const triedNow = tried === JSON.stringify(values);
  const atStart = JSON.stringify(values) === JSON.stringify(initialValues(kit.controls));
  const copy = (key: string, text: string) => navigator.clipboard?.writeText(text).then(() => setCopied(key), () => {});

  const Shell = embedded ? "div" : "main";
  const Title = embedded ? "p" : "h1";
  // Inside another page (the landing page's hero) the parts are named by labels: that page owns the headings.
  const Head = embedded ? "p" : "h2";
  return (
    <Shell className={embedded ? `${css.embedded} k-root` : "shell k-root"} data-tall={tall || undefined}>
      <header className="top k-head">
        <div>
          <p className="eyebrow">{canWrite ? <><Link href="/">Clay</Link> · {builtByViewer ? "a playground built by your agent" : "a playground built by its author's agent"}</> : (byTeam ? "An example by the Clay team · built by our agent from one request" : "An example · built by its author's own agent")}</p>
          <Title className={css.title}>{title}</Title>
        </div>
      </header>
      {error && <p className="alert">{error}</p>}
      {reading && <p className="small muted" data-building>Reading the web pages this playground is built from. The numbers fill in as each page is read; you do not need to reload.</p>}

      <div className={css.grid}>
        {/* The note is a grid item, so that on a narrow screen it can come after the preview: play first, read second. */}
        {kit.notes && <p className={`${css.notes} k-notes`}>{kit.notes}</p>}
        <section className="pane controls k-controls">
          <Head className="k-label">Controls</Head>
          {kit.controls.map((c) => <Field key={c.id} c={c} value={values[c.id]} palette={c.type === "color" ? paletteOf(c, state.brandData) : []} names={state.brandData?.colors ?? []} onChange={(v) => set(c, v)} />)}
          <button className="small-btn" disabled={atStart} onClick={reset}>Back to the start values</button>
          {unseenChange && <button className={`primary ${css.jump}`} data-preview-changed onClick={() => stage.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })}>The preview changed. Show it</button>}
          <p className="muted small" style={{ marginTop: 12 }}>Every move runs in this browser. {kit.preview.map ? "No agent is in the loop; the map loads its tiles through Clay as you move it." : "No agent and no network call is in the loop."} {!canWrite ? "Nothing you try here is saved." : builtByViewer ? "A short summary of what you tried is kept for your agent." : "A short summary of what you tried is kept for the author's agent."}</p>
        </section>

        <div className={`${css.main} k-main`}>
          {/* The stage: the person's real component on a neutral mat, as a design tool shows an artboard. On a narrow screen it
              comes first and stays in view while the controls below it are moved (kit.module.css). */}
          <section className={`pane ${css.stage} k-stage`} aria-label="Preview" ref={stage}>
            <div className={css.stageHead}>
              <Head className="k-label">Preview</Head>
            </div>
            {frame.status === "failed" && (
              <p className={`alert ${css.failed}`} role="alert">
                Preview failed: {frame.error} {!canWrite ? "" : builtByViewer ? "The error is saved. Tell your agent that the preview is broken; it can read the error and repair it." : "The error is saved; the author's agent can read it and repair the preview."}
              </p>
            )}
            {/* A data view is not an artboard: it is part of the page, in the page's own type and colours (lib/sheet.ts),
                so it sits on the pane itself, with no mat and no white sheet around it. */}
            <div className={kit.preview.data ? css.sheet : css.mat}>
              {inBrowser && !stopped && <iframe ref={iframe} className={css.frame} style={{ height: frameHeight }} src={`/p/${id}/frame${version ? `?v=${encodeURIComponent(version)}` : ""}`} sandbox="allow-scripts" referrerPolicy="no-referrer" title="Preview built by the owner's agent" onLoad={onLoad} />}
            </div>
          </section>

          <section className="pane k-out">
            <Head className="k-label">{!canWrite ? "If this were yours, your agent would now write this into the code" : builtByViewer ? "What goes back to your agent" : "What goes back to the author's agent"}</Head>
            {kit.outputs.map((o) => (
              <div className={css.output} key={o.id}>
                <div className={css.outputHead}>
                  <span className="small muted">{o.label}</span>
                  <button className="small-btn" onClick={() => copy(o.id, outputs[o.id])}>{copied === o.id ? "Copied" : "Copy"}</button>
                </div>
                <OutputText id={o.id} text={outputs[o.id]} />
              </div>
            ))}
            {canWrite ? (
              <div className={css.settle}>
                <button className="primary" disabled={busy || isSettled} onClick={settle}>{isSettled ? "Settled" : settled ? "Settle again on these values" : "Settle on these values"}</button>
                {isSettled ? (
                  <span className="small ok" data-settled>{builtByViewer ? <>✓ Settled. Tell your agent you are done: it reads these outputs and writes them into your code.{kit.web?.length ? ` It also keeps this decision in your repository (${recordPath(id)}), and any later session re-checks it from there.` : ""}</> : "✓ Settled. The author's agent reads these outputs when it next reads this playground."}</span>
                ) : settled ? (
                  <span className="small warn">The controls differ from what you settled.</span>
                ) : (
                  <span className="small muted">When it is right, settle. {builtByViewer ? "Your agent" : "The author's agent"} gets the values, this text, and the range you tried.</span>
                )}
              </div>
            ) : (
              embedded ? (
                <p className="small" data-example>This is an example, so there is nothing to settle here. {connected ? "Ask your agent to build and settle your own." : <><Link href="/connect" prefetch={false}>Connect your own agent</Link> to build and settle your own.</>}</p>
              ) : (
                // A visitor can finish the loop: Settle on an example saves nothing and sends nothing; it shows, on this
                // page only, what their own agent would receive (the values and the texts above, as they stand).
                <div data-example>
                  <div className={css.settle}>
                    <button className="primary" disabled={triedNow} onClick={() => setTried(JSON.stringify(values))}>{triedNow ? "Settled, here only" : "Settle on these values"}</button>
                    {!triedNow && <span className="small muted">This is an example: Settle saves nothing. It shows what your agent would get.</span>}
                  </div>
                  {triedNow && (
                    <p className="small" data-settle-try role="status">
                      Nothing is saved: this is an example. On your own playground your agent reads this and writes it into your code: the texts above as they stand, and the values {kit.controls.map((c) => `${c.label} ${shownValue(c, values[c.id])}`).join(", ")}. {connected ? "Ask your agent to build your own." : <Link href="/connect" prefetch={false}>Connect your own agent</Link>}
                    </p>
                  )}
                </div>
              )
            )}
          </section>

          {(kit.brand || kit.inline || kit.web?.length || leftOut.length > 0) && (
            <section className={`pane ${css.dataCard} k-data`}>
              <Head className="k-label">Where the data comes from</Head>
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
                {(kit.web ?? []).map((s) => <WebSourceItem key={s.id} pg={id} source={s} state={state.web?.[s.id]} reading={reading} since={settled?.at ?? null} names={names} />)}
                {kit.inline && <li data-inline><p className="small">{builtByViewer ? "Provided by your agent, not checked" : "Provided by the author's agent, not checked"}: {Object.keys(kit.inline).join(", ")}.</p></li>}
                {/* What the agent left out and why, as it said (left_out of the spec). */}
                {leftOut.map((x, i) => <li key={i} data-left-out><p className="small muted">Left out: <b>{x.name}</b> — {reasonOf(x.reason)}</p></li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
      {/* A map preview shows map tiles of OpenStreetMap, which must be credited where the map is (the licence link cannot
          be inside the frame: a sandboxed frame opens no link), and it says who sees what. For everyone, the owner included. */}
      {kit.preview.map && (
        <p className="small muted k-about" data-map-note>
          Map tiles: <a href={TILES.licence} target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>. Clay fetches them from {new URL(TILES.upstream).host} for you: Clay sees the area you look at, and the tile server sees Clay, not your internet address.
        </p>
      )}
      {/* What a preview can and cannot do (sandboxed, not sealed from the network) is stated on /privacy. A person looking
          at a preview that their own agent did not build gets one quiet link to it; the owner needs none. */}
      {!builtByViewer && !embedded && <p className="small muted k-about"><Link href="/privacy#previews" prefetch={false}>About previews</Link>: what this preview can and cannot do.</p>}
    </Shell>
  );
}

/** A control's value as the page shows it: on or off, an option's label, a number with its unit. */
const shownValue = (c: Control, v: Value): string =>
  c.type === "toggle" ? (v ? "on" : "off") : c.type === "select" ? (c.options.find((o) => o.value === v)?.label ?? String(v)) : c.type === "slider" && c.unit ? `${v} ${c.unit}` : String(v);

/** An output is folded when it is taller than this; folded, it shows its first lines (kit.module.css, .folded). */
const FOLD_TALLER_THAN = 220;

/**
 * The text of one output. A long one (a rule in words, a block of CSS) shows its first lines and opens on request, so it
 * does not push the rest of the page away; "Copy" above it always copies all of it. Long is measured, not guessed: the
 * same text is a few lines on a wide screen and many on a phone.
 */
function OutputText({ id, text }: { id: string; text: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const [tall, setTall] = useState(() => text.length > 600);
  const [open, setOpen] = useState(false);
  const words = useMemo(() => text.split(/\s+/).filter(Boolean).length, [text]);
  useLayoutEffect(() => {
    const el = pre.current;
    if (!el) return;
    // scrollHeight is the height of the whole text, also while it is folded.
    const measure = () => setTall(el.scrollHeight > FOLD_TALLER_THAN);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [text]);
  return (
    <>
      <pre ref={pre} data-output={id} id={`output-${id}`} className={tall && !open ? css.folded : undefined}>{text}</pre>
      {tall && (
        <button className={`small-btn ${css.more}`} aria-expanded={open} aria-controls={`output-${id}`} onClick={() => setOpen(!open)}>
          {open ? "Show less" : `Show all of it (${words} words)`}
        </button>
      )}
    </>
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

/** "#abc" or "#aabbcc" (any case) as "#aabbcc"; anything else is not a colour. */
const asHex = (raw: string): string | null => {
  const t = raw.trim().replace(/^([0-9a-f]{3}|[0-9a-f]{6})$/i, "#$1");
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(t)) return ("#" + t.slice(1).split("").map((x) => x + x).join("")).toLowerCase();
  return null;
};

/** A typed colour. Text that is not a colour keeps the previous colour, and a note says so; nothing turns black silently. */
function HexBox({ label, value, onChange }: { label: string; value: string; onChange: (v: unknown) => void }) {
  const [text, setText] = useState<string | null>(null);
  // A note is about the colour it kept: it goes away when the colour changes another way (a swatch, the picker).
  const [noteOf, setNoteOf] = useState<{ text: string; value: string } | null>(null);
  const note = noteOf && noteOf.value === value ? noteOf.text : null;
  const commit = () => {
    if (text == null) return;
    const hex = asHex(text);
    if (hex) onChange(hex);
    setNoteOf(hex ? null : { text: `“${text.trim().slice(0, 20)}” is not a colour. Use #rrggbb, for example #2563eb. The colour stays ${value}.`, value });
    setText(null);
  };
  return (
    <>
      <input className={css.hex} type="text" spellCheck={false} autoCapitalize="off" value={text ?? value} aria-label={`${label}, colour code`} aria-invalid={note ? true : undefined}
        onChange={(e) => { setText(e.target.value); setNoteOf(null); }} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
      {note && <span className="small warn" role="status" style={{ flexBasis: "100%" }}>{note}</span>}
    </>
  );
}

function Field({ c, value, palette, names, onChange }: { c: Control; value: Value; palette: string[]; names: { hex: string; name: string }[]; onChange: (v: unknown) => void }) {
  if (c.type === "slider") {
    return (
      <div className={`${css.field} ${css.slider}`} data-control={c.id} title={c.meaning}>
        <label htmlFor={c.id}>{c.label}</label>
        <Exact c={c} value={value as number} onChange={onChange} />
        <output className="k-value" htmlFor={c.id} aria-hidden="true">{value as number}</output>
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
        {c.options.length > SELECT_AS_BUTTONS ? (
          // Many options are a list to open, not a wall of buttons that pushes the other controls off the screen.
          <>
            <label htmlFor={c.id}>{c.label}</label>
            <select id={c.id} value={value as string} onChange={(e) => onChange(e.target.value)}>
              {c.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </>
        ) : (
          <>
            <span className={css.label}>{c.label}</span>
            <div className={css.options} role="group" aria-label={c.label}>
              {c.options.map((o) => <button key={o.value} className="small-btn" data-value={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <div className={css.field} data-control={c.id} title={c.meaning}>
      <span className={css.label}>{c.label}</span>
      <div className={css.swatches} role="group" aria-label={c.label}>
        {palette.map((hex) => <button key={hex} data-color={hex} style={{ background: hex }} aria-pressed={value === hex} aria-label={`${names.find((n) => n.hex === hex)?.name || "Colour"} ${hex}${hex === c.initial ? ", the start colour" : ""}`} title={`${names.find((n) => n.hex === hex)?.name ?? ""} ${hex}${hex === c.initial ? " (start)" : ""}`.trim()} onClick={() => onChange(hex)} />)}
        {c.free && <input type="color" value={value as string} onChange={(e) => onChange(e.target.value)} aria-label={`${c.label}, any colour`} />}
        {c.free ? <HexBox label={c.label} value={value as string} onChange={onChange} /> : <code>{value as string}</code>}
      </div>
    </div>
  );
}

/** A value read from a web page. Unknown is said, never shown as a number; text from the page is shown as text only. */
const shown = (v: WebValue | undefined) => (v == null ? <span className="warn">unknown</span> : v === true ? "yes" : v === false ? "no" : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 6 }) : v);
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

/** A select with more options than this is a dropdown; up to this many are buttons, all in view. */
const SELECT_AS_BUTTONS = 5;

/** More rows than this are folded: the rows the preview names are shown, the rest opens on request. */
const FOLD_OVER = 8;

/** A field id as a person reads it: "price_per_hour" is "Price per hour". */
const words = (id: string) => id.replace(/_/g, " ").replace(/^[a-z]/, (c) => c.toUpperCase());
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

/** The values a person opened, by playground and source, kept in this tab's memory. */
const opened = new Set<string>();

/**
 * The values read from one source, closed until the person asks for them: the card says where the data comes from, and
 * the raw tables no longer push the page away. They stay in the page, so any number can still be checked against its
 * source. No summary: nothing to fold, the content is shown as it is.
 */
function Values({ id, summary, children }: { id: string; summary: string | null; children: ReactNode }) {
  // What the person opened stays open in this tab: the screen is mounted again whenever a source is read (see `held`).
  const [open, setOpen] = useState(() => opened.has(id));
  const toggle = (now: boolean) => {
    if (now) opened.add(id);
    else opened.delete(id);
    setOpen(now);
  };
  return summary == null ? <>{children}</> : <details className={css.values} open={open} onToggle={(e) => toggle(e.currentTarget.open)}><summary>{summary}</summary>{children}</details>;
}

/**
 * One web source in "Where the data comes from": the page (a link), when it was read, every value that was read, what was
 * quarantined, and what changed since the person settled. So a person can check any number against its page.
 * A long table shows first the rows that the preview's own names match (`names`), and the rest on request. A row whose
 * name the read did not find cannot be matched to anything: it is listed last, as such, and counted in a line of its own.
 */
function WebSourceItem({ pg, source: s, state: st, reading, since, names }: { /** The playground's id. */ pg: string; source: WebSource; state: WebState | undefined; reading: boolean; since: string | null; names: JoinNames }) {
  const [all, setAll] = useState(false);
  const read = st?.read;
  const link = st?.url && /^https:\/\//.test(st.url) ? st.url : null;
  const host = (() => { try { return new URL(st?.url ?? "").hostname; } catch { return s.domain ?? s.id; } })();
  const changes = (st?.changes ?? []).filter((c) => !since || c.at > since);
  const fields = s.fields ?? s.rows!.fields;
  const fact = (v: WebValue) => (v === true ? "yes" : v === false ? "no" : v == null ? "unknown" : String(v));
  // The first text field of a row is its name, as in the change list and the quotes (rowKey, lib/web.ts).
  const key = s.rows?.fields.find((f) => f.type === "text")?.id ?? null;
  const rows = read?.rows ?? [];
  const named = key ? rows.filter((r) => r[key] != null) : rows;
  const nameless = key ? rows.filter((r) => r[key] == null) : [];
  const used = key ? named.filter((r) => rowNamed(r[key], names)) : [];
  const foldable = rows.length > FOLD_OVER;
  // Folded: the rows this playground names, or the first few when it names none. The other rows stay in the page, hidden.
  const first = used.length ? used : (named.length ? named : nameless).slice(0, 5);
  const ordered = [...named, ...nameless];
  const isShown = (r: (typeof rows)[number]) => !foldable || all || first.includes(r);
  const tableId = `rows-${s.id}`;
  const site = hostsOf([host])[0] ?? host;
  /** The name under which this tab remembers that the person opened the values of this source. */
  const fold = `${pg}:${s.id}`;
  // Values the read did not find: counted in the line that opens the values, so "unknown" is said also while they are closed.
  const unknown = s.fields ? s.fields.filter((f) => read?.fields?.[f.id] == null).length : rows.reduce((n, r) => n + fields.filter((f) => r[f.id] == null).length, 0);
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
        <Values id={fold} summary={unknown ? `${s.fields.length - unknown} of ${count(s.fields.length, "value")} read, ${unknown} unknown` : `${count(s.fields.length, "value")} read`}>
          <table className={`${css.web} ${css.webFields}`}>
            <tbody>
              {s.fields.map((f) => <tr key={f.id}><th title={f.describe}>{words(f.id)}</th><td title={read.quotes[f.id] ?? ""}>{shown(read.fields?.[f.id])}{f.unit && read.fields?.[f.id] != null ? ` ${f.unit}` : ""}</td></tr>)}
            </tbody>
          </table>
        </Values>
      )}
      {read && s.rows && (
        // A page on which no row was found has nothing to fold: the line that says so stays in view.
        <Values id={fold} summary={rows.length ? `${count(rows.length, "row")} read${unknown ? `, ${count(unknown, "value")} unknown` : ""}` : null}>
          <div className={`${css.webScroll} ${all ? css.webOpen : ""}`} id={tableId}>
            <table className={css.web}>
              <thead><tr>{fields.map((f) => <th key={f.id} title={f.describe} className={f.type === "number" ? css.num : undefined}>{words(f.id)}{f.unit ? <small>{f.unit}</small> : null}</th>)}</tr></thead>
              <tbody>
                {ordered.map((r, i) => <tr key={i} hidden={!isShown(r)}>{fields.map((f) => <td key={f.id} className={f.type === "number" ? css.num : undefined}>{f.id === key && r[f.id] == null ? <span className="muted"><span className={css.unseen}>unknown: </span>no name read</span> : shown(r[f.id])}</td>)}</tr>)}
                {!rows.length && <tr><td colSpan={fields.length}><span className="warn">No row was found on this page.</span></td></tr>}
              </tbody>
            </table>
          </div>
          {foldable && (
            <p className={`small muted ${css.rowsNote}`} data-rows-note>
              {all ? `All ${rows.length} rows read from ${site}.` : used.length ? `Shown: ${used.length === 1 ? "the 1 row that matches" : `the ${used.length} rows that match`} the names this playground uses, of ${rows.length} read.` : `Shown: the first ${first.length} of ${rows.length} rows read.`}{" "}
              <button className="small-btn" aria-expanded={all} aria-controls={tableId} onClick={() => setAll(!all)}>{all ? "Show fewer rows" : `Show all ${rows.length} rows read from ${site}`}</button>
            </p>
          )}
          {nameless.length > 0 && (
            <p className="small muted" data-nameless>
              {nameless.length === 1 ? "1 row has" : `${nameless.length} rows have`} values but no name: the read did not find {nameless.length === 1 ? "its" : "their"} name on the page, so nothing can be matched to {nameless.length === 1 ? "it" : "them"} by name.
              {foldable && !all ? ` ${nameless.length === 1 ? "It is" : "They are"} listed last under “Show all”.` : ` ${nameless.length === 1 ? "It is" : "They are"} listed last, marked “no name read”.`}
            </p>
          )}
        </Values>
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
