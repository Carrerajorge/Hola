#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

BASE_URL="${PRODUCTION_BASE_URL:-https://iliagpt.com}"
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
POSTGRES_DB="${POSTGRES_DB:-iliagpt}"

if [ -z "$VPS_HOST" ]; then
  echo "VPS_HOST is required (example: VPS_HOST=100.93.79.71)."
  exit 1
fi

for cmd in curl ssh grep awk python3 node; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
done

if [ ! -r "$VPS_SSH_KEY" ]; then
  echo "VPS_SSH_KEY not readable: $VPS_SSH_KEY"
  exit 1
fi

if ! printf '%s' "$BASE_URL" | grep -Eq '^https?://'; then
  echo "Invalid BASE_URL: $BASE_URL"
  exit 1
fi

if [ ! "$HTTP_TIMEOUT" -ge 1 ] 2>/dev/null; then
  echo "HTTP_TIMEOUT must be an integer >= 1"
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/prod-rigorous-checks.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAILED=0
PASS_COUNT=0
TOTAL_COUNT=0
ACTIVE_SLOT=""
ACTIVE_PORT=""
STANDBY_PORT=""
STATE_APP_VERSION=""
STATE_APP_TAG=""
STATE_SOURCE="unknown"

SSH_OPTS=(
  -i "$VPS_SSH_KEY"
  -p "$VPS_PORT"
  -o BatchMode=yes
  -o ConnectTimeout="$SSH_CONNECT_TIMEOUT"
  -o StrictHostKeyChecking=accept-new
  -o IdentitiesOnly=yes
)

pass() {
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  PASS_COUNT=$((PASS_COUNT + 1))
  printf 'PASS [%s] %s\n' "$1" "$2"
}

fail() {
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  FAILED=$((FAILED + 1))
  printf 'FAIL [%s] %s\n' "$1" "$2"
}

run_ssh() {
  ssh "${SSH_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" "$@"
}

fetch_url() {
  local id="$1"
  local url="$2"
  local body_file="$TMP_DIR/${id}.out"
  local headers_file="$TMP_DIR/${id}.headers"

  curl -sS --max-time "${HTTP_TIMEOUT}" -D "$headers_file" -o "$body_file" -w '%{http_code}' "$url" || echo "000"
}

check_vps_port_free() {
  local id="$1"
  local port="$2"
  local label="$3"
  local listeners

  listeners="$(
    run_ssh "if command -v ss >/dev/null 2>&1; then ss -ltnp '( sport = :${port} )' 2>/dev/null | tail -n +2; elif command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null | tail -n +2; fi"
  )"

  if [ -z "$listeners" ]; then
    pass "$id" "$label"
    return 0
  fi

  fail "$id" "$label (listeners: ${listeners//$'\n'/'; '})"
  return 1
}

check_service_inactive() {
  local id="$1"
  local service_name="$2"
  local label="$3"
  local status

  status="$(run_ssh "if command -v systemctl >/dev/null 2>&1; then systemctl is-active '${service_name}' 2>/dev/null || true; fi")"
  case "$status" in
    ""|inactive|failed|unknown)
      pass "$id" "$label"
      return 0
      ;;
    *)
      fail "$id" "$label (got: ${status})"
      return 1
      ;;
  esac
}

check_http_code() {
  local id="$1"
  local url="$2"
  local expected="$3"

  local code
  code="$(fetch_url "$id" "$url")"
  if [ "$code" = "$expected" ]; then
    pass "$id" "$url -> HTTP $code"
    return 0
  fi
  fail "$id" "$url -> HTTP $code (expected $expected)"
  return 1
}

check_http_code_set() {
  local id="$1"
  local url="$2"
  shift 2
  local expected=("$@")
  local code
  code="$(fetch_url "$id" "$url")"
  for e in "${expected[@]}"; do
    if [ "$code" = "$e" ]; then
      pass "$id" "$url -> HTTP $code"
      return 0
    fi
  done
  fail "$id" "$url -> HTTP $code (expected one of: ${expected[*]})"
  return 1
}

check_contains() {
  local id="$1"
  local file="$2"
  local needle="$3"
  local label="$4"
  if grep -Fq "$needle" "$file" 2>/dev/null; then
    pass "$id" "$label"
  else
    fail "$id" "$label"
  fi
}

