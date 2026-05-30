import { expect, test } from "@playwright/test";

test("a single submit triggers one stream and one assistant reply", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("iliagpt_welcomed", "true");
  });

  let savedMessageCalls = 0;
  let streamCalls = 0;
  const persistedRoles: string[] = [];

  await page.route("**/api/chats", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/chats/*/messages", async (route) => {
    savedMessageCalls += 1;

    let payload: Record<string, unknown> = {};
    try {
      payload = route.request().postDataJSON();
    } catch {
      payload = {};
    }

    const role = typeof payload.role === "string" ? payload.role : "unknown";
    persistedRoles.push(role);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          id: `server-message-${savedMessageCalls}`,
        },
      }),
    });
  });

  await page.route("**/api/chat/stream", async (route) => {
    streamCalls += 1;

    let payload: Record<string, unknown> = {};
    try {
      payload = route.request().postDataJSON();
    } catch {
      payload = {};
    }

    const conversationId =
      typeof payload.conversationId === "string" && payload.conversationId.trim().length > 0
        ? payload.conversationId
        : "chat_test_single_stream";
    const requestId =
      typeof payload.requestId === "string" && payload.requestId.trim().length > 0
        ? payload.requestId
        : "req_test_single_stream";

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `event: thinking`,
        `data: ${JSON.stringify({ conversationId, requestId, step: "processing", message: "Procesando tu mensaje" })}`,
        "",
        `event: chunk`,
        `data: ${JSON.stringify({ conversationId, requestId, content: "Respuesta unica de prueba." })}`,
        "",
        `event: done`,
        `data: ${JSON.stringify({ conversationId, requestId })}`,
        "",
      ].join("\n"),
    });
  });

  await page.goto("/");

  const input = page.getByLabel("Message input");
  await expect(input).toBeVisible({ timeout: 20_000 });

  await input.fill("hola");
  await page.getByTestId("button-send-message").click();

  await expect(page.getByText("Respuesta unica de prueba.", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Respuesta unica de prueba.", { exact: true })).toHaveCount(1);
  await expect(page.locator('[data-testid^="message-actions-"]')).toHaveCount(1);

  expect(streamCalls).toBe(1);
  expect(savedMessageCalls).toBe(2);
  expect(persistedRoles).toEqual(["user", "assistant"]);
});
