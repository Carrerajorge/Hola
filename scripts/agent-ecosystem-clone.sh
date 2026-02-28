#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ECOSYSTEM_DIR="$ROOT_DIR/external/agent_ecosystem"
REPOS_LIST="$ECOSYSTEM_DIR/repos.list"

if [[ ! -f "$REPOS_LIST" ]]; then
  echo "[agent-ecosystem] repos.list not found: $REPOS_LIST" >&2
  exit 1
fi

mkdir -p "$ECOSYSTEM_DIR"

ok=0
fail=0

while IFS='|' read -r name url; do
  [[ -z "${name:-}" ]] && continue
  repo_dir="$ECOSYSTEM_DIR/$name"

  if [[ -d "$repo_dir/.git" ]]; then
    echo "[SKIP] $name already present"
    ok=$((ok + 1))
    continue
  fi

  echo "[CLONE] $name"
  if git clone --depth=1 --filter=blob:none "$url" "$repo_dir"; then
    ok=$((ok + 1))
  else
    echo "[FAIL] $name ($url)" >&2
    fail=$((fail + 1))
  fi
done < "$REPOS_LIST"

echo "[agent-ecosystem] clone finished: ok=$ok fail=$fail"

if [[ "$fail" -gt 0 ]]; then
  exit 2
fi
