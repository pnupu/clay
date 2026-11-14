"use client";
// Prototype B: Clay's control kit inside the person's own app. The agent adds a dev-only route that renders the REAL
// component through this one client component: a stage, a panel with a few controls from a spec, and Settle.
// The stage shows the component in several real places of the codebase (`uses`), and the panel asks at which level
// the change is made (`levels`): this instance, this variant, or the token. Only the uses that the chosen level
// changes get the new values, so the person sees what else moves before anything is written.
// Settle posts the level, the files it changes, the values, the range the person tried and the outputs to a dev-only
// route of the same app (clay-settle-route.ts), which writes .clay/settled/<id>.json for the agent to read.
// Nothing leaves the machine. One file, React only, inline styles: it does not depend on the app's design system.
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

type Option = { value: string; label?: string };
export type ClayControl = {
  id: string;
  label: string;
  /** A CSS variable of the theme ("--radius"). The control then belongs to the level "token": the kit sets the variable on the page root, so everything bound to it changes. */
  token?: string;
} & (
  | { type: "slider"; min: number; max: number; step?: number; initial: number; unit?: string }
  | { type: "toggle"; initial: boolean }
  | { type: "select"; options: Option[]; initial: string }
  | { type: "color"; initial: string }
  /** Spacing, radius, colour: `options` are the project's own scale classes or token classes ("px-2.5", "rounded-lg", "bg-muted"), in the scale's order. The person may also type a raw CSS value; it is applied as the style `css` ("borderRadius") and marked off-scale. */
  | { type: "scale"; options: Option[]; initial: string; css: string }
);
export type ClayValues = Record<string, number | boolean | string>;
/** What one use gets: spread `className` (changed scale classes) and `style` (off-scale values) on the real component. `values` are for props. */
export type ClayApplied = { className: string; style: CSSProperties; values: ClayValues; changes: boolean };
/** One real place where the component is used, with the props and the markup around it copied from that call site. */
export type ClayUse = { id: string; /** Path from the repository root with the line: "src/app/x/page.tsx:42". */ file: string; label?: string; /** The style properties that this call site sets itself with its own class, named as the `css` of the scale controls ("borderRadius" for a call site with `rounded-none`). At the level "variant" the call site keeps its own value in the real code, so the kit leaves those controls out for this use. */ sets?: string[]; render: (a: ClayApplied) => ReactNode };
export type ClayLevel = {
  id: "instance" | "variant" | "token";
  /** What changes, exactly: 'className of the "Save" Button', 'variant "outline" of buttonVariants', '--radius'. */
  target: string;
  /** The files that the hand-back edits at this level. */
  files: string[];
  /** The ids of the shown uses that change at this level. */
  uses: string[];
  /** Files with more uses that change at this level and are not shown. */
  others?: string[];
  /** The level exists but may not be chosen: the reason (a rule of the repository, generated code). */
  blocked?: string;
};
type Tried = Record<string, { from: number; to: number } | (string | boolean)[]>;

const LEVEL: Record<ClayLevel["id"], [string, string]> = {
  instance: ["This instance", "Only this one place changes."],
  variant: ["This variant", "The component's variant definition changes, so every use of that variant changes."],
  token: ["The token", "A theme token changes, so everything that uses the token changes."],
};

