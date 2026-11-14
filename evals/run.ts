// The eval runner: gives each request to a real agent connected to Clay, checks the result, writes the report.
//
//   node evals/run.ts --base-url <url> [--subject claude|codex] [--model <id>] [--cases <id,id>] [--kind <price,none,...>]
//                     [--one-leg <id,id|all>] [--concurrency 2] [--timeout 600] [--from <run dir>] [--label <text>]
//                     [--set heldout]   the held-out requests of evals/heldout.ts instead of the fixed 20
//                     [--scratch-root <dir>]   put the agents' scratch directories under <dir>, outside this repository.
//                         Use it when the operator's own agent rules forbid edits inside a shared checkout (Codex loads
//                         ~/.codex/AGENTS.md whatever the flags). The files are copied back into the run directory.
//   node evals/run.ts report <run dir> <run dir> ...        one report over several runs (for example live and fixture servers)
//
// The base URL and the agent key also come from the environment: CLAY_BASE_URL, CLAY_ACCESS_KEY. Prefer the environment
// for the key; --key works too. A local development server needs no key.
// --from reuses the transcripts of an earlier run instead of starting agents, to re-run the checker alone.
// Output: evals/out/<run id>/ with report.md, results.json, contact.html and one folder per case.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { chromium, type Browser } from "playwright-core";
import { MCP_PATH, TOOL, authHeader, dimensions, kitAvailable, parseBuild, preparedDimensions, preparedPlayground, vendorId, type Dimension } from "./adapter.ts";
import { CAUSE, creation, directAnswer, fileMatches, lastBuild, namesChoice, ranges, readBack, toolUse, verdict, type Check } from "./check.ts";
import { CHROME, checkPage, personSettles } from "./page.ts";
import { HELD_OUT } from "./heldout.ts";
import { CASES as FIXED, type Case } from "./requests.ts";
import { parseClaude, parseCodex, runAgent, type AgentRun, type SubjectName } from "./subjects.ts";

const HERE = import.meta.dirname;
const SECOND_LEG = "ok I'm done, go ahead";

type CaseResult = {
  id: string; kind: Case["kind"]; request: string; note?: string;
  result: "pass" | "fail" | "skip";
  firstFail: Check | null;
  checks: Check[];
  seconds: number;
  tokens: { input: number; cached: number; output: number } | null;
  agentRuns: number;
  subject: SubjectName; model: string | null;
  server: string;
  playground: string | null;
  /** Screenshot of the built playground, relative to the run directory. */
  shot: string | null;
  person: { chosen: string | null; outputs: unknown } | null;
  skipReason?: string;
};
type Meta = { runId: string; startedAt: string; baseUrl: string; subject: SubjectName; model: string | null; kit: boolean; commit: string; branch: string; command: string; concurrency: number; timeoutSeconds: number; label: string; keyOccurrencesScrubbed?: number; merged?: string[] };

// ---- Arguments
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const CASES = flag("set") === "heldout" ? HELD_OUT : FIXED;
const list = (name: string) => flag(name)?.split(",").map((s) => s.trim()).filter(Boolean);
const git = (...a: string[]) => { try { return execFileSync("git", ["-C", HERE, ...a], { encoding: "utf8" }).trim(); } catch { return "unknown"; } };
const stamp = () => new Date().toISOString().replace(/[-:]|\.\d+/g, "");

function newRunDir(tag: string) {
  const runId = `${stamp()}-${tag}-${randomBytes(3).toString("hex")}`;
  const dir = join(HERE, "out", runId);
  if (existsSync(dir)) throw new Error(`${dir} exists already`);
  mkdirSync(dir, { recursive: true });
  return { runId, dir };
}

