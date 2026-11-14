// One request in a real repository, with the agent as it really is (normal tools, clean home, Clay connected).
// It records what the agent did: whether it used Clay or built something in the repository, the tools it used, the
// playground and its page, what the simulated person settled, the second leg, and the hand-back as a git diff.
//
//   node experiments/real-codebase/run.ts --repo <checkout> --base-url <clay> --home <clean home> --out <dir>
//        --id <case id> --say "<the request>" [--memory <file>] [--typecheck "<command>"] [--timeout 900] [--no-reset]
//        [--in-app "<dev command with PORT>" --app-dir <dir>]   prototype B: the person settles on the dev-only route
//        that the agent built in the app; the dev command is started when the agent's own server is gone
// The Clay key comes from CLAY_ACCESS_KEY. The checkout is reset (git checkout, git clean) before the run, so use a
// scratch clone. Nothing of the checkout is copied into <out> except the diff of the hand-back; keep <out> private
// when the checkout is.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { signIn, TOOL } from "../../evals/adapter.ts";
import { CHROME, personSettles } from "../../evals/page.ts";
import { runAgent, type AgentRun } from "../../evals/subjects.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const need = (n: string) => { const v = flag(n); if (!v) throw new Error(`--${n} is needed`); return v; };
const repo = resolve(need("repo")), baseUrl = need("base-url").replace(/\/$/, ""), home = resolve(need("home")), out = resolve(need("out"), need("id"));
const say = need("say"), key = process.env.CLAY_ACCESS_KEY, timeoutMs = Number(flag("timeout") ?? 900) * 1000;
const git = (...a: string[]) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 << 20 }).stdout ?? "";
mkdirSync(out, { recursive: true });
if (!argv.includes("--no-reset")) { git("checkout", "-q", "."); git("clean", "-fdq"); }
if (flag("memory")) execFileSync("cp", [resolve(flag("memory")!), join(repo, "CLAUDE.md")]);
const before = git("rev-parse", "HEAD").trim();

const tools = (r: AgentRun) => { const n: Record<string, number> = {}; for (const c of r.calls) n[c.tool] = (n[c.tool] ?? 0) + 1; return n; };
// A session that started a dev server in the background does not exit when its answer is done: the CLI waits for the
// server. So once the transcript holds the final result, the session's processes are stopped (the server too; the
// in-app step starts the app again when it needs it).
async function leg(name: string, prompt: string, resume?: string | null) {
  const file = join(out, `${name}.jsonl`);
  const watch = setInterval(() => {
    // The final result of the turn, not the empty one that a resumed session prints first (a few milliseconds, no turn).
    const last = (spawnSync("grep", ['"type":"result"', file], { encoding: "utf8" }).stdout ?? "").trim().split("\n").pop() ?? "";
    let done = false;
    try { const r = JSON.parse(last) as { num_turns?: number; duration_ms?: number }; done = (r.num_turns ?? 0) >= 1 && (r.duration_ms ?? 0) > 3000; } catch {}
    if (done) { clearInterval(watch); setTimeout(() => spawnSync("pkill", ["-f", join(out, "mcp.json")]), 4000); }
  }, 3000);
  try {
    return await runAgent({ subject: "claude", baseUrl, key, cwd: repo, dir: out, prompt, resume, timeoutMs, name, tools: "normal", home });
  } finally { clearInterval(watch); }
}
const summary = (r: AgentRun) => ({ seconds: r.seconds, tokens: r.tokens, costUsd: r.costUsd, error: r.error, tools: tools(r), answer: r.finalText.slice(0, 4000) });

