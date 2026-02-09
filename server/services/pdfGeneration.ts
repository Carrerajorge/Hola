import { chromium, Browser, BrowserContext } from "playwright";
import { pdfConcurrencyLimiter, validatePdfBuffer, logDocumentEvent } from "./documentSecurity";

export interface PdfMargin {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export interface PdfOptions {
  format?: "A4" | "Letter" | "Legal" | "Tabloid" | "A3" | "A5";
  margin?: PdfMargin;
  landscape?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  printBackground?: boolean;
  scale?: number;
  preferCSSPageSize?: boolean;
}

const DEFAULT_OPTIONS: PdfOptions = {
  format: "A4",
  margin: {
    top: "20mm",
    right: "20mm",
    bottom: "20mm",
    left: "20mm",
  },
  landscape: false,
  printBackground: true,
  scale: 1,
  preferCSSPageSize: false,
};

// Maximum PDF output size (50MB)
const MAX_PDF_SIZE = 50 * 1024 * 1024;

// Page load timeout (30 seconds)
const PAGE_LOAD_TIMEOUT = 30_000;

// PDF generation timeout (60 seconds)
const PDF_GENERATION_TIMEOUT = 60_000;

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-sync",
        "--disable-translate",
        "--no-first-run",
        "--single-process",
        "--disable-web-security=false",
      ],
    });
  }
  return browserInstance;
}

