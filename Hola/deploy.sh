#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] This script targets an old non-canonical deploy flow and is disabled."
echo "Use the canonical production flow instead:"
echo "  gh workflow run deploy.yml -f skip_ci=true"
echo "or"
echo "  bash scripts/deploy-prod.sh"
exit 1