const first = await leg("leg1", say);
// The playground, when Clay was used: the id and the url of the last successful create.
const created = first.calls.filter((c) => c.mcp && c.tool === TOOL.create && !c.isError).map((c) => { try { return JSON.parse(c.result) as { playground_id?: string; url?: string; kind?: string }; } catch { return null; } }).filter((x) => x?.playground_id).pop() ?? null;
const result: Record<string, unknown> = { id: flag("id"), say, repo: repo.split("/").pop(), commit: before, usedClay: !!created, playground: created?.playground_id ?? null, kind: created?.kind ?? null, leg1: summary(first) };
let second: AgentRun | null = null;
if (created?.playground_id) {
  const url = `${baseUrl}/p/${created.playground_id}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // The page as the person sees it, and the preview alone, before the person moves anything.
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await signIn(page, baseUrl, key);
    await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(out, "clay-page.png"), fullPage: true }).catch(() => {});
    const frame = page.locator('iframe[src$="/frame"]').first();
    if (await frame.count()) await frame.screenshot({ path: join(out, "clay-preview.png") }).catch(() => {});
    result.previewFailed = (await page.locator("p.alert").allInnerTexts().catch(() => [])).map((t) => t.slice(0, 300));
    await page.context().close();
    const person = await personSettles(browser, { baseUrl, url, key, dims: [] });
    result.person = { chosen: person.chosen, error: person.error, outputs: person.outputs };
    if (!person.error) second = await leg("leg2", "ok I'm done, go ahead", first.sessionId);
  } finally { await browser.close(); }
  if (second) result.leg2 = summary(second);
}
// Prototype B: the playground is a dev-only route of the app itself. The person opens the URL the agent gave, moves the
// controls of the in-app kit and settles; the settled file is then in the checkout, and the second leg follows.
const local = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/[^\s)`*"'>]*)?/.exec(first.allText.split("\n").filter((l) => /clay/i.test(l)).join("\n") || first.allText);
if (!created && flag("in-app") && local) {
  const url = `http://127.0.0.1:${local[1]}${local[2] ?? "/"}`;
  const up = async () => (await fetch(url, { signal: AbortSignal.timeout(60_000) }).then((r) => r.status, () => 0)) === 200;
  let started = false;
  // Where the agent built the route: the main checkout, or a git worktree of it (agents often work in one). The app
  // is the nearest directory above the route that has a package.json; a new worktree borrows the checkout's node_modules.
  const routeDir = (spawnSync("bash", ["-c", `find ${JSON.stringify(repo)} \\( -path '*/node_modules' -o -path '*/.next' \\) -prune -o -type d -path '*/app/clay' -printf '%T@ %p\\n' | sort -rn | head -1 | cut -d' ' -f2-`], { encoding: "utf8" }).stdout ?? "").trim();
  let appDir = flag("app-dir") ?? repo;
  if (routeDir) { let d = routeDir; while (d.length > repo.length && spawnSync("test", ["-f", join(d, "package.json")]).status !== 0) d = resolve(d, ".."); appDir = d; }
  if (spawnSync("test", ["-e", join(appDir, "node_modules")]).status !== 0) spawnSync("ln", ["-s", join(flag("app-dir") ?? repo, "node_modules"), join(appDir, "node_modules")]);
  if (!(await up())) {
    // The agent's dev server ended with its session: start the app's own dev command on the same port for the person.
    const dev = spawnSync("bash", ["-c", `cd ${JSON.stringify(appDir)} && (nohup ${flag("in-app")!.replace("PORT", local[1])} > ${JSON.stringify(join(out, "dev-server.log"))} 2>&1 &)`]);
    started = dev.status === 0;
    for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1500));
  }
  const browser = await chromium.launch({ executablePath: CHROME });
  const inApp: Record<string, unknown> = { url, appDir: appDir.slice(repo.length + 1) || ".", serverStartedByHarness: started, reachable: await up() };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
    const kit = await page.waitForSelector("[data-clay-playground]", { timeout: 30_000 }).then(() => true, () => false);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(out, "in-app-page.png"), fullPage: true }).catch(() => {});
    if (kit) await page.locator("[data-clay-stage]").first().screenshot({ path: join(out, "in-app-stage.png") }).catch(() => {});
    inApp.kit = kit;
    inApp.controls = await page.locator("[data-clay-control]").evaluateAll((els) => els.map((e) => e.getAttribute("data-clay-control")));
    // The person: every slider halfway to its top, every select to its next option, then Settle.
    for (const c of await page.locator("[data-clay-control]").all()) {
      const range = c.locator('input[type="range"]'), select = c.locator("select");
      if (await range.count()) await range.evaluate((el) => { const r = el as HTMLInputElement; const step = Number(r.step) || 1; const to = Math.round((Number(r.value) + Number(r.max)) / 2 / step) * step; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(r, String(to === Number(r.value) ? Math.max(Number(r.min), to - step) : to)); r.dispatchEvent(new Event("input", { bubbles: true })); });
      else if (await select.count()) await select.evaluate((el) => { const s = el as HTMLSelectElement; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!; set.call(s, s.options[(s.selectedIndex + 1) % s.options.length].value); s.dispatchEvent(new Event("change", { bubbles: true })); });
      await page.waitForTimeout(150);
    }
    await page.screenshot({ path: join(out, "in-app-moved.png"), fullPage: true }).catch(() => {});
    if (kit) { await page.locator("[data-clay-settle]").click().catch(() => {}); inApp.settled = await page.waitForSelector("[data-clay-settled]", { timeout: 15_000 }).then(() => true, () => false); }
    inApp.errors = errors;
  } finally { await browser.close(); }
  const files = (spawnSync("bash", ["-c", `find ${JSON.stringify(repo)} -path '*/node_modules' -prune -o -path '*/.clay/settled/*.json' -print`], { encoding: "utf8" }).stdout ?? "").split("\n").filter(Boolean);
  inApp.settledFile = files[0]?.slice(repo.length + 1) ?? null;
  if (files[0]) inApp.settledText = (spawnSync("cat", [files[0]], { encoding: "utf8" }).stdout ?? "").slice(0, 3000);
  result.inApp = inApp;
  if (inApp.settled) { second = await leg("leg2", "ok I'm done, go ahead", first.sessionId); result.leg2 = summary(second); }
}
// The hand-back, or what the agent built in the repository: every changed and new file, as a diff.
git("add", "-A", "-N", ".");
const status = git("status", "--short");
writeFileSync(join(out, "handback.diff"), git("diff"));
result.changed = status.split("\n").filter(Boolean).map((l) => l.trim());
if (flag("typecheck") && status.trim()) {
  const t = spawnSync("bash", ["-lc", flag("typecheck")!], { cwd: repo, encoding: "utf8", timeout: 300_000, maxBuffer: 64 << 20 });
  result.typecheck = { exit: t.status, tail: `${t.stdout}\n${t.stderr}`.trim().split("\n").slice(-12).join("\n").slice(0, 1500) };
}
// A dev server or watcher that the agent left running in the checkout is stopped: the next case starts clean.
for (const pid of (spawnSync("bash", ["-c", `for d in /proc/[0-9]*; do [ "$(readlink $d/cwd 2>/dev/null | grep -c -E '^${repo}(/|$)')" = 1 ] && echo \${d#/proc/}; done`], { encoding: "utf8" }).stdout ?? "").split("\n").filter(Boolean)) { try { process.kill(Number(pid)); } catch {} }
writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 1));
console.log(`${flag("id")}: ${created ? `Clay (${created.kind ?? "playground"} ${created.playground_id})` : "no Clay"} | leg1 ${first.seconds}s ${JSON.stringify(tools(first))}${second ? ` | leg2 ${second.seconds}s` : ""} | changed: ${(result.changed as string[]).length} file(s)${first.error ? ` | error: ${first.error}` : ""}`);
