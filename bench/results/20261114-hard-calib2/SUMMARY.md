# Agent and model benchmark: summary

Run `20261114-hard-calib2` · source commit `3e94167` · 2026-11-14T01:51:36+00:00 to 2026-11-14T01:53:50+00:00 · CLI versions: claude 2.1.321 (Claude Code), codex codex-cli 0.167.0

8 runs. Pass rate counts only scored runs; see the method note in `bench/METHOD.md`. Seconds are wall time of the whole CLI process, including start-up, for all runs (passed or not). Tokens are means per run as the CLI reports them; input includes cached input.

## Per model

| Agent | Model | Effort | Runs | Passed / scored | Pass rate (95% interval) | Median s | p90 s | Input tok/task | Cached tok/task | Output tok/task | Input tok/passed | Output tok/passed | Tool calls/task | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude | claude-opus-5-5 | cli default (not reported) | 4 | 4/4 | 100% (51%–100%) | 42.7 | 64.8 | 102,174 | 92,116 | 4,300 | 102,174 | 4,300 | 4 | none |
| codex | gpt-6-luna | medium | 4 | 3/4 | 75% (30%–95%) | 34.0 | 54.4 | 106,725 | 91,072 | 1,652 | 102,049 | 1,654 | 6 | none |

## Per task (passed / scored runs)

| Task | Difficulty | What it asks | claude-opus-5-5 | gpt-6-luna |
|---|---|---|---|---|
| batch-invoices | hard | Bug report whose three causes sit in other files than the symptom, in a 20-file app | 1/1 | 1/1 |
| billing-schedule | hard | Subscription billing dates to a written spec: month-end clamping, business-day roll, holidays, pauses | 1/1 | 0/1 |
| dedupe-perf | hard | Make a quadratic customer-dedupe job fast without changing its output | 1/1 | 1/1 |
| exporter-refactor | hard | Deduplicate three exporters into a shared module while keeping byte-identical output | 1/1 | 1/1 |

## Failure classes per model

Read from the run record and the hidden check's first `FAIL` line, not judged by a model: `wrong-output` (the check found a wrong result), `broke-behaviour` (existing behaviour or tests broke), `too-slow` (the performance limit was missed), `no-change (gave up)` (the agent ended without changing any file), or the run's error class (`timeout`, ...).

- claude-opus-5-5: no failures
- gpt-6-luna: wrong-output 1

## Failed runs

- `billing-schedule` gpt-6-luna r1: **wrong-output**, 34.98 s — wrong-output: billing_dates(datetime.date(2026, 1, 31), 14) {}: got [datetime.date(2026, 1, 30), datetime.date(2026, 2, 27), datetime.date(2026, 3, 31), datetime.date(2026, 4, 30), datetime.date(2026, 6, 1), datetim

## Runs with an error class other than none

None.
