#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

ATTEMPTS=4
BASE_DELAY_SECONDS=5
MAX_DELAY_SECONDS=45
LABEL="command"
TRANSIENT_ONLY=false

usage() {
  cat <<'EOF'
Usage:
  scripts/ci-retry.sh [options] -- <command> [args...]

Options:
  --attempts <n>         Maximum attempts before failing. Default: 4
  --base-delay <sec>     Initial retry delay in seconds. Default: 5
  --max-delay <sec>      Maximum retry delay in seconds. Default: 45
  --label <text>         Human-readable label for logs. Default: "command"
  --transient-only       Retry only when output matches known transient network/registry errors
  --help                 Show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --attempts)
      ATTEMPTS="${2:?--attempts requires a value}"
      shift 2
      ;;
    --base-delay)
      BASE_DELAY_SECONDS="${2:?--base-delay requires a value}"
      shift 2
      ;;
    --max-delay)
      MAX_DELAY_SECONDS="${2:?--max-delay requires a value}"
      shift 2
      ;;
    --label)
      LABEL="${2:?--label requires a value}"
      shift 2
      ;;
    --transient-only)
      TRANSIENT_ONLY=true
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "::error::Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ "$#" -eq 0 ]; then
  echo "::error::No command provided to scripts/ci-retry.sh" >&2
  usage >&2
  exit 1
fi

if ! [[ "${ATTEMPTS}" =~ ^[0-9]+$ ]] || [ "${ATTEMPTS}" -lt 1 ]; then
  echo "::error::--attempts must be a positive integer" >&2
  exit 1
fi

if ! [[ "${BASE_DELAY_SECONDS}" =~ ^[0-9]+$ ]] || [ "${BASE_DELAY_SECONDS}" -lt 0 ]; then
  echo "::error::--base-delay must be a non-negative integer" >&2
  exit 1
fi

if ! [[ "${MAX_DELAY_SECONDS}" =~ ^[0-9]+$ ]] || [ "${MAX_DELAY_SECONDS}" -lt 0 ]; then
  echo "::error::--max-delay must be a non-negative integer" >&2
  exit 1
fi

CMD=( "$@" )

is_transient_failure() {
  local log_file="$1"

  grep -Eiq \
    'auth\.docker\.io|registry-1\.docker\.io|toomanyrequests|rate exceeded|context deadline exceeded|Client\.Timeout exceeded|TLS handshake timeout|tls handshake timeout|connection reset by peer|temporary failure|i/o timeout|unexpected EOF|500 Internal Server Error|502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout|network is unreachable|no route to host|timed out while awaiting headers|resource temporarily unavailable' \
    "${log_file}"
}

delay_for_attempt() {
  local attempt="$1"
  local delay=$(( BASE_DELAY_SECONDS * (2 ** (attempt - 1)) ))
  if [ "${delay}" -gt "${MAX_DELAY_SECONDS}" ]; then
    delay="${MAX_DELAY_SECONDS}"
  fi
  echo "${delay}"
}

for attempt in $(seq 1 "${ATTEMPTS}"); do
  log_file="$(mktemp "/tmp/ci-retry.${attempt}.XXXXXX.log")"
  echo "[ci-retry] ${LABEL}: attempt ${attempt}/${ATTEMPTS}"

  set +e
  "${CMD[@]}" 2>&1 | tee "${log_file}"
  exit_code="${PIPESTATUS[0]}"
  set -e

  if [ "${exit_code}" -eq 0 ]; then
    echo "[ci-retry] ${LABEL}: success on attempt ${attempt}/${ATTEMPTS}"
    rm -f "${log_file}"
    exit 0
  fi

  if [ "${attempt}" -ge "${ATTEMPTS}" ]; then
    echo "::error::${LABEL} failed after ${ATTEMPTS} attempts."
    rm -f "${log_file}"
    exit "${exit_code}"
  fi

  if [ "${TRANSIENT_ONLY}" = "true" ] && ! is_transient_failure "${log_file}"; then
    echo "::error::${LABEL} failed with a non-retryable error signature."
    rm -f "${log_file}"
    exit "${exit_code}"
  fi

  delay_seconds="$(delay_for_attempt "${attempt}")"
  jitter_seconds=$(( RANDOM % 3 ))
  total_sleep=$(( delay_seconds + jitter_seconds ))
  echo "[ci-retry] ${LABEL}: retrying in ${total_sleep}s..."
  rm -f "${log_file}"
  sleep "${total_sleep}"
done

echo "::error::${LABEL} exhausted retry loop unexpectedly."
exit 1
