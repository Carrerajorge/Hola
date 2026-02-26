import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://localhost:5000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: "bash -lc 'set -a; source .env.localtest; set +a; NODE_ENV=production PORT=5000 node --import tsx server/index.ts'",
    url: 'http://localhost:5000',
    reuseExistingServer: true,
    timeout: 300 * 1000,
  },
});
