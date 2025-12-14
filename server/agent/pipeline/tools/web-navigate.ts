import { ToolDefinition, ExecutionContext, ToolResult, Artifact } from "../types";
import { browserWorker } from "../../browser-worker";
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
      sessionId = await browserWorker.createSession();
      
      context.onProgress({
        runId: context.runId,
        stepId: `nav_${context.stepIndex}`,
        status: "progress",
        message: `Navigating to ${url}...`,
        progress: 30
      });
      
      const result = await browserWorker.navigate(sessionId, url, takeScreenshot);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || "Navigation failed"
        };
      }

      if (result.screenshot) {
        try {
          const { uploadURL, storagePath } = await objectStorage.getObjectEntityUploadURLWithPath();
          await fetch(uploadURL, {
            method: "PUT",
            headers: { "Content-Type": "image/png" },
            body: result.screenshot
          });
          
          artifacts.push({
            id: crypto.randomUUID(),
            type: "screenshot",
            name: `screenshot_${new URL(url).hostname}.png`,
            storagePath,
            mimeType: "image/png",
            metadata: { url, title: result.title }
          });
        } catch (e) {
          console.error("Failed to save screenshot:", e);
        }
      }

      let extractedContent: any = null;
      if (result.html) {
        extractedContent = extractWithReadability(result.html, url);
        
        if (extractedContent) {
          artifacts.push({
            id: crypto.randomUUID(),
            type: "text",
            name: `content_${new URL(url).hostname}.txt`,
            content: extractedContent.textContent.slice(0, 50000),
            metadata: {
              title: extractedContent.title,
              byline: extractedContent.byline,
              length: extractedContent.length
            }
          });
        }
      }

      return {
        success: true,
        data: {
          url: result.url,
          title: result.title,
          html: result.html?.slice(0, 100000),
          textContent: extractedContent?.textContent?.slice(0, 50000),
          links: extractedContent?.links?.slice(0, 50),
          timing: result.timing
        },
        artifacts,
        metadata: {
          finalUrl: result.url,
          title: result.title,
          timing: result.timing
        }
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    } finally {
      if (sessionId) {
        await browserWorker.destroySession(sessionId).catch(() => {});
      }
    }
  }
};
