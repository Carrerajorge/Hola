#!/usr/bin/env bash
set -euo pipefail

echo "==> type-check"
if npm run -s type-check >/dev/null 2>&1; then
  npm run type-check
else
  npm run check
fi

echo "==> unit tests"
npm run test:run

echo "==> build"
npm run build
