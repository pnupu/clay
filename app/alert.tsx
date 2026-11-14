"use client";

import { useEffect, useState } from "react";

type View = { address: string; last: { at: string; ok: boolean; status: number | null; kind: "test" | "change" } | null } | null;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/**
 * "Tell me when this stops holding": the owner's alert address for this playground's saved decision (lib/alert.ts). The
 * address is never sent back to the page: after saving, only its masked form and the result of the last message show.
 */
export default function AlertSetting({ api }: { api: string }) {
  const [alert, setAlert] = useState<View | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${api}/alert`).then((r) => (r.ok ? r.json() : null)).then((j) => setAlert(j ? j.alert : null), () => setAlert(null));
  }, [api]);
  async function call(init: RequestInit) {
    setBusy(true);
    setError(null);
    const r = await fetch(`${api}/alert`, { headers: { "Content-Type": "application/json" }, ...init }).catch(() => null);
    const j = await r?.json().catch(() => null);
    setBusy(false);
    if (j && "alert" in j) setAlert(j.alert);
    if (!r?.ok && !(j && "alert" in j && j.alert?.last)) setError(j?.error ?? "That did not work. Try again.");
    return !!r?.ok;
  }
  if (alert === undefined) return null;
  const last = alert?.last;
  return (
    <div className="alert-setting" data-alert style={{ marginTop: 14 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><b>Tell me when this stops holding</b></p>
      {alert ? (
        <>
          <p className="small" style={{ margin: "0 0 6px" }}>
            After each re-check, Clay posts one message to <code>{alert.address}</code> when this decision stops holding, and one when it holds again.
          </p>
          <p className={`small ${last && !last.ok ? "bad" : "muted"}`} data-alert-last style={{ margin: "0 0 6px" }}>
            {!last ? "No message sent yet." : last.ok ? `Last message (${last.kind === "test" ? "a test" : "a change"}) sent ${when(last.at)}.` : `Last message (${last.kind === "test" ? "a test" : "a change"}) failed ${last.status ? `with status ${last.status}` : "with no answer"}, ${when(last.at)}.`}
          </p>
          <div className="row">
            <button className="small-btn" disabled={busy} onClick={() => call({ method: "POST", body: JSON.stringify({ test: true }) })}>Send a test message</button>
            <button className="small-btn" disabled={busy} onClick={() => call({ method: "DELETE" })}>Remove</button>
          </div>
        </>
      ) : (
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call({ method: "POST", body: JSON.stringify({ url: draft.trim() }) })) setDraft("");
          }}
        >
          <input type="url" required value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://hooks.slack.com/services/…" aria-label="Slack or Discord webhook address" autoComplete="off" spellCheck={false} style={{ flex: 1, minWidth: 0 }} />
          <button className="small-btn" disabled={busy || !draft.trim()}>Save</button>
        </form>
      )}
      {!alert && <p className="small muted" style={{ margin: "6px 0 0" }}>A Slack incoming webhook, or a Discord webhook with <code>/slack</code> at the end. The address is kept as a secret: after saving it shows only masked.</p>}
      {error && <p className="small bad" role="alert" style={{ margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}
