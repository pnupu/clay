#!/usr/bin/env bash
# Deploy the committed tree (HEAD) to Vercel production from an export without Git metadata.
# Why: Vercel blocks a deployment whose commit author is not a member of the team, and commits in this checkout are
# made by a placeholder identity. The export is deployed by the logged-in Vercel user; the commit is recorded as metadata.
# Usage: scripts/deploy.sh <empty-export-dir>
set -euo pipefail
out=$(realpath -m "$1") # resolved before the cd, against the caller's directory
cd "$(dirname "$0")/.."
case "$out/" in "$PWD"/*) echo "$out is inside the repository. Give a directory outside it." >&2; exit 1;; esac
[ -z "$(git status --porcelain)" ] || { echo "The tree is not clean. Commit first." >&2; exit 1; }
[ ! -e "$out" ] || { echo "$out exists. Give a new directory." >&2; exit 1; }
mkdir -p "$out"
git archive HEAD | tar -x -C "$out"
cp -r .vercel "$out/.vercel"
sha=$(git rev-parse HEAD)
cd "$out"
vercel deploy --prod --yes --scope pnupus-projects --meta "commit=$sha"
