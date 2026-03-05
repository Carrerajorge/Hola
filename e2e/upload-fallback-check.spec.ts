import { test, expect } from '@playwright/test';
import fs from 'node:fs';

test('upload works when vite proxy target is unavailable', async ({ page }) => {
  const testFile = '/tmp/codex-upload-fallback.docx';
  fs.writeFileSync(testFile, 'hello from fallback test');

  const failed: Array<{ url: string; error: string }> = [];
  page.on('requestfailed', req => {
    failed.push({ url: req.url(), error: req.failure()?.errorText || 'unknown' });
  });

  await page.goto('http://localhost:5051/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const fileInput = page.locator('input[type="file"]').first();
  await expect(fileInput).toBeAttached({ timeout: 20000 });
  await fileInput.setInputFiles(testFile);

  const sendBtn = page.getByTestId('button-send-message');
  await expect(sendBtn).toBeVisible({ timeout: 20000 });
  await expect(sendBtn).toBeEnabled({ timeout: 35000 });

  const errorToastCount = await page.getByText('Error al subir archivo').count();
  console.log('FAILED_REQUESTS', JSON.stringify(failed));
  console.log('ERROR_TOAST_COUNT', errorToastCount);

  await page.screenshot({ path: '/tmp/upload-fallback-check.png', fullPage: true });

  expect(errorToastCount).toBe(0);
});
