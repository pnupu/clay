# Print a readable view of a `claude -p --output-format stream-json` transcript: tool calls, tool results (cut) and text.
import json, sys
for line in open(sys.argv[1]):
    try: m = json.loads(line)
    except Exception: continue
    t = m.get("type")
    if t == "system" and m.get("subtype") == "init":
        print("INIT model", m.get("model"), "| mcp", m.get("mcp_servers"), "| tools", [x for x in m.get("tools", []) if x.startswith("mcp__")])
    elif t == "assistant":
        for c in m["message"]["content"]:
            if c["type"] == "text": print("\nASSISTANT:", c["text"])
            elif c["type"] == "tool_use": print("\nTOOL CALL", c["name"], json.dumps(c["input"], indent=1))
    elif t == "user":
        for c in m["message"]["content"]:
            if isinstance(c, dict) and c.get("type") == "tool_result":
                body = c["content"] if isinstance(c["content"], str) else " ".join(x.get("text", "") for x in c["content"])
                print("\nTOOL RESULT", "(error)" if c.get("is_error") else "", body[: int(sys.argv[2]) if len(sys.argv) > 2 else 1500])
    elif t == "result":
        print("\nRESULT", m.get("subtype"), "turns", m.get("num_turns"), "cost_usd", m.get("total_cost_usd"), "duration_ms", m.get("duration_ms"))
