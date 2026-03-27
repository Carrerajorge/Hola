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

interface IntentExpectation {
  query: string;
  expectedIntent: string;
  expectedGeneration: boolean;
}

interface WorkflowExpectation {
  query: string;
  expectedIntent: string;
  expectedArtifactCount: number;
  expectedMime?: string;
}

const BASE_URL = (process.env.BASE_URL || "https://iliagpt.com").replace(/\/+$/, "");
const WORKFLOW_POLL_TIMEOUT_MS = Number(process.env.WORKFLOW_POLL_TIMEOUT_MS || "90000");
const WORKFLOW_POLL_INTERVAL_MS = Number(process.env.WORKFLOW_POLL_INTERVAL_MS || "1000");
const MIN_REQUEST_GAP_MS = Number(process.env.MIN_REQUEST_GAP_MS || "400");
const REQUEST_RETRY_ATTEMPTS = Number(process.env.REQUEST_RETRY_ATTEMPTS || "5");
const REQUEST_RETRY_DELAY_MS = Number(process.env.REQUEST_RETRY_DELAY_MS || "1500");

const cookieJar = new Map<string, string>();
const checks: CheckResult[] = [];
let checkCounter = 0;
let lastRequestStartedAtMs = 0;

const intentCases: IntentExpectation[] = [
  { query: "puedes transcribir", expectedIntent: "generic", expectedGeneration: false },
  { query: "transcribe este audio", expectedIntent: "generic", expectedGeneration: false },
  { query: "hazme un resumen en formato APA", expectedIntent: "generic", expectedGeneration: false },
  { query: "resume este documento", expectedIntent: "generic", expectedGeneration: false },
  { query: "analiza este archivo", expectedIntent: "data_analyze", expectedGeneration: false },
  { query: "crea un powerpoint corto de 2 diapositivas sobre IA", expectedIntent: "slides_create", expectedGeneration: true },
  { query: "genera un documento word sobre ventas", expectedIntent: "docx_generate", expectedGeneration: true },
];

