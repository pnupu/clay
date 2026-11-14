#!/usr/bin/env bash
# A stand-in for the GitHub CLI, for evals/recheck-workflow.test.ts and for a local proof of connect/github/sorvi-recheck.sh.
# It keeps the issues as GitHub's JSON in $GH_STAND_IN/issues.json (number, state, title, body, labels), answers
# "issue list" by running the caller's own --jq expression over them, and records every call in $GH_STAND_IN/calls.log.
# GH_STAND_IN_FAIL names calls that fail (for example "list" or "create"), to play a broken set-up. It contacts nothing.
set -u
S="${GH_STAND_IN:?set GH_STAND_IN to a directory}"
mkdir -p "$S"
[ -f "$S/issues.json" ] || echo "[]" > "$S/issues.json"
printf 'gh' >> "$S/calls.log"; for a in "$@"; do printf ' [%s]' "$a" >> "$S/calls.log"; done; printf '\n' >> "$S/calls.log"
arg() { local want="$1"; shift; while [ "$#" -gt 1 ]; do [ "$1" = "$want" ] && { printf '%s' "$2"; return; }; shift; done; }
fails() { case " ${GH_STAND_IN_FAIL:-} " in *" $1 "*) echo "gh stand-in: $1 fails" >&2; exit 1 ;; esac; }
save() { mv "$S/issues.tmp" "$S/issues.json"; }
case "${1:-} ${2:-}" in
  "issue list")
    fails list
    state="$(arg --state "$@")"
    jq -r --arg state "${state:-open}" "[.[] | select(\$state == \"all\" or (.state | ascii_downcase) == \$state)] | $(arg --jq "$@")" "$S/issues.json" ;;
  "issue create")
    fails create
    n=$(( $(jq 'length' "$S/issues.json") + 1 ))
    jq --argjson n "$n" --arg title "$(arg --title "$@")" --rawfile body "$(arg --body-file "$@")" '. + [{number: $n, state: "OPEN", title: $title, body: $body}]' "$S/issues.json" > "$S/issues.tmp" && save
    echo "https://github.com/example/repo/issues/$n" ;;
  "issue edit")
    fails edit
    jq --argjson n "$3" --arg title "$(arg --title "$@")" --rawfile body "$(arg --body-file "$@")" 'map(if .number == $n then .title = $title | .body = $body else . end)' "$S/issues.json" > "$S/issues.tmp" && save ;;
  "issue close")
    fails close
    jq --argjson n "$3" 'map(if .number == $n then .state = "CLOSED" else . end)' "$S/issues.json" > "$S/issues.tmp" && save ;;
  "label create") ;;
  *) echo "gh stand-in: unknown call" >&2; exit 2 ;;
esac
exit 0
