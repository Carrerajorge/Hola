cat > scripts/agent-pr.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

TITLE="${1:-"chore: update"}"
BODY="${2:-"Automated changes by agent."}"

# Crea PR desde branch actual hacia main
gh pr create --title "$TITLE" --body "$BODY" --base main
EOF

chmod +x scripts/agent-pr.sh
