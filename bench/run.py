#!/usr/bin/env python3
"""Run coding agents headless on the bench task set and record one JSON line per run.

Usage:
  python3 bench/run.py --run-id <id> [--subjects claude:claude-opus-5-5 codex:gpt-6.1-sol ...]
                       [--tasks paginate semver ...] [--repeats 2] [--concurrency 3] [--max-runs 130]

Each run: copy tasks/<id>/start to a fresh temporary directory, run the agent there with the task
instruction and a hard time limit, then run the hidden check (tasks/<id>/check, which the agent
never sees) against that directory. Results go to results/<run-id>/runs.jsonl; full CLI transcripts
go to results/<run-id>/transcripts/ (git-ignored).
"""
import argparse, concurrent.futures as cf, json, os, re, shutil, signal, subprocess, sys, tempfile, threading, time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS = os.path.join(HERE, "tasks")
RESULTS = os.path.join(HERE, "results")

DEFAULT_SUBJECTS = [
    "claude:claude-opus-5-5", "claude:claude-sonnet-5-5", "claude:claude-fable-5-2",
    "codex:gpt-6.1-sol", "codex:gpt-6.1-terra", "codex:gpt-6-luna",
]

# Claude Code's built-in Bash sandbox needs socat, which this machine lacks (the CLI then silently runs
# unsandboxed). So the whole claude process runs inside bubblewrap instead: the filesystem is read-only
# except the task's work directory and ~/.claude (CLI state and login), /tmp is private, and this bench/
# directory (with the hidden checks) is hidden. Inside, Claude Code runs without user/project
# customizations (--safe-mode), edits are auto-accepted, Bash is allowed, and anything else that would
# need a permission prompt is denied.
HOME = os.path.expanduser("~")


def bwrap_prefix(work):
    return ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp",
            "--tmpfs", HERE, "--bind", f"{HOME}/.claude", f"{HOME}/.claude",
            "--bind", f"{HOME}/.claude.json", f"{HOME}/.claude.json",
            "--bind", work, work, "--chdir", work, "--die-with-parent", "--"]


# Codex: `--ignore-user-config` still loads the user's global ~/.codex/AGENTS.md (on this machine it tells
# the agent to delegate through T3 tools and refuse otherwise), and codex's own sandbox cannot run nested
# inside another namespace here. So codex runs inside bubblewrap with codex's sandbox switched off: the
# filesystem is read-only except the work directory and ~/.codex (CLI state and login), /tmp is private,
# the global AGENTS.md reads as an empty file, user skills and this bench/ directory are hidden.
# Difference from codex's own workspace-write mode: shell commands keep network access.
EMPTY = os.path.join(tempfile.gettempdir(), "bench-empty-file")


def codex_bwrap_prefix(work):
    if not os.path.exists(EMPTY):
        open(EMPTY, "w").close()
    agents_md = os.path.realpath(f"{HOME}/.codex/AGENTS.md")
    pre = ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"]
    if os.path.exists(agents_md):
        pre += ["--ro-bind", EMPTY, agents_md]
    pre += ["--tmpfs", "/tmp", "--tmpfs", HERE, "--bind", f"{HOME}/.codex", f"{HOME}/.codex"]
    for d in (f"{HOME}/.codex/skills", f"{HOME}/.agents/skills"):
        if os.path.isdir(d):
            pre += ["--tmpfs", d]
    return pre + ["--bind", work, work, "--chdir", work, "--die-with-parent", "--"]


# Patterns are matched only against the CLI's own error/result messages, never against tool output.
LIMIT_RE = re.compile(r"rate.?limit|usage.?limit|limit reached|hit your .*limit|quota|too many requests|\b429\b|out of (extra )?usage", re.I)
MODEL_RE = re.compile(r"model.*(not (found|supported|available|exist)|invalid|unknown|does not exist)|(unknown|invalid) model|not_found_error", re.I)

# Strip the parent session's harness variables so the child is a plain CLI run at its defaults.
ENV_DROP = re.compile(r"^(CLAUDE|CLAUDECODE|T3|CODEX_|ANTHROPIC_|OPENAI_)", re.I)


def child_env():
    return {k: v for k, v in os.environ.items() if not ENV_DROP.match(k)}


