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

- **Small sample.** 10 tasks × 2 repeats = 20 runs per model. One pass or failure moves a pass rate by
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
python3 bench/run.py --run-id <new-id> --repeats 2 --concurrency 3
python3 bench/summarize.py bench/results/<new-id>          # add --overwrite to regenerate an existing summary
```

To add a model, run only that subject into a new run directory, then summarize both runs together. The
merged summary is written into the last directory given, so the earlier summary stays unchanged:

```bash
python3 bench/run.py --run-id <new-id> --subjects codex:<model-id> --repeats 2
python3 bench/summarize.py bench/results/20261114-final bench/results/<new-id>
```

`run.py` refuses an existing run directory. Requirements: `claude` and/or `codex` logged in, `bwrap`,
Node and Python 3. No other dependencies.
