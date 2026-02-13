#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] This script targets the legacy PM2 stack (/var/www/michat) and is disabled."
echo "Use the canonical Docker deploy flow instead:"
echo "  bash scripts/deploy-prod.sh"
echo "For incident recovery, follow:"
echo "  OPS-DEPLOY-CHECKLIST.md"
exit 1
