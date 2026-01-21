import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { Response } from "express";
import { toolRegistry, type ToolContext, type ToolResult } from "./toolRegistry";
import { emitTraceEvent } from "./unifiedChatHandler";
import type { RequestSpec } from "./requestSpec";
import { renderPresentation, renderDocument, renderSpreadsheet } from "./artifactRenderer";
import { PresentationSpecSchema, DocSpecSchema, SheetSpecSchema } from "./builderSpec";
import { randomUUID } from "crypto";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface AgentExecutorOptions {
  maxIterations?: number;
  timeout?: number;
  runId: string;
  userId: string;
  chatId: string;
  requestSpec: RequestSpec;
}

interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

const AGENT_TOOLS: FunctionDeclaration[] = [
  {
    name: "web_search",
    description: "Search the web for current information on any topic",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        maxResults: { type: "number", description: "Maximum results (default 5)" }
      },
      required: ["query"]
    }
  },
  {
    name: "fetch_url",
    description: "Fetch and extract text content from a URL",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        extractText: { type: "boolean", description: "Extract readable text (default true)" }
      },
      required: ["url"]
    }
  },
  {
    name: "create_presentation",
    description: "Create a PowerPoint presentation with slides",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Presentation title" },
        slides: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              content: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
              layout: { type: "string", enum: ["title", "content", "twoColumn", "imageLeft", "imageRight"] }
            }
          },
          description: "Array of slide definitions"
        },
        theme: { type: "string", description: "Theme name (default 'professional')" }
      },
      required: ["title", "slides"]
    }
  },
  {
    name: "create_document",
    description: "Create a Word document with sections and content",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Document title" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              content: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
              level: { type: "number" }
            }
          },
          description: "Document sections"
        }
      },
      required: ["title", "sections"]
    }
  },
  {
    name: "create_spreadsheet",
    description: "Create an Excel spreadsheet with data",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Spreadsheet title" },
        sheets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              headers: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: { type: "array" } }
            }
          },
          description: "Sheet definitions"
        }
      },
      required: ["title", "sheets"]
    }
  },
  {
    name: "analyze_data",
    description: "Analyze data and provide statistical insights",
    parameters: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data to analyze (JSON, CSV, or description)" },
        analysisType: { type: "string", enum: ["summary", "trends", "comparison", "forecast"] }
      },
      required: ["data"]
    }
  },
  {
    name: "generate_chart",
    description: "Generate a chart visualization",
    parameters: {
      type: "object",
      properties: {
        chartType: { type: "string", enum: ["bar", "line", "pie", "scatter", "area"] },
        title: { type: "string" },
        data: { type: "object", description: "Chart data with labels and values" }
      },
      required: ["chartType", "data"]
    }
  }
];

import { zodToJsonSchema } from "zod-to-json-schema";

function getToolsForIntent(intent: string): FunctionDeclaration[] {
  switch (intent) {
    case "research":
      return AGENT_TOOLS.filter(t => ["web_search", "fetch_url"].includes(t.name));
    case "presentation_creation":
      return AGENT_TOOLS.filter(t => ["create_presentation", "web_search"].includes(t.name));
    case "document_generation":
      return AGENT_TOOLS.filter(t => ["create_document", "web_search"].includes(t.name));
    case "spreadsheet_creation":
      return AGENT_TOOLS.filter(t => ["create_spreadsheet", "analyze_data"].includes(t.name));
    case "data_analysis":
      return AGENT_TOOLS.filter(t => ["analyze_data", "generate_chart", "create_spreadsheet"].includes(t.name));
    default:
      return AGENT_TOOLS;
  }
}