def cli_version(agent):
    r = subprocess.run([agent, "--version"], capture_output=True, text=True, env=child_env(), timeout=60)
    return (r.stdout or r.stderr).strip()


def codex_default_effort(model):
    """Default reasoning level the installed codex CLI reports for a model (its local model catalog)."""
    try:
        cat = json.load(open(os.path.expanduser("~/.codex/models_cache.json")))
        for m in cat.get("models", []):
            if m.get("slug") == model:
                return m.get("default_reasoning_level")
    except Exception:
        pass
    return None


def build_cmd(agent, model, instruction, work):
    if agent == "claude":
        return bwrap_prefix(work) + [
            "claude", "-p", instruction, "--model", model, "--output-format", "stream-json", "--verbose",
            "--safe-mode", "--strict-mcp-config", "--no-session-persistence",
            "--permission-mode", "acceptEdits", "--permission-prompts", "none", "--allowedTools", "Bash"]
    if agent == "codex":
        # Effort is pinned to the model's own default from the CLI's model catalog, so the record is exact.
        effort = codex_default_effort(model)
        return codex_bwrap_prefix(work) + [
            "codex", "exec", "--json", "-m", model, "--dangerously-bypass-approvals-and-sandbox", "-C", work,
            *(["-c", f'model_reasoning_effort="{effort}"'] if effort else []),
            "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules",
            "--color", "never", instruction]
    raise ValueError(agent)


def parse_claude(stdout):
    m = {"input_tokens": None, "cached_input_tokens": None, "cache_write_tokens": None, "output_tokens": None,
         "turns": None, "tool_calls": 0, "helper_models": {}, "cli_error": None, "refused": False, "effort": None,
         "reported_model": None}
    result = None
    for line in stdout.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        t = ev.get("type")
        if t == "system" and ev.get("subtype") == "init":
            m["reported_model"] = ev.get("model")
            m["effort"] = ev.get("effort") or ev.get("effort_level") or m["effort"]
        elif t == "assistant":
            msg = ev.get("message") or {}
            for b in msg.get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    m["tool_calls"] += 1
            if msg.get("stop_reason") == "refusal":
                m["refused"] = True
        elif t == "result":
            result = ev
    if result is None:
        m["cli_error"] = "no result event"
        return m
    m["turns"] = result.get("num_turns")
    mu = result.get("modelUsage") or {}
    if mu:
        tot = {"in": 0, "cr": 0, "cw": 0, "out": 0}
        for name, u in mu.items():
            i, cr, cw, o = (u.get("inputTokens", 0), u.get("cacheReadInputTokens", 0),
                            u.get("cacheCreationInputTokens", 0), u.get("outputTokens", 0))
            tot["in"] += i; tot["cr"] += cr; tot["cw"] += cw; tot["out"] += o
            m["helper_models"][name] = {"input_tokens": i + cr + cw, "cached_input_tokens": cr,
                                        "cache_write_tokens": cw, "output_tokens": o}
        m["input_tokens"] = tot["in"] + tot["cr"] + tot["cw"]
        m["cached_input_tokens"], m["cache_write_tokens"], m["output_tokens"] = tot["cr"], tot["cw"], tot["out"]
    elif result.get("usage"):
        u = result["usage"]
        cr, cw = u.get("cache_read_input_tokens", 0), u.get("cache_creation_input_tokens", 0)
        m["input_tokens"] = u.get("input_tokens", 0) + cr + cw
        m["cached_input_tokens"], m["cache_write_tokens"], m["output_tokens"] = cr, cw, u.get("output_tokens", 0)
    if result.get("is_error") or result.get("subtype") not in (None, "success"):
        m["cli_error"] = f"{result.get('subtype')}: {str(result.get('result') or result.get('errors') or '')[:500]}"
    if result.get("stop_reason") == "refusal":
        m["refused"] = True
    return m


