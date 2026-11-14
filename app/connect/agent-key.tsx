"use client";

import { useState } from "react";

/** Requests a person can paste to their agent, one per kind of playground. */
const EXAMPLES = [
  { kind: "Look", text: "Use Clay to help me choose the corner radius, padding and shadow of the Sign up button in my app." },
  { kind: "Feel", text: "Use Clay so I can tune how the menu opens: how long it takes and how it eases." },
  { kind: "Price", text: "Use Clay to compare transactional email services for my app: about 30,000 emails a month now, maybe 200,000 later." },
];

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
    setCopied(null);
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
  // Without a secure context (http on another machine's address) there is no clipboard: say so instead of doing nothing.
  const copy = (id: string, text: string) => (navigator.clipboard ? navigator.clipboard.writeText(text).then(() => setCopied(id), () => setCopied(`failed:${id}`)) : setCopied(`failed:${id}`));
  const label = (id: string) => (copied === id ? "Copied" : copied === `failed:${id}` ? "Select and copy by hand" : "Copy");
  /** A command or text block with its own Copy button. Commands with the key need the key first. */
  const block = (id: string, text: string, needsKey = true) => (
    <div className="command copyable">
      <pre className="code" data-command={id}>{text}</pre>
      <button className="small-btn" onClick={() => copy(id, text)} disabled={needsKey && !key}>{label(id)}</button>
    </div>
  );

  return (
    <>
      <section className="card">
        <h2>1. Your agent key</h2>
        {key ? (
          <>
            <p className="ok">This is your new key. Copy it now: Clay shows it only once and keeps only a hash of it.</p>
            <div className="command copyable">
              <pre className="code" data-testid="agent-key">{key}</pre>
              <button className="small-btn" onClick={() => copy("key", key)}>{label("key")}</button>
            </div>
          </>
        ) : since ? (
          <p>You have a key, created {new Date(since).toUTCString()}. Clay cannot show it again, so the commands below show a placeholder. To see them with a key filled in, create a new one (the old one then stops working).</p>
        ) : (
          <p>You have no key yet. Create one: the commands below then show it filled in.</p>
        )}
        <p className="row wrap">
          <button className="primary" disabled={busy} onClick={() => call("POST")}>{since ? "Create a new key" : "Create my agent key"}</button>
          {since && <button disabled={busy} onClick={() => call("DELETE")}>Revoke key</button>}
        </p>
        {error && <p className="alert">{error}</p>}
      </section>

      <section className="card">
        <h2>2. Add Clay to your agent</h2>
        <h3>Claude Code</h3>
        {block("claude", `claude mcp add --scope user --transport http clay ${endpoint} --header "Authorization: Bearer ${shown}"`)}
        <p className="small muted"><code>--scope user</code> makes Clay available in every folder, not only the one you are in.</p>
        <p className="small muted">The first time your agent uses each Clay tool, Claude Code asks you to allow it. Allow it.</p>

        <h3>Codex</h3>
        {block("codex", `export CLAY_AGENT_KEY=${shown}\ncodex mcp add clay --url ${endpoint} --bearer-token-env-var CLAY_AGENT_KEY`)}
        <p className="small muted">Codex reads the key from <code>CLAY_AGENT_KEY</code> each time it starts. Also put the export line in your shell profile (for example <code>~/.zshrc</code>).</p>
        <p className="small muted">For <code>codex exec</code> (no questions asked): add this line under <code>[mcp_servers.clay]</code> in <code>~/.codex/config.toml</code>, or Clay&apos;s tools are refused:</p>
        {block("codex-approve", `default_tools_approval_mode = "approve"`, false)}
        <p className="small muted"><code>codex exec</code> can only read files by default. To let it write your settled result into your code, run it with <code>-s workspace-write</code>:</p>
        <pre className="code">{`codex exec -s workspace-write "Use Clay to <your request>"`}</pre>
        <p className="small muted">To answer it in the same session later, <code>-s</code> goes before <code>resume</code>:</p>
        {block("codex-resume", `codex exec -s workspace-write resume --last "I'm done."`, false)}

        <h3>Another agent</h3>
        <p className="small">Any MCP client that speaks Streamable HTTP: URL <code>{endpoint}</code>, header <code>Authorization: Bearer {shown}</code>.</p>
      </section>

      <section className="card">
        <h2>3. Ask your agent</h2>
        <p>Start your first request with <strong>“Use Clay to …”</strong>. Codex does not pick Clay on its own yet; with the name, every agent does. Paste one of these, or write your own:</p>
        {EXAMPLES.map((e) => (
          <div key={e.kind}>
            <h3>{e.kind}</h3>
            {block(`example-${e.kind}`, e.text, false)}
          </div>
        ))}
        <p>What happens: your agent answers with a link. Open it and move the controls until it looks, feels or costs right. Then press Settle (or save your decision) and tell your agent you are done. It reads what you chose and carries it out.</p>
      </section>

      <section className="card">
        <h2>Later</h2>
        <ul className="plain">
          <li><strong>Lost your key?</strong> Create a new one above; the old one stops working. Claude Code: run <code>claude mcp remove clay</code>, then the add command again. Codex: change the export line.</li>
          <li><strong>Remove Clay:</strong> <code>claude mcp remove clay</code> or <code>codex mcp remove clay</code>. If Claude Code says clay exists in several scopes (you also added it without <code>--scope user</code> in a folder), run <code>claude mcp remove --scope local clay</code> in that folder and <code>claude mcp remove --scope user clay</code>.</li>
        </ul>
      </section>
    </>
  );
}
