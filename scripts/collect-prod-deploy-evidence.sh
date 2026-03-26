#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

BASE_URL="${PRODUCTION_BASE_URL:-https://iliagpt.com}"
EVIDENCE_DIR="${EVIDENCE_DIR:-artifacts/prod-evidence}"
VPS_HOST="${VPS_HOST:-}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/iliagpt_deploy}"
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-10}"
HTTP_TIMEOUT="${HTTP_TIMEOUT:-10}"
EXPECTED_APP_VERSION="${EXPECTED_APP_VERSION:-}"
EXPECTED_APP_SHA="${EXPECTED_APP_SHA:-}"
DEPLOY_STATE_PATH="${DEPLOY_STATE_PATH:-/opt/hola/deploy-state.json}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
NGINX_UPSTREAM_CONF="${NGINX_UPSTREAM_CONF:-/etc/nginx/conf.d/iliagpt-upstream.conf}"

PUBLIC_DIR="${EVIDENCE_DIR}/public"
VPS_DIR="${EVIDENCE_DIR}/vps"
STATUS_TSV="${PUBLIC_DIR}/endpoints.tsv"
TIMESTAMP_UTC="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
SSH_CAPTURE_ENABLED="false"

mkdir -p "${PUBLIC_DIR}" "${VPS_DIR}"
printf 'label\turl\tcode\theaders\tbody\n' > "${STATUS_TSV}"

slugify() {
  printf '%s' "$1" | tr '/: ' '---' | tr -cd 'A-Za-z0-9._-\n'
}

write_skip_note() {
  local file="$1"
  local reason="$2"
  printf '%s\n' "${reason}" > "${file}"
}

capture_public() {
  local label="$1"
  local path="$2"
  local url="${BASE_URL%/}${path}"
  local slug
  slug="$(slugify "${label}")"
  local headers_file="${PUBLIC_DIR}/${slug}.headers.txt"
  local body_file="${PUBLIC_DIR}/${slug}.body.txt"
  local err_file="${PUBLIC_DIR}/${slug}.curl.err.txt"
  local code

  code="$(
    curl -L -sS --max-time "${HTTP_TIMEOUT}" \
      -D "${headers_file}" \
      -o "${body_file}" \
      -w '%{http_code}' \
      "${url}" 2>"${err_file}" || true
  )"

  if [ -z "${code}" ]; then
    code="000"
  fi

  if [ ! -s "${err_file}" ]; then
    rm -f "${err_file}"
  fi

  printf '%s\t%s\t%s\t%s\t%s\n' \
    "${label}" \
    "${url}" \
    "${code}" \
    "$(basename "${headers_file}")" \
    "$(basename "${body_file}")" \
    >> "${STATUS_TSV}"
}

run_ssh_capture() {
  local relative_path="$1"
  local remote_cmd="$2"
  local output_file="${EVIDENCE_DIR}/${relative_path}"

  mkdir -p "$(dirname "${output_file}")"

  if [ "${SSH_CAPTURE_ENABLED}" != "true" ]; then
    write_skip_note "${output_file}" "ssh capture skipped: missing VPS_HOST or unreadable VPS_SSH_KEY"
    return 0
  fi

  if ssh \
    -i "${VPS_SSH_KEY}" \
    -p "${VPS_PORT}" \
    -o BatchMode=yes \
    -o ConnectTimeout="${SSH_CONNECT_TIMEOUT}" \
    -o StrictHostKeyChecking=accept-new \
    -o IdentitiesOnly=yes \
    "${VPS_USER}@${VPS_HOST}" \
    "${remote_cmd}" >"${output_file}" 2>&1; then
    return 0
  fi

  {
    printf '[capture-error] ssh command failed\n'
    printf '[remote-cmd] %s\n' "${remote_cmd}"
  } >> "${output_file}"
  return 0
}

if [ -n "${VPS_HOST}" ] && [ -r "${VPS_SSH_KEY}" ]; then
  SSH_CAPTURE_ENABLED="true"
fi

capture_public "root" "/"
capture_public "health" "/api/health"
capture_public "health-live" "/api/health/live"
capture_public "health-ready" "/api/health/ready"
capture_public "settings-public" "/api/settings/public"
capture_public "session-identity" "/api/session/identity"
capture_public "sw-cleanup" "/sw-cleanup.js"
capture_public "openclaw" "/openclaw"

