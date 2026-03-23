import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5050';
const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? 'npm run dev:test-web';
const reuseExistingServer =
  process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER != null
    ? process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === 'true'
    : !process.env.CI;
const webServerTimeout = Number(process.env.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS ?? 120_000);

export default defineConfig({
  testDir: './e2e',
  testIgnore: process.env.CI
    ? [
        '**/production-rigorous.spec.ts',
        '**/restaurantReservation.spec.ts',
      ]
    : [],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer,
    timeout: webServerTimeout,
  },
});