function wrapHtmlWithStyles(html: string): string {
  const hasHtmlTag = /<html[\s>]/i.test(html);
  const hasHeadTag = /<head[\s>]/i.test(html);

  const printStyles = `
    <style>
      @media print {
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        body {
          margin: 0;
          padding: 0;
        }
        @page {
          margin: 0;
        }
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        line-height: 1.6;
        color: #333;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th, td {
        border: 1px solid #ddd;
        padding: 8px;
        text-align: left;
      }
      th {
        background-color: #f5f5f5;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      pre, code {
        font-family: 'Courier New', Courier, monospace;
        background-color: #f5f5f5;
        padding: 2px 4px;
        border-radius: 3px;
      }
      pre {
        padding: 12px;
        overflow-x: auto;
      }
      blockquote {
        border-left: 4px solid #ddd;
        margin: 0;
        padding-left: 16px;
        color: #666;
      }
    </style>
  `;

  if (hasHtmlTag && hasHeadTag) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${printStyles}`);
  } else if (hasHtmlTag) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${printStyles}</head>`);
  } else {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${printStyles}
</head>
<body>
  ${html}
</body>
</html>`;
  }
}

function validateHtml(html: string): void {
  if (!html || typeof html !== "string") {
    throw new Error("HTML content is required and must be a string");
  }

  if (html.trim().length === 0) {
    throw new Error("HTML content cannot be empty");
  }

  const maxSize = 10 * 1024 * 1024; // 10MB limit
  if (html.length > maxSize) {
    throw new Error(`HTML content exceeds maximum size of ${maxSize / 1024 / 1024}MB`);
  }

  // Block dangerous HTML patterns
  const dangerousPatterns = [
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,  // Script tags
    /javascript:/gi,                          // JavaScript URLs
    /on\w+\s*=/gi,                           // Event handlers (onclick, onerror, etc.)
    /data:text\/html/gi,                     // Data URLs with HTML
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(html)) {
      throw new Error("HTML content contains potentially dangerous elements");
    }
  }
}

/**
 * Sanitize HTML for PDF rendering: strip scripts and event handlers
 * but preserve layout and styling needed for PDF output.
 */
function sanitizeHtmlForPdf(html: string): string {
  return html
    // Remove script tags and content
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    // Remove event handler attributes
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Remove javascript: URLs
    .replace(/javascript\s*:/gi, "blocked:")
    // Remove data:text/html URLs
    .replace(/data:text\/html/gi, "data:blocked");
}

export async function generatePdfFromHtml(
  html: string,
  options?: PdfOptions
): Promise<Buffer> {
  const startTime = Date.now();
  validateHtml(html);

  // Sanitize HTML to remove dangerous elements
  const sanitizedHtml = sanitizeHtmlForPdf(html);

  const mergedOptions: PdfOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    margin: {
      ...DEFAULT_OPTIONS.margin,
      ...options?.margin,
    },
  };

  // Enforce concurrency limits for PDF generation (browser resources are expensive)
  const acquired = await pdfConcurrencyLimiter.acquire();
  if (!acquired) {
    logDocumentEvent({
      timestamp: new Date().toISOString(),
      event: "rate_limit_exceeded",
      docType: "pdf",
    });
    throw new Error("Too many concurrent PDF generations. Please try again.");
  }

  if (process.env.ENABLE_BACKGROUND_JOBS === "true") {
    console.log("[pdfGeneration] Background jobs enabled, but direct execution requested for immediate response.");
  }

  logDocumentEvent({
    timestamp: new Date().toISOString(),
    event: "generate_start",
    docType: "pdf",
    details: { htmlSize: sanitizedHtml.length },
  });

  let context: BrowserContext | null = null;

  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      // Block external resource loading for security
      javaScriptEnabled: false,
    });
    const page = await context.newPage();

    // Block external network requests - only allow inline content
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url === "about:blank") {
        route.continue();
      } else {
        route.abort("blockedbyclient");
      }
    });

    const wrappedHtml = wrapHtmlWithStyles(sanitizedHtml);
    await page.setContent(wrappedHtml, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_LOAD_TIMEOUT,
    });

    const pdfOptions: Parameters<typeof page.pdf>[0] = {
      format: mergedOptions.format,
      margin: mergedOptions.margin,
      landscape: mergedOptions.landscape,
      printBackground: mergedOptions.printBackground,
      scale: mergedOptions.scale,
      preferCSSPageSize: mergedOptions.preferCSSPageSize,
    };

    if (mergedOptions.headerTemplate || mergedOptions.footerTemplate) {
      pdfOptions.displayHeaderFooter = true;
      pdfOptions.headerTemplate = mergedOptions.headerTemplate || "<span></span>";
      pdfOptions.footerTemplate = mergedOptions.footerTemplate || "<span></span>";
    }

    const pdfBuffer = await page.pdf(pdfOptions);
    const resultBuffer = Buffer.from(pdfBuffer);

    // Validate generated PDF
    if (resultBuffer.length > MAX_PDF_SIZE) {
      throw new Error(`Generated PDF exceeds maximum size of ${MAX_PDF_SIZE / 1024 / 1024}MB`);
    }

    const pdfValidation = validatePdfBuffer(resultBuffer);
    if (!pdfValidation.valid) {
      throw new Error(`Generated PDF is invalid: ${pdfValidation.errors.join("; ")}`);
    }

    if (pdfValidation.warnings.length > 0) {
      console.warn("[pdfGeneration] Warnings:", pdfValidation.warnings);
    }

    logDocumentEvent({
      timestamp: new Date().toISOString(),
      event: "generate_success",
      docType: "pdf",
      durationMs: Date.now() - startTime,
      details: { bufferSize: resultBuffer.length },
    });

    return resultBuffer;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logDocumentEvent({
      timestamp: new Date().toISOString(),
      event: "generate_failure",
      docType: "pdf",
      durationMs: Date.now() - startTime,
      details: { error: errorMessage },
    });

    if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
      throw new Error(`PDF generation timed out: ${errorMessage}`);
    }

    if (errorMessage.includes("net::ERR_") || errorMessage.includes("Navigation")) {
      throw new Error(`Failed to load HTML content: ${errorMessage}`);
    }

    throw new Error(`PDF generation failed: ${errorMessage}`);
  } finally {
    pdfConcurrencyLimiter.release();

    if (context) {
      await context.close().catch((err) => {
        console.error("[pdfGeneration] Error closing browser context:", err);
      });
    }
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch (error) {
      console.error("[pdfGeneration] Error closing browser:", error);
    } finally {
      browserInstance = null;
    }
  }
}

process.on("SIGTERM", async () => {
  await closeBrowser();
});

process.on("SIGINT", async () => {
  await closeBrowser();
});
