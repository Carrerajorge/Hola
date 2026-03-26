#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <label> <path> [path...]" >&2
  exit 2
fi

label="$1"
shift

missing=0

echo "[ci-checkout] Verifying ${label} required paths..."
for required_path in "$@"; do
  if [ -e "${required_path}" ]; then
    echo "[ci-checkout] OK ${required_path}"
  else
    echo "::error::${label} missing required path: ${required_path}" >&2
    missing=1
  fi
done

if [ "${missing}" -ne 0 ]; then
  echo "[ci-checkout] ${label} is incomplete." >&2
  exit 1
fi

echo "[ci-checkout] ${label} is complete."
