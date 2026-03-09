#!/usr/bin/env bash
set -Eeuo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/deploy-bluegreen.sh" "$@"