check_not_contains() {
  local id="$1"
  local file="$2"
  local needle="$3"
  local label="$4"
  if grep -Fq "$needle" "$file" 2>/dev/null; then
    fail "$id" "$label"
  else
    pass "$id" "$label"
  fi
}

check_content_type() {
  local id="$1"
  local headers_file="$2"
  local expected_pattern="$3"
  local label="$4"
  local content_type

  content_type="$(grep -Ei '^content-type:' "$headers_file" 2>/dev/null | tail -n 1 | tr -d '\r')"
  if [ -n "$content_type" ] && printf '%s\n' "$content_type" | grep -Eiq "${expected_pattern}"; then
    pass "$id" "$label"
  else
    fail "$id" "$label (got: ${content_type:-<missing>})"
  fi
}

extract_html_resources() {
  local html_file="$1"
  local base_url="$2"
  local output_file="$3"

  python3 - "$html_file" "$base_url" "$output_file" <<'PY'
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
import sys

html_file, base_url, output_file = sys.argv[1:4]
base_url = base_url.rstrip("/") + "/"
base_netloc = urlparse(base_url).netloc

class ResourceParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.resources = []
        self.seen = set()

    def _record(self, kind, value):
        resolved = urljoin(base_url, value)
        parsed = urlparse(resolved)
        if parsed.scheme not in ("http", "https"):
            return
        if parsed.netloc != base_netloc:
            return
        key = (kind, resolved)
        if key in self.seen:
            return
        self.seen.add(key)
        self.resources.append(key)

    def handle_starttag(self, tag, attrs):
        attr_map = {key.lower(): value for key, value in attrs if key}
        tag = tag.lower()
        if tag == "script":
            src = attr_map.get("src")
            if src:
                self._record("script", src)
            return
        if tag != "link":
            return
        href = attr_map.get("href")
        if not href:
            return
        rels = {part.lower() for part in attr_map.get("rel", "").split()}
        if "stylesheet" in rels:
            self._record("stylesheet", href)
        elif "modulepreload" in rels:
            self._record("modulepreload", href)
        elif "manifest" in rels:
            self._record("manifest", href)
        elif "icon" in rels or "apple-touch-icon" in rels:
            self._record("icon", href)

parser = ResourceParser()
with open(html_file, "r", encoding="utf-8", errors="ignore") as handle:
    parser.feed(handle.read())

with open(output_file, "w", encoding="utf-8") as handle:
    for kind, url in parser.resources:
        handle.write(f"{kind}\t{url}\n")
PY
}

load_state_from_vps() {
  local state_raw
  if ! state_raw="$(run_ssh "cat '${DEPLOY_STATE_PATH}' 2>/dev/null || true")"; then
    return 1
  fi
  if [ -z "$state_raw" ]; then
    return 1
  fi

  local parsed
  if ! parsed="$(printf '%s' "$state_raw" | python3 -c 'import json,sys; state=json.loads(sys.stdin.read()); print((state.get("active_slot") or "").strip().lower()); print(str(state.get("active_port","")).strip()); print((state.get("app_version") or "").strip()); print((state.get("image_tag") or "").strip())')"; then
    return 1
  fi

  local lines=()
  while IFS= read -r line; do
    lines+=("$line")
  done <<<"$parsed"

  if [ "${#lines[@]}" -ne 4 ]; then
    return 1
  fi

  local slot="${lines[0]}"
  local port="${lines[1]}"
  local version="${lines[2]}"
  local img="${lines[3]}"

  if [ "$slot" != "blue" ] && [ "$slot" != "green" ]; then
    return 1
  fi
  if [ "$port" != "5000" ] && [ "$port" != "5001" ]; then
    return 1
  fi
  if [ -n "$version" ] && ! echo "$version" | grep -Eq '^[0-9a-f]{8}$'; then
    return 1
  fi
  if [ -n "$img" ] && ! echo "$img" | grep -Eq '^sha-[0-9a-f]{8}$'; then
    return 1
  fi

  ACTIVE_SLOT="$slot"
  ACTIVE_PORT="$port"
  STATE_APP_VERSION="$version"
  STATE_APP_TAG="$img"
  STATE_SOURCE="state-file"
  return 0
}

