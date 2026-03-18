#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

usage() {
  cat <<'EOF' >&2
Usage:
  remote-deploy-lock.sh acquire <host> <port> <user> <ssh_key> <lock_path> <holder_id> [ttl_seconds]
  remote-deploy-lock.sh release <host> <port> <user> <ssh_key> <lock_path> <holder_id>
EOF
  exit 64
}

if [ "$#" -lt 7 ]; then
  usage
fi

ACTION="$1"
HOST="$2"
PORT="$3"
USER_NAME="$4"
SSH_KEY="$5"
LOCK_PATH="$6"
HOLDER_ID="$7"
TTL_SECONDS="${8:-1800}"

ssh_run() {
  ssh \
    -i "${SSH_KEY}" \
    -p "${PORT}" \
    -o StrictHostKeyChecking=accept-new \
    -o BatchMode=yes \
    -o ConnectTimeout=12 \
    "${USER_NAME}@${HOST}" \
    "$@"
}

acquire_lock() {
  local attempt
  for attempt in $(seq 1 90); do
    if ssh_run "bash -s -- $(printf '%q' "${LOCK_PATH}") $(printf '%q' "${HOLDER_ID}") $(printf '%q' "${TTL_SECONDS}")" <<'EOF'
set -euo pipefail
lock_path="$1"
holder_id="$2"
ttl_seconds="$3"
info_path="${lock_path}/info"
now="$(date +%s)"

write_info() {
  mkdir -p "${lock_path}"
  cat > "${info_path}" <<INFO
holder_id=${holder_id}
created_at=${now}
INFO
}

if mkdir "${lock_path}" 2>/dev/null; then
  write_info
  exit 0
fi

existing_holder=""
created_at=""
if [ -f "${info_path}" ]; then
  while IFS='=' read -r key value; do
    case "${key}" in
      holder_id) existing_holder="${value}" ;;
      created_at) created_at="${value}" ;;
    esac
  done < "${info_path}"
fi

if [ -n "${created_at}" ] && [ $(( now - created_at )) -gt "${ttl_seconds}" ]; then
  rm -rf "${lock_path}"
  if mkdir "${lock_path}" 2>/dev/null; then
    write_info
    exit 0
  fi
fi

age="unknown"
if [ -n "${created_at}" ]; then
  age="$(( now - created_at ))"
fi
printf 'busy holder=%s age=%s\n' "${existing_holder:-unknown}" "${age}" >&2
exit 2
EOF
    then
      echo "Acquired remote deploy lock: ${LOCK_PATH}"
      return 0
    fi

    echo "Remote deploy lock busy (${LOCK_PATH}), attempt ${attempt}/90. Waiting 10s..." >&2
    sleep 10
  done

  echo "Timed out acquiring remote deploy lock: ${LOCK_PATH}" >&2
  return 1
}

release_lock() {
  ssh_run "bash -s -- $(printf '%q' "${LOCK_PATH}") $(printf '%q' "${HOLDER_ID}")" <<'EOF'
set -euo pipefail
lock_path="$1"
holder_id="$2"
info_path="${lock_path}/info"

if [ ! -d "${lock_path}" ]; then
  echo "Remote deploy lock already absent: ${lock_path}"
  exit 0
fi

existing_holder=""
if [ -f "${info_path}" ]; then
  existing_holder="$(awk -F= '/^holder_id=/{print $2}' "${info_path}" | tail -n 1)"
fi

if [ -n "${existing_holder}" ] && [ "${existing_holder}" != "${holder_id}" ]; then
  echo "Remote deploy lock held by another run (${existing_holder}); leaving in place." >&2
  exit 0
fi

rm -rf "${lock_path}"
echo "Released remote deploy lock: ${lock_path}"
EOF
}

case "${ACTION}" in
  acquire)
    acquire_lock
    ;;
  release)
    release_lock
    ;;
  *)
    usage
    ;;
esac
