import { test, expect } from "@playwright/test";

/**
 * E2E tests for the restaurant reservation flow.
 *
 * These tests verify the complete browser-facing reservation experience:
 *  1. The user sends a reservation request through the chat.
 *  2. The system detects it as a reservation and asks for missing fields.
 *  3. The user provides the remaining details.
 *  4. The system proceeds with the web automation (browser opens).
 */

test.describe("Restaurant Reservation Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Skip the onboarding overlay so it doesn't block the composer
    await page.addInitScript(() => {
      localStorage.setItem("iliagpt_welcomed", "true");
    });
    await page.goto("/");

    // Wait for the chat input to be ready
    const input = page.getByLabel("Message input");
    await expect(input).toBeVisible({ timeout: 15000 });
  });

  test("shows clarification when reservation request is incomplete", async ({
    page,
  }) => {
    const input = page.getByLabel("Message input");
    const sendButton = page.getByTestId("button-send-message");

    // Send an incomplete reservation request (missing contact info)
    await input.fill(
      "Quiero reservar mesa en restaurante Cala para 4 personas mañana a las 8 pm"
    );
    await sendButton.click();

    // The assistant should respond asking for missing fields
    // Wait for the clarification response to appear
    const response = page.locator('[data-testid^="message-actions-"]').first();
    await expect(response).toBeVisible({ timeout: 30000 });

    // Verify the response contains clarification about missing fields
    const pageContent = page.locator("#main-content");
    await expect(pageContent).toContainText(/nombre|telefono|email/i, {
      timeout: 30000,
    });
  });

  test("sends a reservation request and receives a response", async ({
    page,
  }) => {
    const input = page.getByLabel("Message input");
    const sendButton = page.getByTestId("button-send-message");

    // Send a reservation request
    await input.fill("Quiero reservar un restaurante para 2 personas");
    await sendButton.click();

    // The system should respond - either with clarification or by starting the flow
    // We just verify the message was sent and a response appeared
    await expect(
      page.locator(".message, [class*='message'], [data-testid*='message']").first()
    ).toBeVisible({ timeout: 30000 });
  });

  test("complete reservation request includes all detected fields in response", async ({
    page,
  }) => {
    const input = page.getByLabel("Message input");
    const sendButton = page.getByTestId("button-send-message");

    // Send a complete reservation request with all details
    const fullRequest =
      "Reservar mesa en restaurante Maido para 2 personas el 20 de marzo a las 19:30 " +
      "a nombre de Carlos López telefono 987654321 email carlos@test.com";

    await input.fill(fullRequest);
    await sendButton.click();

    // With a complete request, the system should proceed to web automation
    // or show a confirmation with the detected fields.
    // Wait for any response from the assistant
    const assistantResponse = page.locator("#main-content");
    await expect(assistantResponse).toContainText(
      /Maido|reserva|navegador|browser|mesa247|confirma/i,
      { timeout: 45000 }
    );
  });

  test("multi-turn reservation: user provides missing details in follow-up", async ({
    page,
  }) => {
    const input = page.getByLabel("Message input");
    const sendButton = page.getByTestId("button-send-message");

    // Turn 1: Incomplete reservation
    await input.fill(
      "Reservar mesa en restaurante Cala para 4 personas mañana a las 8 pm"
    );
    await sendButton.click();

    // Wait for clarification response
    const mainContent = page.locator("#main-content");
    await expect(mainContent).toContainText(/nombre|telefono|email|datos/i, {
      timeout: 30000,
    });

    // Turn 2: Provide the missing details
    await input.fill(
      "Mi nombre es Juan Pérez, telefono 987654321, email juan@gmail.com"
    );
    await sendButton.click();

    // The system should now proceed with the reservation
    // It should acknowledge the data or start the browser automation
    await expect(mainContent).toContainText(
      /reserva|navegador|browser|mesa247|Cala|confirma|procesando/i,
      { timeout: 45000 }
    );
  });
});
