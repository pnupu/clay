"use client";

import { useState } from "react";

/** The person's agent key: shown once after it is created, then only its creation time. The server keeps a hash. */
export default function AgentKey({ endpoint, createdAt }: { endpoint: string; createdAt: string | null }) {
  const [key, setKey] = useState<string | null>(null);
  const [since, setSince] = useState(createdAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE") {
    if (method === "POST" && since && !confirm("A new key replaces the old one. An agent that uses the old key stops working until you add the new one. Go on?")) return;
    if (method === "DELETE" && !confirm("Revoke the key? An agent that uses it stops working.")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/agent-key", { method });
      const body = r.status === 204 ? null : await r.json();
      if (!r.ok) throw new Error(body?.error ?? `The request failed (${r.status}).`);
      setKey(body?.key ?? null);
      setSince(body?.createdAt ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const shown = key ?? "<your agent key>";
  const commands = [
    { id: "claude", label: "Claude Code", text: `claude mcp add --transport http clay ${endpoint} --header "Authorization: Bearer ${shown}"` },
    { id: "codex", label: "Codex", text: `export CLAY_AGENT_KEY=${shown}\ncodex mcp add clay --url ${endpoint} --bearer-token-env-var CLAY_AGENT_KEY`, note: "Codex reads the key from the environment each time it starts, so also put the export line in your shell profile (for example ~/.zshrc)." },
  ];
  const copy = (id: string, text: string) => navigator.clipboard?.writeText(text).then(() => setCopied(id), () => setCopied(null));

  return (
    <section className="card">
      <h2>1. Your agent key</h2>
      {key ? (
        <>
          <p className="ok">This is your new key. Copy it now: Clay shows it only once and keeps only a hash of it.</p>
          <pre className="code" data-testid="agent-key">{key}</pre>
        </>
      ) : since ? (
        <p>You have a key, created {new Date(since).toUTCString()}. Clay cannot show it again. If you lost it, create a new one.</p>
      ) : (
        <p>You have no key yet.</p>
      )}
      <p className="row wrap">
        <button className="primary" disabled={busy} onClick={() => call("POST")}>{since ? "Create a new key" : "Create my agent key"}</button>
        {since && <button disabled={busy} onClick={() => call("DELETE")}>Revoke key</button>}
      </p>
      {error && <p className="alert">{error}</p>}
      <h2 className="step">2. Add Clay to your agent</h2>
      {commands.map((c) => (
        <div key={c.id} className="command">
          <div className="command-head">
            <strong>{c.label}</strong>
            <button className="small-btn" onClick={() => copy(c.id, c.text)} disabled={!key}>{copied === c.id ? "Copied" : "Copy"}</button>
          </div>
          <pre className="code">{c.text}</pre>
          {c.note && <p className="small muted">{c.note}</p>}
        </div>
      ))}
      {!key && <p className="small muted">Create a key to get these commands with your key filled in.</p>}
      <h2 className="step">3. Ask for help with a decision</h2>
      <p>For example: “I need an email service for my app: about 30,000 emails a month now, maybe 200,000 later. Which one makes sense?” Your agent builds a playground and gives you its link. Try values there, select an option and save. Then tell your agent what to do next; it reads what you settled on.</p>
    </section>
  );
}
