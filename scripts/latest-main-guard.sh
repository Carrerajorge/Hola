#!/usr/bin/env bash

set -euo pipefail

current_sha="${CURRENT_SHA:-}"
target_branch="${TARGET_BRANCH:-main}"
repo="${GH_REPO:-${GITHUB_REPOSITORY:-}}"
guard_context="${GUARD_CONTEXT:-latest-main-guard}"
max_retries="${MAX_RETRIES:-6}"
retry_sleep_seconds="${RETRY_SLEEP_SECONDS:-5}"
fail_on_lookup_error="${FAIL_ON_LOOKUP_ERROR:-false}"

write_output() {
  local key="$1"
  local value="$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "${key}" "${value}" >> "${GITHUB_OUTPUT}"
  fi
}

emit_outputs() {
  local should_deploy="$1"
  local latest_sha="$2"
  local skip_reason="$3"

  write_output "is_latest" "${should_deploy}"
  write_output "should_deploy" "${should_deploy}"
  write_output "latest_sha" "${latest_sha}"
  write_output "skip_reason" "${skip_reason}"
}

is_truthy() {
  case "${1:-}" in
    1|[Tt][Rr][Uu][Ee]|[Yy][Ee][Ss]|[Oo][Nn])
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if [ -z "${current_sha}" ]; then
  echo "::error::[${guard_context}] CURRENT_SHA is required."
  exit 1
fi

if [ -z "${repo}" ]; then
  echo "::error::[${guard_context}] GH_REPO or GITHUB_REPOSITORY is required."
  exit 1
fi

latest_sha=""
for attempt in $(seq 1 "${max_retries}"); do
  latest_sha="$(gh api "repos/${repo}/git/ref/heads/${target_branch}" --jq '.object.sha' 2>/dev/null || true)"
  if [ -n "${latest_sha}" ]; then
    break
  fi

  if [ "${attempt}" -lt "${max_retries}" ]; then
    echo "[${guard_context}] Could not resolve latest ${target_branch} SHA yet. Retry ${attempt}/${max_retries}..."
    sleep "${retry_sleep_seconds}"
  fi
done

if [ -z "${latest_sha}" ]; then
  reason="Unable to resolve latest ${target_branch} SHA."
  if is_truthy "${fail_on_lookup_error}"; then
    emit_outputs "false" "" "${reason}"
    echo "::error::[${guard_context}] ${reason}"
    exit 1
  fi

  emit_outputs "true" "" ""
  echo "::warning::[${guard_context}] ${reason} Continuing without stale-run protection."
  exit 0
fi

if [ "${latest_sha}" != "${current_sha}" ]; then
  reason="Superseded by ${latest_sha:0:8}"
  emit_outputs "false" "${latest_sha}" "${reason}"
  echo "::notice::[${guard_context}] Skipping ${current_sha:0:8}; ${target_branch} already advanced to ${latest_sha:0:8}."
  exit 0
fi

emit_outputs "true" "${latest_sha}" ""
echo "[${guard_context}] ${current_sha:0:8} is still the tip of ${target_branch}."
