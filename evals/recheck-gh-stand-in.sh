#!/usr/bin/env bash
# A stand-in for the GitHub CLI, for evals/recheck-workflow.test.ts and for a local proof of connect/github/clay-recheck.sh.
# It records every call in $GH_STAND_IN/calls.log, keeps the body of each issue in $GH_STAND_IN/issue-<n>.md, and
# remembers which decision has an open issue, so "issue list" answers as GitHub would. It contacts nothing.
set -u
S="${GH_STAND_IN:?set GH_STAND_IN to a directory}"
mkdir -p "$S"
printf 'gh' >> "$S/calls.log"; for a in "$@"; do printf ' [%s]' "$a" >> "$S/calls.log"; done; printf '\n' >> "$S/calls.log"
arg() { local want="$1"; shift; while [ "$#" -gt 1 ]; do [ "$1" = "$want" ] && { printf '%s' "$2"; return; }; shift; done; }
case "${1:-} ${2:-}" in
  "issue list")
    id="$(arg --jq "$@" | grep -o 'clay-decision:[a-z0-9-]*' | head -n 1 | cut -d: -f2)"
    [ -n "$id" ] && [ -f "$S/open-$id" ] && cat "$S/open-$id"
    exit 0 ;;
  "issue create")
    n=$(( $(cat "$S/last" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$S/last"
    cp "$(arg --body-file "$@")" "$S/issue-$n.md"; arg --title "$@" > "$S/issue-$n.title"
    id="$(grep -o 'clay-decision:[a-z0-9-]*' "$S/issue-$n.md" | head -n 1 | cut -d: -f2)"; echo "$n" > "$S/open-$id"
    echo "https://github.com/example/repo/issues/$n" ;;
  "issue edit")
    cp "$(arg --body-file "$@")" "$S/issue-$3.md"; arg --title "$@" > "$S/issue-$3.title" ;;
  "issue close")
    for f in "$S"/open-*; do if [ -f "$f" ] && [ "$(cat "$f")" = "$3" ]; then rm "$f"; fi; done ;;
  "label create") ;;
  *) echo "gh stand-in: unknown call" >&2; exit 2 ;;
esac
exit 0
