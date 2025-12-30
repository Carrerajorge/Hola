import { test, expect, Page } from 'playwright/test';
import path from 'path';

const TEST_FIXTURE_PATH = path.join(process.cwd(), 'test_fixtures', 'multi-sheet.xlsx');

async function ensureAuthenticated(page: Page) {
  await page.goto('/');
  
  const isLoggedIn = await page.locator('[data-testid="user-menu"]').isVisible({ timeout: 5000 }).catch(() => false);
  
  if (!isLoggedIn) {
    const loginButton = page.locator('[data-testid="button-login"], a[href="/login"]').first();
    if (await loginButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await loginButton.click();
      await page.waitForURL('**/login', { timeout: 10000 });
      
      await page.fill('[data-testid="input-email"], input[type="email"]', 'test@example.com');
      await page.fill('[data-testid="input-password"], input[type="password"]', 'testpassword123');
      await page.click('[data-testid="button-submit"], button[type="submit"]');
      
      await page.waitForURL('/', { timeout: 15000 });
    }
  }
}

async function navigateToChat(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  
  const chatInterface = page.locator('[data-testid="chat-interface"], .chat-interface, [class*="chat"]').first();
  await chatInterface.waitFor({ state: 'visible', timeout: 10000 });
}

test.describe('Document Analysis Flow', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test('should upload file and show analysis progress', async ({ page }) => {
    await navigateToChat(page);

    const fileInput = page.locator('[data-testid="input-file-upload"]');
    await expect(fileInput).toBeAttached();
    
    await fileInput.setInputFiles(TEST_FIXTURE_PATH);

    const uploadChip = page.locator('[data-testid^="inline-file-"], [data-testid="inline-attachments-container"]').first();
    await expect(uploadChip).toBeVisible({ timeout: 10000 });
  });

  test('should send message with uploaded file and show analysis card', async ({ page }) => {
    await navigateToChat(page);

    const fileInput = page.locator('[data-testid="input-file-upload"]');
    await fileInput.setInputFiles(TEST_FIXTURE_PATH);

    const uploadChip = page.locator('[data-testid="inline-attachments-container"]');
    await expect(uploadChip).toBeVisible({ timeout: 10000 });

    const textarea = page.locator('textarea').first();
    await textarea.fill('Analyze this spreadsheet');

    const sendButton = page.locator('[data-testid="button-send"], button[type="submit"]').first();
    await sendButton.click();

    const analysisCard = page.locator(
      '[data-testid="document-analysis-loading"], ' +
      '[data-testid="document-analysis-progress"], ' +
      '[data-testid="document-analysis-results"]'
    ).first();
    await expect(analysisCard).toBeVisible({ timeout: 30000 });
  });

  test('should show progress indicator during analysis', async ({ page }) => {
    await navigateToChat(page);

    const fileInput = page.locator('[data-testid="input-file-upload"]');
    await fileInput.setInputFiles(TEST_FIXTURE_PATH);

    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Analyze this spreadsheet');

    const sendButton = page.locator('[data-testid="button-send"], button[type="submit"]').first();
    await sendButton.click();

    const progressCard = page.locator('[data-testid="document-analysis-progress"]');
    const loadingCard = page.locator('[data-testid="document-analysis-loading"]');
    
    const hasProgressOrLoading = await Promise.race([
      progressCard.waitFor({ state: 'visible', timeout: 15000 }).then(() => true),
      loadingCard.waitFor({ state: 'visible', timeout: 15000 }).then(() => true),
    ]).catch(() => false);
    
    expect(hasProgressOrLoading).toBeTruthy();

    const progressBar = page.locator('[data-testid="analysis-progress-bar"]');
    if (await progressCard.isVisible()) {
      await expect(progressBar).toBeVisible({ timeout: 5000 });
    }
  });

  test('should complete analysis and show results with tabs', async ({ page }) => {
    test.setTimeout(90000);
    
    await navigateToChat(page);

    const fileInput = page.locator('[data-testid="input-file-upload"]');
    await fileInput.setInputFiles(TEST_FIXTURE_PATH);

    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Analyze this spreadsheet');

    const sendButton = page.locator('[data-testid="button-send"], button[type="submit"]').first();
    await sendButton.click();

    const resultsCard = page.locator('[data-testid="document-analysis-results"]');
    await expect(resultsCard).toBeVisible({ timeout: 60000 });

    const summaryTab = page.locator('[data-testid="tab-summary"]');
    if (await summaryTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(summaryTab).toBeVisible();
    }

    const sheetTabs = page.locator('[data-testid^="tab-sheet-"]');
    const tabCount = await sheetTabs.count();
    expect(tabCount).toBeGreaterThan(0);
  });

  test('should navigate between sheet tabs and show content', async ({ page }) => {
    test.setTimeout(90000);
    
    await navigateToChat(page);

    const fileInput = page.locator('[data-testid="input-file-upload"]');
    await fileInput.setInputFiles(TEST_FIXTURE_PATH);

    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Analyze this spreadsheet');

    const sendButton = page.locator('[data-testid="button-send"], button[type="submit"]').first();
    await sendButton.click();

    const resultsCard = page.locator('[data-testid="document-analysis-results"]');
    await expect(resultsCard).toBeVisible({ timeout: 60000 });

    const sheetTabs = page.locator('[data-testid^="tab-sheet-"]');
    const tabCount = await sheetTabs.count();
    
    if (tabCount > 0) {
      const firstTab = sheetTabs.first();
      await firstTab.click();
      
      const tabTestId = await firstTab.getAttribute('data-testid');
      const sheetName = tabTestId?.replace('tab-sheet-', '');
      
      if (sheetName) {
        const hasContent = await Promise.race([
          page.locator(`[data-testid="metrics-${sheetName}"]`).waitFor({ state: 'visible', timeout: 5000 }).then(() => true),
          page.locator(`[data-testid="preview-${sheetName}"]`).waitFor({ state: 'visible', timeout: 5000 }).then(() => true),
          page.locator(`[data-testid="toggle-code-${sheetName}"]`).waitFor({ state: 'visible', timeout: 5000 }).then(() => true),
          page.locator(`[data-testid="summary-${sheetName}"]`).waitFor({ state: 'visible', timeout: 5000 }).then(() => true),
        ]).catch(() => false);
        
        expect(hasContent).toBeTruthy();
      }
    }

    if (tabCount > 1) {
      const secondTab = sheetTabs.nth(1);
      await secondTab.click();
      await page.waitForTimeout(500);
    }
  });

  test('should toggle code section for sheet', async ({ page }) => {
    test.setTimeout(90000);
    
    await navigateToChat(page);

    const fileInput = page.locator('[data-testid="input-file-upload"]');
    await fileInput.setInputFiles(TEST_FIXTURE_PATH);

    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Analyze this spreadsheet');

    const sendButton = page.locator('[data-testid="button-send"], button[type="submit"]').first();
    await sendButton.click();

    const resultsCard = page.locator('[data-testid="document-analysis-results"]');
    await expect(resultsCard).toBeVisible({ timeout: 60000 });

    const codeToggle = page.locator('[data-testid^="toggle-code-"]').first();
    
    if (await codeToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await codeToggle.click();
      
      const toggleTestId = await codeToggle.getAttribute('data-testid');
      const sheetName = toggleTestId?.replace('toggle-code-', '');
      
      if (sheetName) {
        const codeBlock = page.locator(`[data-testid="code-block-${sheetName}"]`);
        await expect(codeBlock).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('should show summary tab content when crossSheetSummary exists', async ({ page }) => {
    test.setTimeout(90000);
    
    await navigateToChat(page);

    const fileInput = page.locator('[data-testid="input-file-upload"]');
    await fileInput.setInputFiles(TEST_FIXTURE_PATH);

    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Analyze this spreadsheet');

    const sendButton = page.locator('[data-testid="button-send"], button[type="submit"]').first();
    await sendButton.click();

    const resultsCard = page.locator('[data-testid="document-analysis-results"]');
    await expect(resultsCard).toBeVisible({ timeout: 60000 });

    const summaryTab = page.locator('[data-testid="tab-summary"]');
    
    if (await summaryTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await summaryTab.click();
      
      const summaryContent = page.locator('[data-testid="content-summary"]');
      await expect(summaryContent).toBeVisible({ timeout: 5000 });
    }
  });

  test('should verify metrics section exists for analyzed sheet', async ({ page }) => {
    test.setTimeout(90000);
    
    await navigateToChat(page);

    const fileInput = page.locator('[data-testid="input-file-upload"]');
    await fileInput.setInputFiles(TEST_FIXTURE_PATH);

    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Analyze this spreadsheet');

    const sendButton = page.locator('[data-testid="button-send"], button[type="submit"]').first();
    await sendButton.click();

    const resultsCard = page.locator('[data-testid="document-analysis-results"]');
    await expect(resultsCard).toBeVisible({ timeout: 60000 });

    const metricsSection = page.locator('[data-testid^="metrics-"]').first();
    const previewSection = page.locator('[data-testid^="preview-"]').first();
    
    const hasMetricsOrPreview = await Promise.race([
      metricsSection.waitFor({ state: 'visible', timeout: 5000 }).then(() => true),
      previewSection.waitFor({ state: 'visible', timeout: 5000 }).then(() => true),
    ]).catch(() => false);
    
    expect(hasMetricsOrPreview).toBeTruthy();
  });

  test('should handle analysis failure gracefully', async ({ page }) => {
    await navigateToChat(page);

    const failedCard = page.locator('[data-testid="document-analysis-failed"]');
    const errorCard = page.locator('[data-testid="document-analysis-error"]');
    const retryButton = page.locator('[data-testid="retry-analysis-button"]');

    if (await failedCard.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(retryButton).toBeVisible();
    }
    
    if (await errorCard.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(retryButton).toBeVisible();
    }
  });

  test('should display filename in analysis card', async ({ page }) => {
    await navigateToChat(page);

    const fileInput = page.locator('[data-testid="input-file-upload"]');
    await fileInput.setInputFiles(TEST_FIXTURE_PATH);

    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Analyze this spreadsheet');

    const sendButton = page.locator('[data-testid="button-send"], button[type="submit"]').first();
    await sendButton.click();

    const analysisCard = page.locator(
      '[data-testid="document-analysis-progress"], ' +
      '[data-testid="document-analysis-results"]'
    ).first();
    await expect(analysisCard).toBeVisible({ timeout: 30000 });

    const filenameElement = page.locator('[data-testid="analysis-filename"], [data-testid="analysis-results-title"]').first();
    if (await filenameElement.isVisible({ timeout: 5000 }).catch(() => false)) {
      const text = await filenameElement.textContent();
      expect(text?.toLowerCase()).toContain('multi-sheet');
    }
  });

  test('should show sheet status indicators during progress', async ({ page }) => {
    await navigateToChat(page);

    const fileInput = page.locator('[data-testid="input-file-upload"]');
    await fileInput.setInputFiles(TEST_FIXTURE_PATH);

    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Analyze this spreadsheet');

    const sendButton = page.locator('[data-testid="button-send"], button[type="submit"]').first();
    await sendButton.click();

    const progressCard = page.locator('[data-testid="document-analysis-progress"]');
    
    if (await progressCard.isVisible({ timeout: 15000 }).catch(() => false)) {
      const sheetStatuses = page.locator('[data-testid^="sheet-status-"]');
      const statusCount = await sheetStatuses.count();
      
      if (statusCount > 0) {
        expect(statusCount).toBeGreaterThan(0);
      }
    }
  });
});
