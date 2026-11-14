# Method: agent and model benchmark

This note says what the numbers in `results/<run-id>/` measure, how they were made, and what they cannot
support. The numbers carry no prices. The product multiplies them by live prices.

## What was measured

Each run gives one coding agent CLI one task, in a fresh copy of the task's starting directory, with no
human in the loop. Each run records:

- **passed**: a hidden check passes after the agent stops. The check is a script that needs no model.
  It lives in `tasks/<id>/check/`, outside the agent's directory. The agent cannot see it or edit it
  (see "Confinement"). The check runs against the agent's directory after the agent exits.
- **wall_seconds**: wall time of the whole CLI process, from launch to exit. This includes CLI start-up,
  login refresh, every model call and every tool call. It does not include the hidden check.
- **tokens**, as the CLI reports them in its machine-readable output:
  - `input_tokens`: all input tokens, **including** cached input. For Claude Code this is
    `inputTokens + cacheReadInputTokens + cacheCreationInputTokens`, summed over every model in
    `modelUsage`. For codex this is `usage.input_tokens` from `turn.completed`, which already includes
    cached tokens.
  - `cached_input_tokens`: cache reads (Claude `cacheReadInputTokens`; codex `cached_input_tokens`).
  - `cache_write_tokens`: Claude `cacheCreationInputTokens` only (prompt-cache writes, which have their
    own price). Codex does not report cache writes.
  - `output_tokens`: as reported. Codex also reports `reasoning_output_tokens` separately.
- **tool_calls**: Claude `tool_use` blocks; codex `command_execution`, `file_change`, `mcp_tool_call` and
  `web_search` items. **turns**: Claude `num_turns`; codex turns (always 1 for `codex exec`).
