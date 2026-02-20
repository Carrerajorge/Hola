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
    const cta = page.locator('button', { hasText: /Probar ahora|Comenzar/i }).first();
    await expect(cta).toBeVisible();

    // Verify the login button
    const loginBtn = page.locator('button', { hasText: /Inicia sesión/i }).first();
    await expect(loginBtn).toBeVisible();
  });
});
