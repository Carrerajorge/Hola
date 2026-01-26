
import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/ILIAGPT/);
});

test('login page loads', async ({ page }) => {
  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: /Connect/i })).toBeVisible();
});
