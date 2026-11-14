# Agent and model benchmark: summary

Run `20261114-hard` · source commit `3e94167` · 2026-11-14T01:54:03+00:00 to 2026-11-14T02:28:16+00:00 · CLI versions: claude 2.1.321 (Claude Code), codex codex-cli 0.167.0

> **Read with these numbers.** The hard task set was calibrated before this run: each task was tried on
> claude-opus-5-5 and gpt-6-luna (`20261114-hard-calib1`, 16 runs), six tasks that both passed were made
> harder, and four were tried again (`20261114-hard-calib2`, 8 runs). Calibrating on two of the six measured
> models is a form of tuning (see `bench/METHOD.md`). All 3 gpt-6.1-terra failures are one **disputed**
> check (`bank-import`, Nordea amounts with fewer than two decimals, a form the task's docs do not show);
> they count as failures here, and "Disputed failures" below gives the rate without them. The 95%
> intervals treat the 24 runs per model as independent; the 3 repeats of a task are correlated, so the
> real uncertainty is larger.

144 runs. Pass rate counts only scored runs; see the method note in `bench/METHOD.md`. Seconds are wall time of the whole CLI process, including start-up, for all runs (passed or not). Tokens are means per run as the CLI reports them; input includes cached input.

## Per model

| Agent | Model | Effort | Runs | Passed / scored | Pass rate (95% interval) | Median s | p90 s | Input tok/task | Cached tok/task | Output tok/task | Input tok/passed | Output tok/passed | Tool calls/task | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude | claude-fable-5-2 | cli default (not reported) | 24 | 24/24 | 100% (86%–100%) | 47.6 | 83.9 | 77,440 | 66,872 | 4,612 | 77,440 | 4,612 | 3 | none |
| claude | claude-opus-5-5 | cli default (not reported) | 24 | 24/24 | 100% (86%–100%) | 54.9 | 76.5 | 103,548 | 92,827 | 4,878 | 103,548 | 4,878 | 4 | none |
| claude | claude-sonnet-5-5 | cli default (not reported) | 24 | 24/24 | 100% (86%–100%) | 18.6 | 39.8 | 72,688 | 64,343 | 2,901 | 72,688 | 2,901 | 3 | none |
| codex | gpt-6-luna | medium | 24 | 17/24 | 71% (51%–85%) | 33.2 | 52.7 | 93,257 | 80,667 | 1,602 | 94,233 | 1,649 | 5 | none |
| codex | gpt-6.1-sol | low | 24 | 24/24 | 100% (86%–100%) | 48.9 | 62.4 | 101,804 | 88,640 | 1,958 | 101,804 | 1,958 | 6 | none |
| codex | gpt-6.1-terra | low | 24 | 21/24 | 88% (69%–96%) | 34.3 | 44.3 | 83,494 | 74,896 | 1,550 | 82,465 | 1,489 | 4 | none |

## Per task (passed / scored runs)

| Task | Difficulty | What it asks | claude-fable-5-2 | claude-opus-5-5 | claude-sonnet-5-5 | gpt-6-luna | gpt-6.1-sol | gpt-6.1-terra |
|---|---|---|---|---|---|---|---|---|
| bank-import | hard | Parse three banks' messy statement exports into one normalized format | 3/3 | 3/3 | 3/3 | 1/3 | 3/3 | 0/3 |
| batch-invoices | hard | Bug report whose three causes sit in other files than the symptom, in a 20-file app | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| billing-schedule | hard | Subscription billing dates to a written spec: month-end clamping, business-day roll, holidays, pauses | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| dedupe-perf | hard | Make a quadratic customer-dedupe job fast without changing its output | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 | 3/3 |
| export-since | medium | Add a --since date filter whose obvious reading (UTC midnight) contradicts the documented convention | 3/3 | 3/3 | 3/3 | 1/3 | 3/3 | 3/3 |
| exporter-refactor | hard | Deduplicate three exporters into a shared module while keeping byte-identical output | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| job-queue | hard | Fix ordering and concurrency bugs in an async job queue that show only under load | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 | 3/3 |
| user-migration | hard | Migrate messy v1 user records to the v2 schema: names, phones, mixed date formats with DST, duplicate merge, idempotency | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 | 3/3 |

## Failure classes per model

Read from the run record and the hidden check's first `FAIL` line, not judged by a model: `wrong-output` (the check found a wrong result), `broke-behaviour` (existing behaviour or tests broke), `too-slow` (the performance limit was missed), `incomplete` (a required structural change is missing), `check-timeout` (the hidden check itself did not finish, for example on a hang), `no-change (gave up)` (the agent ended without changing any file), or the run's error class (`timeout`, ...).

- claude-fable-5-2: no failures
- claude-opus-5-5: no failures
- claude-sonnet-5-5: no failures
- gpt-6-luna: no-change (gave up) 1, wrong-output 6
- gpt-6.1-sol: no failures
- gpt-6.1-terra: wrong-output 3

## Failed runs

- `bank-import` gpt-6.1-terra r1: **wrong-output**, 42.17 s — wrong-output: nordea2.csv raised ValueError: Invalid Nordea amount: 12 (**disputed**, see adjustments.json)
- `bank-import` gpt-6-luna r1: **wrong-output**, 51.06 s — wrong-output: spankki2.csv raised ValueError: invalid S-Pankki amount
- `export-since` gpt-6-luna r1: **wrong-output**, 33.42 s — wrong-output: --since 2026-03-01 with offset -300 gave [a1 a2 a5 a3 a4], want [a2 a5 a3 a4] (day starts in the account time zone)
- `user-migration` gpt-6-luna r1: **wrong-output**, 44.69 s — wrong-output: hidden: record 20: got {'schema': 2, 'id': 20, 'given_name': 'John, Jr.', 'family_name': 'Smith', 'email': 'john@example.com', 'phone': None, 'created_at': '2026-01-15T12:00:00Z', 'prefs': ['a', 'b']},
- `bank-import` gpt-6.1-terra r2: **wrong-output**, 46.3 s — wrong-output: nordea2.csv raised ValueError: Invalid amount: '12' (**disputed**, see adjustments.json)
- `bank-import` gpt-6.1-terra r3: **wrong-output**, 43.31 s — wrong-output: nordea2.csv raised ValueError: Invalid Nordea amount (**disputed**, see adjustments.json)
- `bank-import` gpt-6-luna r3: **wrong-output**, 42.4 s — wrong-output: pohjola.csv raised ValueError: unrecognized statement format
- `dedupe-perf` gpt-6-luna r3: **no-change (gave up)**, 9.99 s — too-slow: 150k-row input took over 60 s
- `export-since` gpt-6-luna r3: **wrong-output**, 17.41 s — wrong-output: --since 2026-03-01 with offset -300 gave [a1 a2 a5 a3 a4], want [a2 a5 a3 a4] (day starts in the account time zone)
- `job-queue` gpt-6-luna r3: **wrong-output**, 34.51 s — wrong-output: retry ran in the wrong place: start order AABCD, want ABACD

## Disputed failures

These failures count in every pass rate above. Left out, the pass rate would be:

- gpt-6.1-terra: 3 disputed; 21/21 = 100% without them

## Runs with an error class other than none

None.