load_active_slot_fallback() {
  local nginx_port=""
  nginx_port="$(run_ssh "grep -Eo 'server[[:space:]]+127\\.0\\.0\\.1:[0-9]+' '${NGINX_UPSTREAM_CONF}' 2>/dev/null | awk -F: '{print \$NF}' | awk 'NF {print; exit}' || true")"

  if [ "$nginx_port" = "5000" ] || [ "$nginx_port" = "5001" ]; then
    ACTIVE_PORT="$nginx_port"
    ACTIVE_SLOT="$( [ "$ACTIVE_PORT" = "5000" ] && echo blue || echo green )"
    STATE_SOURCE="nginx-upstream"
    return 0
  fi

  for candidate_slot in blue green; do
    local candidate_port
    candidate_port="$( [ "$candidate_slot" = "blue" ] && echo 5000 || echo 5001 )"
    local status
    status="$(run_ssh "docker inspect --format '{{.State.Status}}' hola-${candidate_slot}-app 2>/dev/null || true")"
    if [ "$status" = "running" ]; then
      ACTIVE_SLOT="$candidate_slot"
      ACTIVE_PORT="$candidate_port"
      STATE_SOURCE="running-slot"
      return 0
    fi
  done

  ACTIVE_SLOT="blue"
  ACTIVE_PORT="5000"
  STATE_SOURCE="hardcoded-fallback"
}

determine_active_slot() {
  if load_state_from_vps; then
    echo "Info: using deploy-state.json (${ACTIVE_SLOT}:${ACTIVE_PORT}, version=${STATE_APP_VERSION})"
    return 0
  fi

  load_active_slot_fallback
  echo "Warning: deploy state unavailable; fallback slot detection selected ${ACTIVE_SLOT}:${ACTIVE_PORT} from ${STATE_SOURCE}."
}

check_container_status() {
  local id="$1"
  local container="$2"
  local expected="$3"
  local label="$4"
  local status
  status="$(run_ssh "docker inspect --format '{{.State.Status}}' ${container} 2>/dev/null || true")"
  if [ "$status" = "$expected" ]; then
    pass "$id" "$label"
    return 0
  fi
  fail "$id" "$label (got: ${status:-<not found>})"
  return 1
}

check_container_health() {
  local id="$1"
  local container="$2"
  local label="$3"
  local status
  status="$(run_ssh "docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}NO_HEALTHCHECK{{end}}' ${container} 2>/dev/null || true")"
  if [ "$status" = "healthy" ]; then
    pass "$id" "$label"
    return 0
  fi
  if [ "$status" = "NO_HEALTHCHECK" ]; then
    fail "$id" "$label (no healthcheck configured)"
    return 1
  fi
  fail "$id" "$label (got: ${status:-<not found>})"
  return 1
}

check_psql_query() {
  local id="$1"
  local container="$2"
  local query="$3"
  local label="$4"
  local out
  out="$(run_ssh "docker exec ${container} psql -U postgres -d '${POSTGRES_DB}' -tAc \"${query}\" 2>/dev/null || true")"
  if [ "$out" = "1" ] || [ -n "$out" ]; then
    pass "$id" "$label"
  else
    fail "$id" "$label (got: ${out:-<empty>})"
  fi
}

determine_active_slot
STANDBY_PORT="$( [ "$ACTIVE_PORT" = "5000" ] && echo 5001 || echo 5000 )"

APP_CONTAINER="hola-${ACTIVE_SLOT}-app"
WORKER_CONTAINER="hola-${ACTIVE_SLOT}-worker"
OCR_CONTAINER="hola-ocr"
SANDBOX_CONTAINER="hola-${ACTIVE_SLOT}-sandbox"
PG_CONTAINER="hola-postgres"
REDIS_CONTAINER="hola-redis"

set +e

echo "== External production checks (${BASE_URL}) =="
check_http_code "01" "${BASE_URL}/api/health" "200"
check_contains "02" "$TMP_DIR/01.out" '"status":"ok"' "/api/health returns status ok"

