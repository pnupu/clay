// Eval cases of kind "return": does a standing decision come back to a later agent session through the person's repository?
//
// A person settled a price decision earlier. The decision record (lib/record.ts) is a file in their repository. A fresh
// agent session, with no memory and no Clay word in the request, is asked "is our email provider still the right pick?".
// It must find the file, call recheck_playground with its id, and answer correctly:
//   holds   the prices are as they were: say that it still holds, and update the check line of the file.
//   broken  the chosen vendor's price went up (evals/return-fixture.ts): say what changed and what the rule now picks, give
//           the playground link, propose the change, and change no code.
//   write   the first session: the person says they saved their choice; the agent must write the record file as given.
//   model   a settled preview on web facts (which model for a coding agent): a model's price went up. Clay has no rule for
//           a preview, so the agent must judge with the settled rule and the new prices, and propose the other model.
//
//   node evals/return.ts --base-url <url> --fixture-url <url> --home <clean home> --scratch-root <dir outside this repository>
//                        [--cases write,holds,broken,model] [--memory <file>] [--label <text>] [--timeout 300] [--store <file>]
//   node evals/return.ts --from <run dir>[,<run dir>...]   judge saved runs again with the checks as they are now
// The agent is Claude Code with its normal tools and its default model, one run at a time, in a clean home (see run.ts for
// how to prepare one). --memory puts a standing instruction into the scratch repository as CLAUDE.md.
// The app must run on the return fixture (no live web request). The owner key comes from CLAY_ACCESS_KEY.
// Output: evals/out/<run id>/ with report.md, results.json and one folder per case. Additive: it changes no harness file.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { MCP_PATH, authHeader } from "./adapter.ts";
import { parseClaude, runAgent, type AgentRun } from "./subjects.ts";

const HERE = import.meta.dirname;
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const baseUrl = (flag("base-url") ?? process.env.CLAY_BASE_URL ?? "").replace(/\/$/, "");
const fixtureUrl = (flag("fixture-url") ?? "").replace(/\/$/, "");
const key = process.env.CLAY_ACCESS_KEY;
const home = flag("home") ? resolve(flag("home")!) : null;
const scratchRoot = flag("scratch-root") ? resolve(flag("scratch-root")!) : null;
const memory = flag("memory") ? readFileSync(resolve(flag("memory")!), "utf8") : null;
const timeoutMs = Number(flag("timeout") ?? 300) * 1000;
const outside = (dir: string | null) => !!dir && relative(resolve(HERE, ".."), dir).startsWith("..");
/** --from <run dir>,<run dir>: judge the saved transcripts, answers and files of earlier runs again. No server, no agent. */
const from = flag("from")?.split(",").map((d) => resolve(d.trim())) ?? null;
if (!from && (!baseUrl || !fixtureUrl || !outside(home) || !outside(scratchRoot))) throw new Error("Needs --base-url, --fixture-url, and --home and --scratch-root outside this repository (or --from <run dir>).");

export type ReturnCase = { id: "write" | "holds" | "broken" | "model"; kind: "return"; request: (playground: string) => string; note: string };
/** No Clay word in the two return requests: the file in the repository must carry the agent to the tool. */
export const RETURN_CASES: ReturnCase[] = [
  { id: "write", kind: "return", request: (id) => `I picked our email provider on the playground page (${id}) and saved my choice. go ahead`, note: "the first session: the record must be written into the repository as given" },
  { id: "holds", kind: "return", request: () => "is our email provider still the right pick?", note: "a fresh session, prices unchanged" },
  { id: "broken", kind: "return", request: () => "is our email provider still the right pick?", note: "a fresh session, the chosen vendor's price went up from $20 to $45" },
  { id: "model", kind: "return", request: () => "are we still on the right model for the agent?", note: "a fresh session, a settled preview on web facts; the chosen model's prices went up sixfold" },
];
/** Not in the default set: each case is one agent run. */
const DEFAULT = ["write", "holds", "broken"];
const wanted = (flag("cases")?.split(",") ?? DEFAULT).map((id) => RETURN_CASES.find((c) => c.id === id.trim()) ?? (() => { throw new Error(`No such case: ${id}`); })());

