import { test, expect } from '@playwright/test';

test.describe('Test 1: Page Load and Navigation', () => {
  test('should load the landing page successfully', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);

    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("#root")).toBeVisible({ timeout: 20000 });
  });
  test('should navigate to login page without infinite spinner', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('input-login-email')).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to signup page without infinite spinner', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByTestId('input-signup-email-initial')).toBeVisible({ timeout: 10000 });
  });
});