if [ -n "$EXPECTED_APP_VERSION" ]; then
  if grep -Fq "\"version\":\"${EXPECTED_APP_VERSION}\"" "$TMP_DIR/01.out" || grep -Fq "\"app_version\":\"${EXPECTED_APP_VERSION}\"" "$TMP_DIR/01.out"; then
    pass "03" "/api/health version matches expected (${EXPECTED_APP_VERSION})"
  elif [ -n "$STATE_APP_VERSION" ] && [ "$STATE_APP_VERSION" = "$EXPECTED_APP_VERSION" ] && \
       grep -Eq '"(version|app_version)":"build-[^"]+"' "$TMP_DIR/01.out"; then
    pass "03" "/api/health exposes build version while deploy-state matches expected (${EXPECTED_APP_VERSION})"
  else
    fail "03" "/api/health version did not match expected (${EXPECTED_APP_VERSION})"
  fi
else
  check_contains "03" "$TMP_DIR/01.out" '"version":' "/api/health has version field"
fi

check_http_code "04" "${BASE_URL}/api/health/live" "200"
check_contains "05" "$TMP_DIR/04.out" '"status":"ok"' "/api/health/live returns status ok"
check_http_code "06" "${BASE_URL}/api/health/ready" "200"
if grep -Eq '"status":"(ready|degraded)"' "$TMP_DIR/06.out"; then
  pass "07" "/api/health/ready returned an acceptable readiness status"
else
  fail "07" "/api/health/ready returned an acceptable readiness status"
fi
check_http_code "08" "${BASE_URL}/health" "200"
check_http_code "09" "${BASE_URL}/api/registry/health" "200"
check_contains "10" "$TMP_DIR/09.out" '"healthy":true' "/api/registry/health reports healthy"
check_http_code "11" "${BASE_URL}/metrics" "401"
check_http_code "12" "${BASE_URL}/api/user/usage" "401"
check_http_code_set "13" "${BASE_URL}/api/auth/google" "301" "302" "303" "307" "308" "429"
check_http_code "14" "${BASE_URL}/sw-cleanup.js" "200"
check_contains "15" "$TMP_DIR/14.out" "APP_VERSION" "/sw-cleanup.js present"
check_http_code "16" "${BASE_URL}/" "200"
check_content_type "17" "$TMP_DIR/16.headers" 'text/html|application/xhtml\+xml' "/ returns HTML content"
if grep -Eiq '<!doctype html>' "$TMP_DIR/16.out"; then
  pass "18" "/ returns a document shell"
else
  fail "18" "/ returns a document shell"
fi
if grep -Eiq '<title>[^<]*iliagpt' "$TMP_DIR/16.out"; then
  pass "19" "/ includes an IliaGPT page title"
else
  fail "19" "/ includes an IliaGPT page title"
fi
if grep -Eiq '<div[^>]+id=["'"'"']root["'"'"']' "$TMP_DIR/16.out"; then
  pass "20" "/ includes the root mount node"
else
  fail "20" "/ includes the root mount node"
fi
check_not_contains "21" "$TMP_DIR/16.out" "Volvemos enseguida" "/ is not serving the maintenance page"

ROOT_RESOURCES_FILE="$TMP_DIR/root-resources.tsv"
if extract_html_resources "$TMP_DIR/16.out" "${BASE_URL}/" "$ROOT_RESOURCES_FILE" && [ -s "$ROOT_RESOURCES_FILE" ]; then
  pass "22" "/ declares local application resources"
else
  fail "22" "/ declares local application resources"
fi

root_js_url="$(awk -F '\t' '($1 == "script" || $1 == "modulepreload") && $2 ~ /\/assets\/.*\.js([?#].*)?$/ { print $2; exit }' "$ROOT_RESOURCES_FILE" 2>/dev/null)"
if [ -n "$root_js_url" ]; then
  pass "23" "/ declares a bundled JavaScript asset"
  check_http_code "24" "$root_js_url" "200"
  check_content_type "25" "$TMP_DIR/24.headers" 'javascript|ecmascript' "${root_js_url} serves JavaScript content"
else
  fail "23" "/ declares a bundled JavaScript asset"
  fail "24" "Bundled JavaScript asset is reachable"
  fail "25" "Bundled JavaScript asset serves JavaScript content"
fi

