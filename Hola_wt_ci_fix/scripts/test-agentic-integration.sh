#!/usr/bin/env bash
set -euo pipefail

# Runs the agentic API integration tests against a real server instance.
# Usage:
#   scripts/test-agentic-integration.sh
#
# Optional env:
#   AGENTIC_TEST_PORT=5055
#   TEST_API_BASE=http://127.0.0.1:5055   (overrides)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${AGENTIC_TEST_PORT:-5055}"
BASE_URL="${TEST_API_BASE:-http://127.0.0.1:${PORT}}"
READY_URL="${BASE_URL}/api/health/ready"

# Minimal env required by server/config/env.ts (in test mode we can use dummy values).
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
export SESSION_SECRET="${SESSION_SECRET:-test-session-secret}"

echo "=== Agentic Integration Tests ==="
echo "Base URL: ${BASE_URL}"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Best-effort port cleanup (common dev ports collide frequently).
if command -v lsof >/dev/null 2>&1; then
  PID="$(lsof -ti:"${PORT}" 2>/dev/null || true)"
  if [[ -n "$PID" ]]; then
    echo "Killing existing process on port ${PORT} (PID: ${PID})"
    kill -9 "$PID" 2>/dev/null || true
    sleep 1
  fi
fi

echo "Starting server on port ${PORT}..."
node scripts/with-env.cjs NODE_ENV=test PORT="${PORT}" -- tsx server/index.ts &
SERVER_PID="$!"

echo "Waiting for readiness: ${READY_URL}"
for _ in $(seq 1 60); do
  HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${READY_URL}" || true)"
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "503" ]]; then
    echo "Server responded (HTTP ${HTTP_CODE})."
    break
  fi
  sleep 1
done

if [[ "${HTTP_CODE:-}" != "200" && "${HTTP_CODE:-}" != "503" ]]; then
  echo "Server did not become ready in time (last HTTP code: ${HTTP_CODE:-none})."
  exit 1
fi

echo "Running integration tests..."
TEST_API_BASE="${BASE_URL}" npm run -s test:agentic

echo "Integration tests completed."
