import { test, expect } from '@playwright/test';

test.describe('Chat E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    
    // Wait for the app to load
    await page.waitForLoadState('networkidle');
  });

  test('should display welcome screen', async ({ page }) => {
    // Check for welcome message
    await expect(page.getByText(/en qué puedo ayudarte/i)).toBeVisible();
    
    // Check for input placeholder
    await expect(page.getByPlaceholder(/escribe tu mensaje/i)).toBeVisible();
  });

  test('should send a message', async ({ page }) => {
    // Type a message
    const testMessage = 'Hola, ¿cómo estás?';
    await page.getByPlaceholder(/escribe tu mensaje/i).fill(testMessage);
    
    // Click send button
    await page.getByRole('button', { name: /enviar/i }).click();
    
    // Verify message appears in the chat
    await expect(page.getByText(testMessage)).toBeVisible();
    
    // Wait for AI response (with timeout)
    await expect(page.getByTestId('ai-message')).toBeVisible({ timeout: 30000 });
  });

  test('should handle file attachments', async ({ page }) => {
    // Create a test file
    const fileContent = 'Test file content';
    const fileName = 'test.txt';
    
    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(fileContent),
    });
    
    // Verify file appears in attachments
    await expect(page.getByText(fileName)).toBeVisible();
    
    // Type a message
    await page.getByPlaceholder(/escribe tu mensaje/i).fill('Aquí está mi archivo');
    
    // Send
    await page.getByRole('button', { name: /enviar/i }).click();
    
    // Verify message sent with attachment
    await expect(page.getByText('Aquí está mi archivo')).toBeVisible();
  });

  test('should cancel streaming response', async ({ page }) => {
    // Send a message that will trigger a long response
    await page.getByPlaceholder(/escribe tu mensaje/i).fill('Cuéntame una historia larga');
    await page.getByRole('button', { name: /enviar/i }).click();
    
    // Wait for streaming to start
    await expect(page.getByText(/escribiendo/i)).toBeVisible({ timeout: 5000 });
    
    // Click stop/cancel button
    await page.getByRole('button', { name: /detener/i }).click();
    
    // Verify streaming stopped
    await expect(page.getByText(/escribiendo/i)).not.toBeVisible();
  });

  test('should retry failed message', async ({ page }) => {
    // Simulate network error (can be done via page.route)
    await page.route('**/api/chat/**', (route) => {
      route.abort('failed');
    });
    
    // Try to send a message
    await page.getByPlaceholder(/escribe tu mensaje/i).fill('Mensaje que fallará');
    await page.getByRole('button', { name: /enviar/i }).click();
    
    // Verify error state
    await expect(page.getByText(/error/i)).toBeVisible();
    
    // Unblock network
    await page.unroute('**/api/chat/**');
    
    // Click retry
    await page.getByRole('button', { name: /reintentar/i }).click();
    
    // Verify message sent successfully
    await expect(page.getByText('Mensaje que fallará')).toBeVisible();
  });

  test('should handle keyboard shortcuts', async ({ page }) => {
    // Type a message
    await page.getByPlaceholder(/escribe tu mensaje/i).fill('Mensaje con Enter');
    
    // Press Enter (should submit)
    await page.keyboard.press('Enter');
    
    // Verify message sent
    await expect(page.getByText('Mensaje con Enter')).toBeVisible();
    
    // Type another message
    await page.getByPlaceholder(/escribe tu mensaje/i).fill('Mensaje con Shift+Enter');
    
    // Press Shift+Enter (should add new line, not submit)
    await page.keyboard.press('Shift+Enter');
    
    // Verify message not sent (still in input)
    await expect(page.getByPlaceholder(/escribe tu mensaje/i)).toHaveValue('Mensaje con Shift+Enter\n');
  });

  test('should switch between chats', async ({ page }) => {
    // Create first chat
    await page.getByPlaceholder(/escribe tu mensaje/i).fill('Mensaje en chat 1');
    await page.getByRole('button', { name: /enviar/i }).click();
    
    // Create new chat
    await page.getByRole('button', { name: /nuevo chat/i }).click();
    
    // Verify welcome screen shown for new chat
    await expect(page.getByText(/en qué puedo ayudarte/i)).toBeVisible();
    
    // Send message in new chat
    await page.getByPlaceholder(/escribe tu mensaje/i).fill('Mensaje en chat 2');
    await page.getByRole('button', { name: /enviar/i }).click();
    
    // Verify message in new chat
    await expect(page.getByText('Mensaje en chat 2')).toBeVisible();
    
    // Switch back to first chat
    await page.getByText('Mensaje en chat 1').first().click();
    
    // Verify first chat content
    await expect(page.getByText('Mensaje en chat 1')).toBeVisible();
  });
});
