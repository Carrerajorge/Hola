import { test, expect, type Page } from '@playwright/test';

const TEST_USER_ID = 'test-user-123';

function createRuntimeErrorTracker(page: Page, options?: { captureConsoleErrors?: boolean }) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const ignoredConsolePatterns = [
    /favicon/i,
    /Failed to load resource: the server responded with a status of 404/i,
  ];

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  if (options?.captureConsoleErrors) {
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (ignoredConsolePatterns.some((pattern) => pattern.test(text))) return;
      consoleErrors.push(text);
    });
  }

  return async () => {
    expect(pageErrors, `Runtime errors detected:\n${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors, `Console errors detected:\n${consoleErrors.join('\n')}`).toEqual([]);
  };
}

async function installAuthenticatedShellMocks(page: Page) {
  let userSettings = {
    userId: TEST_USER_ID,
    responsePreferences: {
      responseStyle: 'default',
      customInstructions: '',
    },
    userProfile: {
      nickname: '',
      occupation: '',
      bio: '',
      showName: true,
      linkedInUrl: '',
      githubUrl: '',
      websiteDomain: '',
      receiveEmailComments: false,
    },
    featureFlags: {
      memoryEnabled: true,
      recordingHistoryEnabled: false,
      webSearchAuto: true,
      codeInterpreterEnabled: true,
      canvasEnabled: true,
      voiceEnabled: true,
      voiceAdvanced: false,
      connectorSearchAuto: false,
    },
  };

  await page.route('**/api/auth/user', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: TEST_USER_ID,
        email: 'test@example.com',
        fullName: 'Test User',
        role: 'user',
        plan: 'pro',
      }),
    });
  });

  await page.route('**/api/session/identity', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        userId: TEST_USER_ID,
        email: 'test@example.com',
        role: 'user',
        isAnonymous: false,
      }),
    });
  });

  await page.route('**/api/auth/mfa/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        active: false,
        methods: { totp: false, push: false },
        approvalId: null,
        status: null,
      }),
    });
  });

  await page.route('**/api/settings/public', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        settings: {
          app_name: 'IliaGPT',
          default_model: 'grok-4-1-fast-non-reasoning',
          theme_mode: 'auto',
          date_format: 'DD/MM/YYYY',
          timezone_default: 'America/La_Paz',
        },
      }),
    });
  });

  await page.route('**/api/models/available', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        models: [
          {
            id: 'model-1',
            name: 'Grok 4.1 Fast',
            provider: 'xai',
            modelId: 'grok-4-1-fast-non-reasoning',
            description: 'Mock model',
            isEnabled: 'true',
            enabledAt: new Date().toISOString(),
            enabledByAdminId: 'admin-1',
            displayOrder: 1,
            icon: null,
            modelType: 'chat',
            contextWindow: 128000,
          },
        ],
      }),
    });
  });

  await page.route('**/api/workspace/analytics/track', async (route) => {
    await route.fulfill({
      status: 204,
      body: '',
    });
  });

  await page.route('**/api/chats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/user/preferences', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ language: 'es' }),
    });
  });

  await page.route('**/api/csrf/token?rotate=1', async (route) => {
    await route.fulfill({
      status: 204,
      body: '',
    });
  });

  await page.route(`**/api/users/${TEST_USER_ID}/settings`, async (route) => {
    if (route.request().method() === 'PUT') {
      const next = route.request().postDataJSON() as Omit<typeof userSettings, 'userId'>;
      userSettings = { userId: TEST_USER_ID, ...next };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(userSettings),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userSettings),
    });
  });
}

async function installPrivacyMocks(page: Page) {
  let privacySettings = {
    trainingOptIn: false,
    remoteBrowserDataAccess: false,
    analyticsTracking: true,
    chatHistoryEnabled: true,
  };

  await installAuthenticatedShellMocks(page);

  await page.route(`**/api/users/${TEST_USER_ID}/privacy`, async (route) => {
    if (route.request().method() === 'PUT') {
      const next = route.request().postDataJSON() as Partial<typeof privacySettings>;
      privacySettings = { ...privacySettings, ...next };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ privacySettings }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ privacySettings }),
    });
  });
}

async function installSettingsMocks(page: Page) {
  await installAuthenticatedShellMocks(page);
}

test('home loads without runtime errors', async ({ page }) => {
  const assertNoRuntimeErrors = createRuntimeErrorTracker(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/IliaGPT/i);
  await page.waitForTimeout(500);

  await assertNoRuntimeErrors();
});

test('login page loads without runtime errors', async ({ page }) => {
  const assertNoRuntimeErrors = createRuntimeErrorTracker(page);

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Bienvenido/i })).toBeVisible();
  await page.waitForTimeout(500);

  await assertNoRuntimeErrors();
});

test('privacy page loads as authenticated route without runtime errors', async ({ page }) => {
  const assertNoRuntimeErrors = createRuntimeErrorTracker(page, { captureConsoleErrors: true });

  await page.addInitScript(() => {
    localStorage.setItem('iliagpt_welcomed', 'true');
    localStorage.removeItem('siragpt_force_signed_out');
  });
  await installPrivacyMocks(page);

  await page.goto('/privacy', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: /Privacy|Privacidad/i })).toBeVisible();
  await expect(page.getByTestId('switch-share-data')).toBeVisible();
  await expect(page.getByTestId('switch-analytics')).toBeVisible();

  await page.getByTestId('switch-share-data').click();
  await expect(page.getByTestId('switch-share-data')).toHaveAttribute('data-state', 'checked');

  await page.waitForTimeout(500);
  await assertNoRuntimeErrors();
});

test('settings page loads as authenticated route without runtime errors', async ({ page }) => {
  const assertNoRuntimeErrors = createRuntimeErrorTracker(page, { captureConsoleErrors: true });

  await page.addInitScript(() => {
    localStorage.setItem('iliagpt_welcomed', 'true');
    localStorage.removeItem('siragpt_force_signed_out');
  });
  await installSettingsMocks(page);

  await page.goto('/settings', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('settings-menu-general')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('select-accent-color')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('switch-keyboard')).toBeVisible({ timeout: 15_000 });

  const keyboardSwitch = page.getByTestId('switch-keyboard');
  const initialState = await keyboardSwitch.getAttribute('data-state');

  await keyboardSwitch.click();
  await expect(keyboardSwitch).toHaveAttribute(
    'data-state',
    initialState === 'checked' ? 'unchecked' : 'checked',
  );

  await page.waitForTimeout(700);
  await assertNoRuntimeErrors();
});
