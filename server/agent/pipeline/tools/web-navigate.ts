import { ToolDefinition, ExecutionContext, ToolResult, Artifact } from "../types";
import { browserSessionManager } from "../../browser";
import { extractWithReadability } from "../../extractor";
import { ObjectStorageService } from "../../../objectStorage";
import crypto from "crypto";

const objectStorage = new ObjectStorageService();

export const webNavigateTool: ToolDefinition = {
  id: "web_navigate",
  name: "Navigate Web Page",
  description: "Navigate to a URL and capture the page content, optionally taking a screenshot",
  category: "web",
  capabilities: ["navigate", "browse", "fetch", "url", "website", "webpage"],
  inputSchema: {
    url: { type: "string", description: "The URL to navigate to", required: true },
    takeScreenshot: { type: "boolean", description: "Whether to capture a screenshot", default: true },
    waitForSelector: { type: "string", description: "CSS selector to wait for before capturing" },
    timeout: { type: "number", description: "Navigation timeout in ms", default: 30000 }
  },
  outputSchema: {
    html: { type: "string", description: "The page HTML content" },
    title: { type: "string", description: "The page title" },
    url: { type: "string", description: "The final URL after any redirects" },
    screenshot: { type: "string", description: "Path to the screenshot if taken" }
  },
  timeout: 60000,
  
  async execute(context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> {
    const { url, takeScreenshot = true, waitForSelector, timeout = 30000 } = params;
    
    let sessionId: string | null = null;
    const artifacts: Artifact[] = [];
    
    try {
      sessionId = await browserSessionManager.createSession(
        `Navigate to ${url}`,
        { timeout },
        undefined
      );
      
      browserSessionManager.startScreenshotStreaming(sessionId, 1500);
      
      context.onProgress({
        runId: context.runId,
        stepId: `nav_${context.stepIndex}`,
        status: "progress",
        message: `Navigating to ${url}...`,
        progress: 30
      });
      
      const result = await browserSessionManager.navigate(sessionId, url);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || "Navigation failed"
        };
      }

      if (waitForSelector) {
        const waitScript = `
          new Promise((resolve, reject) => {
            const selector = ${JSON.stringify(waitForSelector)};
            const timeout = ${Math.min(timeout, 10000)};
            const start = Date.now();
            const check = () => {
              if (document.querySelector(selector)) {
                resolve(true);
              } else if (Date.now() - start > timeout) {
                resolve(false);
              } else {
                requestAnimationFrame(check);
              }
            };
            check();
          })
        `;
        await browserSessionManager.evaluate(sessionId, waitScript);
      }

      if (takeScreenshot && result.screenshot) {
        try {
          const screenshotBuffer = Buffer.from(result.screenshot.replace(/^data:image\/png;base64,/, ""), "base64");
          const { uploadURL, storagePath } = await objectStorage.getObjectEntityUploadURLWithPath();
          await fetch(uploadURL, {
            method: "PUT",
            headers: { "Content-Type": "image/png" },
            body: screenshotBuffer
          });
          
          artifacts.push({
            id: crypto.randomUUID(),
            type: "screenshot",
            name: `screenshot_${new URL(url).hostname}.png`,
            storagePath,
            mimeType: "image/png",
            metadata: { url, title: result.data?.title }
          });
        } catch (e) {
          console.error("Failed to save screenshot:", e);
        }
      }

      const pageState = await browserSessionManager.getPageState(sessionId);
      
      let extractedContent: any = null;
      if (pageState?.visibleText) {
        extractedContent = {
          textContent: pageState.visibleText,
          title: pageState.title,
          links: pageState.links
        };
        
        artifacts.push({
          id: crypto.randomUUID(),
          type: "text",
          name: `content_${new URL(url).hostname}.txt`,
          content: pageState.visibleText.slice(0, 50000),
          metadata: {
            title: pageState.title,
            linksCount: pageState.links?.length || 0
          }
        });
      }

      return {
        success: true,
        data: {
          url: result.data?.url || url,
          title: result.data?.title || pageState?.title,
          textContent: extractedContent?.textContent?.slice(0, 50000),
          links: extractedContent?.links?.slice(0, 50),
          duration: result.duration
        },
        artifacts,
        metadata: {
          finalUrl: result.data?.url || url,
          title: result.data?.title || pageState?.title,
          duration: result.duration
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    } finally {
      if (sessionId) {
        browserSessionManager.stopScreenshotStreaming(sessionId);
        await browserSessionManager.closeSession(sessionId).catch(() => {});
      }
    }
  }
};
