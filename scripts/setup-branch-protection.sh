#!/usr/bin/env bash

set -euo pipefail

REPO="${REPO:-Carrerajorge/Hola}"
BRANCH="${BRANCH:-main}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required. Install it and run: gh auth login"
  exit 1
fi

echo "Applying branch protection to ${REPO}:${BRANCH}"

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "/repos/${REPO}/branches/${BRANCH}/protection" \
  -F required_status_checks.strict=true \
  -F enforce_admins=true \
  -F required_pull_request_reviews.dismiss_stale_reviews=true \
  -F required_pull_request_reviews.require_code_owner_reviews=false \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  -F block_creations=false \
  -F required_conversation_resolution=true \
  -F lock_branch=false \
  -F allow_fork_syncing=true \
  -f required_status_checks.contexts[]=Lint\ \&\ Typecheck \
  -f required_status_checks.contexts[]=Unit\ Testing

echo
echo "Branch protection updated."
echo "Direct pushes to ${BRANCH} should now be blocked; use feature branch -> PR -> merge."
