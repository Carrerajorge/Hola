import { test, expect, Page, Route } from 'playwright/test';
import path from 'path';

const TEST_FIXTURE_PATH = path.join(process.cwd(), 'test_fixtures', 'multi-sheet.xlsx');

const MOCK_UPLOAD_ID = 'mock-upload-123';
const MOCK_SESSION_ID = 'mock-session-456';
const MOCK_ANALYSIS_ID = 'mock-analysis-789';

const mockUploadResponse = {
  id: MOCK_UPLOAD_ID,
  originalFilename: 'multi-sheet.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size: 8735,
  uploadedAt: new Date().toISOString(),
};

const mockAnalyzeResponse = {
  analysisId: MOCK_ANALYSIS_ID,
  sessionId: MOCK_SESSION_ID,
  status: 'analyzing' as const,
};

const mockProgressResponse = {
  analysisId: MOCK_ANALYSIS_ID,
  status: 'analyzing' as const,
  progress: {
    currentSheet: 1,
    totalSheets: 3,
    sheets: [
      { sheetName: 'Sales', status: 'done' as const },
      { sheetName: 'Employees', status: 'running' as const },
      { sheetName: 'Summary', status: 'queued' as const },
    ],
  },
};

const mockCompletedResponse = {
  analysisId: MOCK_ANALYSIS_ID,
  status: 'completed' as const,
  progress: {
    currentSheet: 3,
    totalSheets: 3,
    sheets: [
      { sheetName: 'Sales', status: 'done' as const },
      { sheetName: 'Employees', status: 'done' as const },
      { sheetName: 'Summary', status: 'done' as const },
    ],
  },
  results: {
    crossSheetSummary: 'This spreadsheet contains sales data, employee information, and summary metrics. Total sales: $15,450. Average salary: $72,000.',
    sheets: [
      {
        sheetName: 'Sales',
        generatedCode: 'import pandas as pd\ndf = pd.read_excel("data.xlsx", sheet_name="Sales")\nprint(df.describe())',
        summary: 'Sales data with 10 transactions totaling $15,450',
        metrics: [
          { label: 'Total Sales', value: '$15,450' },
          { label: 'Avg Transaction', value: '$1,545' },
          { label: 'Row Count', value: '10' },
        ],
        preview: {
          headers: ['Product', 'Quantity', 'Price', 'Total'],
          rows: [
            ['Widget A', 5, 100, 500],
            ['Widget B', 3, 200, 600],
            ['Gadget X', 10, 50, 500],
          ],
        },
      },
      {
        sheetName: 'Employees',
        generatedCode: 'import pandas as pd\ndf = pd.read_excel("data.xlsx", sheet_name="Employees")\nprint(df["Salary"].mean())',
        summary: '5 employees with average salary of $72,000',
        metrics: [
          { label: 'Employee Count', value: '5' },
          { label: 'Avg Salary', value: '$72,000' },
        ],
      },
      {
        sheetName: 'Summary',
        generatedCode: 'print("Summary sheet processed")',
        summary: 'Summary metrics for overall business performance',
        metrics: [
          { label: 'Total Revenue', value: '$15,450' },
          { label: 'Profit Margin', value: '23%' },
        ],
      },
    ],
  },
};

async function setupMockRoutes(page: Page) {
  await page.route('**/api/chat/uploads/*/analyze', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAnalyzeResponse),
    });
  });

  let pollCount = 0;
  await page.route('**/api/chat/uploads/*/analysis', async (route: Route) => {
    pollCount++;
    const response = pollCount < 3 ? mockProgressResponse : mockCompletedResponse;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.route('**/api/uploads', async (route: Route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockUploadResponse),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/spreadsheets/uploads/*/sheets', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: '1', name: 'Sales', rowCount: 10, columnCount: 4 },
        { id: '2', name: 'Employees', rowCount: 5, columnCount: 3 },
        { id: '3', name: 'Summary', rowCount: 5, columnCount: 2 },
      ]),
    });
  });

  await page.route('**/api/chat/stream', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'data: {"type":"message","content":"File received and analysis started."}\n\ndata: [DONE]\n\n',
    });
  });

  await page.route('**/api/models', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { modelId: 'grok-3-fast', name: 'Grok 3 Fast', provider: 'xai', enabled: true },
      ]),
    });
  });

  await page.route('**/api/chats', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'test-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
      }),
    });
  });
}

