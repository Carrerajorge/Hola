import { expect, test, type APIRequestContext } from "@playwright/test";

async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const csrfRes = await request.get("/api/csrf/token?rotate=1");
  expect(csrfRes.status(), "csrf endpoint should return 200").toBe(200);
  const payload = await csrfRes.json();
  const token = String(payload?.csrfToken || "");
  expect(token, "csrf token should be present").toMatch(/^[A-Za-z0-9_-]{22,128}$/);
  return token;
}

async function runWorkflow(
  request: APIRequestContext,
  query: string,
  csrfToken: string,
  expectedIntent: string
): Promise<any> {
  const startRes = await request.post("/api/registry/workflows", {
    data: { query },
    headers: { "x-csrf-token": csrfToken },
  });
  expect(startRes.status(), `workflow start should return 202 for: ${query}`).toBe(202);

  const startPayload = await startRes.json();
  const runId = String(startPayload?.runId || "");
  expect(runId, "runId should exist").toMatch(/^[0-9a-f-]{36}$/i);

  let terminalPayload: any | null = null;
  for (let i = 0; i < 60; i++) {
    const statusRes = await request.get(`/api/registry/workflows/${runId}`);
    expect(statusRes.status()).toBe(200);
    const statusPayload = await statusRes.json();
    const status = String(statusPayload?.data?.status || "");
    if (["completed", "failed", "cancelled", "timeout"].includes(status)) {
      terminalPayload = statusPayload;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  expect(terminalPayload, `workflow should reach terminal status for: ${query}`).toBeTruthy();
  expect(terminalPayload.data.status, `workflow should complete for: ${query}`).toBe("completed");
  expect(terminalPayload.data.intent, `workflow intent mismatch for: ${query}`).toBe(expectedIntent);
  return terminalPayload.data;
}

test("01 home page renders critical marketing shell", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/ILIAGPT/i);
  await expect(page.getByRole("button", { name: /Log in/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign up for free/i }).first()).toBeVisible();
});

test("02 home page shows core navigation actions", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /About us/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Pricing/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Download/i })).toBeVisible();
});

test("03 login page shows auth controls", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Bienvenido a ILIAGPT/i })).toBeVisible();
  await expect(page.getByPlaceholder(/Dirección de correo electrónico/i)).toBeVisible();
  await expect(page.getByPlaceholder(/Contraseña/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Continuar con Google/i })).toBeVisible();
});

test("04 register route currently resolves to not-found screen (expected)", async ({ page }) => {
  await page.goto("/register", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /404 Page Not Found/i })).toBeVisible();
});

test("05 response headers include hardening policies", async ({ page }) => {
  const res = await page.request.get("/");
  expect(res.status()).toBe(200);
  const hsts = res.headers()["strict-transport-security"] || "";
  const csp = res.headers()["content-security-policy"] || "";
  const xfo = res.headers()["x-frame-options"] || "";
  expect(hsts.toLowerCase()).toContain("max-age=");
  expect(csp.toLowerCase()).toContain("default-src");
  expect(xfo.length).toBeGreaterThan(0);
});

test("06 csrf endpoint returns token and cookie contract", async ({ page }) => {
  const csrfRes = await page.request.get("/api/csrf/token?rotate=1");
  expect(csrfRes.status()).toBe(200);
  const payload = await csrfRes.json();
  expect(String(payload?.csrfToken || "")).toMatch(/^[A-Za-z0-9_-]{22,128}$/);
  const setCookie = csrfRes.headers()["set-cookie"] || "";
  expect(setCookie).toContain("XSRF-TOKEN=");
});

test("07 protected endpoints remain protected for anonymous session", async ({ page }) => {
  const usage = await page.request.get("/api/user/usage");
  const metrics = await page.request.get("/metrics");
  expect(usage.status()).toBe(401);
  expect(metrics.status()).toBe(401);
});

test("08 classify-intent works with valid csrf in browser context", async ({ page }) => {
  const csrfToken = await getCsrfToken(page.request);
  const classifyRes = await page.request.post("/api/registry/classify-intent", {
    data: { query: "crea una imagen de un gato" },
    headers: { "x-csrf-token": csrfToken },
  });
  expect(classifyRes.status()).toBe(200);
  const payload = await classifyRes.json();
  expect(payload?.data?.intent).toBe("image_generate");
  expect(payload?.data?.isGenerationIntent).toBe(true);
});

test("09 workflow pdf generation completes and emits artifact", async ({ page }) => {
  const csrfToken = await getCsrfToken(page.request);
  const data = await runWorkflow(
    page.request,
    "crea un pdf de validación en producción",
    csrfToken,
    "pdf_generate"
  );
  expect(Array.isArray(data.artifacts)).toBe(true);
  expect(data.artifacts.length).toBeGreaterThan(0);
  const mimes = data.artifacts.map((a: any) => a.mimeType);
  expect(mimes).toContain("application/pdf");
});

test("10 workflow image generation completes with png artifact", async ({ page }) => {
  const csrfToken = await getCsrfToken(page.request);
  const data = await runWorkflow(
    page.request,
    "crea una imagen futurista de una ciudad inteligente",
    csrfToken,
    "image_generate"
  );
  expect(Array.isArray(data.artifacts)).toBe(true);
  expect(data.artifacts.length).toBeGreaterThan(0);
  const mimes = data.artifacts.map((a: any) => a.mimeType);
  expect(mimes).toContain("image/png");
});
