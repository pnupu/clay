// The subjects: a real headless agent connected to Clay's MCP endpoint and nothing else, with file access to one scratch
// directory. Two CLIs behind one interface: `claude` and `codex exec`. Flags were read from each CLI's --help
// (claude 2.1.321, codex-cli 0.167.0). No global or user-level configuration is edited: everything is passed per run.
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { MCP_PATH, SERVER, authHeader } from "./adapter.ts";
import type { Call } from "./check.ts";

export type SubjectName = "claude" | "codex";
export type RunOptions = {
  subject: SubjectName;
  /** undefined: the subject's default (claude: claude-opus-5-5; codex: the CLI's own default). */
  model?: string;
  baseUrl: string;
  /** The agent key. It reaches the CLI only through the environment variable CLAY_ACCESS_KEY, never through a file or an argument. */
  key?: string;
  /** The scratch directory: the agent's working directory, and the only place it may read and edit. */
  cwd: string;
  /** Where the harness writes its own files for this case (MCP config, transcripts). Outside the scratch directory. */
  dir: string;
  prompt: string;
  /** Session of the first leg, to continue the same conversation. */
  resume?: string | null;
  timeoutMs: number;
  /** File name stem for the transcript, for example "leg1". */
  name: string;
  /**
   * "files" (the default): the agent has Clay and file tools only, so the checks measure Clay, not the agent's other ways out.
   * "normal": the agent keeps the CLI's own tool set (web search and fetch, shell, files) plus Clay, as a person's agent has.
   */
  tools?: "files" | "normal";
  /** For tools "normal": a clean home directory for the CLI, prepared by the operator (see run.ts). */
  home?: string;
};
export type AgentRun = {
  subject: SubjectName;
  model: string | null;
  command: string[];
  sessionId: string | null;
  calls: Call[];
  /** The last message to the person. */
  finalText: string;
  /** Everything the agent said to the person in this leg. */
  allText: string;
  tokens: { input: number; cached: number; output: number } | null;
  costUsd: number | null;
  seconds: number;
  error: string | null;
};

// The tool-call timeout of each CLI stays at its default on purpose (about 60 s in both): a person who adds Clay with
// `claude mcp add` or `codex mcp add` gets that default, and a build that outlasts it is a failure they would see.
export const DEFAULT_MODEL: Record<SubjectName, string | undefined> = { claude: "claude-opus-5-5", codex: undefined };
const FILE_TOOLS = "Read,Edit,Write,Glob,Grep";

function command(o: RunOptions, session: string): { bin: string; args: string[] } {
  // With its normal tools the subject also keeps the CLI's own default model, unless one is named.
  const model = o.model ?? (o.tools === "normal" ? undefined : DEFAULT_MODEL[o.subject]);
  if (model && /haiku/i.test(model)) throw new Error("Haiku models are not allowed as subjects.");
  const url = o.baseUrl + MCP_PATH;
  const normal = o.tools === "normal";
  if (o.subject === "claude") {
    // ${CLAY_ACCESS_KEY} is expanded by the CLI from the environment, so the key is not in the file.
    const config = { mcpServers: { [SERVER]: { type: "http", url, ...(o.key ? { headers: authHeader("${CLAY_ACCESS_KEY}") } : {}) } } };
    writeFileSync(`${o.dir}/mcp.json`, JSON.stringify(config, null, 1));
    return {
      bin: "claude",
      args: [
        "-p", // the prompt comes on stdin
        "--mcp-config", `${o.dir}/mcp.json`, "--strict-mcp-config", // only Clay's MCP server
        // Files only: no user, project or local settings, so no plugins, hooks or CLAUDE.md. Normal tools: the default
        // sources, as a person has them; the clean home and the scratch directory hold only what the operator put there
        // (a CLAUDE.md in the scratch directory, a personal skill in the home), so the levers a person has can be measured.
        ...(normal ? [] : ["--setting-sources", ""]),
        // Normal tools: the CLI's own default model unless one is named, every built-in tool, and the ones that would
        // ask (shell, web) approved beforehand, because print mode cannot ask. Otherwise: files only (no shell, no web).
        ...(model ? ["--model", model] : []),
        ...(normal ? [] : ["--tools", FILE_TOOLS]),
        "--allowedTools", normal ? `mcp__${SERVER},Bash,WebSearch,WebFetch` : `mcp__${SERVER}`,
        "--permission-mode", "acceptEdits", // edits inside the working directory; anything outside it is refused in print mode
        "--output-format", "stream-json", "--verbose",
        ...(o.resume ? ["--resume", o.resume] : ["--session-id", session]),
      ],
    };
  }
  const c = (kv: string) => ["-c", kv];
  return {
    bin: "codex",
    args: [
      "exec", ...(o.resume ? ["resume", o.resume] : []),
      "--json", "--skip-git-repo-check",
      // Normal tools: a clean home has no user config and no rules, and web search stays as the CLI ships it.
      ...(normal ? [] : ["--ignore-user-config", "--ignore-rules"]), // no user config (so no other MCP servers) and no rules files; auth still works
      ...(model ? ["-m", model] : []),
      ...c('sandbox_mode="workspace-write"'), // edits only inside the working directory; shell commands have no network
      ...(normal ? [] : [...c("project_doc_max_bytes=0"), ...c('web_search="disabled"')]), // no AGENTS.md of the surrounding repository, no web
      ...c(`mcp_servers.${SERVER}.url="${url}"`),
      ...(o.key ? c(`mcp_servers.${SERVER}.bearer_token_env_var="CLAY_ACCESS_KEY"`) : []),
      ...c(`mcp_servers.${SERVER}.default_tools_approval_mode="approve"`), // exec cannot ask; without this every Clay call is refused
      "-", // the prompt comes on stdin
    ],
  };
}