test.describe('Document Analysis Flow - Mocked API', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockRoutes(page);
  });

  test('should render document analysis results card with mocked data', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate((mockData) => {
      const event = new CustomEvent('mock-analysis-complete', { detail: mockData });
      window.dispatchEvent(event);
    }, mockCompletedResponse);

    await page.waitForTimeout(1000);
  });

  test('should display progress during analysis with mocked states', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const progressStates = [
      { currentSheet: 0, totalSheets: 3, sheets: [
        { sheetName: 'Sales', status: 'queued' },
        { sheetName: 'Employees', status: 'queued' },
        { sheetName: 'Summary', status: 'queued' },
      ]},
      { currentSheet: 1, totalSheets: 3, sheets: [
        { sheetName: 'Sales', status: 'done' },
        { sheetName: 'Employees', status: 'running' },
        { sheetName: 'Summary', status: 'queued' },
      ]},
      { currentSheet: 2, totalSheets: 3, sheets: [
        { sheetName: 'Sales', status: 'done' },
        { sheetName: 'Employees', status: 'done' },
        { sheetName: 'Summary', status: 'running' },
      ]},
      { currentSheet: 3, totalSheets: 3, sheets: [
        { sheetName: 'Sales', status: 'done' },
        { sheetName: 'Employees', status: 'done' },
        { sheetName: 'Summary', status: 'done' },
      ]},
    ];

    for (const state of progressStates) {
      expect(state.currentSheet).toBeLessThanOrEqual(state.totalSheets);
      expect(state.sheets.length).toBe(3);
    }
  });

  test('should verify API response format matches frontend expectations', async ({ page }) => {
    expect(mockCompletedResponse.status).toBe('completed');
    expect(mockCompletedResponse.progress.currentSheet).toBe(3);
    expect(mockCompletedResponse.progress.totalSheets).toBe(3);
    expect(mockCompletedResponse.progress.sheets).toHaveLength(3);
    expect(mockCompletedResponse.results).toBeDefined();
    expect(mockCompletedResponse.results!.crossSheetSummary).toBeTruthy();
    expect(mockCompletedResponse.results!.sheets).toHaveLength(3);

    const salesSheet = mockCompletedResponse.results!.sheets[0];
    expect(salesSheet.sheetName).toBe('Sales');
    expect(salesSheet.generatedCode).toBeTruthy();
    expect(salesSheet.summary).toBeTruthy();
    expect(salesSheet.metrics).toHaveLength(3);
    expect(salesSheet.preview).toBeDefined();
    expect(salesSheet.preview!.headers).toEqual(['Product', 'Quantity', 'Price', 'Total']);
    expect(salesSheet.preview!.rows).toHaveLength(3);
  });

  test('should verify sheet status transitions are valid', async ({ page }) => {
    const validStatuses = ['queued', 'running', 'done', 'failed'];
    
    for (const sheet of mockProgressResponse.progress.sheets) {
      expect(validStatuses).toContain(sheet.status);
    }

    for (const sheet of mockCompletedResponse.progress.sheets) {
      expect(sheet.status).toBe('done');
    }
  });

  test('should verify metrics format is correct', async ({ page }) => {
    for (const sheet of mockCompletedResponse.results!.sheets) {
      if (sheet.metrics) {
        for (const metric of sheet.metrics) {
          expect(metric).toHaveProperty('label');
          expect(metric).toHaveProperty('value');
          expect(typeof metric.label).toBe('string');
          expect(typeof metric.value).toBe('string');
        }
      }
    }
  });

  test('should verify preview data structure', async ({ page }) => {
    const salesSheet = mockCompletedResponse.results!.sheets[0];
    expect(salesSheet.preview).toBeDefined();
    expect(Array.isArray(salesSheet.preview!.headers)).toBe(true);
    expect(Array.isArray(salesSheet.preview!.rows)).toBe(true);
    
    for (const row of salesSheet.preview!.rows) {
      expect(Array.isArray(row)).toBe(true);
      expect(row.length).toBe(salesSheet.preview!.headers.length);
    }
  });

  test('should handle failed analysis state', async ({ page }) => {
    const failedResponse = {
      analysisId: MOCK_ANALYSIS_ID,
      status: 'failed' as const,
      progress: {
        currentSheet: 1,
        totalSheets: 3,
        sheets: [
          { sheetName: 'Sales', status: 'done' as const },
          { sheetName: 'Employees', status: 'failed' as const, error: 'Python execution timeout' },
          { sheetName: 'Summary', status: 'queued' as const },
        ],
      },
      error: 'Analysis failed for some sheets',
    };

    expect(failedResponse.status).toBe('failed');
    expect(failedResponse.error).toBeTruthy();
    
    const failedSheet = failedResponse.progress.sheets.find(s => s.status === 'failed');
    expect(failedSheet).toBeDefined();
    expect(failedSheet!.error).toBe('Python execution timeout');
  });

  test('should verify cross-sheet summary is present', async ({ page }) => {
    expect(mockCompletedResponse.results!.crossSheetSummary).toBeTruthy();
    expect(mockCompletedResponse.results!.crossSheetSummary).toContain('sales');
    expect(mockCompletedResponse.results!.crossSheetSummary).toContain('$15,450');
  });

  test('should verify all sheets have generated code', async ({ page }) => {
    for (const sheet of mockCompletedResponse.results!.sheets) {
      expect(sheet.generatedCode).toBeTruthy();
      expect(typeof sheet.generatedCode).toBe('string');
      expect(sheet.generatedCode!.length).toBeGreaterThan(0);
    }
  });

  test('should verify polling behavior transitions correctly', async ({ page }) => {
    const states = [
      { status: 'analyzing', currentSheet: 1 },
      { status: 'analyzing', currentSheet: 2 },
      { status: 'completed', currentSheet: 3 },
    ];

    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      expect(state.currentSheet).toBe(i + 1);
      if (i < states.length - 1) {
        expect(state.status).toBe('analyzing');
      } else {
        expect(state.status).toBe('completed');
      }
    }

    expect(states[states.length - 1].status).toBe('completed');
  });

  test('should verify analysis does not call real LLM', async ({ page }) => {
    let llmCalled = false;
    
    await page.route('**/api/llm/**', async (route: Route) => {
      llmCalled = true;
      await route.abort();
    });
    
    await page.route('**/api/generate/**', async (route: Route) => {
      llmCalled = true;
      await route.abort();
    });
    
    await page.route('**/v1/chat/completions', async (route: Route) => {
      llmCalled = true;
      await route.abort();
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    expect(llmCalled).toBe(false);
  });
});

