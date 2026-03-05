import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  // Capture console messages
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error(`Browser Error:`, msg.text());
    }
  });

  // Capture uncaught page errors
  page.on('pageerror', err => {
    console.error(`Page Error:`, err.message);
  });

  try {
    // Change waitUntil to domcontentloaded to avoid Vite HMR keeping network active
    await page.goto('http://localhost:5050', { waitUntil: 'domcontentloaded' });
    console.log("Navigated to page");

    // Wait for the model selector
    await page.waitForSelector('[data-testid="button-model-selector"] select', { timeout: 15000 });
    console.log("Found model selector");

    // Get the select element and its options
    const select = await page.$('[data-testid="button-model-selector"] select');
    const options = await page.evaluate(el => Array.from(el.querySelectorAll('option')).map(o => o.value), select);
    console.log("Available options:", options);

    // Select a different option to trigger the crash
    if (options.length > 1) {
      // Find the currently selected value
      const currentValue = await page.evaluate(el => el.value, select);
      const newOption = options.find(o => o !== currentValue) || options[1];

      console.log(`Current: ${currentValue}, Selecting new option: ${newOption}`);
      await page.select('[data-testid="button-model-selector"] select', newOption);

      // Wait a bit to let React crash and log errors
      await new Promise(r => setTimeout(r, 3000));
    } else {
      console.log("Not enough options to switch");
    }

  } catch (err) {
    console.error("Test script failed:", err);
  } finally {
    await browser.close();
  }
})();
