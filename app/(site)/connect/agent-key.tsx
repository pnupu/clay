"use client";

import { useState } from "react";
import { STANDING_INSTRUCTION } from "@/connect/standing-instruction";
import { KEY_PLACEHOLDER, maskKey } from "@/lib/mask";

/** What a person types to their agent: the sentence that asks for a playground, once for a look or feel and once for a decision on prices. */
const EXAMPLES = [
  { kind: "A look or a feel", text: "build me a playground for the Sign up button in my app: its corner radius, padding, shadow and hover" },
  { kind: "A decision on prices", text: "build me a playground for this: which transactional email service for about 30,000 emails a month now, maybe 200,000 later?" },
];

/** The person's agent key: shown once after it is created, then only its creation time. The server keeps a hash. */
/** What stands in a command for the operator's key. The page never has the key itself: it lives in the deployment's settings. */
const OWNER_PLACEHOLDER = "<owner key>";

/**
 * `operator`: the viewer is in with the owner key (the operator session), not as a person. The same three steps, adapted:
 * no key is created or shown; the commands carry the placeholder and can be copied with it.
 */
export default function AgentKey({ endpoint, createdAt, operator = false }: { endpoint: string; createdAt: string | null; operator?: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [since, setSince] = useState(createdAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /**
   * The key is hidden by default: the page may be on a shared screen or in a recording. While it is hidden, the page holds
   * only the masked text (lib/mask.ts); the real key stays in this component's memory, for Copy and for "Show key".
   */
  const [visible, setVisible] = useState(false);

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
      // A new key starts hidden, also when the one before it was shown.
      setVisible(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** The key as the page shows it: the placeholder without a key, the masked form while it is hidden, the key when asked. */
  const shown = operator ? OWNER_PLACEHOLDER : !key ? KEY_PLACEHOLDER : visible ? key : maskKey(key);
  /** The text of a command with a key in it: for the page (the shown key) and for Copy (always the real key). */
  const withKey = (make: (k: string) => string) => ({ text: make(shown), real: make(operator ? OWNER_PLACEHOLDER : (key ?? KEY_PLACEHOLDER)) });
  // Without a clipboard (http on another machine's address, or a refusal) the person must select the text by hand. The
  // key is never shown because a copy failed (the page may be on a shared screen): the note under the block says that a
  // hidden key must be shown first, so a masked command is not copied as if it were real.
  const copy = (id: string, real: string) => (navigator.clipboard ? navigator.clipboard.writeText(real).then(() => setCopied(id), () => setCopied(`failed:${id}`)) : setCopied(`failed:${id}`));
  const label = (id: string) => (copied === id ? "Copied" : "Copy");
  /** What to do when Copy did not work, for a block that holds the key (`hasKey`) and for one that does not. */
  const byHand = (id: string, hasKey: boolean) =>
    copied === `failed:${id}` ? (
      <p className="small warn" role="status" data-by-hand={id}>
        Copying did not work in this browser. {hasKey && key && !visible ? "The key is hidden here: press “Show key” first, then select the text and copy it by hand." : "Select the text and copy it by hand."}
      </p>
    ) : null;
  /** A command or text block with its own Copy button. `real` is what Copy copies when it differs from what is shown. Commands with the key need the key first. */
  const block = (id: string, text: string, needsKey = true, real = text) => (
    <>
      <div className="command copyable">
        <pre className="code" data-command={id}>{text}</pre>
        <button className="small-btn" onClick={() => copy(id, real)} disabled={needsKey && !key} title={needsKey && !key ? "Create a key first: the command needs it" : undefined}>{label(id)}</button>
      </div>
      {byHand(id, needsKey)}
    </>
  );
  const claude = withKey((k) => `claude mcp add --scope user --transport http clay ${endpoint} --header "Authorization: Bearer ${k}"`);
  const env = operator ? "CLAY_ACCESS_KEY" : "CLAY_AGENT_KEY";
  const codex = withKey((k) => `export ${env}=${k}\ncodex mcp add clay --url ${endpoint} --bearer-token-env-var ${env}`);

  return (
    <>
      {operator ? (
        <section className="pane" data-operator>
          <h2>1. You are in as the operator</h2>
          <p>You are in as the operator (the owner key). Your agent connects with that same key. This page does not have the key: it is the value of <code>CLAY_ACCESS_KEY</code> in the deployment’s settings. In the commands below, put it in place of <code>{OWNER_PLACEHOLDER}</code>.</p>
          <p className="small muted">Playgrounds that your agent builds with the owner key are the operator’s, and can be marked as examples. To see Clay as a new person does, leave the operator session (clear this site’s cookies in your browser), then sign up.</p>
        </section>
      ) : (
      <section className="pane">
          <h2>1. Your agent key</h2>
          {key ? (
            <>
              <p className="ok">This is your new key. Copy it now: Clay shows it only once and keeps only a hash of it. It stays on this page, hidden, until you leave the page.</p>
              <div className="command copyable">
                <pre className="code" data-testid="agent-key">{shown}</pre>
                <button className="small-btn primary" onClick={() => copy("key", key)}>{label("key")}</button>
              </div>
              {byHand("key", true)}
              <p className="row wrap">
                <button className="small-btn" aria-pressed={visible} onClick={() => setVisible(!visible)} data-testid="show-key">{visible ? "Hide key" : "Show key"}</button>
                <span className="small muted">Copy puts the real key on your clipboard, also while it is hidden here and in the commands below.</span>
              </p>
            </>
          ) : since ? (
            <p>You have a key, created on {new Date(since).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}. Clay cannot show it again, so the commands below show a placeholder and cannot be copied. To fill them in, create a new key (the old one then stops working).</p>
          ) : (
            <p>You have no key yet. Create one: the commands below then show it filled in.</p>
          )}
          <p className="row wrap">
            {/* Right after a key is shown, the next step is to copy it, not to replace it: this button is then a plain one. */}
            <button className={key ? undefined : "primary"} disabled={busy} onClick={() => call("POST")}>{since ? "Create a new key" : "Create my agent key"}</button>
            {since && <button disabled={busy} onClick={() => call("DELETE")}>Revoke key</button>}
          </p>
          {error && <p className="alert">{error}</p>}
        </section>
      )}

      <section className="pane">
        <h2>2. Add Clay to your agent</h2>
        <h3>Claude Code</h3>
        {block("claude", claude.text, !operator, claude.real)}
        <p className="small muted"><code>--scope user</code> makes Clay available in every folder, not only the one you are in.</p>
        <p className="small muted">The first time your agent uses each Clay tool, Claude Code asks you to allow it. Allow it.</p>

        <h3>Codex</h3>
        {block("codex", codex.text, !operator, codex.real)}
        <p className="small muted">Codex reads the key from <code>{env}</code> each time it starts. Also put the export line in your shell profile (for example <code>~/.zshrc</code>).</p>
        <p className="small muted">For <code>codex exec</code> (no questions asked): add this line under <code>[mcp_servers.clay]</code> in <code>~/.codex/config.toml</code>, or Clay&apos;s tools are refused:</p>
        {block("codex-approve", `default_tools_approval_mode = "approve"`, false)}
        <p className="small muted"><code>codex exec</code> can only read files by default. To let it write your settled result into your code, run it with <code>-s workspace-write</code>:</p>
        <pre className="code">{`codex exec -s workspace-write "build me a playground for <your request>"`}</pre>
        <p className="small muted">To answer it in the same session later, <code>-s</code> goes before <code>resume</code>:</p>
        {block("codex-resume", `codex exec -s workspace-write resume --last "I'm done."`, false)}

        <h3>Another agent</h3>
        <p className="small">Any MCP client that speaks Streamable HTTP: URL <code>{endpoint}</code>, header <code>Authorization: Bearer {shown}</code>.{key && !visible ? " The key is hidden here: press “Show key” above to read it, or copy it from the key block." : ""}</p>
      </section>

      <section className="pane">
        <h2>3. Ask for a playground</h2>
        <p>Type <strong>“build me a playground for …”</strong> to your agent, with what you want to try, tune or decide in your own words. For example:</p>
        {EXAMPLES.map((e) => (
          <div key={e.kind}>
            <h3>{e.kind}</h3>
            {block(`example-${e.kind}`, e.text, false)}
          </div>
        ))}
        <p className="small muted">In Claude Code the same works as a command: <code>/mcp__clay__playground the hover on my Sign up button</code> (type <code>/</code> and it is listed as <code>/clay:playground</code>). Codex has no such commands: type the sentence. Other words work too: “make a playground …”, “let me play with it first”, “clay this”.</p>
        <p className="small muted">Measured on 14 November 2026 with the agents&apos; normal tools and nothing pasted anywhere: asked with this sentence, Claude Code 2.1.321 built a playground in 14 of 14 runs and Codex 0.167.0 in 4 of 4; the Claude Code command in 4 of 4. Asked a plain question or given an exact instruction without it, Claude Code built none (0 of 3).</p>
        <p>What happens: your agent answers with a link. Open it and move the controls until it looks, feels or costs right. Then press Settle (or save your decision) and tell your agent you are done. It reads what you chose and carries it out.</p>
      </section>

      <section className="pane">
        <details>
          <summary><strong>Optional: let your agent offer a playground on its own</strong></summary>
          <p>When you do not ask for a playground, Claude Code mostly edits the file or looks the price up itself. To make it build one on its own when you are vague, paste these lines into the <code>CLAUDE.md</code> of your project (for Codex: <code>AGENTS.md</code>).</p>
          {block("standing-instruction", STANDING_INSTRUCTION, false)}
        <p className="small muted">Measured on 14 November 2026 with Claude Code 2.1.321 and its normal tools (shell, web search), before the server&apos;s opening text was changed to the explicit sentence, on four vague requests, three runs each: without these lines it built a playground in 2 of 12 runs, with them in 12 of 12. For an exact instruction or a plain question it still built none (0 of 9). Codex built one with and without the lines.</p>
        </details>
      </section>

      <section className="pane">
        <h2>Later</h2>
        <ul className="plain">
          <li><strong>Keep a decision alive:</strong> when you settle a choice that rests on prices or web facts, your agent writes it to <code>.clay/decisions/</code> in your repository. Ask “is my saved decision still right?” at any time (Claude Code: <code>/mcp__clay__recheck</code>). Save <a href="/clay-recheck.yml">clay-recheck.yml</a> as <code>.github/workflows/clay-recheck.yml</code> and add your key as the repository secret <code>CLAY_AGENT_KEY</code>: GitHub then re-checks your decisions every day and opens an issue when one no longer holds. Each run spends web requests from your daily allowance.</li>
{!operator &&           <li><strong>Lost your key?</strong> Create a new one above; the old one stops working. Claude Code: run <code>claude mcp remove clay</code>, then the add command again. Codex: change the export line.</li>}
          <li><strong>Remove Clay:</strong> <code>claude mcp remove clay</code> or <code>codex mcp remove clay</code>. If Claude Code says clay exists in several scopes (you also added it without <code>--scope user</code> in a folder), run <code>claude mcp remove --scope local clay</code> in that folder and <code>claude mcp remove --scope user clay</code>.</li>
        </ul>
      </section>
    </>
  );
}