/** Run one leg. The raw CLI output is saved as <name>.jsonl, stderr as <name>.stderr.txt. */
export async function runAgent(o: RunOptions): Promise<AgentRun> {
  const session = randomUUID();
  const { bin, args } = command(o, session);
  const out = `${o.dir}/${o.name}.jsonl`;
  const [fdOut, fdErr] = [openSync(out, "w"), openSync(`${o.dir}/${o.name}.stderr.txt`, "w")];
  const t0 = Date.now();
  // Normal tools: the environment of a new person's shell in a clean home, so no operator configuration, plugin, hook,
  // rules file or other MCP server reaches the agent. The home holds only the copied login of the CLI.
  if (o.tools === "normal" && !o.home) throw new Error("tools \"normal\" needs a clean home directory.");
  const clean = { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", TERM: "dumb", HOME: o.home ?? "", TMPDIR: `${o.home}/tmp`, ...(o.subject === "claude" ? { CLAUDE_CONFIG_DIR: `${o.home}/.claude`, ENABLE_CLAUDEAI_MCP_SERVERS: "false" } : { CODEX_HOME: `${o.home}/.codex` }) };
  const env = { ...(o.tools === "normal" ? clean : process.env), ...(o.key ? { CLAY_ACCESS_KEY: o.key } : {}) } as NodeJS.ProcessEnv;
  let error: string | null = null;
  await new Promise<void>((resolve) => {
    const child = spawn(bin, args, { cwd: o.cwd, env, stdio: ["pipe", fdOut, fdErr], detached: true });
    const timer = setTimeout(() => {
      error = `timed out after ${Math.round(o.timeoutMs / 1000)} s`;
      const stop = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch {} }; // the process group of this run, nothing else
      stop("SIGTERM");
      setTimeout(() => stop("SIGKILL"), 5000).unref(); // a CLI that ignores SIGTERM must not hold the run for ever
    }, o.timeoutMs);
    child.on("error", (e) => { error = `could not start ${bin}: ${e.message}`; clearTimeout(timer); resolve(); });
    child.on("close", (code) => { if (code !== 0 && !error) error = `${bin} exited with code ${code}`; clearTimeout(timer); resolve(); });
    child.stdin!.on("error", () => {}); // a CLI that exits before it reads the prompt: its exit code is the error, not EPIPE
    child.stdin!.end(o.prompt);
  });
  closeSync(fdOut);
  closeSync(fdErr);
  const parsed = (o.subject === "claude" ? parseClaude : parseCodex)(readFileSync(out, "utf8"));
  return { subject: o.subject, command: [bin, ...args], seconds: Math.round((Date.now() - t0) / 1000), ...parsed, model: parsed.model ?? o.model ?? (o.tools === "normal" ? undefined : DEFAULT_MODEL[o.subject]) ?? null, sessionId: parsed.sessionId ?? (o.subject === "claude" ? (o.resume ?? session) : null), error: error ?? parsed.error };
}

type Parsed = Pick<AgentRun, "model" | "sessionId" | "calls" | "finalText" | "allText" | "tokens" | "costUsd" | "error">;
type Json = Record<string, unknown>;
const lines = (raw: string) => raw.split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l) as Json] : []; } catch { return []; } });
const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((x) => (typeof x === "string" ? x : ((x as Json)?.text ?? ""))).join("") : content == null ? "" : JSON.stringify(content));

