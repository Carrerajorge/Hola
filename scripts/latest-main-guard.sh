#!/usr/bin/env bash

set -euo pipefail

current_sha="${CURRENT_SHA:-}"
target_branch="${TARGET_BRANCH:-main}"
repo="${GH_REPO:-${GITHUB_REPOSITORY:-}}"
guard_context="${GUARD_CONTEXT:-latest-main-guard}"
max_retries="${MAX_RETRIES:-6}"
retry_sleep_seconds="${RETRY_SLEEP_SECONDS:-5}"
fail_on_lookup_error="${FAIL_ON_LOOKUP_ERROR:-false}"

resolve_latest_sha() {
  local api_url="https://api.github.com/repos/${repo}/git/ref/heads/${target_branch}"
  local response=""

  if [ -n "${GH_TOKEN:-}" ]; then
    response="$(curl -fsSL \
      -H "Authorization: Bearer ${GH_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      "${api_url}" 2>/dev/null || true)"
  else
    response="$(curl -fsSL \
      -H "Accept: application/vnd.github+json" \
      "${api_url}" 2>/dev/null || true)"
  fi

  if [ -z "${response}" ]; then
    return 0
  fi

  printf '%s' "${response}" | python3 -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)

sha = ((payload.get("object") or {}).get("sha") or "").strip()
if sha:
    print(sha)
' 2>/dev/null || true
}

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
  latest_sha="$(resolve_latest_sha)"
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
