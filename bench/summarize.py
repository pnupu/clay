#!/usr/bin/env python3
"""Summarize a bench run: python3 bench/summarize.py bench/results/<run-id> [more run dirs to merge ...]

With `--combine-easy <easy run dir>` it also writes clay-inline-combined.json: one row per model with the
easy-set and the hard-set numbers as separate fields.

Writes summary.json, SUMMARY.md and clay-inline.json into the LAST run directory given (it refuses to
replace an existing summary unless --overwrite is passed), so merging a new
run never overwrites the summary of an earlier one.
No prices: those come live from the web in the product.
"""
import fnmatch, json, math, os, statistics, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ERROR_CLASSES = ["none", "timeout", "rate_or_usage_limit", "tool_or_cli_error", "refused", "harness_error"]


def pct(xs, p):
    """Nearest-rank percentile."""
    if not xs:
        return None
    s = sorted(xs)
    return s[max(0, math.ceil(p / 100 * len(s)) - 1)]


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.fmean(xs)) if xs else None


def wilson(k, n, z=1.96):
    """95% Wilson score interval for k successes in n runs."""
    if not n:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 3), round(min(1.0, c + h), 3)]


def kind(r):
    """Failure class of a failed run (records from older runs have no failure_kind field)."""
    if r["passed"]:
        return None
    if r.get("failure_kind"):
        return r["failure_kind"]
    return r["error_class"] if r["error_class"] != "none" else "wrong-output"


def load(run_dirs):
    """Records of all run dirs; each dir's adjustments apply only to that dir's own records."""
    recs = []
    for d in run_dirs:
        own = [json.loads(line) for line in open(os.path.join(d, "runs.jsonl"))]
        adj = os.path.join(d, "adjustments.json")
        adjd = json.load(open(adj)) if os.path.exists(adj) else {}
        unknown, disputed = adjd.get("pass_unknown", []), adjd.get("disputed", [])
        for r in own:
            r["disputed"] = (not r["passed"]) and any(
                r["task"] == u["task"] and r["agent"] == u["agent"] and r["model"] == u["model"]
                and all(x in (r.get("check_fail_line") or "") for x in u["fail_line_contains_all"]) for u in disputed)
            r["pass_scored"] = not any(
                r["task"] == u["task"] and r["repeat"] == u["repeat"] and fnmatch.fnmatch(r["agent"], u["agent"])
                and fnmatch.fnmatch(r["model"], u["model"]) for u in unknown)
        recs += own
    return recs


def summarize(recs):
    subjects = sorted({(r["agent"], r["model"]) for r in recs})
    tasks = sorted({r["task"] for r in recs})
    rows = []
    for ag, m in subjects:
        rs = [r for r in recs if (r["agent"], r["model"]) == (ag, m)]
        scored = [r for r in rs if r["pass_scored"]]
        passed = [r for r in scored if r["passed"]]
        secs = [r["wall_seconds"] for r in rs if r["wall_seconds"] is not None]
        rows.append({
            "agent": ag, "model": m, "agent_version": next((r.get("agent_version") for r in rs if r.get("agent_version")), None),
            "effort": next((r.get("effort") for r in rs if r.get("effort")), "cli default (not reported)"),
            "runs": len(rs), "scored_runs": len(scored), "passed": len(passed),
            "pass_rate": round(len(passed) / len(scored), 3) if scored else None,
            "pass_rate_ci95": wilson(len(passed), len(scored)),
            "disputed_failures": sum(1 for r in scored if r.get("disputed")),
            "pass_rate_excluding_disputed": round(len(passed) / (len(scored) - sum(1 for r in scored if r.get("disputed"))), 3)
            if len(scored) > sum(1 for r in scored if r.get("disputed")) else None,
            "median_seconds": round(statistics.median(secs), 1) if secs else None,
            "p90_seconds": round(pct(secs, 90), 1) if secs else None,
            "median_seconds_passed": round(statistics.median([r["wall_seconds"] for r in passed]), 1) if passed else None,
            "per_task": {k: mean([r.get(k) for r in rs]) for k in
                         ("input_tokens", "cached_input_tokens", "cache_write_tokens", "output_tokens",
                          "reasoning_output_tokens", "tool_calls", "turns")},
            "per_passed_task": {k: mean([r.get(k) for r in passed]) for k in
                                ("input_tokens", "cached_input_tokens", "cache_write_tokens", "output_tokens",
                                 "reasoning_output_tokens")},
            "runs_without_token_report": sum(1 for r in rs if r.get("input_tokens") is None),
            "errors": {c: sum(1 for r in rs if r["error_class"] == c) for c in ERROR_CLASSES},
            "failures": {k: sum(1 for r in scored if kind(r) == k) for k in sorted({kind(r) for r in scored if not r["passed"]})},
            "helper_models": sorted({h for r in rs for h in (r.get("helper_models") or {}) if h != m}),
        })
    per_task = []
    for t in tasks:
        tr = [r for r in recs if r["task"] == t]
        tset = next((r.get("task_set") for r in tr if r.get("task_set")), "tasks")
        task = json.load(open(os.path.join(HERE, tset, t, "task.json")))
        res = {}
        for ag, m in subjects:
            x = [r for r in tr if (r["agent"], r["model"]) == (ag, m)]
            sc = [r for r in x if r["pass_scored"]]
            res[m] = f"{sum(r['passed'] for r in sc)}/{len(sc)}" + (f" (+{len(x) - len(sc)} unscored)" if len(x) > len(sc) else "")
        per_task.append({"task": t, "difficulty": task["difficulty"], "summary": task["summary"],
                         "hard_because": task.get("hard_because"),
                         "timeout_s": task["timeout_s"], "passed_by_model": res})
    return rows, per_task


