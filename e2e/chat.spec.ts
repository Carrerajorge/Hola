import { test, expect } from '@playwright/test';

test('guest can send and receive a chat message', async ({ page }) => {
  // Skip the first-visit animation overlay so it doesn't block the composer.
  await page.addInitScript(() => {
    localStorage.setItem('iliagpt_welcomed', 'true');
  });

  await page.goto('/');

  const input = page.getByLabel('Message input');
  await expect(input).toBeVisible({ timeout: 15000 });

  await input.fill('hola');
  await page.getByTestId('button-send-message').click();

  await expect(
    page.locator('.liquid-message-user', { hasText: 'hola' }).first()
  ).toBeVisible({ timeout: 20000 });
});

test('guest can send a chat message with Enter', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('iliagpt_welcomed', 'true');
  });

  await page.goto('/');

  const input = page.getByLabel('Message input');
  await expect(input).toBeVisible({ timeout: 15000 });

  await input.fill('hola enter');
  await input.press('Enter');

  await expect(
    page.locator('.liquid-message-user', { hasText: 'hola enter' }).first()
  ).toBeVisible({ timeout: 20000 });
});