root_css_url="$(awk -F '\t' '$1 == "stylesheet" && $2 ~ /\/assets\/.*\.css([?#].*)?$/ { print $2; exit }' "$ROOT_RESOURCES_FILE" 2>/dev/null)"
if [ -n "$root_css_url" ]; then
  pass "26" "/ declares a bundled stylesheet asset"
  check_http_code "27" "$root_css_url" "200"
  check_content_type "28" "$TMP_DIR/27.headers" 'text/css' "${root_css_url} serves CSS content"
else
  fail "26" "/ declares a bundled stylesheet asset"
  fail "27" "Bundled stylesheet asset is reachable"
  fail "28" "Bundled stylesheet asset serves CSS content"
fi

manifest_url="$(awk -F '\t' '$1 == "manifest" { print $2; exit }' "$ROOT_RESOURCES_FILE" 2>/dev/null)"
if [ -n "$manifest_url" ]; then
  check_http_code "29" "$manifest_url" "200"
  check_content_type "30" "$TMP_DIR/29.headers" 'application/manifest\+json|application/json' "${manifest_url} serves manifest JSON"
else
  pass "29" "Web manifest not declared in root HTML"
  pass "30" "Manifest content-type check skipped (manifest not declared)"
fi

icon_url="$(awk -F '\t' '$1 == "icon" { print $2; exit }' "$ROOT_RESOURCES_FILE" 2>/dev/null)"
if [ -n "$icon_url" ]; then
  check_http_code "31" "$icon_url" "200"
  check_content_type "32" "$TMP_DIR/31.headers" 'image/' "${icon_url} serves an image content type"
else
  pass "31" "Favicon not declared in root HTML"
  pass "32" "Favicon content-type check skipped (favicon not declared)"
fi

check_http_code "33" "${BASE_URL}/openclaw" "200"
check_http_code_set "34" "${BASE_URL}/codex" "200" "301" "302" "303" "307" "308"
RUNTIME_CONTRACT_LOG="$(
  node scripts/verify-public-runtime-contract.mjs \
    --base-url "${BASE_URL}" \
    --label "prod-rigorous-checks" \
    --timeout-ms "$((HTTP_TIMEOUT * 1000))" 2>&1
)" && {
  printf '%s\n' "${RUNTIME_CONTRACT_LOG}"
  pass "35" "Public runtime contract verified"
} || {
  printf '%s\n' "${RUNTIME_CONTRACT_LOG}"
  fail "35" "Public runtime contract verification"
}

echo "== VPS runtime checks (${VPS_USER}@${VPS_HOST}) =="
if run_ssh "echo ok >/dev/null"; then
  pass "40" "SSH connectivity to VPS"
else
  fail "40" "SSH connectivity to VPS"
fi

check_container_status "41" "${APP_CONTAINER}" "running" "${APP_CONTAINER} container is running"
check_container_health "42" "${APP_CONTAINER}" "${APP_CONTAINER} health is healthy"
check_container_status "43" "${WORKER_CONTAINER}" "running" "${WORKER_CONTAINER} container is running"
check_container_status "44" "${SANDBOX_CONTAINER}" "running" "${SANDBOX_CONTAINER} container is running"
check_container_status "45" "${OCR_CONTAINER}" "running" "${OCR_CONTAINER} container is running"
check_container_status "46" "${PG_CONTAINER}" "running" "PostgreSQL container is running"
check_container_status "47" "${REDIS_CONTAINER}" "running" "Redis container is running"
check_psql_query "48" "${PG_CONTAINER}" "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users';" "users table exists"

