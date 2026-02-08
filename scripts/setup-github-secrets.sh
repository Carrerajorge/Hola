#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# ILIAGPT - Setup GitHub Secrets for Auto-Deploy
# Run this from YOUR LOCAL MACHINE (Mac)
# Usage: bash scripts/setup-github-secrets.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO="Carrerajorge/Hola"
VPS_IP="100.93.79.71"

echo "═══════════════════════════════════════════"
echo "  ILIAGPT - GitHub Secrets Setup"
echo "═══════════════════════════════════════════"
echo ""

# ── Step 1: Generate SSH key pair for deployment ──
echo -e "${GREEN}Step 1: Generating SSH deploy key...${NC}"
SSH_KEY_PATH="$HOME/.ssh/iliagpt_deploy"

if [ ! -f "$SSH_KEY_PATH" ]; then
  ssh-keygen -t ed25519 -C "iliagpt-deploy@github-actions" -f "$SSH_KEY_PATH" -N ""
  echo -e "${GREEN}✓ SSH key generated at $SSH_KEY_PATH${NC}"
else
  echo -e "${YELLOW}⚠ Key already exists at $SSH_KEY_PATH${NC}"
fi

# ── Step 2: Copy public key to VPS ──
echo ""
echo -e "${GREEN}Step 2: Copying public key to VPS...${NC}"
echo -e "${YELLOW}You may be asked for your VPS root password.${NC}"
ssh-copy-id -i "$SSH_KEY_PATH.pub" root@$VPS_IP

# ── Step 3: Test SSH connection ──
echo ""
echo -e "${GREEN}Step 3: Testing SSH connection...${NC}"
ssh -i "$SSH_KEY_PATH" -o StrictHostKeyChecking=no root@$VPS_IP "echo '✓ SSH connection successful!'"

# ── Step 4: Add secret to GitHub ──
echo ""
echo -e "${GREEN}Step 4: Adding SSH key to GitHub secrets...${NC}"

if command -v gh &>/dev/null; then
  gh secret set VPS_SSH_KEY --repo "$REPO" < "$SSH_KEY_PATH"
  echo -e "${GREEN}✓ Secret VPS_SSH_KEY added to GitHub repo!${NC}"
else
  echo -e "${YELLOW}⚠ GitHub CLI not found. Install it with: brew install gh${NC}"
  echo ""
  echo "Manual steps:"
  echo "  1. Go to: https://github.com/$REPO/settings/secrets/actions"
  echo "  2. Click 'New repository secret'"
  echo "  3. Name: VPS_SSH_KEY"
  echo "  4. Value: paste the contents of $SSH_KEY_PATH"
  echo ""
  echo "To copy the key to clipboard:"
  echo "  cat $SSH_KEY_PATH | pbcopy"
fi

echo ""
echo "═══════════════════════════════════════════"
echo -e "  ${GREEN}✓ Setup complete!${NC}"
echo "═══════════════════════════════════════════"
echo ""
echo "Now every push to 'main' will auto-deploy to your VPS."
echo ""
echo "To deploy manually:"
echo "  git push origin main"
echo ""
echo "To trigger deploy from GitHub:"
echo "  gh workflow run deploy.yml --repo $REPO"
echo ""