def fmt(x):
    return "–" if x is None else (f"{x:,}" if isinstance(x, int) else str(x))


def markdown(rows, per_task, manifests, recs):
    out = ["# Agent and model benchmark: summary", ""]
    for mf in manifests:
        out.append(f"Run `{mf['run_id']}` · source commit `{mf['source_commit'][:7]}` · {mf['started_utc']} to "
                   f"{mf.get('finished_utc', '?')} · CLI versions: " + ", ".join(f"{k} {v}" for k, v in mf["cli_versions"].items()))
    out += ["", f"{len(recs)} runs. Pass rate counts only scored runs; see the method note in `bench/METHOD.md`. "
            "Seconds are wall time of the whole CLI process, including start-up, for all runs (passed or not). "
            "Tokens are means per run as the CLI reports them; input includes cached input.", "",
            "## Per model", "",
            "| Agent | Model | Effort | Runs | Passed / scored | Pass rate (95% interval) | Median s | p90 s | Input tok/task | Cached tok/task | Output tok/task | Input tok/passed | Output tok/passed | Tool calls/task | Errors |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        errs = ", ".join(f"{k} {v}" for k, v in r["errors"].items() if k != "none" and v) or "none"
        out.append(f"| {r['agent']} | {r['model']} | {r['effort']} | {r['runs']} | {r['passed']}/{r['scored_runs']} | "
                   f"{'–' if r['pass_rate'] is None else format(r['pass_rate'], '.0%') + ' (' + '–'.join(format(x, '.0%') for x in r['pass_rate_ci95']) + ')'} | {r['median_seconds']} | {r['p90_seconds']} | {fmt(r['per_task']['input_tokens'])} | "
                   f"{fmt(r['per_task']['cached_input_tokens'])} | {fmt(r['per_task']['output_tokens'])} | "
                   f"{fmt(r['per_passed_task']['input_tokens'])} | {fmt(r['per_passed_task']['output_tokens'])} | "
                   f"{fmt(r['per_task']['tool_calls'])} | {errs} |")
    models = [r["model"] for r in rows]
    out += ["", "## Per task (passed / scored runs)", "", "| Task | Difficulty | What it asks | " + " | ".join(models) + " |",
            "|---|---|---|" + "---|" * len(models)]
    for t in per_task:
        out.append(f"| {t['task']} | {t['difficulty']} | {t['summary']} | " + " | ".join(t["passed_by_model"][m] for m in models) + " |")
    out += ["", "## Failure classes per model", "", "Read from the run record and the hidden check's first `FAIL` line, not judged by a model: "
            "`wrong-output` (the check found a wrong result), `broke-behaviour` (existing behaviour or tests broke), "
            "`too-slow` (the performance limit was missed), `no-change (gave up)` (the agent ended without changing any file), "
            "or the run's error class (`timeout`, ...).", ""]
    out += [f"- {r['model']}: " + (", ".join(f"{k} {v}" for k, v in r["failures"].items()) or "no failures") for r in rows]
    failed = [r for r in recs if r["pass_scored"] and not r["passed"]]
    out += ["", "## Failed runs", ""]
    out += [f"- `{r['task']}` {r['model']} r{r['repeat']}: **{kind(r)}**, {r['wall_seconds']} s"
            + (f" — {(r.get('check_fail_line') or '')[5:220]}" if r.get("check_fail_line") else "")
            + (" (**disputed**, see adjustments.json)" if r.get("disputed") else "") for r in failed] or ["None."]
    dis = [r for r in rows if r["disputed_failures"]]
    if dis:
        out += ["", "## Disputed failures", "", "These failures count in every pass rate above. Left out, the pass rate would be:", ""]
        out += [f"- {r['model']}: {r['disputed_failures']} disputed; {r['passed']}/{r['scored_runs'] - r['disputed_failures']} = "
                f"{r['pass_rate_excluding_disputed']:.0%} without them" for r in dis]
    bad = [r for r in recs if r["error_class"] != "none"]
    out += ["", "## Runs with an error class other than none", ""]
    out += [f"- `{r['task']}` {r['model']} r{r['repeat']}: {r['error_class']} after {r['wall_seconds']} s"
            + (f" — `{(r.get('error_text') or '')[:300]}`" if r.get("error_text") else "") for r in bad] or ["None."]
    extra = [r for r in rows if r["helper_models"]]
    if extra:
        out += ["", "## Helper models", "", "The CLI also called these models inside some runs; their tokens are included in the totals:", ""]
        out += [f"- {r['model']}: {', '.join(r['helper_models'])}" for r in extra]
    return "\n".join(out) + "\n"


def main():
    args = sys.argv[1:]
    overwrite = "--overwrite" in args
    easy_dir = None
    if "--combine-easy" in args:
        i = args.index("--combine-easy")
        easy_dir = args[i + 1]
        del args[i:i + 2]
    dirs = [a for a in args if a != "--overwrite"]
    if not dirs:
        sys.exit(__doc__)
    outs = [os.path.join(dirs[-1], n) for n in ("summary.json", "SUMMARY.md", "clay-inline.json", "clay-inline-combined.json")]
    if not overwrite and any(os.path.exists(o) for o in outs):
        sys.exit(f"refusing to overwrite the summary in {dirs[-1]}; pass --overwrite to regenerate it")
    recs = load(dirs)
    rows, per_task = summarize(recs)
    manifests = [json.load(open(os.path.join(d, "manifest.json"))) for d in dirs if os.path.exists(os.path.join(d, "manifest.json"))]
    out = dirs[-1]
    json.dump({"runs": len(recs), "run_ids": [m["run_id"] for m in manifests], "models": rows, "tasks": per_task},
              open(os.path.join(out, "summary.json"), "w"), indent=2)
    open(os.path.join(out, "SUMMARY.md"), "w").write(markdown(rows, per_task, manifests, recs))
    inline = [{"model": r["model"], "agent": r["agent"], "effort": r["effort"], "runs": r["runs"], "scored_runs": r["scored_runs"],
               "passed": r["passed"], "pass_rate": r["pass_rate"], "median_seconds": r["median_seconds"],
               "p90_seconds": r["p90_seconds"], "input_tokens_per_task": r["per_task"]["input_tokens"],
               "cached_input_tokens_per_task": r["per_task"]["cached_input_tokens"],
               "output_tokens_per_task": r["per_task"]["output_tokens"],
               "pass_rate_low95": (r["pass_rate_ci95"] or [None, None])[0], "pass_rate_high95": (r["pass_rate_ci95"] or [None, None])[1],
               "input_tokens_per_passed_task": r["per_passed_task"]["input_tokens"],
               "cached_input_tokens_per_passed_task": r["per_passed_task"]["cached_input_tokens"],
               "output_tokens_per_passed_task": r["per_passed_task"]["output_tokens"],
               "disputed_failures": r["disputed_failures"]} for r in rows]
    json.dump(inline, open(os.path.join(out, "clay-inline.json"), "w"), indent=1)
    if easy_dir:
        # One row per model; the easy and the hard set stay separate fields, never averaged together.
        easy_rows, _ = summarize(load([easy_dir]))
        easy = {(r["agent"], r["model"]): r for r in easy_rows}
        fields = lambda r, pre: {} if r is None else {
            f"{pre}_runs": r["scored_runs"], f"{pre}_passed": r["passed"], f"{pre}_pass_rate": r["pass_rate"],
            f"{pre}_pass_rate_low95": r["pass_rate_ci95"][0], f"{pre}_pass_rate_high95": r["pass_rate_ci95"][1],
            f"{pre}_median_seconds": r["median_seconds"], f"{pre}_p90_seconds": r["p90_seconds"],
            f"{pre}_input_tokens_per_task": r["per_task"]["input_tokens"],
            f"{pre}_cached_input_tokens_per_task": r["per_task"]["cached_input_tokens"],
            f"{pre}_output_tokens_per_task": r["per_task"]["output_tokens"],
            f"{pre}_input_tokens_per_passed_task": r["per_passed_task"]["input_tokens"],
            f"{pre}_cached_input_tokens_per_passed_task": r["per_passed_task"]["cached_input_tokens"],
            f"{pre}_output_tokens_per_passed_task": r["per_passed_task"]["output_tokens"],
            f"{pre}_disputed_failures": r["disputed_failures"]}
        combined = [{"model": r["model"], "agent": r["agent"], "effort": r["effort"],
                     **fields(easy.get((r["agent"], r["model"])), "easy"), **fields(r, "hard")} for r in rows]
        json.dump(combined, open(os.path.join(out, "clay-inline-combined.json"), "w"), indent=1)
    print(open(os.path.join(out, "SUMMARY.md")).read())


if __name__ == "__main__":
    main()