health_local="$(
  run_ssh "curl -fsS --max-time ${HTTP_TIMEOUT} http://127.0.0.1:${ACTIVE_PORT}/api/health 2>/dev/null || true"
)"
if [ -n "$health_local" ]; then
  if echo "$health_local" | grep -Fq '"status":"ok"'; then
    pass "49" "Direct active slot health is ok (${ACTIVE_SLOT}:${ACTIVE_PORT})"
  else
    fail "49" "Direct active slot health is ok (${ACTIVE_SLOT}:${ACTIVE_PORT})"
  fi
  if [ -n "$EXPECTED_APP_VERSION" ] && echo "$health_local" | grep -Fq "\"version\":\"${EXPECTED_APP_VERSION}\""; then
    pass "50" "Direct active slot health version matches expected (${EXPECTED_APP_VERSION})"
  elif [ -n "$STATE_APP_VERSION" ] && [ -n "$EXPECTED_APP_VERSION" ] && [ "$STATE_APP_VERSION" = "$EXPECTED_APP_VERSION" ] && \
       echo "$health_local" | grep -Eq '"version":"build-[^"]+"'; then
    pass "50" "Direct active slot health exposes build version while deploy-state matches expected (${EXPECTED_APP_VERSION})"
  elif [ -n "$STATE_APP_VERSION" ] && echo "$health_local" | grep -Fq "\"version\":\"${STATE_APP_VERSION}\""; then
    pass "50" "Direct active slot health version matches state (${STATE_APP_VERSION})"
  else
    fail "50" "Direct active slot health version check"
  fi
  if [ -n "$EXPECTED_APP_SHA" ]; then
    EXPECTED_APP_SHA_SHORT="${EXPECTED_APP_SHA:0:8}"
    if echo "$health_local" | grep -Fq "\"app_sha\":\"${EXPECTED_APP_SHA}\"" || \
       { [ -n "$EXPECTED_APP_SHA_SHORT" ] && echo "$health_local" | grep -Fq "\"app_sha\":\"${EXPECTED_APP_SHA_SHORT}\""; }; then
      pass "51" "Direct active slot health app_sha matches expected commit (${EXPECTED_APP_SHA_SHORT})"
    else
      fail "51" "Direct active slot health app_sha expected commit ${EXPECTED_APP_SHA_SHORT} (or full SHA)"
    fi
  else
    pass "51" "Direct active slot health app_sha skipped (EXPECTED_APP_SHA not set)"
  fi
else
  fail "49" "Direct active slot health endpoint (http://127.0.0.1:${ACTIVE_PORT}/api/health)"
  fail "50" "Direct active slot health version check"
  fail "51" "Direct active slot health app_sha check"
fi

lock_state="$(run_ssh "if [ ! -f '${DEPLOY_PATH}/.deploy.lock' ]; then echo ABSENT; else lock_pid=\"\$(cat '${DEPLOY_PATH}/.deploy.lock' 2>/dev/null || true)\"; if [ -n \"\$lock_pid\" ] && kill -0 \"\$lock_pid\" 2>/dev/null; then echo ACTIVE:\$lock_pid; else echo STALE:\$lock_pid; fi; fi")"
if [ "${lock_state}" = "ABSENT" ]; then
  pass "52" "No active deploy lock file"
elif printf '%s' "${lock_state}" | grep -Eq '^ACTIVE:'; then
  fail "52" "Deploy lock file still present"
elif printf '%s' "${lock_state}" | grep -Eq '^STALE:'; then
  pass "52" "Deploy lock file is stale (${lock_state})"
else
  fail "52" "Deploy lock status unknown (${lock_state})"
fi

upstream_cfg="$(run_ssh "cat '${NGINX_UPSTREAM_CONF}' 2>/dev/null || true")"
if [ -n "$upstream_cfg" ] && echo "$upstream_cfg" | grep -Fq "server 127.0.0.1:${ACTIVE_PORT};"; then
  pass "53" "Nginx upstream points to active slot port (${ACTIVE_PORT})"
else
  fail "53" "Nginx upstream contains expected active port (${ACTIVE_PORT})"
fi

check_vps_port_free "54" "${STANDBY_PORT}" "Standby slot port ${STANDBY_PORT} is free"
check_service_inactive "55" "iliagpt-manual.service" "Manual recovery service is inactive"

echo "Checks completed: ${PASS_COUNT}/${TOTAL_COUNT} passed"
if [ "${FAILED}" -ne 0 ]; then
  echo "RIGOROUS_CHECKS_FAILED=${FAILED}"
  exit 1
fi

echo "RIGOROUS_CHECKS_PASSED=${PASS_COUNT}"
echo "ACTIVE_SLOT=${ACTIVE_SLOT}"
echo "ACTIVE_PORT=${ACTIVE_PORT}"
echo "STATE_SOURCE=${STATE_SOURCE}"
echo "ACTIVE_STATE_VERSION=${STATE_APP_VERSION:-n/a}"