def parse_codex(stdout):
    m = {"input_tokens": None, "cached_input_tokens": None, "cache_write_tokens": None, "output_tokens": None,
         "reasoning_output_tokens": None, "turns": 0, "tool_calls": 0, "cli_error": None, "refused": False}
    errors = []
    for line in stdout.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        t = ev.get("type")
        if t == "turn.completed":
            m["turns"] += 1
            u = ev.get("usage") or {}
            for k_src, k_dst in (("input_tokens", "input_tokens"), ("cached_input_tokens", "cached_input_tokens"),
                                 ("output_tokens", "output_tokens"), ("reasoning_output_tokens", "reasoning_output_tokens")):
                if k_src in u:
                    m[k_dst] = (m[k_dst] or 0) + u[k_src]
        elif t == "item.completed":
            it = ev.get("item") or {}
            if it.get("type") in ("command_execution", "file_change", "mcp_tool_call", "web_search"):
                m["tool_calls"] += 1
        elif t in ("error", "turn.failed"):
            err = ev.get("message") or (ev.get("error") or {}).get("message") or json.dumps(ev)[:500]
            errors.append(str(err)[:500])
    if errors:
        m["cli_error"] = " | ".join(errors)[:1000]
    return m


def classify(timed_out, exit_code, parsed, stderr):
    if timed_out:
        return "timeout"
    err = (parsed.get("cli_error") or "") + "\n" + (stderr if exit_code else "")
    if (parsed.get("cli_error") or exit_code) and LIMIT_RE.search(err):
        return "rate_or_usage_limit"
    if parsed.get("refused"):
        return "refused"
    if parsed.get("cli_error") or exit_code:
        return "tool_or_cli_error"
    return "none"