if (argv[0] === "report") {
  const dirs = argv.slice(1).map((d) => resolve(d));
  const { runId, dir } = newRunDir("merged");
  const parts = dirs.map((d) => JSON.parse(readFileSync(join(d, "results.json"), "utf8")) as { meta: Meta; results: CaseResult[] });
  const results = parts.flatMap((p, i) => p.results.map((r) => ({ ...r, shot: r.shot ? relative(dir, join(dirs[i], r.shot)) : null })));
  const meta: Meta = { ...parts[0].meta, runId, baseUrl: [...new Set(parts.map((p) => p.meta.baseUrl))].join(" and "), label: parts.map((p) => p.meta.label).filter(Boolean).join(" + "), merged: parts.map((p) => p.meta.runId), command: `node evals/run.ts report ${parts.map((p) => `evals/out/${p.meta.runId}`).join(" ")}` };
  writeReport(dir, meta, results);
  console.log(readFileSync(join(dir, "report.md"), "utf8"));
  process.exit(0);
}

const baseUrl = (flag("base-url") ?? process.env.CLAY_BASE_URL ?? "").replace(/\/+$/, "");
const key = flag("key") ?? process.env.CLAY_ACCESS_KEY ?? undefined;
const subject = (flag("subject") ?? "claude") as SubjectName;
const model = flag("model");
const concurrency = Number(flag("concurrency") ?? 2);
const timeoutSeconds = Number(flag("timeout") ?? 600);
const oneLeg = list("one-leg") ?? [];
const from = flag("from") ? resolve(flag("from")!) : null;
const scratchRoot = flag("scratch-root") ? resolve(flag("scratch-root")!) : null;
if (!/^https?:\/\//.test(baseUrl)) throw new Error("Give the server: --base-url <url> or CLAY_BASE_URL.");
if (!["claude", "codex"].includes(subject)) throw new Error("--subject is claude or codex.");
if (model && /haiku/i.test(model)) throw new Error("Haiku models are not allowed as subjects.");
const wanted = CASES.filter((c) => (!list("cases") || list("cases")!.includes(c.id)) && (!list("kind") || list("kind")!.includes(c.kind)));
const unknown = (list("cases") ?? []).filter((id) => !CASES.some((c) => c.id === id));
if (unknown.length || !wanted.length) throw new Error(`No such case: ${unknown.join(", ") || "(none selected)"}. Cases: ${CASES.map((c) => c.id).join(", ")}`);

// ---- Clay over MCP, for the harness itself: the tool list (is the kit there?) and the prepared playgrounds.
async function mcp(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(baseUrl + MCP_PATH, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(key ? authHeader(key) : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(300_000) });
  const body = (await r.json().catch(() => null)) as { result?: Record<string, unknown>; error?: { message?: string } } | null;
  if (!r.ok || !body?.result) throw new Error(`MCP ${method} at ${baseUrl + MCP_PATH} answered HTTP ${r.status}: ${(body?.error?.message ?? JSON.stringify(body) ?? "").slice(0, 200)}`);
  return body.result;
}

const { runId, dir: runDir } = newRunDir(subject);
const tag = runId.slice(-6);
const sum = (a: CaseResult["tokens"], b: AgentRun["tokens"]) => (b ? { input: (a?.input ?? 0) + b.input, cached: (a?.cached ?? 0) + b.cached, output: (a?.output ?? 0) + b.output } : a);
const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
/** A playground URL built from the id alone, so nothing in a tool result decides which page the browser opens. */
const pageUrl = (id: string) => (/^[a-z][a-z0-9-]{2,39}$/.test(id) ? `${baseUrl}/p/${id}` : null);

async function runCase(c: Case, browser: Browser, kit: boolean): Promise<CaseResult> {
  const dir = join(runDir, "cases", c.id);
  // A dot directory: tsc and Next.js skip it, so scratch .tsx files do not break the repository's typecheck.
  const kept = join(dir, ".ws");
  const ws = scratchRoot && !from ? join(scratchRoot, runId, c.id) : kept;
  const r: CaseResult = { id: c.id, kind: c.kind, request: c.request, note: c.note, result: "skip", firstFail: null, checks: [], seconds: 0, tokens: null, agentRuns: 0, subject, model: model ?? null, server: baseUrl, playground: null, shot: null, person: null };
  if (c.needsKit && !kit) return { ...r, skipReason: "needs the kit, which this server does not have" };
  // --from: the earlier run's transcripts, scratch directory, playground and the person's choice are reused; no agent starts.
  const old = from ? join(from, "cases", c.id) : null;
  const earlier = from ? ((JSON.parse(read(join(from, "results.json")) ?? "{}") as { results?: CaseResult[] }).results?.find((x) => x.id === c.id) ?? null) : null;
  if (old && !existsSync(join(old, "leg1.jsonl"))) return { ...r, skipReason: "the --from run has no transcript of this case" };
  if (old) cpSync(old, dir, { recursive: true });
  else if (c.files) cpSync(join(HERE, "files", c.files), ws, { recursive: true });
  mkdirSync(ws, { recursive: true });
  mkdirSync(dir, { recursive: true });
  r.agentRuns = earlier?.agentRuns ?? 0; // the agent runs that produced the reused transcripts
  const original = (path: string) => (c.files ? read(join(HERE, "files", c.files, path)) : null);
  const add = (...checks: Check[]) => r.checks.push(...checks);
  const finish = () => {
    if (ws !== kept) cpSync(ws, kept, { recursive: true }); // the record of what the agent left behind stays with the run
    const v = verdict(r.checks);
    return { ...r, result: v.result, firstFail: v.firstFail };
  };
  const leg = async (name: string, prompt: string, resume?: string | null): Promise<AgentRun> => {
    if (from) {
      // --from starts no agent: a leg without a saved transcript counts as not run.
      const reused = read(join(dir, `${name}.jsonl`));
      const p = (subject === "claude" ? parseClaude : parseCodex)(reused ?? "");
      if (reused == null) add({ id: "agent_run", status: "na", reason: `${name}: no saved transcript to reuse, and --from starts no agent` });
      else if (p.error) add({ id: "agent_run", status: "fail", reason: `${name}: ${p.error}` });
      const saved = JSON.parse(read(join(dir, `${name}.run.json`)) ?? "{}") as Partial<AgentRun>;
      r.seconds += saved.seconds ?? 0;
      r.tokens = sum(r.tokens, p.tokens);
      r.model = p.model ?? saved.model ?? r.model;
      return { subject, command: ["(reused transcript)"], seconds: saved.seconds ?? 0, ...p, error: reused == null ? "not run" : p.error };
    }
    const run = await runAgent({ subject, model, baseUrl, key, cwd: ws, dir, prompt, resume, timeoutMs: timeoutSeconds * 1000, name });
    r.agentRuns++;
    r.seconds += run.seconds;
    r.tokens = sum(r.tokens, run.tokens);
    r.model = run.model;
    writeFileSync(join(dir, `${name}.run.json`), JSON.stringify({ command: run.command, model: run.model, seconds: run.seconds, tokens: run.tokens, costUsd: run.costUsd, error: run.error, sessionId: run.sessionId }, null, 1));
    if (run.error) add({ id: "agent_run", status: "fail", reason: `${name}: ${run.error}` });
    return run;
  };

  // ---- Return visits: the harness prepares a playground with a saved decision first.
  let prepared: { id: string; url: string; chosen: string; dims: Dimension[] | null } | null = null;
  if (c.expect === "return") {
    const before = earlier?.playground?.split("/").pop();
    if (from && before && earlier?.person?.chosen) prepared = { id: before, url: pageUrl(before)!, chosen: earlier.person.chosen, dims: preparedDimensions(before) };
    else try {
      const res = await mcp("tools/call", { name: TOOL.create, arguments: preparedPlayground(`eval-${tag}-${c.id}`) });
      // The id of the result: the server adds a suffix when the id asked for is taken. A build that is still running is
      // waited for on the page by the person step below.
      const id = parseBuild(String((res.content as { text?: string }[] | undefined)?.[0]?.text ?? "")).id;
      const url = id ? pageUrl(id) : null;
      if (res.isError || !id || !url) throw new Error(`the playground could not be prepared: ${JSON.stringify(res).slice(0, 200)}`);
      const dims = preparedDimensions(id);
      const person = await personSettles(browser, { baseUrl, url, key, dims });
      if (person.error || !person.chosen) throw new Error(`the prepared decision could not be saved: ${person.error}`);
      prepared = { id, url, chosen: person.chosen, dims };
    } catch (e) {
      add({ id: "agent_run", status: "fail", reason: `preparation: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` });
      return finish();
    }
    r.playground = prepared.url;
    r.person = { chosen: prepared.chosen, outputs: null };
  }

  // ---- First leg: the request.
  const first = await leg("leg1", c.request);
  add(toolUse(c, first.calls, prepared?.id ?? null));

  if (c.expect === "none") {
    add(directAnswer(c, first.finalText, c.fileMust ? original(c.fileMust.path) : null, c.fileMust ? read(join(ws, c.fileMust.path)) : null));
    return finish();
  }
  if (c.expect === "return") {
    if (c.mustCall?.includes("read")) add(namesChoice(first.allText, prepared!.chosen, vendorId([{ input: preparedPlayground(prepared!.id) }], prepared!.chosen)));
    const page = await checkPage(browser, { baseUrl, url: prepared!.url, key, dims: dimensions([{ tool: TOOL.create, mcp: true, input: preparedPlayground(prepared!.id), isError: false, result: JSON.stringify({ playground_id: prepared!.id }) }, ...first.calls], prepared!.id), shotPath: join(dir, "page.png") });
    add(...page.checks);
    r.shot = page.shot ? relative(runDir, page.shot) : null;
    return finish();
  }

  // ---- Build cases: creation, the page, the ranges.
  add(creation(first.calls, first.allText));
  const build = lastBuild(first.calls);
  const built = { id: build.last?.id ?? build.attempted };
  const url = built.id ? pageUrl(built.id) : null;
  if (!built.id || !url) return finish();
  r.playground = url;
  // A build call that timed out at the client was still applied by the server, so its config counts, also when a later call succeeded.
  const dims = dimensions(first.calls.map((x) => (x.isError && /timed out|timeout/i.test(x.result) ? { ...x, isError: false } : x)), built.id);
  const page = await checkPage(browser, { baseUrl, url, key, dims, shotPath: join(dir, "page.png") });
  add(...page.checks);
  r.shot = page.shot ? relative(runDir, page.shot) : null;
  add(ranges(c.given, dims));

  // ---- Second leg: the person settles, then the same conversation continues.
  if (oneLeg.includes(c.id) || oneLeg.includes("all")) {
    add({ id: "handback_read", status: "na", reason: "the second leg was not run (--one-leg)" });
    return finish();
  }
  if (page.checks.find((x) => x.id === "page_loads")?.status !== "pass") {
    add({ id: "handback_read", status: "na", reason: "the second leg was not run: the page is not usable" });
    return finish();
  }
  if (first.error || !first.sessionId) {
    // A first leg that failed or timed out has no conversation to continue: no second agent run is spent on it.
    add({ id: "handback_read", status: "na", reason: `the second leg was not run: ${first.error ? "the first leg failed" : "the first leg has no session to resume"}` });
    if (!first.error) add({ id: "agent_run", status: "fail", reason: "leg1: the CLI reported no session id, so the conversation cannot continue" });
    return finish();
  }
  if (from && !existsSync(join(dir, "leg2.jsonl"))) {
    // The earlier run may have stopped here because the person could not settle: that failure stays a failure.
    const failedSettle = earlier?.checks.find((x) => x.id === "settle" && x.status === "fail");
    add(failedSettle ?? { id: "handback_read", status: "na", reason: "the second leg was not run: no saved transcript, and --from starts no agent" });
    return finish();
  }
  // With --from, the person's choice is the one saved in the earlier run: the second-leg transcript answers to it.
  const person = earlier?.person ? { chosen: earlier.person.chosen, outputs: earlier.person.outputs as Record<string, unknown> | null, error: null } : await personSettles(browser, { baseUrl, url, key, dims });
  r.person = { chosen: person.chosen, outputs: person.outputs };
  if (person.error) {
    add({ id: "settle", status: "fail", reason: person.error });
    return finish();
  }
  add({ id: "settle", status: "pass", reason: person.chosen ? `the person saved ${person.chosen}` : "the person settled the outputs" });
  const second = await leg("leg2", SECOND_LEG, first.sessionId);
  if (second.error === "not run") return finish();
  add(readBack(second.calls, built.id));
  if (c.targetFile) add(fileMatches(original(c.targetFile) ?? "", read(join(ws, c.targetFile)), person.outputs));
  else if (person.chosen) add(namesChoice(second.allText, person.chosen, vendorId(first.calls, person.chosen)));
  return finish();
}

// ---- The report
function writeReport(dir: string, meta: Meta, results: CaseResult[]) {
  const ran = results.filter((r) => r.result !== "skip");
  const rate = (rs: CaseResult[]) => { const n = rs.filter((r) => r.result !== "skip"); return n.length ? `${n.filter((r) => r.result === "pass").length} of ${n.length} (${Math.round((100 * n.filter((r) => r.result === "pass").length) / n.length)}%)` : "none run"; };
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const tokens = (t: CaseResult["tokens"]) => (t ? `${k(t.input + t.output)} (+${k(t.cached)} cached)` : "not reported");
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");
  const kinds = [...new Set(results.map((r) => r.kind))];
  const failed = ran.filter((r) => r.result === "fail");
  const causes = new Map<string, CaseResult[]>();
  for (const r of failed) { const cause = CAUSE[r.firstFail!.id] ?? "other"; causes.set(cause, [...(causes.get(cause) ?? []), r]); }
  const shots = results.filter((r) => r.shot);
  const md = [
    `# Clay evals: run ${meta.runId}`,
    "",
    `- First-try pass rate: **${rate(results)}**${results.length > ran.length ? `; ${results.length - ran.length} skipped` : ""}`,
    `- Subject: ${meta.subject}, model ${[...new Set(ran.map((r) => r.model).filter(Boolean))].join(", ") || meta.model || "the CLI's default"}. Server: ${meta.baseUrl} (kit: ${meta.kit ? "yes" : "no"}).${meta.label ? ` ${meta.label}.` : ""}`,
    `- Harness commit ${meta.commit} on ${meta.branch}, started ${meta.startedAt}. Concurrency ${meta.concurrency}, timeout ${meta.timeoutSeconds} s per agent run. Agent runs: ${results.reduce((n, r) => n + r.agentRuns, 0)}.`,
    `- Command: \`${meta.command}\``,
    ...(meta.merged ? [`- Merged from runs: ${meta.merged.join(", ")}`] : []),
    ...(meta.keyOccurrencesScrubbed != null ? [`- Key check: ${meta.keyOccurrencesScrubbed} occurrence(s) of the agent key found and removed from saved files.`] : []),
    "",
    "## Pass rate by kind",
    "",
    "| Kind | Passed | Skipped |",
    "|---|---|---|",
    ...kinds.map((kind) => `| ${kind} | ${rate(results.filter((r) => r.kind === kind))} | ${results.filter((r) => r.kind === kind && r.result === "skip").length} |`),
    "",
    "## Cases",
    "",
    "| Case | Result | First failing check | Time | Tokens in+out |",
    "|---|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${r.result === "pass" ? "PASS" : r.result === "fail" ? "**FAIL**" : "skip"} | ${r.result === "skip" ? cell(r.skipReason ?? "") : r.firstFail ? cell(`${r.firstFail.id}: ${r.firstFail.reason}`) : ""} | ${r.result === "skip" ? "" : `${r.seconds} s`} | ${r.result === "skip" ? "" : tokens(r.tokens)} |`),
    "",
    "## Failures by cause",
    "",
    ...(failed.length ? [...causes].flatMap(([cause, rs]) => [`- **${cause}** (${rs.length}):`, ...rs.map((r) => `  - ${r.id}: ${r.firstFail!.reason}`)]) : ["No case failed."]),
    "",
    "## Every check",
    "",
    ...ran.flatMap((r) => [`### ${r.id}: ${r.result.toUpperCase()}`, "", `> ${r.request}`, "", ...(r.note ? [`Note: ${r.note}`, ""] : []), ...(r.playground ? [`Playground: ${r.playground}${r.person?.chosen ? `. The person saved: ${r.person.chosen}.` : ""}`, ""] : []), ...r.checks.map((c) => `- ${c.status === "pass" ? "pass" : c.status === "fail" ? "**fail**" : "n/a"} \`${c.id}\`: ${c.reason}`), ""]),
    "## Contact sheet",
    "",
    shots.length ? "One screenshot per built playground, as the person first sees it. Open `contact.html` for all of them on one screen." : "No playground was built.",
    "",
    ...shots.flatMap((r) => [`**${r.id}** (${r.result})`, "", `![${r.id}](${r.shot})`, ""]),
  ].join("\n");
  writeFileSync(join(dir, "report.md"), md);
  writeFileSync(join(dir, "results.json"), JSON.stringify({ meta, results }, null, 1));
  writeFileSync(join(dir, "contact.html"), `<!doctype html><meta charset="utf-8"><title>Clay evals ${meta.runId}</title><style>body{font:14px system-ui;margin:16px;background:#111;color:#eee}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}figure{margin:0}img{width:100%;border:1px solid #444}.fail{color:#f88}.pass{color:#8f8}</style><h1>Clay evals ${meta.runId}: ${rate(results)}</h1><main>${shots.map((r) => `<figure><figcaption class="${r.result}">${r.id}: ${r.result}${r.firstFail ? ` (${r.firstFail.id})` : ""}</figcaption><a href="${r.shot}"><img src="${r.shot}" loading="lazy"></a></figure>`).join("")}</main>`);
}

/** Make sure the agent key is in no saved file. Returns the number of occurrences that were removed. */
function scrub(dir: string, secret: string | undefined): number {
  if (!secret) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) n += scrub(p, secret);
    else if (!/\.(png|jpg)$/.test(name)) {
      const text = readFileSync(p, "utf8");
      if (text.includes(secret)) { n += text.split(secret).length - 1; writeFileSync(p, text.replaceAll(secret, "[REDACTED]")); }
    }
  }
  return n;
}