async function executeToolCall(
  toolName: string,
  args: Record<string, any>,
  context: ToolContext,
  runId: string
): Promise<{ result: any; artifact?: { type: string; url: string; name: string } }> {
  console.log(`[AgentExecutor] Executing tool: ${toolName}`, args);

  await emitTraceEvent(runId, "tool_call_started", {
    toolCall: {
      id: randomUUID(),
      name: toolName,
      input: args,
      status: "running"
    }
  });

  const startTime = Date.now();
  let result: any;
  let artifact: { type: string; url: string; name: string } | undefined;

  try {
    switch (toolName) {
      case "web_search": {
        const searchResult = await toolRegistry.execute("search", {
          query: args.query,
          maxResults: args.maxResults || 5
        }, context);
        result = searchResult.success ? searchResult.output : { error: searchResult.error?.message };
        break;
      }

      case "fetch_url": {
        try {
          const { fetchUrl } = await import("../services/webSearch");
          const fetchResult = await fetchUrl(args.url, {
            extractText: args.extractText ?? true,
            maxLength: 50000
          });
          result = fetchResult;
        } catch (err: any) {
          result = { error: err.message };
        }
        break;
      }

      case "create_presentation": {
        const slideSpec = {
          title: args.title,
          theme: args.theme || "professional",
          slides: args.slides.map((s: any, i: number) => ({
            id: `slide-${i + 1}`,
            layout: s.layout || "content",
            elements: [
              ...(s.title ? [{
                id: `title-${i}`,
                type: "text" as const,
                content: s.title,
                position: { x: 5, y: 5, w: 90, h: 15 },
                style: { fontSize: 32, bold: true, align: "center" as const }
              }] : []),
              ...(s.content ? [{
                id: `content-${i}`,
                type: "text" as const,
                content: s.content,
                position: { x: 5, y: 25, w: 90, h: 60 }
              }] : []),
              ...(s.bullets ? [{
                id: `bullets-${i}`,
                type: "list" as const,
                items: s.bullets,
                position: { x: 5, y: 25, w: 90, h: 60 }
              }] : [])
            ]
          })),
          metadata: { author: context.userId, createdAt: new Date() }
        };

        const validatedSpec = PresentationSpecSchema.parse(slideSpec);
        const { buffer } = await renderPresentation(validatedSpec);
        const filename = `${args.title.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.pptx`;
        const fs = await import("fs/promises");
        const path = await import("path");
        const outputDir = path.join(process.cwd(), "generated_artifacts");
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        await fs.writeFile(outputPath, buffer);

        result = { success: true, filename, slidesCount: args.slides.length };
        artifact = { type: "presentation", url: `/api/artifacts/${filename}`, name: filename };

        await emitTraceEvent(runId, "artifact_created", {
          artifact: {
            id: randomUUID(),
            type: "presentation",
            name: filename,
            url: artifact.url,
            size: buffer.length,
            mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          }
        });
        break;
      }

      case "create_document": {
        const docSpec = {
          title: args.title,
          sections: args.sections.map((s: any, i: number) => ({
            id: `section-${i + 1}`,
            heading: s.heading,
            level: s.level || 1,
            content: s.content ? [{ type: "paragraph" as const, text: s.content }] : [],
            bullets: s.bullets
          })),
          metadata: { author: context.userId, createdAt: new Date() }
        };

        const validatedSpec = DocSpecSchema.parse(docSpec);
        const { buffer } = await renderDocument(validatedSpec);
        const filename = `${args.title.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.docx`;
        const fs = await import("fs/promises");
        const path = await import("path");
        const outputDir = path.join(process.cwd(), "generated_artifacts");
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        await fs.writeFile(outputPath, buffer);

        result = { success: true, filename, sectionsCount: args.sections.length };
        artifact = { type: "document", url: `/api/artifacts/${filename}`, name: filename };

        await emitTraceEvent(runId, "artifact_created", {
          artifact: {
            id: randomUUID(),
            type: "document",
            name: filename,
            url: artifact.url,
            size: buffer.length,
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          }
        });
        break;
      }

      case "create_spreadsheet": {
        const sheetSpec = {
          title: args.title,
          sheets: args.sheets.map((s: any, i: number) => ({
            id: `sheet-${i + 1}`,
            name: s.name || `Sheet${i + 1}`,
            columns: s.headers.map((h: string, j: number) => ({
              id: `col-${j}`,
              header: h,
              type: "text" as const,
              width: 15
            })),
            rows: s.rows.map((row: any[], k: number) => ({
              id: `row-${k}`,
              cells: row.map((cell, l) => ({
                columnId: `col-${l}`,
                value: cell
              }))
            }))
          })),
          metadata: { author: context.userId, createdAt: new Date() }
        };

        const validatedSpec = SheetSpecSchema.parse(sheetSpec);
        const { buffer } = await renderSpreadsheet(validatedSpec);
        const filename = `${args.title.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}.xlsx`;
        const fs = await import("fs/promises");
        const path = await import("path");
        const outputDir = path.join(process.cwd(), "generated_artifacts");
        await fs.mkdir(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, filename);
        await fs.writeFile(outputPath, buffer);

        result = { success: true, filename, sheetsCount: args.sheets.length };
        artifact = { type: "spreadsheet", url: `/api/artifacts/${filename}`, name: filename };

        await emitTraceEvent(runId, "artifact_created", {
          artifact: {
            id: randomUUID(),
            type: "spreadsheet",
            name: filename,
            url: artifact.url,
            size: buffer.length,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          }
        });
        break;
      }

      case "analyze_data": {
        try {
          // Dynamic import to keep startup fast
          const ss = await import("simple-statistics");

          let parsedData: any[] = [];
          if (typeof args.data === "string") {
            try {
              parsedData = JSON.parse(args.data);
            } catch {
              // Try CSV parsing if JSON fails? For now rely on description or basic numbers
              result = { error: "Could not parse data as JSON" };
            }
          } else if (Array.isArray(args.data)) {
            parsedData = args.data;
          }

          if (parsedData.length > 0) {
            // Extract numeric values if it's an array of objects
            const valueKeys = Object.keys(parsedData[0]).filter(k => typeof parsedData[0][k] === 'number');
            const insights: string[] = [];

            valueKeys.forEach(key => {
              const values = parsedData.map((d: any) => d[key]);
              const mean = ss.mean(values);
              const median = ss.median(values);
              const max = ss.max(values);
              const min = ss.min(values);
              const stdDev = ss.standardDeviation(values);

              insights.push(`Field '${key}': Mean=${mean.toFixed(2)}, Median=${median}, Range=[${min}, ${max}], StdDev=${stdDev.toFixed(2)}`);
            });

            result = {
              summary: `Analysis performed on ${parsedData.length} records.`,
              type: args.analysisType || "statistical",
              insights,
              stats: {
                recordCount: parsedData.length,
                fieldsAnalyzed: valueKeys
              }
            };
          } else {
            result = { error: "No valid data provided for analysis" };
          }
        } catch (e: any) {
          result = { error: `Analysis failed: ${e.message}` };
        }
        break;
      }

      case "generate_chart": {
        // Return a structured Chart.js/Recharts compatible config
        const chartConfig = {
          type: args.chartType,
          data: args.data, // Expects { labels: [], datasets: [{ label: '', data: [] }] }
          options: {
            responsive: true,
            plugins: {
              title: {
                display: true,
                text: args.title
              },
              legend: {
                position: 'top'
              }
            }
          }
        };

        result = {
          success: true,
          chartType: args.chartType,
          title: args.title,
          config: chartConfig,
          message: "Chart configuration generated successfully"
        };
        break;
      }

      default: {
        const toolResult = await toolRegistry.execute(toolName, args, context);
        result = toolResult.success ? toolResult.output : { error: toolResult.error?.message };
      }
    }

    const durationMs = Date.now() - startTime;

    await emitTraceEvent(runId, "tool_call_succeeded", {
      toolCall: {
        id: randomUUID(),
        name: toolName,
        input: args,
        output: result,
        status: "completed",
        durationMs
      }
    });

    return { result, artifact };

  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    await emitTraceEvent(runId, "tool_call_failed", {
      toolCall: {
        id: randomUUID(),
        name: toolName,
        input: args,
        status: "failed",
        error: error.message,
        durationMs
      }
    });

    return { result: { error: error.message } };
  }
}

