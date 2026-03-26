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

async function installAuthenticatedSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('iliagpt_welcomed', 'true');
    localStorage.removeItem('siragpt_force_signed_out');
  });
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

async function installMemoryMocks(page: Page) {
  await installAuthenticatedShellMocks(page);

  const createMemory = (
    id: string,
    content: string,
    type: 'fact' | 'preference' | 'instruction' | 'context' | 'persona' | 'emotional',
    overrides?: Partial<{
      source: string;
      confidence: number;
      accessCount: number;
      createdAt: string;
      lastAccessed: string;
      tags: string[];
    }>,
  ) => ({
    id,
    content,
    type,
    metadata: {
      source: overrides?.source ?? 'manual',
      confidence: overrides?.confidence ?? 91,
      accessCount: overrides?.accessCount ?? 3,
      createdAt: overrides?.createdAt ?? '2026-03-24T15:00:00.000Z',
      lastAccessed: overrides?.lastAccessed ?? '2026-03-25T11:00:00.000Z',
      tags: overrides?.tags ?? ['smoke'],
    },
  });

  let memories = [
    createMemory('memory-1', 'Mi cumpleaños es el 15 de marzo', 'fact'),
    createMemory('memory-2', 'Prefiero respuestas cortas y directas', 'preference', {
      confidence: 88,
      accessCount: 7,
      source: 'conversation',
    }),
  ];

  const buildStats = () => ({
    totalMemories: memories.length,
    byType: memories.reduce<Record<string, number>>((acc, memory) => {
      acc[memory.type] = (acc[memory.type] ?? 0) + 1;
      return acc;
    }, {}),
    avgConfidence:
      memories.length === 0
        ? 0
        : Math.round(
            memories.reduce((sum, memory) => sum + memory.metadata.confidence, 0) / memories.length,
          ),
    embeddingProvider: 'mock-embeddings',
  });

  await page.route('**/api/memory/semantic/recall?limit=100', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ memories }),
    });
  });

  await page.route('**/api/memory/semantic/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildStats()),
    });
  });

  await page.route('**/api/memory/semantic/search', async (route) => {
    const body = route.request().postDataJSON() as { query?: string };
    const query = (body?.query ?? '').trim().toLowerCase();
    const results = memories
      .filter((memory) => memory.content.toLowerCase().includes(query))
      .map((memory) => ({
        chunk: memory,
        similarity: memory.id === 'memory-1' ? 0.93 : 0.87,
      }));

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results }),
    });
  });

  await page.route('**/api/memory/semantic/remember', async (route) => {
    const body = route.request().postDataJSON() as { content?: string; type?: string };
    const nextMemory = createMemory(
      `memory-${memories.length + 1}`,
      body.content ?? 'Nueva memoria',
      (body.type as 'fact' | 'preference' | 'instruction' | 'context' | 'persona' | 'emotional') ??
        'fact',
      {
        confidence: 95,
        accessCount: 1,
        createdAt: '2026-03-26T09:30:00.000Z',
        lastAccessed: '2026-03-26T09:30:00.000Z',
      },
    );

    memories = [nextMemory, ...memories];

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, memory: nextMemory }),
    });
  });

  await page.route(/\/api\/memory\/semantic\/memory-[^/?]+$/, async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue();
      return;
    }

    const memoryId = route.request().url().split('/').pop();
    memories = memories.filter((memory) => memory.id !== memoryId);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
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

  await installAuthenticatedSession(page);
  await installPrivacyMocks(page);

  await page.goto('/privacy', { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: /Privacy|Privacidad/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('switch-share-data')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('switch-analytics')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('switch-share-data').click();
  await expect(page.getByTestId('switch-share-data')).toHaveAttribute('data-state', 'checked');

  await page.waitForTimeout(500);
  await assertNoRuntimeErrors();
});

test('settings page loads as authenticated route without runtime errors', async ({ page }) => {
  const assertNoRuntimeErrors = createRuntimeErrorTracker(page, { captureConsoleErrors: true });

  await installAuthenticatedSession(page);
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

test('memory page loads as authenticated route without runtime errors', async ({ page }) => {
  const assertNoRuntimeErrors = createRuntimeErrorTracker(page, { captureConsoleErrors: true });

  await installAuthenticatedSession(page);
  await installMemoryMocks(page);

  await page.goto('/memory', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('memory-page-title')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Mi cumpleaños es el 15 de marzo')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('memory-tab-search').click();
  await page.getByTestId('memory-search-input').fill('cumpleaños');
  await page.getByTestId('memory-search-input').press('Enter');
  await expect(page.getByText(/93% similitud/i)).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('memory-tab-add').click();
  await page.getByTestId('memory-add-textarea').fill('Siempre resume al final');
  await page.getByTestId('button-save-memory').click();

  await page.getByTestId('memory-tab-browse').click();
  await expect(page.getByText('Siempre resume al final')).toBeVisible({ timeout: 15_000 });

  await page.waitForTimeout(700);
  await assertNoRuntimeErrors();
});
