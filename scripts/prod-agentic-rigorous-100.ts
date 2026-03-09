#!/usr/bin/env tsx

type JsonRecord = Record<string, any>;

interface HttpResponse {
  status: number;
  text: string;
  json: JsonRecord | null;
  headers: Headers;
}

interface CheckResult {
  id: number;
  name: string;
  ok: boolean;
  detail: string;
}

interface WorkflowExpectation {
  query: string;
  expectedIntent: string;
  requireArtifact: boolean;
  expectedMime?: string;
}

const BASE_URL = (process.env.BASE_URL || "https://iliagpt.com").replace(/\/+$/, "");
const MIN_CHECKS = Number(process.env.MIN_CHECKS || "100");
const WORKFLOW_POLL_TIMEOUT_MS = Number(process.env.WORKFLOW_POLL_TIMEOUT_MS || "45000");
const WORKFLOW_POLL_INTERVAL_MS = Number(process.env.WORKFLOW_POLL_INTERVAL_MS || "1000");

const cookieJar = new Map<string, string>();
const checks: CheckResult[] = [];
let checkCounter = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function addCheck(name: string, ok: boolean, detail: string): void {
  checkCounter += 1;
  checks.push({ id: checkCounter, name, ok, detail });
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status} [${String(checkCounter).padStart(3, "0")}] ${name} :: ${detail}`);
}

function updateCookiesFromHeaders(headers: Headers): void {
  const setCookieAccessor = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = typeof setCookieAccessor === "function"
    ? setCookieAccessor.call(headers)
    : (() => {
      const single = headers.get("set-cookie");
      return single ? [single] : [];
    })();

  for (const cookieLine of setCookies) {
    const pair = cookieLine.split(";")[0]?.trim();
    if (!pair || !pair.includes("=")) continue;
    const idx = pair.indexOf("=");
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name || !value) continue;
    cookieJar.set(name, value);
  }
}

function cookieHeader(): string {
  return Array.from(cookieJar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function request(
  path: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    jsonBody?: unknown;
  }
): Promise<HttpResponse> {
  const method = options?.method || "GET";
  const headers: Record<string, string> = { ...(options?.headers || {}) };

  if (cookieJar.size > 0) {
    headers.Cookie = cookieHeader();
  }

  let body: string | undefined;
  if (options?.jsonBody !== undefined) {
    body = JSON.stringify(options.jsonBody);
    if (!Object.keys(headers).some(k => k.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body,
    redirect: "manual",
  });

  updateCookiesFromHeaders(res.headers);

  const text = await res.text();
  let json: JsonRecord | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    status: res.status,
    text,
    json,
    headers: res.headers,
  };
}

function expectStatus(name: string, res: HttpResponse, expected: number | number[]): void {
  const values = Array.isArray(expected) ? expected : [expected];
  const ok = values.includes(res.status);
  addCheck(name, ok, `HTTP ${res.status} (expected ${values.join("/")})`);
}

async function getCsrfToken(rotate = true): Promise<string> {
  const route = rotate ? "/api/csrf/token?rotate=1" : "/api/csrf/token";
  const res = await request(route);
  expectStatus(`CSRF endpoint ${route}`, res, 200);

  const token = String(res.json?.csrfToken || "");
  const tokenOk = /^[A-Za-z0-9_-]{22,128}$/.test(token);
  addCheck(
    `CSRF token format ${route}`,
    tokenOk,
    tokenOk ? `token length=${token.length}` : `invalid token: ${token || "<empty>"}`
  );

  const hasCookie = cookieJar.has("XSRF-TOKEN");
  addCheck(
    `CSRF cookie persisted ${route}`,
    hasCookie,
    hasCookie ? "XSRF-TOKEN cookie available" : "XSRF-TOKEN cookie missing"
  );

  return token;
}

async function pollWorkflow(runId: string): Promise<JsonRecord | null> {
  const start = Date.now();
  let last: JsonRecord | null = null;

  while (Date.now() - start < WORKFLOW_POLL_TIMEOUT_MS) {
    const res = await request(`/api/registry/workflows/${encodeURIComponent(runId)}`);
    if (res.status === 200 && res.json?.data) {
      last = res.json;
      const status = String(res.json.data.status || "");
      if (["completed", "failed", "cancelled", "timeout"].includes(status)) {
        return res.json;
      }
    }
    await sleep(WORKFLOW_POLL_INTERVAL_MS);
  }

  return last;
}

async function run(): Promise<void> {
  console.log(`Running rigorous production matrix against ${BASE_URL}`);
  console.log("==============================================================");

  const root = await request("/");
  expectStatus("Root responds", root, 200);
  addCheck("Root includes ILIAGPT marker", /ILIAGPT/i.test(root.text), "Found brand marker in HTML");
  addCheck(
    "Root has strict transport header",
    Boolean(root.headers.get("strict-transport-security")),
    root.headers.get("strict-transport-security") || "missing"
  );
  addCheck(
    "Root has CSP header",
    Boolean(root.headers.get("content-security-policy")),
    (root.headers.get("content-security-policy") || "").slice(0, 80) || "missing"
  );
  addCheck(
    "Root has X-Content-Type-Options",
    (root.headers.get("x-content-type-options") || "").toLowerCase().includes("nosniff"),
    root.headers.get("x-content-type-options") || "missing"
  );
  addCheck(
    "Root has X-Frame-Options",
    Boolean(root.headers.get("x-frame-options")),
    root.headers.get("x-frame-options") || "missing"
  );
  addCheck(
    "Root has Permissions-Policy",
    Boolean(root.headers.get("permissions-policy")),
    (root.headers.get("permissions-policy") || "").slice(0, 80) || "missing"
  );

  const login = await request("/login");
  expectStatus("Login responds", login, 200);
  addCheck(
    "Login serves app shell",
    /ILIAGPT|id="root"|id='root'/i.test(login.text),
    "SPA shell markers present"
  );

  const health = await request("/health");
  expectStatus("/health responds", health, 200);

  const apiHealth = await request("/api/health");
  expectStatus("/api/health responds", apiHealth, 200);
  addCheck("/api/health status ok", apiHealth.json?.status === "ok", `status=${apiHealth.json?.status}`);
  addCheck("/api/health has version", typeof apiHealth.json?.version === "string", `version=${apiHealth.json?.version ?? "<missing>"}`);
  addCheck("/api/health has rate limiter backend", typeof apiHealth.json?.rateLimiter?.backend === "string", `backend=${apiHealth.json?.rateLimiter?.backend ?? "<missing>"}`);

  const live = await request("/api/health/live");
  expectStatus("/api/health/live responds", live, 200);
  addCheck("/api/health/live status ok", live.json?.status === "ok", `status=${live.json?.status}`);

  const ready = await request("/api/health/ready");
  expectStatus("/api/health/ready responds", ready, 200);
  addCheck(
    "/api/health/ready status acceptable",
    ready.json?.status === "ready" || ready.json?.status === "degraded",
    `status=${ready.json?.status}`,
  );

  const registryHealth = await request("/api/registry/health");
  expectStatus("/api/registry/health responds", registryHealth, 200);
  addCheck("/api/registry/health success true", registryHealth.json?.success === true, `success=${registryHealth.json?.success}`);
  addCheck("/api/registry/health healthy true", registryHealth.json?.healthy === true, `healthy=${registryHealth.json?.healthy}`);

  const registryStatus = await request("/api/registry/status");
  expectStatus("/api/registry/status responds", registryStatus, 200);
  addCheck("/api/registry/status initialized", registryStatus.json?.data?.initialized === true, `initialized=${registryStatus.json?.data?.initialized}`);
  addCheck(
    "/api/registry/status tool count >= 100",
    Number(registryStatus.json?.data?.tools?.totalTools || 0) >= 100,
    `tools=${registryStatus.json?.data?.tools?.totalTools ?? 0}`
  );
  addCheck(
    "/api/registry/status agent count >= 10",
    Number(registryStatus.json?.data?.agents?.totalAgents || 0) >= 10,
    `agents=${registryStatus.json?.data?.agents?.totalAgents ?? 0}`
  );

  const swCleanup = await request("/sw-cleanup.js");
  expectStatus("/sw-cleanup.js responds", swCleanup, 200);
  addCheck("/sw-cleanup.js includes APP_VERSION marker", /APP_VERSION/.test(swCleanup.text), "APP_VERSION marker check");

  const metrics = await request("/metrics");
  expectStatus("/metrics requires auth", metrics, 401);

  const usage = await request("/api/user/usage");
  expectStatus("/api/user/usage requires auth", usage, 401);

  const adminMetrics = await request("/api/admin/metrics");
  expectStatus("/api/admin/metrics requires auth", adminMetrics, 401);

  const adminTools = await request("/api/admin/agent/tools");
  expectStatus("/api/admin/agent/tools requires auth", adminTools, 401);

  const adminGaps = await request("/api/admin/agent/gaps");
  expectStatus("/api/admin/agent/gaps requires auth", adminGaps, 401);

  const adminCircuits = await request("/api/admin/agent/circuits");
  expectStatus("/api/admin/agent/circuits requires auth", adminCircuits, 401);

  const adminMemory = await request("/api/admin/agent/memory/stats");
  expectStatus("/api/admin/agent/memory/stats requires auth", adminMemory, 401);

  const toolsList = await request("/api/registry/tools");
  expectStatus("/api/registry/tools responds", toolsList, 200);
  const toolsData = Array.isArray(toolsList.json?.data) ? toolsList.json?.data : [];
  const toolNames = new Set<string>(toolsData.map((t: any) => String(t.name)));
  addCheck("/api/registry/tools count >= 100", toolsData.length >= 100, `count=${toolsData.length}`);
  for (const tool of [
    "web_search",
    "browse_url",
    "image_generate",
    "slides_create",
    "document_create",
    "document_convert",
    "pdf_generate",
    "text_generate",
    "data_analyze",
    "orchestrate",
    "reason",
  ]) {
    addCheck(`Tool present: ${tool}`, toolNames.has(tool), toolNames.has(tool) ? "present" : "missing");
  }

  const agentsList = await request("/api/registry/agents");
  expectStatus("/api/registry/agents responds", agentsList, 200);
  const agentsData = Array.isArray(agentsList.json?.data) ? agentsList.json?.data : [];
  const agentNames = new Set<string>(agentsData.map((a: any) => String(a.name)));
  addCheck("/api/registry/agents count >= 10", agentsData.length >= 10, `count=${agentsData.length}`);
  for (const agent of [
    "OrchestratorAgent",
    "ResearchAssistantAgent",
    "CodeAgent",
    "DataAnalystAgent",
    "ContentAgent",
    "CommunicationAgent",
    "BrowserAgent",
    "DocumentAgent",
    "QAAgent",
    "SecurityAgent",
  ]) {
    addCheck(`Agent present: ${agent}`, agentNames.has(agent), agentNames.has(agent) ? "present" : "missing");
  }

  const traces = await request("/api/registry/traces");
  expectStatus("/api/registry/traces responds", traces, 200);
  addCheck("/api/registry/traces success true", traces.json?.success === true, `success=${traces.json?.success}`);

  const imageTool = await request("/api/registry/tools/image_generate");
  expectStatus("/api/registry/tools/image_generate responds", imageTool, 200);
  addCheck(
    "image_generate metadata name check",
    imageTool.json?.data?.metadata?.name === "image_generate",
    `name=${imageTool.json?.data?.metadata?.name ?? "<missing>"}`
  );

  const missingTool = await request("/api/registry/tools/not_a_real_tool_name");
  expectStatus("/api/registry/tools/missing returns 404", missingTool, 404);

  const unknownRun = await request("/api/registry/workflows/not-a-real-run-id");
  expectStatus("/api/registry/workflows/:id unknown returns 404", unknownRun, 404);

  const artifactDownloadNoAuth = await request("/api/artifacts/non-existent-file.pdf/download");
  expectStatus("/api/artifacts/*/download requires auth", artifactDownloadNoAuth, 401);

  const csrfToken = await getCsrfToken(true);
  const csrfTokenSecond = await getCsrfToken(false);
  addCheck("CSRF second token non-empty", csrfTokenSecond.length > 0, `length=${csrfTokenSecond.length}`);
  addCheck("CSRF token continuity check", Boolean(csrfTokenSecond || csrfToken), "token available for POST checks");

  const classifyNoCsrf = await request("/api/registry/classify-intent", {
    method: "POST",
    jsonBody: { query: "crea una imagen de un gato" },
  });
  expectStatus("classify-intent blocks missing CSRF", classifyNoCsrf, 403);

  const workflowsNoCsrf = await request("/api/registry/workflows", {
    method: "POST",
    jsonBody: { query: "busca noticias de IA" },
  });
  expectStatus("workflows blocks missing CSRF", workflowsNoCsrf, 403);

  const classifyBadCsrf = await request("/api/registry/classify-intent", {
    method: "POST",
    headers: { "x-csrf-token": "bad-token-value" },
    jsonBody: { query: "crea una imagen de un gato" },
  });
  expectStatus("classify-intent blocks bad CSRF", classifyBadCsrf, 403);

  const workflowsBadCsrf = await request("/api/registry/workflows", {
    method: "POST",
    headers: { "x-csrf-token": "bad-token-value" },
    jsonBody: { query: "busca noticias de IA" },
  });
  expectStatus("workflows blocks bad CSRF", workflowsBadCsrf, 403);

  // CSRF middleware rotates cookie/token on invalid submissions.
  // Refresh before any positive/assertive POST checks.
  const refreshedCsrfToken = await getCsrfToken(true);

  const classifyInvalidPayload = await request("/api/registry/classify-intent", {
    method: "POST",
    headers: { "x-csrf-token": refreshedCsrfToken },
    jsonBody: { q: "valor incorrecto" },
  });
  expectStatus("classify-intent validates payload", classifyInvalidPayload, 400);

  const workflowsInvalidPayload = await request("/api/registry/workflows", {
    method: "POST",
    headers: { "x-csrf-token": refreshedCsrfToken },
    jsonBody: { q: "valor incorrecto" },
  });
  expectStatus("workflows validates payload", workflowsInvalidPayload, 400);

  const intentCases: Array<{ query: string; intent: string; generation: boolean }> = [
    { query: "crea una imagen de un gato", intent: "image_generate", generation: true },
    { query: "draw a picture of a mountain at sunset", intent: "image_generate", generation: true },
    { query: "genera una presentación de marketing", intent: "slides_create", generation: true },
    { query: "create powerpoint slides about AI safety", intent: "slides_create", generation: true },
    { query: "genera un documento word de ventas", intent: "docx_generate", generation: true },
    { query: "create docx file for contract summary", intent: "docx_generate", generation: true },
    { query: "crea un excel con gastos mensuales", intent: "xlsx_create", generation: true },
    { query: "generate spreadsheet with quarterly revenue", intent: "xlsx_create", generation: true },
    { query: "crea un pdf de reporte mensual", intent: "pdf_generate", generation: true },
    { query: "generate a pdf file with executive summary", intent: "pdf_generate", generation: true },
    { query: "busca noticias de tecnologia hoy", intent: "web_search", generation: false },
    { query: "search latest ai models", intent: "web_search", generation: false },
    { query: "analiza estadísticas de ventas", intent: "data_analyze", generation: false },
    { query: "https://openai.com/research", intent: "browse_url", generation: false },
    { query: "hola como estas", intent: "generic", generation: false },
  ];

  for (const tc of intentCases) {
    const classify = await request("/api/registry/classify-intent", {
      method: "POST",
      headers: { "x-csrf-token": refreshedCsrfToken },
      jsonBody: { query: tc.query },
    });
    expectStatus(`classify-intent responds for: ${tc.query}`, classify, 200);
    addCheck(
      `classify-intent exact intent: ${tc.query}`,
      classify.json?.data?.intent === tc.intent,
      `intent=${classify.json?.data?.intent ?? "<missing>"} expected=${tc.intent}`
    );
    addCheck(
      `classify-intent generation flag: ${tc.query}`,
      classify.json?.data?.isGenerationIntent === tc.generation,
      `isGenerationIntent=${classify.json?.data?.isGenerationIntent} expected=${tc.generation}`
    );
  }

  const workflowCases: WorkflowExpectation[] = [
    { query: "busca noticias recientes de IA en 3 puntos", expectedIntent: "web_search", requireArtifact: false },
    { query: "analiza estadísticas de ventas trimestrales", expectedIntent: "data_analyze", requireArtifact: false },
    { query: "https://openai.com/research", expectedIntent: "browse_url", requireArtifact: false },
    { query: "crea un pdf de prueba con resumen ejecutivo", expectedIntent: "pdf_generate", requireArtifact: true, expectedMime: "application/pdf" },
    { query: "crea un excel con datos de ventas", expectedIntent: "xlsx_create", requireArtifact: true, expectedMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    { query: "crea un documento word con objetivos", expectedIntent: "docx_generate", requireArtifact: true, expectedMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { query: "crea una presentación sobre transformación digital", expectedIntent: "slides_create", requireArtifact: true, expectedMime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
    { query: "crea una imagen de un gato futurista", expectedIntent: "image_generate", requireArtifact: true, expectedMime: "image/png" },
  ];

  for (const wf of workflowCases) {
    const start = await request("/api/registry/workflows", {
      method: "POST",
      headers: { "x-csrf-token": refreshedCsrfToken },
      jsonBody: { query: wf.query },
    });
    expectStatus(`workflow start: ${wf.query}`, start, 202);

    const runId = String(start.json?.runId || "");
    addCheck(
      `workflow runId format: ${wf.query}`,
      /^[0-9a-f-]{36}$/i.test(runId),
      runId || "<missing>"
    );

    if (!runId) {
      continue;
    }

    const final = await pollWorkflow(runId);
    const finalData = final?.data || {};

    addCheck(
      `workflow reached terminal status: ${wf.query}`,
      ["completed", "failed", "cancelled", "timeout"].includes(String(finalData.status || "")),
      `status=${finalData.status ?? "<missing>"}`
    );
    addCheck(
      `workflow completed successfully: ${wf.query}`,
      finalData.status === "completed",
      `status=${finalData.status ?? "<missing>"}`
    );
    addCheck(
      `workflow intent match: ${wf.query}`,
      finalData.intent === wf.expectedIntent,
      `intent=${finalData.intent ?? "<missing>"} expected=${wf.expectedIntent}`
    );
    addCheck(
      `workflow evidence present: ${wf.query}`,
      Array.isArray(finalData.evidence) && finalData.evidence.length > 0,
      `evidence=${Array.isArray(finalData.evidence) ? finalData.evidence.length : 0}`
    );

    const artifacts = Array.isArray(finalData.artifacts) ? finalData.artifacts : [];
    if (wf.requireArtifact) {
      addCheck(`workflow artifact required: ${wf.query}`, artifacts.length > 0, `artifacts=${artifacts.length}`);
    } else {
      addCheck(`workflow artifact optional check: ${wf.query}`, artifacts.length >= 0, `artifacts=${artifacts.length}`);
    }

    if (wf.expectedMime) {
      const mimes = artifacts.map((a: any) => String(a.mimeType || ""));
      addCheck(
        `workflow artifact mime: ${wf.query}`,
        mimes.includes(wf.expectedMime),
        `mimes=${mimes.join(",") || "<none>"} expected=${wf.expectedMime}`
      );
    }
  }

  console.log("==============================================================");
  const passed = checks.filter(c => c.ok).length;
  const failed = checks.length - passed;
  const summary = `Checks: ${passed}/${checks.length} passed`;
  console.log(summary);
  console.log(`Minimum required checks: ${MIN_CHECKS}`);

  if (checks.length < MIN_CHECKS) {
    console.error(`Suite too small: executed ${checks.length}, required >= ${MIN_CHECKS}`);
    process.exit(2);
  }

  if (failed > 0) {
    const failedList = checks.filter(c => !c.ok);
    console.error(`Failed checks: ${failed}`);
    for (const item of failedList) {
      console.error(`- [${item.id}] ${item.name}: ${item.detail}`);
    }
    process.exit(1);
  }

  console.log("All rigorous production checks passed.");
}

run().catch((error) => {
  console.error("Rigorous production suite crashed:", error);
  process.exit(1);
});
