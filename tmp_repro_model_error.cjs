const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on('console', msg => {
    if (['error','warning'].includes(msg.type())) {
      console.log(`[console:${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    console.log('[pageerror]', err?.stack || err?.message || String(err));
  });

  try {
    await page.goto('http://localhost:5050', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const menu = page.locator('[data-testid="button-gpt-context-menu"]');
    const menuCount = await menu.count();
    console.log('MENU_COUNT', menuCount);
    if (!menuCount) {
      await page.screenshot({ path: '/tmp/repro-no-menu.png', fullPage: true });
      return;
    }

    await menu.first().click({ timeout: 3000 });
    await page.waitForTimeout(300);

    const modeloItem = page.locator('div[role="menuitem"]:has-text("Modelo")').first();
    const modeloCount = await modeloItem.count();
    console.log('MODELO_COUNT', modeloCount);
    if (!modeloCount) {
      await page.screenshot({ path: '/tmp/repro-no-modelo-item.png', fullPage: true });
      return;
    }

    await modeloItem.click({ timeout: 3000 });
    await page.waitForTimeout(500);

    const dialog = page.locator('text=Seleccionar modelo');
    const dialogCount = await dialog.count();
    console.log('DIALOG_COUNT', dialogCount);
    if (!dialogCount) {
      await page.screenshot({ path: '/tmp/repro-no-dialog.png', fullPage: true });
      return;
    }

    const modelButtons = page.locator('div[role="dialog"] button');
    const count = await modelButtons.count();
    console.log('MODEL_BUTTONS', count);
    if (count > 1) {
      await modelButtons.nth(1).click({ timeout: 3000 });
    } else if (count > 0) {
      await modelButtons.first().click({ timeout: 3000 });
    }

    await page.waitForTimeout(1500);

    const sectionError = page.locator('text=Error en esta sección');
    const errCount = await sectionError.count();
    console.log('SECTION_ERROR_COUNT', errCount);
    await page.screenshot({ path: '/tmp/repro-after-model-select.png', fullPage: true });
  } catch (e) {
    console.log('SCRIPT_ERROR', e?.message || e);
    await page.screenshot({ path: '/tmp/repro-script-error.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
