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
    baseURL: 'http://localhost:5050',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev:test-web',
    url: 'http://localhost:5050',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
