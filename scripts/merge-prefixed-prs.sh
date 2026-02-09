#!/usr/bin/env bash
set -euo pipefail

# Merge all open PRs whose head branch matches the prefix set.
# Intended for "batch landing" changes from assistant-driven branches.
#
# Requires:
#   gh auth login
#
# Behavior:
# - Merges mergeable PRs (non-draft) via squash merge
# - Deletes remote branches after merge
# - Prints remaining CONFLICTING PRs to resolve manually

PREFIX_REGEX="${PREFIX_REGEX:-^(claude/|work/|fix/|chore/|dependabot/)}"

echo "▸ Finding open PRs matching: ${PREFIX_REGEX}"

mapfile -t PRS < <(
  gh pr list --state open --limit 200 \
    --json number,headRefName,isDraft,mergeable \
    --jq ".[] | select(.isDraft==false) | select(.headRefName|test(\"${PREFIX_REGEX}\")) | select(.mergeable==\"MERGEABLE\") | .number" \
    | sort -n
)

if [ "${#PRS[@]}" -eq 0 ]; then
  echo "✓ No mergeable PRs found"
else
  echo "▸ Mergeable PRs: ${PRS[*]}"
  for n in "${PRS[@]}"; do
    echo "== Merging PR #${n} =="
    if ! gh pr merge "${n}" --squash --delete-branch; then
      echo "!! FAILED PR #${n}"
    fi
  done
fi

echo ""
echo "▸ Remaining prefixed PRs still open (likely conflicts):"
gh pr list --state open --limit 200 \
  --json number,headRefName,title,mergeable,mergeStateStatus,isDraft \
  --jq ".[] | select(.headRefName|test(\"${PREFIX_REGEX}\")) | {number, headRefName, title, isDraft, mergeable, mergeStateStatus}"