run_ssh_capture "vps/deploy-state.json" "cat '${DEPLOY_STATE_PATH}' 2>/dev/null || true"
run_ssh_capture "vps/nginx-upstream.conf" "cat '${NGINX_UPSTREAM_CONF}' 2>/dev/null || true"
run_ssh_capture "vps/deploy-log.tail.txt" "tail -n 200 '${DEPLOY_PATH}/deploy.log' 2>/dev/null || true"
run_ssh_capture "vps/docker-ps.txt" "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true"
run_ssh_capture "vps/manual-recovery-service.txt" "if command -v systemctl >/dev/null 2>&1; then systemctl is-active iliagpt-manual.service 2>/dev/null || true; fi"
run_ssh_capture "vps/slot-health.txt" "for port in 5000 5001; do printf '### port=%s\n' \"\$port\"; curl -sS --max-time ${HTTP_TIMEOUT} \"http://127.0.0.1:\${port}/api/health\" 2>/dev/null || true; printf '\n'; done"
run_ssh_capture "vps/container-state.txt" "for name in hola-blue-app hola-green-app hola-blue-worker hola-green-worker hola-blue-sandbox hola-green-sandbox hola-ocr hola-postgres hola-redis; do printf '### %s\n' \"\$name\"; docker inspect --format '{{json .State}}' \"\$name\" 2>/dev/null || echo missing; done"

python3 - <<'PY' \
  "${STATUS_TSV}" \
  "${PUBLIC_DIR}/health.body.txt" \
  "${VPS_DIR}/deploy-state.json" \
  "${EVIDENCE_DIR}/summary.md" \
  "${EVIDENCE_DIR}/metadata.json" \
  "${TIMESTAMP_UTC}" \
  "${BASE_URL}" \
  "${EXPECTED_APP_VERSION}" \
  "${EXPECTED_APP_SHA}" \
  "${SSH_CAPTURE_ENABLED}" \
  "${VPS_HOST}" \
  "${VPS_PORT}"
import json
import os
import sys
from pathlib import Path

status_tsv = Path(sys.argv[1])
health_body = Path(sys.argv[2])
deploy_state = Path(sys.argv[3])
summary_md = Path(sys.argv[4])
metadata_json = Path(sys.argv[5])
timestamp_utc = sys.argv[6]
base_url = sys.argv[7]
expected_version = sys.argv[8]
expected_sha = sys.argv[9]
ssh_capture_enabled = sys.argv[10] == "true"
vps_host = sys.argv[11]
vps_port = sys.argv[12]

endpoint_rows = []
with status_tsv.open("r", encoding="utf-8") as fh:
    next(fh, None)
    for raw in fh:
        raw = raw.rstrip("\n")
        if not raw:
            continue
        label, url, code, headers, body = raw.split("\t")
        endpoint_rows.append(
            {
                "label": label,
                "url": url,
                "code": code,
                "headers_file": headers,
                "body_file": body,
            }
        )

health_payload = {}
try:
    health_payload = json.loads(health_body.read_text(encoding="utf-8"))
except Exception:
    health_payload = {}

state_payload = {}
try:
    state_payload = json.loads(deploy_state.read_text(encoding="utf-8"))
except Exception:
    state_payload = {}

metadata = {
    "captured_at_utc": timestamp_utc,
    "base_url": base_url,
    "expected_app_version": expected_version or None,
    "expected_app_sha": expected_sha or None,
    "ssh_capture_enabled": ssh_capture_enabled,
    "vps_host": vps_host or None,
    "vps_port": vps_port or None,
    "public_endpoints": endpoint_rows,
    "public_health": health_payload,
    "deploy_state": state_payload,
}
metadata_json.write_text(json.dumps(metadata, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

endpoint_lookup = {row["label"]: row for row in endpoint_rows}
lines = [
    "## Production Evidence Bundle",
    "",
    f"- Captured at: `{timestamp_utc}`",
    f"- Base URL: `{base_url}`",
    f"- Expected version: `{expected_version or 'n/a'}`",
    f"- Expected SHA: `{expected_sha or 'n/a'}`",
    f"- Public app version: `{health_payload.get('app_version') or health_payload.get('version') or 'unknown'}`",
    f"- Public app SHA: `{health_payload.get('app_sha') or 'unknown'}`",
    f"- SSH snapshot: `{'enabled' if ssh_capture_enabled else 'skipped'}`",
]
if state_payload:
    lines.extend(
        [
            f"- Active slot: `{state_payload.get('active_slot', 'unknown')}`",
            f"- Active port: `{state_payload.get('active_port', 'unknown')}`",
            f"- State app version: `{state_payload.get('app_version', 'unknown')}`",
            f"- State image tag: `{state_payload.get('image_tag', 'unknown')}`",
        ]
    )
elif vps_host:
    lines.append("- Active slot: `unknown (deploy-state unavailable)`")

lines.extend(
    [
        "",
        "| Endpoint | HTTP |",
        "|---|---|",
    ]
)
for label in ("root", "health", "health-live", "health-ready", "settings-public", "session-identity", "openclaw"):
    row = endpoint_lookup.get(label)
    if row:
      lines.append(f"| `{label}` | `{row['code']}` |")

lines.extend(
    [
        "",
        "Artifacts:",
        "- `public/*.body.txt` and `public/*.headers.txt` contain the captured public responses.",
        "- `vps/deploy-state.json`, `vps/nginx-upstream.conf`, `vps/docker-ps.txt`, and `vps/deploy-log.tail.txt` capture the runtime snapshot when SSH is available.",
    ]
)
summary_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

printf 'Production evidence bundle written to %s\n' "${EVIDENCE_DIR}"
