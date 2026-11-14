# Agent and model benchmark: summary

Run `20261114-hard-calib1` · source commit `3e94167` · 2026-11-14T01:43:13+00:00 to 2026-11-14T01:47:07+00:00 · CLI versions: claude 2.1.321 (Claude Code), codex codex-cli 0.167.0

> **Calibration runs, not measured results.** These runs tuned the hard task set before run `20261114-hard`
> (see the calibration paragraph in `bench/METHOD.md`); tasks changed after them, so their numbers are not comparable.

16 runs. Pass rate counts only scored runs; see the method note in `bench/METHOD.md`. Seconds are wall time of the whole CLI process, including start-up, for all runs (passed or not). Tokens are means per run as the CLI reports them; input includes cached input.

## Per model

| Agent | Model | Effort | Runs | Passed / scored | Pass rate (95% interval) | Median s | p90 s | Input tok/task | Cached tok/task | Output tok/task | Input tok/passed | Output tok/passed | Tool calls/task | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude | claude-opus-5-5 | cli default (not reported) | 8 | 7/8 | 88% (53%–98%) | 54.5 | 66.6 | 100,928 | 90,351 | 4,589 | 101,008 | 4,535 | 4 | none |
| codex | gpt-6-luna | medium | 8 | 6/8 | 75% (41%–93%) | 31.6 | 48.0 | 87,026 | 78,864 | 1,492 | 93,540 | 1,805 | 5 | none |

## Per task (passed / scored runs)

| Task | Difficulty | What it asks | claude-opus-5-5 | gpt-6-luna |
|---|---|---|---|---|
| bank-import | hard | Parse three banks' messy statement exports into one normalized format | 1/1 | 1/1 |
| batch-invoices | hard | Bug report whose three causes sit in other files than the symptom, in a 20-file app | 1/1 | 1/1 |
| billing-schedule | hard | Subscription billing dates to a written spec: month-end clamping, business-day roll, holidays, pauses | 1/1 | 1/1 |
| dedupe-perf | hard | Make a quadratic customer-dedupe job fast without changing its output | 1/1 | 1/1 |
| export-since | medium | Add a --since date filter whose obvious reading (UTC midnight) contradicts the documented convention | 1/1 | 0/1 |
| exporter-refactor | hard | Deduplicate three exporters into a shared module while keeping byte-identical output | 1/1 | 1/1 |
| job-queue | hard | Fix ordering and concurrency bugs in an async job queue that show only under load | 0/1 | 0/1 |
| user-migration | hard | Migrate messy v1 user records to the v2 schema: names, phones, mixed date formats with DST, duplicate merge, idempotency | 1/1 | 1/1 |

## Failure classes per model

Read from the run record and the hidden check's first `FAIL` line, not judged by a model: `wrong-output` (the check found a wrong result), `broke-behaviour` (existing behaviour or tests broke), `too-slow` (the performance limit was missed), `no-change (gave up)` (the agent ended without changing any file), or the run's error class (`timeout`, ...).

- claude-opus-5-5: wrong-output 1
- gpt-6-luna: no-change (gave up) 1, wrong-output 1

## Failed runs

- `export-since` gpt-6-luna r1: **wrong-output**, 21.85 s — wrong-output: --since 2026-03-01 with offset -300 gave [a1 a2 a5 a3 a4], want [a2 a5 a3 a4] (day starts in the account time zone)
- `job-queue` gpt-6-luna r1: **no-change (gave up)**, 7.14 s — wrong-output: retry ran in the wrong place: start order ABCDA, want ABACD
- `job-queue` claude-opus-5-5 r1: **wrong-output**, 62.15 s — wrong-output: retry ran in the wrong place: start order AABCD, want ABACD

## Runs with an error class other than none

None.