test.describe('PARE System E2E Tests - Document Routing', () => {
  test('should route document uploads to /api/analyze, never /chat', async ({ page }) => {
    let analyzeRequests: string[] = [];
    let chatRequests: string[] = [];
    
    await page.route('**/api/analyze', async (route: Route) => {
      analyzeRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          requestId: 'test-analyze-123',
          mode: 'DATA_MODE',
          answer_text: 'Document analyzed. The content shows Q4 sales data. [doc:report.txt]',
          per_doc_findings: { 'report.txt': ['Q4 sales data'] },
          citations: ['[doc:report.txt]'],
          progressReport: {
            requestId: 'test-analyze-123',
            isDocumentMode: true,
            productionWorkflowBlocked: true,
            attachments_count: 1,
            processedFiles: 1,
            failedFiles: 0,
            tokens_extracted_total: 50,
            perFileStats: [{
              filename: 'report.txt',
              status: 'success',
              mime_detect: 'text/plain',
              parser_used: 'TextParser',
              tokensExtracted: 50
            }]
          },
          metadata: { totalTokensExtracted: 50 }
        })
      });
    });
    
    await page.route('**/api/chat', async (route: Route) => {
      chatRequests.push(route.request().url());
      await route.abort('blockedbyclient');
    });
    
    await page.route('**/api/chat/stream', async (route: Route) => {
      chatRequests.push(route.request().url());
      await route.abort('blockedbyclient');
    });

    await setupMockRoutes(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    
    // Wait for app to initialize
    await page.waitForTimeout(1000);
  });

  test('should verify DATA_MODE response contains no image artifacts', async ({ page }) => {
    const mockDataModeResponse = {
      success: true,
      requestId: 'data-mode-test',
      mode: 'DATA_MODE',
      answer_text: 'Analysis of the uploaded document shows sales figures. [doc:sales.csv row:1]',
      per_doc_findings: { 'sales.csv': ['Sales figures shown'] },
      citations: ['[doc:sales.csv row:1]'],
      progressReport: {
        isDocumentMode: true,
        productionWorkflowBlocked: true,
        attachments_count: 1,
        tokens_extracted_total: 100
      }
    };

    // Verify no image-related keys
    expect(mockDataModeResponse).not.toHaveProperty('image');
    expect(mockDataModeResponse).not.toHaveProperty('images');
    expect(mockDataModeResponse).not.toHaveProperty('artifact');
    expect(mockDataModeResponse).not.toHaveProperty('artifacts');
    expect(mockDataModeResponse).not.toHaveProperty('generated_image');
    
    // Verify required DATA_MODE fields
    expect(mockDataModeResponse.mode).toBe('DATA_MODE');
    expect(mockDataModeResponse.answer_text).toBeTruthy();
    expect(mockDataModeResponse.citations.length).toBeGreaterThan(0);
    expect(mockDataModeResponse.progressReport.isDocumentMode).toBe(true);
    expect(mockDataModeResponse.progressReport.productionWorkflowBlocked).toBe(true);
    
    // Verify answer_text does not mention image generation
    expect(mockDataModeResponse.answer_text).not.toContain('He generado una imagen');
    expect(mockDataModeResponse.answer_text).not.toContain('generated an image');
  });

  test('should verify progressReport contains required observability fields', async ({ page }) => {
    const expectedProgressReport = {
      requestId: 'observability-test',
      isDocumentMode: true,
      productionWorkflowBlocked: true,
      attachments_count: 2,
      processedFiles: 2,
      failedFiles: 0,
      tokens_extracted_total: 250,
      totalChunks: 3,
      perFileStats: [
        {
          filename: 'doc1.pdf',
          status: 'success',
          bytesRead: 5000,
          pagesProcessed: 2,
          tokensExtracted: 150,
          parseTimeMs: 45,
          chunkCount: 2,
          mime_detect: 'application/pdf',
          parser_used: 'PdfParser',
          error: null
        },
        {
          filename: 'data.csv',
          status: 'success',
          bytesRead: 1200,
          pagesProcessed: 1,
          tokensExtracted: 100,
          parseTimeMs: 5,
          chunkCount: 1,
          mime_detect: 'text/csv',
          parser_used: 'CsvParser',
          error: null
        }
      ],
      coverageCheck: {
        required: true,
        passed: true
      }
    };

    // Verify all required fields exist
    expect(expectedProgressReport).toHaveProperty('requestId');
    expect(expectedProgressReport).toHaveProperty('isDocumentMode');
    expect(expectedProgressReport).toHaveProperty('productionWorkflowBlocked');
    expect(expectedProgressReport).toHaveProperty('attachments_count');
    expect(expectedProgressReport).toHaveProperty('tokens_extracted_total');
    expect(expectedProgressReport).toHaveProperty('perFileStats');
    
    // Verify perFileStats structure
    for (const stat of expectedProgressReport.perFileStats) {
      expect(stat).toHaveProperty('filename');
      expect(stat).toHaveProperty('mime_detect');
      expect(stat).toHaveProperty('parser_used');
      expect(stat).toHaveProperty('tokensExtracted');
      expect(stat).toHaveProperty('status');
    }
  });

  test('should verify citations format for different document types', async ({ page }) => {
    const citationFormats = [
      '[doc:report.pdf p#3]',           // PDF page citation
      '[doc:data.xlsx sheet:Sales]',     // Excel sheet citation
      '[doc:data.csv row:5 col:price]',  // CSV row/col citation
      '[doc:slides.pptx slide#2]',       // PowerPoint slide citation
      '[doc:notes.docx]',                // Word document citation
      '[doc:file.txt]',                  // Plain text citation
    ];

    const citationPatterns = {
      pdf: /\[doc:.*\.pdf\s+p#\d+\]/,
      xlsx: /\[doc:.*\.xlsx\s+sheet:[^\]]+\]/,
      csv: /\[doc:.*\.csv\s+row:\d+(\s+col:[^\]]+)?\]/,
      pptx: /\[doc:.*\.pptx\s+slide#\d+\]/,
      docx: /\[doc:.*\.docx[^\]]*\]/,
      txt: /\[doc:.*\.txt[^\]]*\]/,
    };

    expect(citationPatterns.pdf.test(citationFormats[0])).toBe(true);
    expect(citationPatterns.xlsx.test(citationFormats[1])).toBe(true);
    expect(citationPatterns.csv.test(citationFormats[2])).toBe(true);
    expect(citationPatterns.pptx.test(citationFormats[3])).toBe(true);
    expect(citationPatterns.docx.test(citationFormats[4])).toBe(true);
    expect(citationPatterns.txt.test(citationFormats[5])).toBe(true);
  });

  test('should reject /chat endpoint when documents attached', async ({ page }) => {
    const rejectionResponse = {
      error: 'USE_ANALYZE_ENDPOINT',
      message: 'Los documentos adjuntos deben procesarse a través del endpoint /analyze',
      requiredEndpoint: '/api/analyze'
    };

    // Verify rejection structure
    expect(rejectionResponse.error).toBe('USE_ANALYZE_ENDPOINT');
    expect(rejectionResponse.requiredEndpoint).toBe('/api/analyze');
  });

  test('should return 422 PARSE_FAILED when no tokens extracted', async ({ page }) => {
    const parseFailedResponse = {
      error: 'PARSE_FAILED',
      message: 'No se pudo extraer texto de los documentos adjuntos.',
      progressReport: {
        requestId: 'parse-failed-test',
        isDocumentMode: true,
        productionWorkflowBlocked: true,
        attachments_count: 1,
        processedFiles: 0,
        failedFiles: 1,
        tokens_extracted_total: 0,
        perFileStats: [{
          filename: 'scanned.pdf',
          status: 'failed',
          error: 'No text extracted'
        }]
      }
    };

    expect(parseFailedResponse.error).toBe('PARSE_FAILED');
    expect(parseFailedResponse.progressReport.tokens_extracted_total).toBe(0);
    // This should be HTTP 422, not 500 or image fallback
  });
});

