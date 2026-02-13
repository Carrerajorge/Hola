#!/usr/bin/env bash
set -euo pipefail

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|y|Y) return 0 ;;
    *) return 1 ;;
  esac
}

echo "==> type-check"
if npm run -s type-check >/dev/null 2>&1; then
  npm run type-check
else
  npm run check
fi

echo "==> unit tests"
if is_truthy "${AGENT_VERIFY_SKIP_TESTS:-${SKIP_TESTS:-}}"; then
  echo "SKIP_TESTS enabled; skipping npm run test:run"
else
  npm run test:run
fi

echo "==> build"
npm run build
