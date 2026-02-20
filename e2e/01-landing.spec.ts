import { test, expect } from '@playwright/test';

test.describe('Test 1: Page Load and Navigation', () => {
  test('should load the landing page successfully', async ({ page }) => {
    // Navigate to the base URL
    const response = await page.goto('/');

    // Expect successful response
    expect(response?.status()).toBe(200);

    // Expect the title to have "ILIAGPT" or "IliaGPT"
    await expect(page).toHaveTitle(/ILIAGPT/i);

    // Verify main CTA exists
    const cta = page.getByTestId('button-try-now');
    await expect(cta).toBeVisible();

    // Verify the login button
    const loginBtn = page.getByTestId('button-header-login');
    await expect(loginBtn).toBeVisible();
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