export function ClayPlayground(props: {
  /** Lower-case letters, digits and hyphens: the name of the settled file. */
  id: string;
  title: string;
  /** What the person should try, in one sentence. */
  note?: string;
  controls: ClayControl[];
  /** The real places where the component is used. The stage lists them with their file paths. */
  uses?: ClayUse[];
  /** The levels that are real for this component, narrowest first. */
  levels?: ClayLevel[];
  /** The code-ready text for the values now, at the chosen level: what you will write at hand-back. */
  outputs?: (v: ClayValues, level?: ClayLevel["id"]) => Record<string, string>;
  settleUrl?: string;
  /** A stage without `uses` (a page, a motion): the real component, with the values applied. */
  children?: (v: ClayValues) => ReactNode;
}) {
  const { id, title, note, controls, uses = [], levels = [], outputs, settleUrl = "/api/clay-settle", children } = props;
  const initial = useMemo(() => Object.fromEntries(controls.map((c) => [c.id, c.initial])) as ClayValues, [controls]);
  const [values, setValues] = useState<ClayValues>(initial);
  const [levelId, setLevelId] = useState(levels.find((l) => !l.blocked)?.id);
  const [state, setState] = useState<"idle" | "saving" | "settled" | "failed">("idle");
  const [error, setError] = useState("");
  const tried = useRef<Tried>({});
  // The off-scale text as typed. The stored value is trimmed, so the box keeps its own text: "oklch(0.9 0 0)" has spaces.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const level = levels.find((l) => l.id === levelId);
  // The controls of the chosen level: token controls on the level "token", the others on the other levels.
  const active = controls.filter((c) => !level || (level.id === "token") === !!c.token);
  const moved = active.filter((c) => values[c.id] !== initial[c.id]);
  const onScale = (c: ClayControl) => c.type !== "scale" || c.options.some((o) => o.value === values[c.id]);
  const now = { ...initial, ...Object.fromEntries(active.map((c) => [c.id, values[c.id]])) } as ClayValues;

  // A use that the level changes gets the changed values only: scale classes as className, off-scale values as style.
  const same: ClayApplied = { className: "", style: {}, values: initial, changes: false };
  // At the level "variant" a call site that sets a property itself keeps it in the real code: those controls are left out for that use,
  // and a use that sets every property the controls change does not change at all.
  const own = (u: ClayUse) => (level?.id === "variant" ? (u.sets ?? []) : []);
  const changes = (u: ClayUse) => (!level || level.uses.includes(u.id)) && !(active.length > 0 && active.every((c) => c.type === "scale" && own(u).includes(c.css)));
  const applied = (u: ClayUse): ClayApplied => {
    if (!changes(u)) return same;
    const mine = moved.flatMap((c) => (c.type === "scale" && !c.token && !own(u).includes(c.css) ? [c] : []));
    return { className: mine.filter(onScale).map((c) => values[c.id]).join(" "), style: Object.fromEntries(mine.filter((c) => !onScale(c)).map((c) => [c.css, String(values[c.id])])) as CSSProperties, values: now, changes: true };
  };

  // The level "token": the variable is set on the page root, as the theme file would set it. The browser decides what changes.
  const tokens = JSON.stringify(moved.filter((c) => c.token).map((c) => [c.token, `${values[c.id]}${c.type === "slider" ? (c.unit ?? "") : ""}`]));
  useEffect(() => {
    const root = document.documentElement, set = JSON.parse(tokens) as [string, string][];
    for (const [k, v] of set) root.style.setProperty(k, v);
    return () => { for (const [k] of set) root.style.removeProperty(k); };
  }, [tokens]);

  const record = (c: ClayControl, v: number | boolean | string) => {
    const t = tried.current[c.id];
    if (c.type === "slider" && typeof v === "number") {
      const r = (t as { from: number; to: number } | undefined) ?? { from: c.initial, to: c.initial };
      tried.current[c.id] = { from: Math.min(r.from, v), to: Math.max(r.to, v) };
    } else tried.current[c.id] = [...new Set([...((t as (string | boolean)[] | undefined) ?? [c.initial as string | boolean]), v as string | boolean])];
  };
  // A typed value counts as tried when the person leaves the box (`typing`), not on each keystroke.
  const set = (c: ClayControl, v: number | boolean | string, typing = false) => {
    if (!typing) record(c, v);
    setValues((old) => ({ ...old, [c.id]: v }));
    setState("idle");
  };
  const texts = outputs ? outputs(now, level?.id) : {};
  const pick = <T,>(o: Record<string, T>) => Object.fromEntries(active.filter((c) => c.id in o).map((c) => [c.id, o[c.id]]));
  async function settle() {
    setState("saving");
    const body = {
      id, title,
      // The level, what it names, the files the hand-back may edit, and the uses that change and that do not.
      level: level?.id ?? null, target: level?.target ?? null, files: level?.files ?? [],
      uses: { changed: uses.filter(changes).map((u) => u.file), unchanged: uses.filter((u) => !changes(u)).map((u) => u.file), changedNotShown: level?.others ?? [] },
      values: pick(values), initial: pick(initial), changed: moved.map((c) => c.id),
      // For every spacing, radius and colour control: is the value on the project's scale?
      onScale: Object.fromEntries(active.filter((c) => c.type === "scale").map((c) => [c.id, onScale(c)])),
      tried: pick(tried.current), outputs: texts,
    };
    try {
      const r = await fetch(settleUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
      setState("settled");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("failed");
    }
  }
  const paths = (l: ClayLevel) => {
    const all = [...uses.filter((u) => l.uses.includes(u.id)).map((u) => u.file), ...(l.others ?? [])];
    return `Changes ${all.length} use${all.length === 1 ? "" : "s"}: ${all.slice(0, 4).join(", ")}${all.length > 4 ? ` and ${all.length - 4} more` : ""}.`;
  };
  return (
    <div data-clay-playground={id}>
      <style>{CSS}</style>
      <div data-clay-stage style={S.stage}>
        {uses.map((u) => (
          <section key={u.id} data-clay-use={u.id} data-clay-changes={changes(u)} style={{ ...S.use, opacity: changes(u) ? 1 : 0.7 }}>
            <header style={S.useHead}>
              <span><b>{u.label ?? u.id}</b> <code style={S.path}>{u.file}</code></span>
              <span style={{ ...S.badge, ...(changes(u) ? S.badgeOn : {}) }}>{changes(u) ? "changes" : "stays as it is"}</span>
            </header>
            <div style={S.useBody}>{u.render(applied(u))}</div>
          </section>
        ))}
        {children?.(now)}
      </div>
      <aside data-clay-controls style={S.panel}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        {note && <p style={S.small}>{note}</p>}
        {levels.length > 0 && (
          <fieldset data-clay-levels style={S.levels}>
            <legend style={{ padding: "0 4px" }}>What should change?</legend>
            {levels.map((l) => (
              <label key={l.id} data-clay-level={l.id} data-clay-level-blocked={l.blocked ? "" : undefined} style={{ ...S.level, opacity: l.blocked ? 0.6 : 1 }}>
                <input type="radio" name={`clay-level-${id}`} checked={l.id === levelId} disabled={!!l.blocked} onChange={() => { setLevelId(l.id); setState("idle"); }} />
                <span>
                  <b>{LEVEL[l.id][0]}</b>: <code style={S.path}>{l.target}</code>
                  <span style={S.levelText}>{LEVEL[l.id][1]} {l.blocked ? `Not offered here: ${l.blocked}` : paths(l)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {active.map((c) => (
          <label key={c.id} data-clay-control={c.id} style={S.row}>
            <span style={S.label}>
              {c.label}
              <output style={S.value}>
                {c.type === "toggle" ? (values[c.id] ? "on" : "off") : `${values[c.id]}${c.type === "slider" && c.unit ? ` ${c.unit}` : ""}`}
                {!onScale(c) && <mark data-clay-off-scale style={S.off}>off-scale</mark>}
              </output>
            </span>
            {c.type === "slider" && <input type="range" min={c.min} max={c.max} step={c.step ?? 1} value={values[c.id] as number} onChange={(e) => set(c, Number(e.target.value))} />}
            {c.type === "toggle" && <input type="checkbox" checked={values[c.id] as boolean} onChange={(e) => set(c, e.target.checked)} />}
            {(c.type === "select" || c.type === "scale") && (
              <select value={onScale(c) ? (values[c.id] as string) : ""} onChange={(e) => set(c, e.target.value)} style={S.select}>
                {!onScale(c) && <option value="" disabled>not on the project&apos;s scale</option>}
                {c.options.map((o) => <option key={o.value} value={o.value}>{o.label ?? o.value}</option>)}
              </select>
            )}
            {c.type === "scale" && <input type="text" data-clay-off-scale-input placeholder="or a value off the scale, e.g. 14px" value={onScale(c) ? "" : (typed[c.id]?.trim() ? typed[c.id] : (values[c.id] as string))} onChange={(e) => { const text = e.target.value; setTyped((t) => ({ ...t, [c.id]: text })); set(c, text.trim() || c.initial, true); }} onBlur={() => { if (!onScale(c)) record(c, values[c.id]); }} style={S.select} />}
            {c.type === "color" && <input type="color" value={values[c.id] as string} onChange={(e) => set(c, e.target.value)} />}
          </label>
        ))}
        <button type="button" onClick={() => { tried.current = {}; setTyped({}); setValues(initial); setState("idle"); }} style={S.plain}>Back to the start values</button>
        {Object.entries(texts).map(([k, t]) => (
          <div key={k} style={S.row}>
            <span style={S.label}>{k}</span>
            <pre data-clay-output={k} style={S.code}>{t}</pre>
          </div>
        ))}
        <button type="button" data-clay-settle onClick={settle} disabled={state === "saving"} style={S.settle}>Settle on these values</button>
        {state === "settled" && <p data-clay-settled style={S.small}>Settled{level ? ` at the level "${LEVEL[level.id][0].toLowerCase()}"` : ""}. Tell your agent that you are done: it reads .clay/settled/{id}.json.</p>}
        {state === "failed" && <p data-clay-failed style={{ ...S.small, color: "#b91c1c" }}>Not saved: {error}</p>}
        <p style={S.small}>Runs in your own app, on your machine. Nothing is sent anywhere else.</p>
      </aside>
    </div>
  );
}

// The two-column page, and one column on a narrow screen (inline styles cannot hold a media query).
const CSS = `[data-clay-playground]{display:grid;grid-template-columns:minmax(0,1fr) 320px;min-height:100vh}
[data-clay-controls]{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;border-left:1px solid rgba(128,128,128,.35)}
@media (max-width:760px){[data-clay-playground]{grid-template-columns:minmax(0,1fr)}[data-clay-controls]{position:static;height:auto;border-left:0;border-top:1px solid rgba(128,128,128,.35)}}`;
const ui = "13px/1.4 system-ui, sans-serif";
const S: Record<string, CSSProperties> = {
  stage: { minWidth: 0, padding: 24, display: "flex", flexDirection: "column", gap: 16 },
  use: { border: "1px dashed rgba(128,128,128,.45)", borderRadius: 8, transition: "opacity .15s" },
  useHead: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px dashed rgba(128,128,128,.45)", font: ui, fontSize: 12 },
  useBody: { padding: 16, minWidth: 0, overflow: "auto" },
  path: { font: "11px/1.4 ui-monospace, monospace", opacity: 0.8, overflowWrap: "anywhere" },
  badge: { font: ui, fontSize: 11, padding: "1px 8px", borderRadius: 999, border: "1px solid rgba(128,128,128,.45)", whiteSpace: "nowrap" },
  badgeOn: { background: "#1d4ed8", border: "1px solid #1d4ed8", color: "#fff" },
  panel: { display: "flex", flexDirection: "column", gap: 12, padding: 16, background: "Canvas", color: "CanvasText", font: ui, colorScheme: "light dark" },
  levels: { display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 8, border: "1px solid rgba(128,128,128,.35)", borderRadius: 6 },
  level: { display: "flex", alignItems: "start", gap: 6 },
  levelText: { display: "block", fontSize: 12, opacity: 0.75, wordBreak: "break-word" },
  row: { display: "flex", flexDirection: "column", gap: 4 },
  label: { display: "flex", justifyContent: "space-between", gap: 8 },
  value: { fontVariantNumeric: "tabular-nums", opacity: 0.75 },
  off: { marginLeft: 6, padding: "0 6px", borderRadius: 999, background: "#f59e0b", color: "#000", fontSize: 11 },
  small: { margin: 0, fontSize: 12, opacity: 0.75 },
  select: { font: "inherit", padding: "4px 6px" },
  code: { margin: 0, padding: 8, font: "12px/1.4 ui-monospace, monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid rgba(128,128,128,.35)", borderRadius: 6 },
  plain: { font: "inherit", padding: "4px 8px", alignSelf: "start" },
  settle: { font: "inherit", fontWeight: 600, padding: "8px 12px", borderRadius: 6, border: 0, background: "CanvasText", color: "Canvas", cursor: "pointer" },
};
