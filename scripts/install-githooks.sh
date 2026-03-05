#!/usr/bin/env bash
set -euo pipefail
git config core.hooksPath .githooks
echo "OK: githooks instalados (pre-push ejecuta ./scripts/agent-verify.sh)"
