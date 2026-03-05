#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ECOSYSTEM_DIR="$ROOT_DIR/external/agent_ecosystem"
REPOS_LIST="$ECOSYSTEM_DIR/repos.list"

if [[ ! -f "$REPOS_LIST" ]]; then
  echo "[agent-ecosystem] repos.list not found: $REPOS_LIST" >&2
  exit 1
fi

updated=0
skipped=0
missing=0
failed=0

while IFS='|' read -r name _url; do
  [[ -z "${name:-}" ]] && continue
  repo_dir="$ECOSYSTEM_DIR/$name"
  if [[ ! -d "$repo_dir/.git" ]]; then
    echo "[MISS] $name (run ecosystem:clone first)"
    missing=$((missing + 1))
    continue
  fi

  echo "[SYNC] $name"
  if git -C "$repo_dir" pull --ff-only --autostash; then
    updated=$((updated + 1))
  else
    echo "[FAIL] $name" >&2
    failed=$((failed + 1))
  fi
done < "$REPOS_LIST"

echo "[agent-ecosystem] sync finished: updated=$updated missing=$missing failed=$failed skipped=$skipped"

if [[ "$failed" -gt 0 ]]; then
  exit 2
fi