type Check = { name: string; pass: boolean; detail: string };
type Result = { id: string; kind: "return"; request: string; note: string; memory: boolean; result: "pass" | "fail"; checks: Check[]; seconds: number; model: string | null; playground: string; answer: string; recheckAnswer: string | null; fileBefore: string | null; fileAfter: string | null; error: string | null };

async function mcp(tool: string, args: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(baseUrl + MCP_PATH, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(key ? authHeader(key) : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }), signal: AbortSignal.timeout(120_000) });
  const body = (await r.json().catch(() => null)) as { result?: { content?: { text?: string }[]; isError?: boolean } } | null;
  const text = body?.result?.content?.[0]?.text ?? "";
  if (!r.ok || body?.result?.isError) throw new Error(`${tool} answered HTTP ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as Record<string, unknown>;
}
const control = async (b: unknown) => { const r = await fetch(`${fixtureUrl}/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); if (!r.ok) throw new Error(`fixture /control answered ${r.status}`); };
const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const stamp = () => new Date().toISOString().replace(/[-:]|\.\d+/g, "");
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=dev", "-c", "user.email=dev@example.com", ...a], { encoding: "utf8" });

/** The price playground of a case: three email services on the fixture, Resend chosen at 40,000 emails, tolerance $5. */
async function prepare(id: string) {
  await control({ reset: true });
  await mcp("create_playground", {
    id,
    title: "Which email service should our app use?",
    view: { type: "price_ranking" },
    data: { price_pages: { product: "transactional email API", metrics: [{ id: "emails_per_month", label: "Emails per month", unit: "emails", describe: "Emails sent per month (also called messages or sends), included in the plan and billed as overage.", min: 5000, max: 300000, initial: 40000 }], features: [], vendors: [{ id: "resend", name: "Resend", pricing_url: "https://resend.com/pricing" }, { id: "postmark", name: "Postmark", pricing_url: "https://postmarkapp.com/pricing" }, { id: "mailgun", name: "Mailgun", pricing_url: "https://www.mailgun.com/pricing/" }] } },
  });
  for (let i = 0; i < 12; i++) if (((await mcp("read_playground", { playground_id: id })).build as { status?: string } | undefined)?.status === "done") break;
  // The person saves the decision on the page: the same request the page sends.
  const saved = await fetch(`${baseUrl}/api/p/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? authHeader(key) : {}) }, body: JSON.stringify({ usage: { emails_per_month: 40000 }, required: [], chosen: "resend", tolerance: 5 }) });
  if (!saved.ok) throw new Error(`saving the decision answered ${saved.status}`);
  const record = (await mcp("read_playground", { playground_id: id })).decision_record as { path: string; text: string } | undefined;
  if (!record) throw new Error("read_playground gave no decision_record for a saved price decision");
  return record;
}

/**
 * The preview playground of the "model" case: two models on the fixture's price page, the person's own token counts per
 * task, and a rule in the settled output. Settled on swift-2 at 3,000 tasks a month. The settle request is the page's.
 */
async function prepareModel(id: string) {
  await control({ reset: true });
  await mcp("create_playground", {
    id,
    title: "Which model should our coding agent run on?",
    notes: "Built from the team's bench.json and the provider's price page.",
    data: {
      inline: { measured: "bench.json", models: [{ model: "swift-2", input_tokens_per_task: 60000, output_tokens_per_task: 2000, passed: "24/24" }, { model: "deep-2", input_tokens_per_task: 60000, output_tokens_per_task: 2000, passed: "24/24" }] },
      web: [{ id: "prices", url: "https://modelprices.dev/pricing", rows: { describe: "one row per model", fields: [{ id: "model", type: "text", describe: "model name" }, { id: "input", type: "number", unit: "USD per 1M tokens", describe: "price per 1M input tokens" }, { id: "output", type: "number", unit: "USD per 1M tokens", describe: "price per 1M output tokens" }] } }],
    },
    controls: [
      { id: "tasks", type: "slider", label: "Agent tasks per month", meaning: "how many tasks the agent runs per month", min: 500, max: 10000, step: 500, initial: 3000 },
      { id: "model", type: "select", label: "Model to use", meaning: "the model in agent.config.json", options: [{ value: "swift-2" }, { value: "deep-2" }], initial: "swift-2" },
    ],
    view: { type: "preview", height: 200, html: '<p id="out">{{model}} at {{tasks}} tasks</p>', js: 'const rows = clay.data.web.prices || []; clay.onChange((v) => { const m = clay.data.inline.models.map((x) => { const p = rows.find((r) => r.model === x.model); return x.model + ": " + (p && p.input != null && p.output != null ? "$" + ((x.input_tokens_per_task * p.input + x.output_tokens_per_task * p.output) / 1e6 * v.tasks).toFixed(2) + " per month" : "unknown"); }); document.getElementById("out").textContent = m.join(" | ") + " | selected " + v.model; });' },
    outputs: [
      { id: "config", label: '"model" in agent.config.json', template: '"model": "{{model}}"' },
      { id: "rule", label: "The rule behind the choice", template: "Use {{model}} while it is the cheaper of swift-2 and deep-2 at {{tasks}} tasks per month. Cost per task = input tokens per task x input price + output tokens per task x output price, per 1M tokens, with the token counts of bench.json (60,000 input and 2,000 output tokens per task for both models). Both models passed 24/24." },
    ],
  });
  for (let i = 0; i < 12; i++) if (((await mcp("read_playground", { playground_id: id })).build as { status?: string } | undefined)?.status === "done") break;
  // The revision that the page sends with a settle. A local server keeps its store in .data/store.json of this checkout.
  const rev = (JSON.parse(readFileSync(resolve(flag("store") ?? join(HERE, "..", ".data/store.json")), "utf8")) as { playgrounds: Record<string, { kit?: { rev?: string } }> }).playgrounds[id]?.kit?.rev;
  const settled = await fetch(`${baseUrl}/api/p/${id}/settle`, { method: "POST", headers: { "Content-Type": "application/json", ...(key ? authHeader(key) : {}) }, body: JSON.stringify({ rev, values: { tasks: 3000, model: "swift-2" } }) });
  if (!settled.ok) throw new Error(`settling answered ${settled.status}: ${(await settled.text()).slice(0, 200)}`);
  const record = (await mcp("read_playground", { playground_id: id })).decision_record as { path: string; text: string } | undefined;
  if (!record) throw new Error("read_playground gave no decision_record for a settled preview with web sources");
  return record;
}
/** The repository of the "model" case: the agent's config and the measurements, no Clay word outside the record. */
function modelRepository(dir: string) {
  const files: Record<string, string> = {
    "agent.config.json": JSON.stringify({ agent: "coding-agent", model: "swift-2", max_seconds_per_task: 300 }, null, 2) + "\n",
    "bench.json": JSON.stringify([{ model: "swift-2", runs: 24, passed: 24, input_tokens_per_task: 60000, output_tokens_per_task: 2000 }, { model: "deep-2", runs: 24, passed: 24, input_tokens_per_task: 60000, output_tokens_per_task: 2000 }], null, 2) + "\n",
    "README.md": "# agent-runner\n\nRuns our coding agent on the team's task queue, about 3,000 tasks a month. The model is set in agent.config.json.\n",
  };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text);
}

/** A small repository of a shop backend that sends email. `provider`: the code already uses the chosen service. */
function repository(dir: string, provider: boolean) {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "shop-backend", private: true, type: "module", dependencies: provider ? { resend: "^4.0.0" } : {} }, null, 2) + "\n",
    "README.md": "# shop-backend\n\nOrders and receipts for the shop. Sends about 40,000 emails a month (receipts and password resets).\n",
    "src/orders.ts": 'import { sendReceipt } from "./mailer.ts";\n\nexport async function completeOrder(order: { id: string; email: string }) {\n  await sendReceipt(order.email, order.id);\n}\n',
    "src/mailer.ts": provider
      ? '// Sends receipts and password resets.\nimport { Resend } from "resend";\n\nconst resend = new Resend(process.env.RESEND_API_KEY);\n\nexport async function sendReceipt(to: string, orderId: string) {\n  await resend.emails.send({ from: "shop@example.com", to, subject: `Receipt ${orderId}`, text: "Thanks for your order." });\n}\n'
      : '// Sends receipts and password resets. The email service is not chosen yet.\nexport const EMAIL_PROVIDER: string | null = null;\n\nexport async function sendReceipt(to: string, orderId: string) {\n  throw new Error(`no email service configured: cannot send receipt ${orderId} to ${to}`);\n}\n',
  };
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
}

/** What a run left behind, for the checks: from a live run, or read back from a saved run (--from). */
type Evidence = { id: string; error: string | null; calls: AgentRun["calls"]; answer: string; allText: string; raw: string; fileBefore: string | null; fileAfter: string | null; recordPath: string; recordText: string | null; codeUnchanged: boolean; carried?: Record<string, boolean> };

/** The checks of one case. Pure: the same evidence gives the same verdict, so a saved run can be judged again. */
function judge(c: ReturnCase, x: Evidence): Check[] {
  const { id, raw, answer, fileBefore, fileAfter } = x;
  const recheck = x.calls.filter((x) => x.mcp && x.tool === "recheck_playground");
  const url = `${baseUrl}/p/${id}`;
  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail = "") => checks.push({ name, pass, detail: detail.replace(/\s+/g, " ").slice(0, 300) });
  check("the agent run ended without an error", !x.error, x.error ?? "");
  if (c.id === "write") {
    check("it read the playground", x.calls.some((x) => x.mcp && x.tool === "read_playground" && x.input.playground_id === id), x.calls.filter((x) => x.mcp).map((x) => x.tool).join(", "));
    check(`it wrote the record to ${x.recordPath}`, fileAfter != null, fileAfter == null ? "no file" : `${fileAfter.length} characters`);
    // A saved run does not hold the server's text: the saved outcome of this check is carried over, and said so.
    if (x.recordText == null) check("the file is the server's text, unchanged", x.carried?.["the file is the server's text, unchanged"] ?? false, "carried over from the saved run");
    else check("the file is the server's text, unchanged", (fileAfter ?? "").trim() === x.recordText.trim(), fileAfter == null ? "" : firstDifference(fileAfter.trim(), x.recordText.trim()));
    check("it told the person where the decision is kept", new RegExp(x.recordPath.replace(/[.\/]/g, "\\$&")).test(x.allText) || /\.clay\/decisions/.test(x.allText), answer.slice(-240));
  } else {
    check("it opened the decision file in the repository before it called the re-check", openedBefore(raw), "");
    check("it called recheck_playground with the id from the file", recheck.some((x) => x.input.playground_id === id), recheck.map((x) => JSON.stringify(x.input)).join(" ") || `Clay calls: ${x.calls.filter((x) => x.mcp).map((x) => x.tool).join(", ") || "none"}`);
    check("it did not build a new playground or search the web", !x.calls.some((x) => (x.mcp && x.tool === "create_playground") || /^Web(Search|Fetch)$/.test(x.tool)), x.calls.map((x) => x.tool).join(", "));
    check("it changed no code", x.codeUnchanged, "");
    // The line that the re-check answer gave for the file (the same minute gives the same line as before).
    const given = (() => { try { return (JSON.parse(recheck.at(-1)?.result ?? "{}") as { decision_file?: { with?: string } }).decision_file?.with ?? null; } catch { return null; } })();
    const lineNow = (fileAfter ?? "").split("\n").find((l) => l.startsWith("- Last checked:")) ?? "no line";
    if (c.id === "model") {
      // swift-2: 60,000 x $6 + 2,000 x $30 per 1M = $0.42 a task; deep-2: 60,000 x $3 + 2,000 x $15 = $0.21 a task.
      check("the answer says the settled choice no longer holds", /no longer|not the (right|cheaper|cheapest|best)|isn't the (right|cheaper|cheapest|best)|doesn't hold|does not hold|not anymore|^no[.,]/i.test(answer.trim()), answer.slice(0, 300));
      check("it says what changed: swift-2's prices, old and new", /swift-2/i.test(answer) && dollars(1).test(answer) && dollars(6).test(answer) && dollars(30).test(answer), answer.slice(0, 300));
      check("it works out what the settled rule now gives: deep-2 is the cheaper one", /deep-2/i.test(answer) && /(\$0\.21|\$630(?!\d)|half as much|half the)/i.test(answer), answer.slice(0, 400));
      check("it gives the playground link", answer.includes(url) || answer.includes(`/p/${id}`), "");
      check("it proposes the change and does not make it", PROPOSES.test(answer), answer.slice(-240));
      check("the file keeps the settled choice; only the check line may change", !!fileAfter && sameBut(fileBefore!, fileAfter), lineNow);
    } else if (c.id === "holds") {
      check("the answer says the choice still holds, and names the service", /resend/i.test(answer) && /(still|remains?|yes)\b[^.]*\b(holds?|right|cheapest|best|good|fine|stands)/i.test(answer) && !/no longer|switch to|move to/i.test(answer), answer.slice(0, 300));
      check("the check line of the file is the one the re-check gave, and says it holds", !!fileAfter && !!given && lineNow === given && /: holds\.$/.test(lineNow) && sameBut(fileBefore!, fileAfter), `${lineNow} (given: ${given})`);
    } else {
      check("the answer says the choice no longer holds", /no longer|not the (right|cheapest|best)|isn't the (right|cheapest|best)|doesn't hold|does not hold|stopped holding|not anymore|^no[.,]/i.test(answer.trim()), answer.slice(0, 300));
      check("it says what changed: the old and the new price of Resend", /resend/i.test(answer) && dollars(20).test(answer) && dollars(45).test(answer), answer.slice(0, 300));
      check("it names what the saved rule now picks: Postmark at $25", /postmark/i.test(answer) && dollars(25).test(answer), answer.slice(0, 300));
      check("it gives the playground link", answer.includes(url) || answer.includes(`/p/${id}`), "");
      check("it proposes the change and does not make it", PROPOSES.test(answer), answer.slice(-240));
      check("the file keeps the saved choice; only the check line may change", !!fileAfter && sameBut(fileBefore!, fileAfter) && /("Resend"|\*\*Resend\*\*) \(chosen\)/.test(fileAfter), lineNow);
    }
  }
  return checks;
}

async function runCase(c: ReturnCase, runDir: string, tag: string): Promise<Result> {
  const id = `mail-${c.id}-${tag}`;
  const caseDir = join(runDir, c.id);
  const repo = join(scratchRoot!, tag, c.id);
  mkdirSync(caseDir, { recursive: true });
  mkdirSync(repo, { recursive: true });
  const record = c.id === "model" ? await prepareModel(id) : await prepare(id);
  const file = join(repo, record.path);
  if (c.id === "model") modelRepository(repo);
  else repository(repo, c.id !== "write");
  if (c.id !== "write") { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, record.text); }
  if (memory != null) writeFileSync(join(repo, "CLAUDE.md"), memory);
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "shop backend");
  if (c.id === "broken") await control({ prices: { "resend.com": 45 } });
  if (c.id === "model") await control({ models: { "swift-2": [6, 30] } });
  const fileBefore = read(file);
  const code = c.id === "model" ? "agent.config.json" : "src/mailer.ts";
  const codeBefore = read(join(repo, code));
  let run: AgentRun;
  try {
    run = await runAgent({ subject: "claude", baseUrl, key, cwd: repo, dir: caseDir, prompt: c.request(id), timeoutMs, name: "leg1", tools: "normal", home: home! });
  } finally {
    await control({ reset: true });
  }
  const raw = read(join(caseDir, "leg1.jsonl")) ?? "";
  const fileAfter = read(file);
  const answer = run.finalText || run.allText;
  const checks = judge(c, { id, error: run.error, calls: run.calls, answer, allText: run.allText, raw, fileBefore, fileAfter, recordPath: record.path, recordText: record.text, codeUnchanged: read(join(repo, code)) === codeBefore });
  const recheck = run.calls.filter((x) => x.mcp && x.tool === "recheck_playground");
  // The repository as the agent left it, without its .git folder. Source files get ".txt", so no tool of this repository
  // takes them for its own code.
  cpSync(repo, join(caseDir, "repository"), { recursive: true, filter: (src) => !/\/\.git(\/|$)/.test(src) });
  const rename = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) rename(p); else if (/\.(ts|tsx|js|mjs)$/.test(name)) renameSync(p, `${p}.txt`); } };
  rename(join(caseDir, "repository"));
  return { id: c.id, kind: "return", request: c.request(id), note: c.note, memory: memory != null, result: checks.every((x) => x.pass) ? "pass" : "fail", checks, seconds: run.seconds, model: run.model, playground: id, answer, recheckAnswer: recheck.at(-1)?.result ?? null, fileBefore, fileAfter, error: run.error };
}
/**
 * Did the agent look into .clay with one of its own tools before its first recheck_playground call? The re-check answer
 * names the file's path itself, so the path anywhere in the transcript proves nothing.
 */
function openedBefore(raw: string): boolean {
  for (const line of raw.split("\n")) {
    let e: { type?: string; message?: { content?: { type?: string; name?: string; input?: unknown }[] } };
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "assistant") continue;
    for (const c of e.message?.content ?? []) {
      if (c.type !== "tool_use") continue;
      if (/recheck_playground$/.test(c.name ?? "")) return false;
      if (!/^mcp__/.test(c.name ?? "") && JSON.stringify(c.input ?? {}).includes(".clay")) return true;
    }
  }
  return false;
}
/** The agent offers the change and waits: words of an offer, not just any question mark. */
const PROPOSES = /want me to|shall i|should i|would you like|do you want|if you (agree|go with|want|decide|switch|'d like)|let me know|tell me|say the word|your call|once you|after you/i;
/** A dollar amount as a whole number: "$20", not "$200" or "$20.50". */
const dollars = (n: number) => new RegExp(`\\$${n}(?!\\d)(?![.,]\\d)`);
/** Two texts are the same except for the line that starts with "- Last checked:". */
const sameBut = (a: string, b: string) => { const strip = (t: string) => t.trim().split("\n").filter((l) => !l.startsWith("- Last checked:")).join("\n"); return strip(a) === strip(b); };
const firstDifference = (a: string, b: string) => { const i = [...a].findIndex((ch, n) => ch !== b[n]); return i < 0 ? (a.length === b.length ? "" : `lengths ${a.length} and ${b.length}`) : `first difference at character ${i}: wrote "${a.slice(i, i + 60)}", given "${b.slice(i, i + 60)}"`; };

/** Make sure the key is in no saved file. */
function scrub(dir: string): number {
  if (!key) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) n += scrub(p);
    else { const text = readFileSync(p, "utf8"); if (text.includes(key)) { n += text.split(key).length - 1; writeFileSync(p, text.replaceAll(key, "[REDACTED]")); } }
  }
  return n;
}

if (from) {
  let failed = 0;
  const again: { run: string; id: string; memory: boolean; saved: string; now: string; firstFail: string | null }[] = [];
  for (const dir of from) {
    const saved = (JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as { results: Result[] }).results;
    for (const r of saved) {
      const c = RETURN_CASES.find((x) => x.id === r.id);
      if (!c || r.playground === "?") continue;
      const raw = read(join(dir, r.id, "leg1.jsonl")) ?? "";
      const run = parseClaude(raw);
      const carried = Object.fromEntries(r.checks.map((x) => [x.name, x.pass]));
      const checks = judge(c, { id: r.playground, error: r.error, calls: run.calls, answer: r.answer, allText: run.allText, raw, fileBefore: r.fileBefore, fileAfter: r.fileAfter, recordPath: `.clay/decisions/${r.playground}.md`, recordText: null, codeUnchanged: carried["it changed no code"] ?? true, carried });
      const fail = checks.find((x) => !x.pass) ?? null;
      if (fail) failed++;
      again.push({ run: dir.split("/").at(-1)!, id: r.id, memory: r.memory, saved: r.result, now: fail ? "fail" : "pass", firstFail: fail ? `${fail.name}: ${fail.detail}` : null });
      console.log(`${fail ? "FAIL" : "PASS"}  ${dir.split("/").at(-1)!.slice(-6)}  ${r.id}${r.memory ? " (standing instruction present)" : ""}  saved as ${r.result}${fail ? `  first fail: ${fail.name}: ${fail.detail}` : ""}`);
    }
  }
  const outDir = join(HERE, "out", `${stamp()}-return-rejudged-${randomBytes(3).toString("hex")}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ meta: { kind: "return, judged again from saved runs", from, command: `node evals/return.ts ${argv.join(" ")}` }, results: again }, null, 1));
  console.log(`${again.length - failed} of ${again.length} saved runs pass the checks as they are now. ${join(outDir, "results.json")}`);
  process.exit(failed ? 1 : 0);
}
const runId = `${stamp()}-return-${randomBytes(3).toString("hex")}`;
const runDir = join(HERE, "out", runId);
if (existsSync(runDir)) throw new Error(`${runDir} exists already`);
mkdirSync(runDir, { recursive: true });
const commit = (() => { try { return execFileSync("git", ["-C", HERE, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })();
const results: Result[] = [];
for (const c of wanted) {
  const t0 = Date.now();
  try {
    results.push(await runCase(c, runDir, runId.slice(-6)));
  } catch (e) {
    results.push({ id: c.id, kind: "return", request: c.request("?"), note: c.note, memory: memory != null, result: "fail", checks: [{ name: "the case could be prepared and run", pass: false, detail: String(e).slice(0, 300) }], seconds: Math.round((Date.now() - t0) / 1000), model: null, playground: "?", answer: "", recheckAnswer: null, fileBefore: null, fileAfter: null, error: String(e) });
  }
  const r = results.at(-1)!;
  console.log(`${r.result.toUpperCase()}  ${r.id}  ${r.seconds} s${r.result === "fail" ? `  first fail: ${r.checks.find((x) => !x.pass)?.name}: ${r.checks.find((x) => !x.pass)?.detail}` : ""}`);
}
const meta = { runId, kind: "return", startedAt: new Date().toISOString(), baseUrl, subject: "claude", model: results.find((r) => r.model)?.model ?? null, tools: "normal", memory: memory != null ? flag("memory") : null, commit, command: `node evals/return.ts ${argv.join(" ")}`, label: flag("label") ?? "", concurrency: 1, timeoutSeconds: timeoutMs / 1000 };
writeFileSync(join(runDir, "results.json"), JSON.stringify({ meta, results }, null, 1));
writeFileSync(
  join(runDir, "report.md"),
  [`# Return cases: ${results.filter((r) => r.result === "pass").length} of ${results.length} pass`, "", `Run ${runId} · commit ${commit} · Claude Code, normal tools, model ${meta.model ?? "default"} · standing instruction ${memory != null ? "present" : "absent"} · fixture prices, no live web request${meta.label ? ` · ${meta.label}` : ""}`, "",
    ...results.flatMap((r) => [`## ${r.id}: ${r.result} (${r.seconds} s)`, "", `Request: "${r.request}" (${r.note})`, "", ...r.checks.map((x) => `- ${x.pass ? "pass" : "FAIL"}: ${x.name}${x.detail && !x.pass ? ` (${x.detail})` : ""}`), "", "Answer to the person:", "", ...r.answer.trim().split("\n").map((l) => `> ${l}`), ""])].join("\n"),
);
const scrubbed = scrub(runDir);
console.log(`${results.filter((r) => r.result === "pass").length} of ${results.length} pass. ${join(runDir, "report.md")}${scrubbed ? ` (${scrubbed} key occurrences removed)` : ""}`);
process.exit(results.every((r) => r.result === "pass") ? 0 : 1);
