#!/usr/bin/env bash
set -euo pipefail

SPEC_POINT="${1:-}"
SUMMARY="${2:-}"

mkdir -p docs
touch docs/SPEC_PROGRESS.md docs/WORKLOG.md

ts="$(date -u +"%Y-%m-%d %H:%M UTC")"

if [[ -n "$SUMMARY" ]]; then
  {
    echo ""
    echo "## $ts"
    echo "- $SUMMARY"
    [[ -n "$SPEC_POINT" ]] && echo "- Spec: $SPEC_POINT"
  } >> docs/WORKLOG.md
fi

git add docs/SPEC_PROGRESS.md docs/WORKLOG.md || true

if ! git diff --cached --quiet; then
  git commit -m "docs: checkpoint ${SPEC_POINT:-progress}" || true
fi