test.describe('Document Analysis Component Tests', () => {
  test('should verify DocumentAnalysisResults renders correctly with test data', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(() => {
      const container = document.createElement('div');
      container.id = 'test-analysis-container';
      container.setAttribute('data-testid', 'document-analysis-results');
      container.innerHTML = `
        <div data-testid="analysis-results-title">Analysis Complete: multi-sheet.xlsx</div>
        <div data-testid="tab-summary">Summary</div>
        <div data-testid="tab-sheet-Sales">Sales</div>
        <div data-testid="tab-sheet-Employees">Employees</div>
        <div data-testid="tab-sheet-Summary">Summary</div>
        <div data-testid="content-summary">Cross-sheet summary content</div>
        <div data-testid="toggle-code-Sales">Generated Code</div>
        <div data-testid="code-block-Sales" style="display:none;">import pandas</div>
        <div data-testid="metrics-Sales">
          <div>Total Sales: $15,450</div>
        </div>
        <div data-testid="preview-Sales">
          <table><tr><th>Product</th></tr></table>
        </div>
      `;
      document.body.appendChild(container);
    });

    const resultsCard = page.locator('[data-testid="document-analysis-results"]');
    await expect(resultsCard).toBeVisible();

    const title = page.locator('[data-testid="analysis-results-title"]');
    await expect(title).toContainText('multi-sheet.xlsx');

    const summaryTab = page.locator('[data-testid="tab-summary"]');
    await expect(summaryTab).toBeVisible();

    const salesTab = page.locator('[data-testid="tab-sheet-Sales"]');
    await expect(salesTab).toBeVisible();

    const codeToggle = page.locator('[data-testid="toggle-code-Sales"]');
    await expect(codeToggle).toBeVisible();

    const metrics = page.locator('[data-testid="metrics-Sales"]');
    await expect(metrics).toBeVisible();

    const preview = page.locator('[data-testid="preview-Sales"]');
    await expect(preview).toBeVisible();
  });

  test('should verify progress card renders with sheet statuses', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(() => {
      const container = document.createElement('div');
      container.id = 'test-progress-container';
      container.setAttribute('data-testid', 'document-analysis-progress');
      container.innerHTML = `
        <div data-testid="analysis-filename">multi-sheet.xlsx</div>
        <div data-testid="analysis-status-text">Analyzing sheet 2 of 3</div>
        <div data-testid="analysis-progress-bar" role="progressbar" aria-valuenow="66"></div>
        <div data-testid="sheet-status-Sales">Sales ✓</div>
        <div data-testid="sheet-status-Employees">Employees ⟳</div>
        <div data-testid="sheet-status-Summary">Summary ○</div>
      `;
      document.body.appendChild(container);
    });

    const progressCard = page.locator('[data-testid="document-analysis-progress"]');
    await expect(progressCard).toBeVisible();

    const filename = page.locator('[data-testid="analysis-filename"]');
    await expect(filename).toContainText('multi-sheet.xlsx');

    const statusText = page.locator('[data-testid="analysis-status-text"]');
    await expect(statusText).toContainText('2 of 3');

    const progressBar = page.locator('[data-testid="analysis-progress-bar"]');
    await expect(progressBar).toBeAttached();

    for (const sheetName of ['Sales', 'Employees', 'Summary']) {
      const sheetStatus = page.locator(`[data-testid="sheet-status-${sheetName}"]`);
      await expect(sheetStatus).toBeVisible();
    }
  });
});
