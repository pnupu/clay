# Agent and model benchmark: summary

Run `20261114-final` · source commit `b3d97f8` · 2026-11-14T00:14:20+00:00 to 2026-11-14T00:29:58+00:00 · CLI versions: claude 2.1.321 (Claude Code), codex codex-cli 0.167.0

120 runs. Pass rate counts only scored runs; see the method note in `bench/METHOD.md`. Seconds are wall time of the whole CLI process, including start-up, for all runs (passed or not). Tokens are means per run as the CLI reports them; input includes cached input.

## Per model

| Agent | Model | Effort | Runs | Passed / scored | Pass rate | Median s | p90 s | Input tok/task | Cached tok/task | Output tok/task | Input tok/passed | Output tok/passed | Tool calls/task | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude | claude-fable-5-2 | cli default (not reported) | 20 | 19/19 | 100% | 19.3 | 36.4 | 57,290 | 51,056 | 1,962 | 57,227 | 1,880 | 2 | none |
| claude | claude-opus-5-5 | cli default (not reported) | 20 | 19/19 | 100% | 22.1 | 48.0 | 67,169 | 60,546 | 2,360 | 66,842 | 2,318 | 3 | none |
| claude | claude-sonnet-5-5 | cli default (not reported) | 20 | 19/19 | 100% | 11.1 | 18.5 | 57,201 | 51,478 | 1,690 | 57,439 | 1,658 | 3 | none |
| codex | gpt-6-luna | medium | 20 | 19/19 | 100% | 21.6 | 33.8 | 78,673 | 68,115 | 1,032 | 78,447 | 1,005 | 4 | none |
| codex | gpt-6.1-sol | low | 20 | 19/19 | 100% | 30.4 | 54.3 | 80,495 | 64,832 | 1,092 | 80,126 | 1,050 | 4 | none |
| codex | gpt-6.1-terra | low | 20 | 19/19 | 100% | 22.3 | 48.8 | 72,039 | 61,126 | 1,065 | 71,220 | 1,003 | 4 | none |

## Per task (passed / scored runs)

| Task | Difficulty | What it asks | claude-fable-5-2 | claude-opus-5-5 | claude-sonnet-5-5 | gpt-6-luna | gpt-6.1-sol | gpt-6.1-terra |
|---|---|---|---|---|---|---|---|---|
| cron-next | hard | Next run time of a 5-field cron expression with standard cron semantics | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| csv-totals | medium | CSV export to per-customer EUR totals, with quoted fields and currency conversion | 1/1 (+1 unscored) | 1/1 (+1 unscored) | 1/1 (+1 unscored) | 1/1 (+1 unscored) | 1/1 (+1 unscored) | 1/1 (+1 unscored) |
| esm-fix | medium | Fix module errors after a half-finished CommonJS to ES modules migration | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| json-config | easy | Repair a broken JSON config so the app starts, without touching code | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| log-summary | medium | Write a CLI that summarizes a combined-format access log as JSON | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| lru-cache | medium | Implement an LRU cache class to a written spec | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| paginate | easy | Fix an off-by-one in 1-based pagination and the page count | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| rename-deprecate | medium | Rename a function across a package and keep a deprecated alias | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| semver | hard | SemVer 2.0.0 validation and precedence, including pre-release edge cases | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| slugify | easy | Implement a URL slug function from a docstring spec | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |

## Runs with an error class other than none

None.
