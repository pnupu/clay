#!/usr/bin/env python3
"""Fail if a file under bench/ holds something that belongs to the machine or the person that ran it.

Checks every tracked file under bench/ and every new file there that git does not ignore (a fresh run's
results before `git add`). A binary file (it holds a NUL byte) skips only the user and host name checks.
Each file is checked for:
  - absolute home or session paths (/home/<user>, /Users/<user>, /root/, <tmp>/claude-<uid>, /run/user/<uid>)
  - the user name and the host name of this machine in a path or address context (<user>@, @<host>, -home-<user>-)
  - the host name anywhere
  - a placeholder path under <home>/ that is not one of the agent CLIs' known config folders
  - key-like strings (Clay agent keys, OpenAI/Anthropic/Clerk/GitHub/Slack/AWS keys, JWTs, private key blocks)

Usage: python3 bench/check-public.py   (exit 0: clean; exit 1: prints each finding as path:line: what)
"""
import getpass
import os
import re
import socket
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
user = re.escape(getpass.getuser())
host = re.escape(socket.gethostname().split(".")[0])
KNOWN_UNDER_HOME = r"\.claude|\.claude\.json|\.codex|\.agents|\.t3|\.t3code|agent-runs"

NAME_CHECKS = {"user name in a path or address", "host name"}  # short names can match random bytes in a binary
CHECKS = [
    ("absolute home path", re.compile(r"/home/[A-Za-z0-9_.-]+|/Users/[A-Za-z0-9_.-]+|/root/")),
    ("session temp path", re.compile(r"/tmp/claude-\d+|/run/user/\d+")),
    ("user name in a path or address", re.compile(rf"(?<![A-Za-z0-9_-]){user}@|-home-{user}-|/{user}/")),
    ("host name", re.compile(rf"(?i)(?<![A-Za-z0-9_-]){host}(?![A-Za-z0-9_-])")),
    ("unknown folder under <home>", re.compile(rf"<home>/(?!(?:{KNOWN_UNDER_HOME})(?:[/\\\s\"'.,;:)\]}}]|$))[^\s\"']+")),
    ("Clay agent key", re.compile(r"\bclay_[A-Za-z0-9_-]{24,}")),
    ("API key", re.compile(r"\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{10,}|pk_(?:live|test)_[A-Za-z0-9]{10,})")),
    ("GitHub or Slack token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,})")),
    ("AWS key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
]


def main():
    # Tracked files, and new files that are not ignored: a fresh run's results before `git add`.
    files = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "bench"], cwd=os.path.dirname(HERE),
                           capture_output=True, text=True, check=True).stdout.split("\0")
    findings = 0
    for rel in filter(None, files):
        if rel == "bench/check-public.py":  # its own patterns are the only matches it may hold
            continue
        path = os.path.join(os.path.dirname(HERE), rel)
        try:
            text = open(path, encoding="utf-8", errors="replace").read()  # a non-UTF-8 byte must not hide a key
        except FileNotFoundError:
            continue
        binary = "\x00" in text
        for n, line in enumerate(text.splitlines(), 1):
            for what, pat in CHECKS:
                if binary and what in NAME_CHECKS:
                    continue
                m = pat.search(line)
                if m:
                    findings += 1
                    print(f"{rel}:{n}: {what}: {m.group(0)[:60]}")
    print(f"{len([f for f in files if f])} files checked (tracked and new), {findings} finding(s)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