/** A copy of a value with every occurrence of the agent key replaced. */
const redact = <T,>(value: T): T => (key ? (JSON.parse(JSON.stringify(value).replaceAll(JSON.stringify(key).slice(1, -1), "[REDACTED]")) as T) : value);

// ---- Main
const tools = ((await mcp("tools/list")).tools as { name: string }[]) ?? [];
const kit = kitAvailable(tools);
const meta: Meta = { runId, startedAt: new Date().toISOString(), baseUrl, subject, model: model ?? null, kit, commit: git("rev-parse", "--short", "HEAD"), branch: git("rev-parse", "--abbrev-ref", "HEAD"), command: `node evals/run.ts ${argv.map((a, i) => (argv[i - 1] === "--key" ? "<key>" : a)).join(" ")}`, concurrency, timeoutSeconds, label: flag("label") ?? "" };
console.error(`run ${runId}: ${wanted.length} case(s), subject ${subject}, server ${baseUrl}, kit ${kit ? "yes" : "no"}`);
const browser = await chromium.launch({ executablePath: CHROME });
const results: CaseResult[] = new Array(wanted.length);
let next = 0;
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
  while (next < wanted.length) {
    const i = next++;
    const c = wanted[i];
    try {
      results[i] = await runCase(c, browser, kit);
    } catch (e) {
      const check: Check = { id: "agent_run", status: "fail", reason: `harness error: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` };
      results[i] = { id: c.id, kind: c.kind, request: c.request, result: "fail", firstFail: check, checks: [check], seconds: 0, tokens: null, agentRuns: 0, subject, model: model ?? null, server: baseUrl, playground: null, shot: null, person: null };
    }
    results[i] = redact(results[i]); // an error text (a browser error with the owner link, say) may hold the key
    console.error(`${c.id}: ${results[i].result}${results[i].firstFail ? ` (${results[i].firstFail!.id}: ${results[i].firstFail!.reason})` : ""}`);
  }
}));
await browser.close();
// The key is removed from the saved transcripts first; the results were redacted in memory, so the report is written clean.
meta.keyOccurrencesScrubbed = scrub(runDir, key);
writeReport(runDir, meta, results);
if (scrub(runDir, key) > 0) throw new Error("The agent key was still in a saved file after the report was written. It has been removed; check the run directory.");
console.log(readFileSync(join(runDir, "report.md"), "utf8"));
console.error(`report: ${join(runDir, "report.md")}`);
process.exit(results.some((r) => r.result === "fail") ? 1 : 0);
