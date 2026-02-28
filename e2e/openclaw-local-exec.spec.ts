import { test, expect } from "@playwright/test";

test("chat composer routes strict openclaw prompt to /api/local/exec", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("iliagpt_welcomed", "true");
  });

  let localExecPayload: any = null;
  let localExecCalls = 0;
  let chatStreamCalls = 0;

  await page.route("**/api/local/exec", async (route) => {
    localExecCalls += 1;
    try {
      localExecPayload = route.request().postDataJSON();
    } catch {
      localExecPayload = route.request().postData() || null;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        message: "OpenClaw tool executed: openclaw_clawi_status",
        payload: {
          tool: "openclaw_clawi_status",
          output: {
            repoExists: true,
            skillsCount: 52,
          },
        },
      }),
    });
  });

  await page.route("**/api/chat/stream", async (route) => {
    chatStreamCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: "",
    });
  });

  await page.goto("/");

  const input = page.getByLabel("Message input");
  await expect(input).toBeVisible({ timeout: 20_000 });

  const prompt =
    "Modo auditoria estricto. Si no puedes usar herramientas openclaw_* de verdad, responde exactamente FAIL_NO_OPENCLAW_TOOLS y termina. Tarea obligatoria: ejecuta openclaw_clawi_status y responde JSON.";

  await input.fill(prompt);
  await page.getByTestId("button-send-message").click();

  await expect(page.getByText("OpenClaw tool executed: openclaw_clawi_status")).toBeVisible({ timeout: 20_000 });
  expect(localExecCalls).toBeGreaterThan(0);
  expect(String(localExecPayload?.prompt || "")).toContain("openclaw_clawi_status");
  expect(chatStreamCalls).toBe(0);
});