/** `claude -p --output-format stream-json --verbose`. */
export function parseClaude(raw: string): Parsed {
  const p: Parsed = { model: null, sessionId: null, calls: [], finalText: "", allText: "", tokens: null, costUsd: null, error: null };
  const open = new Map<string, Call>();
  const prefix = `mcp__${SERVER}__`;
  let last = "";
  let done = false;
  for (const m of lines(raw)) {
    if (m.type === "system" && m.subtype === "init") {
      p.model = (m.model as string) ?? null;
      p.sessionId = (m.session_id as string) ?? null;
      const servers = (m.mcp_servers as { name: string; status: string }[] | undefined) ?? [];
      const clay = servers.find((s) => s.name === SERVER);
      if (!clay || clay.status !== "connected") p.error = `the agent is not connected to the ${SERVER} MCP server (${clay?.status ?? "missing"})`;
      if (servers.length > 1) p.error = `the agent has other MCP servers: ${servers.map((s) => s.name).join(", ")}`;
    } else if (m.type === "assistant") {
      for (const c of ((m.message as Json)?.content as Json[]) ?? []) {
        if (c.type === "text") { last = String(c.text); p.allText += last + "\n"; }
        else if (c.type === "tool_use") {
          const name = String(c.name);
          const call: Call = { tool: name.startsWith(prefix) ? name.slice(prefix.length) : name, mcp: name.startsWith(prefix), input: (c.input as Json) ?? {}, result: "", isError: false };
          p.calls.push(call);
          open.set(String(c.id), call);
        }
      }
    } else if (m.type === "user") {
      const content = (m.message as Json)?.content;
      for (const c of Array.isArray(content) ? (content as Json[]) : []) {
        const call = c?.type === "tool_result" ? open.get(String(c.tool_use_id)) : undefined;
        if (call) { call.result = textOf(c.content); call.isError = c.is_error === true; }
      }
    } else if (m.type === "result") {
      done = true;
      const u = (m.usage as Record<string, number> | undefined) ?? {};
      p.tokens = { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cached: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 };
      p.costUsd = typeof m.total_cost_usd === "number" ? m.total_cost_usd : null;
      p.finalText = typeof m.result === "string" && m.result ? m.result : last;
      if (m.is_error === true || (m.subtype && m.subtype !== "success")) p.error ??= `the agent run ended with ${m.subtype ?? "an error"}: ${String(m.result ?? "").slice(0, 200)}`;
    }
  }
  if (!done) p.error ??= "the transcript has no result event";
  p.finalText ||= last;
  return p;
}

/** `codex exec --json`: thread.started, item.completed (agent_message, mcp_tool_call, file_change, command_execution), turn.completed. */
export function parseCodex(raw: string): Parsed {
  const p: Parsed = { model: null, sessionId: null, calls: [], finalText: "", allText: "", tokens: null, costUsd: null, error: null };
  let done = false;
  for (const m of lines(raw)) {
    if (m.type === "thread.started") p.sessionId = (m.thread_id as string) ?? null;
    else if (m.type === "item.completed") {
      const it = (m.item as Json) ?? {};
      if (it.type === "agent_message") { p.finalText = String(it.text ?? ""); p.allText += p.finalText + "\n"; }
      else if (it.type === "mcp_tool_call") {
        const res = it.result as Json | null | undefined;
        const err = it.error as Json | null | undefined;
        p.calls.push({ tool: String(it.tool), mcp: it.server === SERVER, input: (it.arguments as Json) ?? {}, result: err ? String(err.message ?? JSON.stringify(err)) : textOf(res?.content ?? res), isError: !!err || it.status === "failed" || res?.is_error === true || res?.isError === true });
      } else if (it.type === "file_change") p.calls.push({ tool: "file_change", mcp: false, input: { changes: it.changes }, result: String(it.status ?? ""), isError: false });
      else if (it.type === "web_search") p.calls.push({ tool: "web_search", mcp: false, input: { query: it.query }, result: "", isError: false });
      else if (it.type === "command_execution") p.calls.push({ tool: "shell", mcp: false, input: { command: it.command }, result: String(it.aggregated_output ?? "").slice(0, 2000), isError: it.exit_code !== 0 });
      else if (it.type === "error") p.error ??= String(it.message ?? "error item");
    } else if (m.type === "turn.completed") {
      done = true;
      const u = (m.usage as Record<string, number> | undefined) ?? {};
      const cached = u.cached_input_tokens ?? 0;
      p.tokens = { input: (u.input_tokens ?? 0) - cached, cached, output: u.output_tokens ?? 0 };
    } else if (m.type === "turn.failed") p.error ??= `the turn failed: ${String((m.error as Json)?.message ?? "").slice(0, 200)}`;
    else if (m.type === "error") p.error ??= String(m.message ?? "error").slice(0, 200);
  }
  if (!done) p.error ??= "the transcript has no turn.completed event";
  return p;
}