def run_check(task_dir, task, work):
    with tempfile.TemporaryDirectory(prefix="bench-check-") as chk:
        shutil.copytree(os.path.join(task_dir, "check"), chk, dirs_exist_ok=True)
        try:
            r = subprocess.run(task["check"] + [work], cwd=chk, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return False, "check timed out"
        return r.returncode == 0, (r.stdout + r.stderr)[-600:]


def one_run(task_id, agent, model, repeat, out_dir, versions):
    td = os.path.join(TASKS, task_id)
    task = json.load(open(os.path.join(td, "task.json")))
    work = tempfile.mkdtemp(prefix=f"bench-{task_id}-")
    try:
        shutil.copytree(os.path.join(td, "start"), work, dirs_exist_ok=True)
        cmd = build_cmd(agent, model, task["instruction"], work)
        started = datetime.now(timezone.utc).isoformat(timespec="seconds")
        t0 = time.monotonic()
        p = subprocess.Popen(cmd, cwd=work, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
                             text=True, env=child_env(), start_new_session=True)
        timed_out = False
        try:
            stdout, stderr = p.communicate(timeout=task["timeout_s"])
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(p.pid, signal.SIGTERM)
            try:
                stdout, stderr = p.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL)
                stdout, stderr = p.communicate()
        wall = round(time.monotonic() - t0, 2)
        parsed = parse_claude(stdout) if agent == "claude" else parse_codex(stdout)
        err_class = classify(timed_out, p.returncode, parsed, stderr)
        passed, check_out = run_check(td, task, work)
        name = f"{task_id}__{agent}__{model}__r{repeat}"
        tdir = os.path.join(out_dir, "transcripts")
        with open(os.path.join(tdir, name + ".stdout.jsonl"), "w") as f:
            f.write(stdout)
        with open(os.path.join(tdir, name + ".stderr.txt"), "w") as f:
            f.write(stderr)
        effort = parsed.pop("effort", None) if agent == "claude" else codex_default_effort(model)
        rec = {
            "task": task_id, "difficulty": task["difficulty"], "agent": agent, "agent_version": versions[agent],
            "model": model, "reported_model": parsed.pop("reported_model", None),
            "effort": effort or "cli default (not reported)", "effort_source": "codex models_cache.json default_reasoning_level"
            if agent == "codex" else ("stream-json init event" if effort else "none"),
            "repeat": repeat, "passed": passed, "wall_seconds": wall, "timeout_s": task["timeout_s"],
            "exit_code": p.returncode, "error_class": err_class,
            "error_text": (parsed.get("cli_error") or (stderr.strip()[-500:] if p.returncode else None)),
            "check_output": None if passed else check_out.strip()[-300:],
            "transcript_mentions_bench_dir": HERE in stdout,
            "started_utc": started,
            **{k: v for k, v in parsed.items() if k not in ("cli_error", "refused")},
        }
        return rec
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--subjects", nargs="+", default=DEFAULT_SUBJECTS, help="agent:model, agent is claude or codex")
    ap.add_argument("--tasks", nargs="+", default=None)
    ap.add_argument("--repeats", type=int, default=2)
    ap.add_argument("--concurrency", type=int, default=3)
    ap.add_argument("--max-runs", type=int, default=130, help="hard cap on agent runs in this invocation")
    ap.add_argument("--reuse", default=None, help="runs.jsonl of an earlier run whose records for --reuse-agent "
                    "used the identical command; those (task, subject, repeat) runs are copied, not rerun")
    ap.add_argument("--reuse-agent", default="claude")
    a = ap.parse_args()

    out_dir = os.path.join(RESULTS, a.run_id)
    if os.path.exists(out_dir):
        sys.exit(f"refusing to reuse existing run directory {out_dir}")
    os.makedirs(os.path.join(out_dir, "transcripts"))
    tasks = a.tasks or sorted(os.listdir(TASKS))
    subjects = [tuple(s.split(":", 1)) for s in a.subjects]
    agents = sorted({ag for ag, _ in subjects})
    versions = {ag: cli_version(ag) for ag in agents}
    git = lambda *x: subprocess.run(["git", *x], cwd=HERE, capture_output=True, text=True).stdout.strip()
    manifest = {"run_id": a.run_id, "started_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "source_commit": git("rev-parse", "HEAD"), "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
                "command": " ".join(sys.argv), "subjects": a.subjects, "tasks": tasks, "repeats": a.repeats,
                "concurrency": a.concurrency, "cli_versions": versions,
                "claude_cmd": build_cmd("claude", "<model>", "<instruction>", "<work>"),
                "codex_cmd": build_cmd("codex", "<model>", "<instruction>", "<work>"),
                "host": {"node": subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip(),
                         "python": sys.version.split()[0], "cpus": os.cpu_count()}}
    # Interleave so every subject advances at the same pace (fair exposure to time-of-day and limits).
    plan = [(t, ag, m, r) for r in range(1, a.repeats + 1) for t in tasks for ag, m in subjects]
    if not a.reuse:
        plan = plan[: a.max_runs]
    stopped, lock = {}, threading.Lock()
    runs_path = os.path.join(out_dir, "runs.jsonl")
    reused = 0
    if a.reuse:
        src_id = os.path.basename(os.path.dirname(os.path.abspath(a.reuse)))
        keys = {(t, ag, m, r) for t, ag, m, r in plan}
        with open(runs_path, "a") as f:
            for line in open(a.reuse):
                rec = json.loads(line)
                k = (rec["task"], rec["agent"], rec["model"], rec["repeat"])
                if rec["agent"] == a.reuse_agent and k in keys:
                    rec["reused_from_run"] = src_id
                    f.write(json.dumps(rec) + "\n")
                    keys.discard(k)
                    reused += 1
        plan = [p for p in plan if p in keys]
        plan = plan[: a.max_runs]

    def job(item):
        t, ag, m, r = item
        with lock:
            if (ag, m) in stopped:
                return None
        rec = one_run(t, ag, m, r, out_dir, versions)
        with lock:
            if rec["error_class"] == "rate_or_usage_limit" and (ag, m) not in stopped:
                stopped[(ag, m)] = rec["error_text"]
            with open(runs_path, "a") as f:
                f.write(json.dumps(rec) + "\n")
            print(f"{t:17} {ag}:{m:22} r{r} {'PASS' if rec['passed'] else 'fail'} {rec['wall_seconds']:7.1f}s "
                  f"{rec['error_class']} in={rec['input_tokens']} out={rec['output_tokens']}", flush=True)
        return rec

    with cf.ThreadPoolExecutor(max_workers=a.concurrency) as ex:
        done = [x for x in ex.map(job, plan) if x]
    manifest.update({"finished_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                     "agent_runs": len(done), "planned_runs": len(plan), "reused_records": reused, "reused_from": a.reuse,
                     "stopped_subjects": {f"{ag}:{m}": txt for (ag, m), txt in stopped.items()}})
    json.dump(manifest, open(os.path.join(out_dir, "manifest.json"), "w"), indent=2)
    print(f"done: {len(done)} runs -> {runs_path}")


if __name__ == "__main__":
    main()
