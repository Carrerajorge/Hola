#!/usr/bin/env bash
set -euo pipefail

echo "[DEPRECATED] This setup script uses an old non-canonical path/flow and is disabled."
echo "Use the maintained setup script instead:"
echo "  ssh -i ~/.ssh/iliagpt_deploy -p 8022 root@69.62.98.126 'bash -s' < scripts/vps-setup.sh"
exit 1