function writeSse(res: Response, event: string, data: any): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (typeof (res as any).flush === "function") {
    (res as any).flush();
  }
}

export async function executeAgentLoop(
  messages: Array<{ role: string; content: string }>,
  res: Response,
  options: AgentExecutorOptions
): Promise<void> {
  const { runId, userId, chatId, requestSpec, maxIterations = 10 } = options;

  const tools = getToolsForIntent(requestSpec.intent);
  const toolContext: ToolContext = { userId, chatId, runId };

  const artifacts: Array<{ type: string; url: string; name: string }> = [];
  let iteration = 0;
  let conversationHistory = [...messages];
  let fullResponse = "";

  await emitTraceEvent(runId, "progress_update", {
    progress: {
      current: 0,
      total: maxIterations,
      message: `Starting agent loop with ${tools.length} available tools`
    }
  });

  while (iteration < maxIterations) {
    iteration++;

    await emitTraceEvent(runId, "thinking", {
      content: `Iteration ${iteration}: Analyzing and planning next action...`,
      phase: "execution"
    });

    try {
      const geminiMessages = conversationHistory.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: geminiMessages as any,
        config: {
          temperature: 0.7,
          maxOutputTokens: 4096
        },
        tools: tools.length > 0 ? [{
          functionDeclarations: tools
        }] : undefined
      } as any);

      const candidate = response.candidates?.[0];
      if (!candidate) {
        throw new Error("No response from model");
      }

      const parts = candidate.content?.parts || [];
      let hasToolCall = false;
      let textContent = "";

      for (const part of parts) {
        if (part.functionCall) {
          hasToolCall = true;
          const { name, args } = part.functionCall;

          writeSse(res, "tool_start", {
            runId,
            toolName: name!,
            args,
            iteration
          });

          const { result, artifact } = await executeToolCall(
            name!,
            args as Record<string, any>,
            toolContext,
            runId
          );

          if (artifact) {
            artifacts.push(artifact);
          }

          writeSse(res, "tool_result", {
            runId,
            toolName: name,
            result,
            artifact,
            iteration
          });

          conversationHistory.push({
            role: "assistant",
            content: `[Called tool: ${name}]`
          });
          conversationHistory.push({
            role: "user",
            content: `Tool result for ${name}: ${JSON.stringify(result)}`
          });
        } else if (part.text) {
          textContent += part.text;
        }
      }

      if (textContent) {
        fullResponse += textContent;

        if (!hasToolCall) {
          // A1: Agent Verifier - Quality Gate
          try {
            // Dynamic import to avoid circular dependencies if any, though explicit import is better. 
            // Since I can't add top-level imports easily with replace_file_content if I don't target the top, I'll use dynamic import or just hope for the best? 
            // Actually, I should use multi_replace to add the import.
            // But wait, I can use dynamic import here to be safe and localized.
            const { validateResponse } = await import("../services/responseValidator");
            const validation = validateResponse(textContent);

            if (!validation.isValid && iteration < maxIterations) {
              console.warn(`[AgentVerifier] Response rejected: ${validation.issues.map(i => i.message).join(", ")}`);

              await emitTraceEvent(runId, "verification_failed", {
                issues: validation.issues,
                rejectedContent: textContent.substring(0, 100) + "..."
              });

              conversationHistory.push({
                role: "assistant",
                content: textContent
              });
              conversationHistory.push({
                role: "user",
                content: `SYSTEM_ALERT: Your response was rejected by the Quality Verifier. 
Issues detected:
${validation.issues.map(i => `- ${i.message}`).join("\n")}

Please rewrite your response addressing these issues.`
              });

              // Skip streaming and continue to next iteration for retry
              continue;
            }
          } catch (err: any) {
            console.error("[AgentVerifier] Error during validation:", err);
            // Fail open: if verifier crashes, let the response through but log it
            await emitTraceEvent(runId, "verification_failed", {
              error: {
                message: `Verifier crashed: ${err.message}`,
                details: { stack: err.stack }
              },
              metadata: {
                checkName: "System Integrity",
                contentSnippet: textContent.substring(0, 50)
              }
            });
          }

          const chunks = textContent.match(/.{1,100}/g) || [textContent];
          for (let i = 0; i < chunks.length; i++) {
            writeSse(res, "chunk", {
              content: chunks[i],
              sequence: i + 1,
              runId
            });
            await new Promise(r => setTimeout(r, 10));
          }

          break;
        }
      }

      await emitTraceEvent(runId, "progress_update", {
        progress: {
          current: iteration,
          total: maxIterations,
          message: `Completed iteration ${iteration}`
        }
      });

    } catch (error: any) {
      console.error(`[AgentExecutor] Error in iteration ${iteration}:`, error);

      await emitTraceEvent(runId, "error", {
        error: {
          code: "AGENT_EXECUTION_ERROR",
          message: error.message,
          retryable: iteration < maxIterations
        }
      });

      if (iteration >= maxIterations) {
        throw error;
      }
    }
  }

  if (!fullResponse && iteration >= maxIterations) {
    const fallbackMsg = artifacts.length > 0
      ? `I've completed the requested tasks and generated ${artifacts.length} artifact(s) for you.`
      : "I've processed your request. Let me know if you need anything else.";
    writeSse(res, "chunk", {
      content: fallbackMsg,
      sequence: 1,
      runId
    });
  }

  if (artifacts.length > 0) {
    writeSse(res, "artifacts", {
      runId,
      artifacts,
      count: artifacts.length
    });
  }

  await emitTraceEvent(runId, "agent_completed", {
    agent: {
      name: requestSpec.primaryAgent,
      role: "primary",
      status: "completed"
    },
    iterations: iteration,
    artifactsGenerated: artifacts.length
  });
}

export { AGENT_TOOLS, getToolsForIntent };