- **error_class**: `none`, `timeout` (killed at the task's time limit), `rate_or_usage_limit`,
  `tool_or_cli_error` (non-zero exit or an error result), `refused`, or `harness_error` (the runner
  itself failed on that run; the other runs continue). The class comes only from the
  CLI's own result and error events and its exit status, never from tool output. A run can have error
  class `none` and still fail the check: the agent stopped and its answer was wrong.

The summary gives, per model: runs, passed and scored runs, pass rate, median and 90th-percentile
(nearest rank) seconds over all runs, mean tokens per run and per passed run, and error counts.
`clay-inline.json` has the same numbers as flat rows.

## The tasks

`tasks/` holds 10 small tasks of the kind a product team gives an agent: 3 easy, 5 medium, 2 hard
(`task.json` has the instruction, difficulty and time limit). Each task has a `start/` directory, a hidden
`check/` and a reference solution in `ref/`. `python3 bench/validate.py` proves for each task that the
check fails on `start/` and passes on `ref/`.

## The hard set (`tasks-hard/`, run `20261114-hard`)

The first run (`20261114-final`) saturated: every scored run passed. So a second set of 8 tasks in
`tasks-hard/` aims at the kinds of difficulty that separate agents in real work. The first set is
unchanged. Each task has an instruction in a developer's words, the same hidden-check design, a
reference solution, a time limit of 8 minutes, and an intended difficulty and a `hard_because` note in
its `task.json`:

| Task | Kind of difficulty |
|---|---|
| batch-invoices | A bug report in a 20-file Node app whose three causes are in other files than the symptom (a mutated shared default, a cache key, an off-by-one date comparison) |
| billing-schedule | A written spec with interacting edge cases: month-end clamping, end-of-month subscriptions, a business-day roll that can go backwards, holidays, pauses |
| exporter-refactor | A refactor of three near-copies into one module that must keep byte-identical output, while the copies differ in small ways the visible tests do not cover |
| dedupe-perf | A correct but quadratic job that must handle 150,000 rows within the check's 60 s limit with exactly the same output, including its special matching rules |
| job-queue | Concurrency and ordering bugs in an async queue that show only under a randomized stress check |
| bank-import | Three banks' messy CSV exports with documented quirks (decimal commas, thousands separators, negative formats, three date formats, quoted line breaks, footers, header variants) |
| export-since | A new date filter whose obvious reading (UTC midnight) contradicts the convention in the README and the existing code (calendar days in the account's time zone) |
| user-migration | A data migration with many small documented rules on messy data (names, phone prefixes, mixed timestamp formats across daylight saving time, duplicate merging, idempotency) |

`python3 bench/validate.py tasks-hard` proves for each task that the check fails on `start/` and passes
on `ref/`. A failed check prints one `FAIL <kind>: <what>` line. The summary uses it to class each failure,
together with the run record: `wrong-output`, `broke-behaviour`, `too-slow`, `no-change (gave up)` (the
agent changed no file), or the run's error class, such as `timeout`.

**Calibration is a form of tuning, and it was done.** Before the full run, each hard task was tried
once on Claude Opus 5.5 and once on gpt-6-luna (expected as the strongest and the weakest subject; 16
runs, `results/20261114-hard-calib1`). Result: 14 of 16 passed. Changes made after that probe:

- `job-queue`: the retry-order test was ambiguous with a retry delay of 0 (Opus's reading was fair), so
  the test now uses a 10 ms delay. Luna stopped after describing the bugs without editing anything.
- The six tasks that both models passed were hardened, each by a rule that the task's own docs or code
  state: a third cause in `batch-invoices`, end-of-month subscriptions in `billing-schedule`, role
  addresses and one-word names in the matching rules of `dedupe-perf`, two more differences between the
  exporter copies, gmail address equivalence for duplicates in `user-migration`, and a header variant
  and a currency suffix in `bank-import`.
- Four of the hardened tasks were tried again on the same two models (8 runs, `results/20261114-hard-calib2`):
  only `billing-schedule` then separated them (Opus pass, luna fail). `batch-invoices`, `dedupe-perf` and
  `exporter-refactor` still passed on both. The run budget (170 agent runs for this round) left no room
  for more calibration, so these three tasks went into the full run as they were; `bank-import` and
  `user-migration` were not tried again after hardening.

The calibration used two of the six measured models, so the set is tuned a little towards separating
those two. The 26 calibration and sandbox-probe runs are not part of the measured results.

### Results of the hard set, in short

Full numbers are in `results/20261114-hard/SUMMARY.md`. 144 runs: 8 tasks × 6 models × 3 repeats, so
**24 runs per model**. Pass rates with raw counts and 95% Wilson intervals:

| Model | Hard set | 95% interval | Easy set (`20261114-final`) |
|---|---|---|---|
| claude-opus-5-5 | 24/24 = 100% | 86–100% | 19/19 |
| claude-sonnet-5-5 | 24/24 = 100% | 86–100% | 19/19 |
| claude-fable-5-2 | 24/24 = 100% | 86–100% | 19/19 |
| gpt-6.1-sol | 24/24 = 100% | 86–100% | 19/19 |
| gpt-6.1-terra | 21/24 = 88% | 69–96% | 19/19 |
| gpt-6-luna | 17/24 = 71% | 51–85% | 19/19 |

**How uncertain a rate from 24 runs is.** 24 runs on 8 tasks is a small sample, and the 3 repeats of one
task are not independent of each other. A model at 24/24 can still fail up to about 14% of such tasks
(the lower end of its interval is 86%). The four models at 100% are not separated from each other at
all. gpt-6-luna is clearly below them: its interval (51–85%) does not overlap theirs. gpt-6.1-terra's
interval (69–96%) overlaps theirs, and all 3 of its failures are on one disputed check (below); without
them it is 21/21. So the honest reading is: on these tasks, luna fails noticeably more often, terra
possibly a little more often, and the other four cannot be told apart by success; they differ in time
and tokens.

**Disputed check.** All 3 gpt-6.1-terra failures are `bank-import` runs that raise `ValueError` on the
hidden file `nordea2.csv`. That file has Nordea amounts with fewer than two decimals (`12`,
`(1,234.5)`), a form that FORMATS.md does not show. Rejecting it is a defensible reading. These runs
still count as failures; `adjustments.json` lists them, and the summary also gives the rate without them.

**What the failures were** (read from the check's `FAIL` line and the run record): gpt-6-luna 6 ×
`wrong-output` (2 × `export-since`, the UTC-midnight reading the task was built to catch; 2 ×
`bank-import`, one of which did not recognize the sample file itself; 1 × `user-migration`, a phone
number with `-` became `null`; 1 × `job-queue`, a retry ran before its delay) and 1 ×
`no-change (gave up)` (`dedupe-perf`: it ended after 10 s without editing). gpt-6.1-terra 3 ×
`wrong-output` (the disputed `bank-import` case). No run timed out, hit a limit or had a CLI error.

**Changed after the run.** Only the one-line `summary` text of `tasks-hard/batch-invoices/task.json`
(it said "two causes" from before hardening). So `bench_sha256` in the run's manifest is the hash with
the old text. When the run started, `tasks-hard/` was not committed yet (`source_dirty` in the
manifest); the code that ran is in the commit that added these results.

**Sandbox, first real run.** Before the full run, one real agent per CLI ran a probe script inside the
new sandbox (`results/20261114-sandbox-probe`; the probe task itself lived in a scratch directory). Both
reported every hidden check, the repository's `.git`, `~/.claude/projects`, `~/.codex/sessions`, `~/.t3`
and `/tmp` as unreachable, writes outside the work directory as blocked, and Node working; codex also
showed PID 1 as `bwrap`. `~/agent-runs` showed only the empty mount point of the hidden checkout (0
files). Both probe runs "failed" their own check only because of that mount point. No transcript of the
hard run mentions the bench path.

## How the agents were run

`bench/run.py` runs each (task, subject, repeat) in a fresh temporary directory, at most 3 at a time, in
an interleaved order (repeat, then task, then subject), so all subjects meet the same time of day and
the same limits. The exact command lines are in each run's `manifest.json`. In short:

- **Claude Code** (`claude -p`): `--model <id> --output-format stream-json --verbose --safe-mode
  --strict-mcp-config --no-session-persistence --permission-mode acceptEdits --permission-prompts none
  --allowedTools Bash`. `--safe-mode` turns off the machine owner's CLAUDE.md, plugins, hooks, skills and
  MCP servers, so each run is a stock Claude Code with its own built-in system prompt and tools. Effort is
  not set, so each model runs at the CLI's default. The CLI does not report that default.
- **Codex** (`codex exec`): `--json -m <id> -c model_reasoning_effort="<default>" --skip-git-repo-check
  --ephemeral --ignore-user-config --ignore-rules --dangerously-bypass-approvals-and-sandbox`.
  The effort is each model's own default from the CLI's model catalog (`default_reasoning_level`),
  set explicitly so the record is exact: gpt-6.1-sol `low`, gpt-6.1-terra `low`, gpt-6-luna `medium`.
- Harness variables of the parent session (`CLAUDE*`, `T3*`, `CODEX_*`) are removed from the child's
  environment.

Both CLIs use the subscription logins on the machine, not API keys.

### Confinement

Both CLIs run inside bubblewrap (`bwrap`). The whole filesystem is read-only except the task's work
directory and the CLI's own state directory (`~/.claude` and `~/.claude.json`, or `~/.codex`). `/tmp` is a
private empty tmpfs, and the CLI gets its own PID namespace, so no process it starts outlives it.
The network is not restricted, because the CLIs need it.

The hidden checks and reference solutions also exist outside `bench/tasks/`: in the repository's `.git`,
and in agent session stores that can hold the transcript of whoever wrote the tasks. In runs made after
commit `e4557ab`, the whole repository checkout, `~/agent-runs`, `~/.claude/projects`, `~/.codex/sessions`
and `~/.t3` are hidden behind empty tmpfs mounts (and `~/.claude` for codex). In runs `20261114-main` and
`20261114-final`, only `bench/` was hidden, so an agent *could* have reached a check through `.git` or a
session store. An audit of all 124 transcripts found no tool call that names a check or reference file,
`.git`, `agent-runs`, `.claude/projects`, `.codex/sessions` or `.t3`.

Two choices differ from the CLIs' built-in sandboxes, for reasons found on this machine:

- Claude Code's own Bash sandbox needs `socat`, which is not installed. Without it, the CLI warns and runs
  Bash **unsandboxed**. So bubblewrap does the confinement and Bash is allowed.
- `codex exec --ignore-user-config` still loads the user's global `~/.codex/AGENTS.md`. On this machine
  that file told the agent to delegate through tools it did not have, and the agent refused to work (see
  `results/20261114-main/ABORTED.md`). Codex's own sandbox cannot run inside another user namespace here.
  So codex runs with its sandbox switched off inside bubblewrap, which shows an empty file in place of the
  global AGENTS.md and hides `~/.codex/skills` and `~/.agents/skills`. The difference from codex's
  `workspace-write` mode is that shell commands keep network access. The codex system prompt also says
  that it has full access, which can change its behaviour a little.

Each record has `transcript_mentions_bench_dir`, which is true if the bench path appears anywhere in
the CLI's output. It should be false for every run.

## Limits

- **Small sample.** Easy set: 10 tasks × 2 repeats = 20 runs per model; hard set: 8 tasks × 3
  repeats = 24 runs per model (see "How uncertain a rate from 24 runs is"). One pass or failure moves a pass rate by
  5 points. Differences of less than about 15 points between models are not evidence of a difference.
- **Easy tasks saturate.** Small, well-specified tasks are what teams give agents every day, but strong
  models pass most of them. In run `20261114-final` every scored run passed (114 of 114), the two
  "hard" tasks included, so this run separates models only by time and tokens, not by success. A pass
  rate of 100% on 19 runs is still consistent with a true failure rate of up to about 15% (95% upper
  bound, rule of three). A harder task set is needed to measure error rates.
- **One machine, one day.** A shared 12-core Linux host, 3 runs at a time, with other sessions running.
  Latency depends on the providers' load at that time and on this network.
- **Time includes CLI start-up**, which is several seconds per run and differs between the CLIs.
- **The CLIs add their own system prompt and tool definitions.** These are most of the input tokens on
  small tasks (tens of thousands of tokens before the agent reads a file). That is part of the real cost
  of using that agent, but it means the numbers describe *agent CLI + model*, not the bare model.
  Cached input is most of the input; its price is usually much lower than uncached input.
- **Default efforts differ between models** (codex: low or medium; Claude: the CLI default, not reported).
  A model at a higher effort can pass more and use more tokens.
- **Subscription logins** can have their own rate limits and routing. API use can differ.
- **One task-check flaw was found during the run.** The first `csv-totals` check put `rates.json` in a
  different directory from the agent's script. The instruction does not say where that file lives, and
  all three Claude models read it from the script's directory. The check was fixed during the run, before
  any repeat-2 `csv-totals` run. The 6 repeat-1 `csv-totals` runs could not be re-checked (their
  directories were already deleted). They count for time, tokens and errors, but not for pass rate
  (`results/20261114-final/adjustments.json`).

- **Source commit of the committed runs.** `manifest.json` of runs `20261114-main` and `20261114-final`
  says `source_commit` `b3d97f8`, but `bench/` was not committed yet at that time. The code that ran is
  commit `e4557ab`, except two later changes: the `csv-totals` check (changed during the run, see above)
  and the `started_utc` fix. Later manifests also record `source_dirty` (uncommitted changes in `bench/`)
  and `bench_sha256` (a hash of `run.py` and every task file).
- **Record field fix.** In runs `20261114-main` and `20261114-final`, the field `started_utc` holds the
  time each run *ended* (a harness bug, fixed afterwards). Durations are in `wall_seconds` and are correct.

## Reproduce

```bash
python3 bench/validate.py                                   # every check fails on start/ and passes on ref/
python3 bench/validate.py tasks-hard
python3 bench/run.py --run-id <new-id> --repeats 2 --concurrency 3
python3 bench/run.py --run-id <new-id> --task-set tasks-hard --repeats 3 --concurrency 3
python3 bench/summarize.py bench/results/<new-id>          # add --overwrite to regenerate an existing summary
python3 bench/summarize.py bench/results/<hard-id> --combine-easy bench/results/20261114-final   # also clay-inline-combined.json
```

To add a model, run only that subject into a new run directory, then summarize both runs together. The
merged summary is written into the last directory given, so the earlier summary stays unchanged:

```bash
python3 bench/run.py --run-id <new-id> --subjects codex:<model-id> --repeats 2
python3 bench/summarize.py bench/results/20261114-final bench/results/<new-id>
```

`run.py` refuses an existing run directory. Requirements: `claude` and/or `codex` logged in, `bwrap`,
Node and Python 3. No other dependencies.
