#!/usr/bin/env bash
# Exploration helper: one Context.dev call, logged (method, path, status, latency) to run/requests.jsonl.
# Usage: scripts/cd.sh METHOD PATH [json-body-file] > response.json
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.local; set +a
M=$1; P=$2; B=${3:-}
args=(-sS -X "$M" "https://api.context.dev/v1$P" -H "Authorization: Bearer $CONTEXT_DEV_API_KEY" -m 120 -o /dev/stdout -w '\n%{http_code} %{time_total}')
[ -n "$B" ] && args+=(-H 'Content-Type: application/json' --data-binary "@$B")
out=$(curl "${args[@]}")
meta=$(printf '%s' "$out" | tail -n1)
printf '%s' "$out" | sed '$d'
printf '{"at":"%s","via":"cd.sh","method":"%s","path":"%s","status":%s,"ms":%s}\n' "$(date -u +%FT%TZ)" "$M" "$P" "${meta% *}" "$(awk "BEGIN{print int(${meta#* }*1000)}")" >> run/requests.jsonl
