#!/usr/bin/env python3
"""Replace machine-specific absolute paths with stable placeholders, for every file the bench commits.

Placeholders:
  <clone>              the repository checkout that ran the bench
  <scratch>            a session scratch directory under the system temp directory
  <tmp>                a TMPDIR of the run (not the shared /tmp, which is not machine-specific)
  <global-agents-md>   the file that ~/.codex/AGENTS.md points to (it can name a private repository)
  <home>               the home directory of the user who ran the bench

Only path text changes: numbers, ids, model names, versions and timings stay as they are, and a JSON
document stays valid JSON because no placeholder holds a quote or a backslash.

Usage: python3 bench/scrub.py <file> ...   rewrites each file in place (prints the files that changed)
"""
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = os.path.realpath(tempfile.gettempdir()).rstrip("/")
REPO = os.path.dirname(HERE)


def _rules():
    home = os.path.expanduser("~")
    agents_md = os.path.realpath(os.path.join(home, ".codex", "AGENTS.md"))
    rules = []
    if os.path.exists(agents_md) and agents_md != os.path.join(home, ".codex", "AGENTS.md"):
        rules.append((re.escape(agents_md), "<global-agents-md>"))
    rules += [
        (re.escape(REPO), "<clone>"),
        # Any bench clone of this or another session: <home>/agent-runs/clay-bench-<stamp>-<id>
        (r"/home/[^/\s\"']+/agent-runs/clay-bench-[0-9TZ]+-[0-9a-f]+", "<clone>"),
        # Claude Code session scratchpads: /tmp/claude-<uid>/<project>/<session>/scratchpad
        (r"/tmp/claude-\d+/[^/\s\"']+/[0-9a-f-]{36}/scratchpad", "<scratch>"),
        (r"/tmp/claude-\d+", "<tmp>"),
        # A TMPDIR of the run's own (not the shared /tmp, whose paths are not machine-specific and include
        # the sandbox's own /tmp).
        *([(re.escape(TMP) + r"(?=/)", "<tmp>")] if TMP not in ("", "/tmp", "/var/tmp") else []),
        # A backslash ends a path: on raw JSON text it starts an escape such as \n, which must stay.
        (re.escape(home) + r"(?=[/\\\s\"'.,;:)\]}]|$)", "<home>"),
        (r"/home/[^/\\\s\"'<>]+(?=[/\\\s\"'.,;:)\]}]|$)", "<home>"),
    ]
    return [(re.compile(p), r) for p, r in rules]


RULES = _rules()


def scrub(text):
    for pat, rep in RULES:
        text = pat.sub(rep, text)
    return text


def scrub_obj(value):
    """scrub() for a JSON-like value: every string inside it, keys included."""
    if isinstance(value, str):
        return scrub(value)
    if isinstance(value, list):
        return [scrub_obj(v) for v in value]
    if isinstance(value, dict):
        return {scrub(k): scrub_obj(v) for k, v in value.items()}
    return value


if __name__ == "__main__":
    for path in sys.argv[1:]:
        if os.path.basename(path) in ("scrub.py", "check-public.py"):  # their patterns would be rewritten
            continue
        old = open(path, encoding="utf-8").read()
        new = scrub(old)
        if new != old:
            open(path, "w", encoding="utf-8").write(new)
            print(path)
