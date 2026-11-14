#!/usr/bin/env python3
"""Summarize a bench run: python3 bench/summarize.py bench/results/<run-id> [more run dirs to merge ...]

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


def load(run_dirs):
    """Records of all run dirs; each dir's adjustments apply only to that dir's own records."""
    recs = []
    for d in run_dirs:
        own = [json.loads(line) for line in open(os.path.join(d, "runs.jsonl"))]
        adj = os.path.join(d, "adjustments.json")
        unknown = json.load(open(adj)).get("pass_unknown", []) if os.path.exists(adj) else []
        for r in own:
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
            "agent": ag, "model": m, "agent_version": rs[0]["agent_version"], "effort": rs[0]["effort"],
            "runs": len(rs), "scored_runs": len(scored), "passed": len(passed),
            "pass_rate": round(len(passed) / len(scored), 3) if scored else None,
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
            "helper_models": sorted({h for r in rs for h in (r.get("helper_models") or {}) if h != m}),
        })
    per_task = []
    for t in tasks:
        tr = [r for r in recs if r["task"] == t]
        task = json.load(open(os.path.join(HERE, "tasks", t, "task.json")))
        res = {}
        for ag, m in subjects:
            x = [r for r in tr if (r["agent"], r["model"]) == (ag, m)]
            sc = [r for r in x if r["pass_scored"]]
            res[m] = f"{sum(r['passed'] for r in sc)}/{len(sc)}" + (f" (+{len(x) - len(sc)} unscored)" if len(x) > len(sc) else "")
        per_task.append({"task": t, "difficulty": task["difficulty"], "summary": task["summary"],
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
            "| Agent | Model | Effort | Runs | Passed / scored | Pass rate | Median s | p90 s | Input tok/task | Cached tok/task | Output tok/task | Input tok/passed | Output tok/passed | Tool calls/task | Errors |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        errs = ", ".join(f"{k} {v}" for k, v in r["errors"].items() if k != "none" and v) or "none"
        out.append(f"| {r['agent']} | {r['model']} | {r['effort']} | {r['runs']} | {r['passed']}/{r['scored_runs']} | "
                   f"{'–' if r['pass_rate'] is None else format(r['pass_rate'], '.0%')} | {r['median_seconds']} | {r['p90_seconds']} | {fmt(r['per_task']['input_tokens'])} | "
                   f"{fmt(r['per_task']['cached_input_tokens'])} | {fmt(r['per_task']['output_tokens'])} | "
                   f"{fmt(r['per_passed_task']['input_tokens'])} | {fmt(r['per_passed_task']['output_tokens'])} | "
                   f"{fmt(r['per_task']['tool_calls'])} | {errs} |")
    models = [r["model"] for r in rows]
    out += ["", "## Per task (passed / scored runs)", "", "| Task | Difficulty | What it asks | " + " | ".join(models) + " |",
            "|---|---|---|" + "---|" * len(models)]
    for t in per_task:
        out.append(f"| {t['task']} | {t['difficulty']} | {t['summary']} | " + " | ".join(t["passed_by_model"][m] for m in models) + " |")
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
    overwrite = "--overwrite" in sys.argv
    dirs = [a for a in sys.argv[1:] if a != "--overwrite"]
    if not dirs:
        sys.exit(__doc__)
    outs = [os.path.join(dirs[-1], n) for n in ("summary.json", "SUMMARY.md", "clay-inline.json")]
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
               "output_tokens_per_task": r["per_task"]["output_tokens"]} for r in rows]
    json.dump(inline, open(os.path.join(out, "clay-inline.json"), "w"), indent=1)
    print(open(os.path.join(out, "SUMMARY.md")).read())


if __name__ == "__main__":
    main()
