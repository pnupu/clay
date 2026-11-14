"use client";
// Prototype B: Clay's control kit inside the person's own app. The agent adds a dev-only route that renders the REAL
// component through this one client component: a stage with the component, a panel with a few controls from a spec,
// and Settle. Settle posts the values, the range the person tried and the outputs to a dev-only route of the same app
// (clay-settle-route.ts), which writes .clay/settled/<id>.json for the agent to read. Nothing leaves the machine.
// One file, React only, inline styles: it does not depend on the app's design system and does not touch it.
import { type CSSProperties, type ReactNode, useMemo, useRef, useState } from "react";

export type ClayControl =
  | { id: string; type: "slider"; label: string; min: number; max: number; step?: number; initial: number; unit?: string }
  | { id: string; type: "toggle"; label: string; initial: boolean }
  | { id: string; type: "select"; label: string; options: { value: string; label?: string }[]; initial: string }
  | { id: string; type: "color"; label: string; initial: string };
export type ClayValues = Record<string, number | boolean | string>;
type Tried = Record<string, { from: number; to: number } | (string | boolean)[]>;

export function ClayPlayground(props: {
  /** Lower-case letters, digits and hyphens: the name of the settled file. */
  id: string;
  title: string;
  /** What the person should try, in one sentence. */
  note?: string;
  controls: ClayControl[];
  /** The code-ready text for each value set (the class string, the props, the config): what you will write at hand-back. */
  outputs?: (v: ClayValues) => Record<string, string>;
  settleUrl?: string;
  /** The real component, with the values applied. */
  children: (v: ClayValues) => ReactNode;
}) {
  const { id, title, note, controls, outputs, settleUrl = "/api/clay-settle", children } = props;
  const initial = useMemo(() => Object.fromEntries(controls.map((c) => [c.id, c.initial])) as ClayValues, [controls]);
  const [values, setValues] = useState<ClayValues>(initial);
  const [state, setState] = useState<"idle" | "saving" | "settled" | "failed">("idle");
  const [error, setError] = useState("");
  const tried = useRef<Tried>({});
  const set = (c: ClayControl, v: number | boolean | string) => {
    const t = tried.current[c.id];
    if (c.type === "slider" && typeof v === "number") {
      const r = (t as { from: number; to: number } | undefined) ?? { from: c.initial, to: c.initial };
      tried.current[c.id] = { from: Math.min(r.from, v), to: Math.max(r.to, v) };
    } else tried.current[c.id] = [...new Set([...((t as (string | boolean)[] | undefined) ?? [c.initial as string | boolean]), v as string | boolean])];
    setValues((old) => ({ ...old, [c.id]: v }));
    setState("idle");
  };
  const texts = outputs ? outputs(values) : {};
  async function settle() {
    setState("saving");
    try {
      const r = await fetch(settleUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, title, values, initial, tried: tried.current, outputs: texts }) });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
      setState("settled");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("failed");
    }
  }
  return (
    <div data-clay-playground={id} style={S.page}>
      <div data-clay-stage style={S.stage}>{children(values)}</div>
      <aside data-clay-controls style={S.panel}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        {note && <p style={S.small}>{note}</p>}
        {controls.map((c) => (
          <label key={c.id} data-clay-control={c.id} style={S.row}>
            <span style={S.label}>
              {c.label}
              <output style={S.value}>{c.type === "toggle" ? (values[c.id] ? "on" : "off") : `${values[c.id]}${c.type === "slider" && c.unit ? ` ${c.unit}` : ""}`}</output>
            </span>
            {c.type === "slider" && <input type="range" min={c.min} max={c.max} step={c.step ?? 1} value={values[c.id] as number} onChange={(e) => set(c, Number(e.target.value))} />}
            {c.type === "toggle" && <input type="checkbox" checked={values[c.id] as boolean} onChange={(e) => set(c, e.target.checked)} />}
            {c.type === "select" && (
              <select value={values[c.id] as string} onChange={(e) => set(c, e.target.value)} style={S.select}>
                {c.options.map((o) => <option key={o.value} value={o.value}>{o.label ?? o.value}</option>)}
              </select>
            )}
            {c.type === "color" && <input type="color" value={values[c.id] as string} onChange={(e) => set(c, e.target.value)} />}
          </label>
        ))}
        <button type="button" onClick={() => { tried.current = {}; setValues(initial); setState("idle"); }} style={S.plain}>Back to the start values</button>
        {Object.entries(texts).map(([k, t]) => (
          <div key={k} style={S.row}>
            <span style={S.label}>{k}</span>
            <pre data-clay-output={k} style={S.code}>{t}</pre>
          </div>
        ))}
        <button type="button" data-clay-settle onClick={settle} disabled={state === "saving"} style={S.settle}>Settle on these values</button>
        {state === "settled" && <p data-clay-settled style={S.small}>Settled. Tell your agent that you are done: it reads .clay/settled/{id}.json.</p>}
        {state === "failed" && <p data-clay-failed style={{ ...S.small, color: "#b91c1c" }}>Not saved: {error}</p>}
        <p style={S.small}>Runs in your own app, on your machine. Nothing is sent anywhere else.</p>
      </aside>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  page: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", minHeight: "100vh" },
  stage: { minWidth: 0, padding: 24 },
  panel: { position: "sticky", top: 0, alignSelf: "start", height: "100vh", overflow: "auto", display: "flex", flexDirection: "column", gap: 12, padding: 16, borderLeft: "1px solid rgba(128,128,128,.35)", background: "Canvas", color: "CanvasText", font: "13px/1.4 system-ui, sans-serif", colorScheme: "light dark" },
  row: { display: "flex", flexDirection: "column", gap: 4 },
  label: { display: "flex", justifyContent: "space-between", gap: 8 },
  value: { fontVariantNumeric: "tabular-nums", opacity: 0.75 },
  small: { margin: 0, fontSize: 12, opacity: 0.75 },
  select: { font: "inherit", padding: "4px 6px" },
  code: { margin: 0, padding: 8, font: "12px/1.4 ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid rgba(128,128,128,.35)", borderRadius: 6 },
  plain: { font: "inherit", padding: "4px 8px", alignSelf: "start" },
  settle: { font: "inherit", fontWeight: 600, padding: "8px 12px", borderRadius: 6, border: 0, background: "CanvasText", color: "Canvas", cursor: "pointer" },
};
