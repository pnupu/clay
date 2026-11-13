#!/usr/bin/env bash
# One MCP tool call against the running app, as an agent would send it. Usage: scripts/mcp-call.sh <port> <tool> '<arguments json>'
# Prints the text of the result. `scripts/mcp-call.sh <port>` lists the tools.
set -euo pipefail
body=$([ $# -ge 2 ] && printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$2" "${3:-{\}}" || printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
curl -sS -m 300 "http://127.0.0.1:$1/api/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' ${CLAY_ACCESS_KEY:+-H "Authorization: Bearer $CLAY_ACCESS_KEY"} --data-binary "$body" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin); x=r.get("result",r); print("\n".join(c["text"] for c in x["content"]) if "content" in x else "\n".join(t["name"] for t in x.get("tools",[])) or json.dumps(r)); print("(isError)" if x.get("isError") else "", end="")'
