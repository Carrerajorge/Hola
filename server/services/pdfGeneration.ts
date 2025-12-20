import { chromium, Browser, BrowserContext } from "playwright";

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
}

export async function generatePdfFromHtml(
  html: string,
  options?: PdfOptions
): Promise<Buffer> {
  validateHtml(html);

  const mergedOptions: PdfOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    margin: {
      ...DEFAULT_OPTIONS.margin,
      ...options?.margin,
    },
  };

  let context: BrowserContext | null = null;

  try {
    const browser = await getBrowser();
    context = await browser.newContext();
    const page = await context.newPage();

    const wrappedHtml = wrapHtmlWithStyles(html);
    await page.setContent(wrappedHtml, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    await page.waitForLoadState("domcontentloaded");
    
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        if (document.readyState === "complete") {
          resolve();
        } else {
          window.addEventListener("load", () => resolve());
        }
      });
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

    return Buffer.from(pdfBuffer);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
      throw new Error(`PDF generation timed out: ${errorMessage}`);
    }
    
    if (errorMessage.includes("net::ERR_") || errorMessage.includes("Navigation")) {
      throw new Error(`Failed to load HTML content: ${errorMessage}`);
    }
    
    throw new Error(`PDF generation failed: ${errorMessage}`);
  } finally {
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