const workflowCases: WorkflowExpectation[] = [
  { query: "puedes transcribir", expectedIntent: "generic", expectedArtifactCount: 0 },
  { query: "hazme un resumen en formato APA", expectedIntent: "generic", expectedArtifactCount: 0 },
  { query: "analiza este archivo", expectedIntent: "data_analyze", expectedArtifactCount: 0 },
  {
    query: "genera un documento word sobre ventas",
    expectedIntent: "docx_generate",
    expectedArtifactCount: 1,
    expectedMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
];

function addCheck(name: string, ok: boolean, detail: string): void {
  checkCounter += 1;
  checks.push({ id: checkCounter, name, ok, detail });
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status} [${String(checkCounter).padStart(2, "0")}] ${name} :: ${detail}`);
}

function updateCookiesFromHeaders(headers: Headers): void {
  const setCookieAccessor = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
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
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function request(
  path: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    jsonBody?: unknown;
  },
): Promise<HttpResponse> {
  const method = options?.method || "GET";
  for (let attempt = 1; attempt <= REQUEST_RETRY_ATTEMPTS; attempt += 1) {
    const headers: Record<string, string> = { ...(options?.headers || {}) };

    if (cookieJar.size > 0) {
      headers.Cookie = cookieHeader();
    }

    let body: string | undefined;
    if (options?.jsonBody !== undefined) {
      body = JSON.stringify(options.jsonBody);
      if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json";
      }
    }

    const now = Date.now();
    const elapsed = now - lastRequestStartedAtMs;
    const delayMs = MIN_REQUEST_GAP_MS - elapsed;
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    lastRequestStartedAtMs = Date.now();

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

    if (res.status !== 429 || attempt === REQUEST_RETRY_ATTEMPTS) {
      return {
        status: res.status,
        text,
        json,
        headers: res.headers,
      };
    }

    const retryAfterHeader = Number(res.headers.get("retry-after") || "0");
    const retryDelayMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader * 1000
      : REQUEST_RETRY_DELAY_MS * attempt;
    console.warn(`Rate limited on ${method} ${path}; retrying in ${retryDelayMs}ms (attempt ${attempt}/${REQUEST_RETRY_ATTEMPTS})`);
    await sleep(retryDelayMs);
  }

  return {
    status: 429,
    text: "",
    json: null,
    headers: new Headers(),
  };
}

function expectStatus(name: string, res: HttpResponse, expected: number | number[]): void {
  const accepted = Array.isArray(expected) ? expected : [expected];
  addCheck(name, accepted.includes(res.status), `HTTP ${res.status} (expected ${accepted.join("/")})`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCsrfToken(): Promise<string> {
  const res = await request("/api/csrf/token?rotate=1");
  expectStatus("csrf endpoint responds", res, 200);

  const token = String(res.json?.csrfToken || "");
  addCheck(
    "csrf token format",
    /^[A-Za-z0-9_-]{22,128}$/.test(token),
    token ? `length=${token.length}` : "<empty>",
  );
  addCheck(
    "csrf cookie persisted",
    cookieJar.has("XSRF-TOKEN"),
    cookieJar.has("XSRF-TOKEN") ? "XSRF-TOKEN available" : "XSRF-TOKEN missing",
  );

  return token;
}

async function pollWorkflow(runId: string): Promise<JsonRecord | null> {
  const start = Date.now();
  let last: JsonRecord | null = null;

  while (Date.now() - start < WORKFLOW_POLL_TIMEOUT_MS) {
    const res = await request(`/api/registry/workflows/${encodeURIComponent(runId)}`);
    if (res.status === 200 && res.json?.data) {
      last = res.json.data;
      const status = String(res.json.data.status || "");
      if (["completed", "failed", "cancelled", "timeout"].includes(status)) {
        return res.json.data;
      }
    }
    await sleep(WORKFLOW_POLL_INTERVAL_MS);
  }

  return last;
}

async function runIntentChecks(csrfToken: string): Promise<void> {
  for (const tc of intentCases) {
    const res = await request("/api/registry/classify-intent", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
      jsonBody: { query: tc.query },
    });

    expectStatus(`classify-intent responds: ${tc.query}`, res, 200);
    addCheck(
      `classify-intent exact intent: ${tc.query}`,
      res.json?.data?.intent === tc.expectedIntent,
      `intent=${res.json?.data?.intent ?? "<missing>"} expected=${tc.expectedIntent}`,
    );
    addCheck(
      `classify-intent generation flag: ${tc.query}`,
      res.json?.data?.isGenerationIntent === tc.expectedGeneration,
      `isGenerationIntent=${res.json?.data?.isGenerationIntent} expected=${tc.expectedGeneration}`,
    );

    await sleep(250);
  }
}

async function runWorkflowChecks(csrfToken: string): Promise<void> {
  for (const tc of workflowCases) {
    const start = await request("/api/registry/workflows", {
      method: "POST",
      headers: { "x-csrf-token": csrfToken },
      jsonBody: { query: tc.query },
    });

    expectStatus(`workflow start: ${tc.query}`, start, 202);
    const runId = String(start.json?.runId || "");
    addCheck(
      `workflow runId format: ${tc.query}`,
      /^[0-9a-f-]{36}$/i.test(runId),
      runId || "<missing>",
    );

    if (!runId) {
      continue;
    }

    const final = await pollWorkflow(runId);
    const status = String(final?.status || "");
    const artifacts = Array.isArray(final?.artifacts) ? final.artifacts : [];
    const mimeTypes = artifacts.map((artifact: any) => String(artifact?.mimeType || ""));
    const artifactCountOk = tc.expectedArtifactCount === 0
      ? artifacts.length === 0
      : artifacts.length >= tc.expectedArtifactCount;

    addCheck(
      `workflow terminal status: ${tc.query}`,
      ["completed", "failed", "cancelled", "timeout"].includes(status),
      `status=${status || "<missing>"}`,
    );
    addCheck(
      `workflow completed successfully: ${tc.query}`,
      status === "completed",
      `status=${status || "<missing>"}`,
    );
    addCheck(
      `workflow intent match: ${tc.query}`,
      final?.intent === tc.expectedIntent,
      `intent=${final?.intent ?? "<missing>"} expected=${tc.expectedIntent}`,
    );
    addCheck(
      `workflow artifact count: ${tc.query}`,
      artifactCountOk,
      tc.expectedArtifactCount === 0
        ? `artifacts=${artifacts.length} expected=0`
        : `artifacts=${artifacts.length} expected>=${tc.expectedArtifactCount}`,
    );

    if (tc.expectedMime) {
      addCheck(
        `workflow artifact mime: ${tc.query}`,
        mimeTypes.includes(tc.expectedMime),
        `mimes=${mimeTypes.join(",") || "<none>"} expected=${tc.expectedMime}`,
      );
    }

    await sleep(500);
  }
}

async function run(): Promise<void> {
  console.log(`Running artifact-safety production regression suite against ${BASE_URL}`);
  console.log("==============================================================");

  const root = await request("/");
  expectStatus("root responds", root, 200);

  const csrfToken = await getCsrfToken();
  await runIntentChecks(csrfToken);
  await runWorkflowChecks(csrfToken);

  console.log("==============================================================");
  const passed = checks.filter((check) => check.ok).length;
  const failed = checks.length - passed;
  console.log(`Checks: ${passed}/${checks.length} passed`);

  if (failed > 0) {
    console.error(`Artifact-safety regressions detected: ${failed}`);
    for (const check of checks.filter((item) => !item.ok)) {
      console.error(`- [${check.id}] ${check.name}: ${check.detail}`);
    }
    process.exit(1);
  }

  console.log("Artifact-safety production regressions passed.");
}

run().catch((error) => {
  console.error("Artifact-safety suite crashed:", error);
  process.exit(1);
});
