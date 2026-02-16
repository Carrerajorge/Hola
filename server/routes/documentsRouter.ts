import { Response, Router } from "express";
import fs from "node:fs/promises";
import {
  generateWordDocument,
  generateExcelDocument,
  generatePptDocument,
  normalizePptSlides,
  parseExcelFromText,
  parseSlidesFromText
} from "../services/documentGeneration";
import {
  DocumentRenderRequestSchema,
  renderDocument,
  getGeneratedDocument,
  getTemplates,
  getTemplateById,
  generateFallbackReport,
} from "../services/documentService";
import { renderExcelFromSpec } from "../services/excelSpecRenderer";
import { renderWordFromSpec } from "../services/wordSpecRenderer";
import { generateExcelFromPrompt, generateWordFromPrompt, generateCvFromPrompt, generateReportFromPrompt, generateLetterFromPrompt } from "../services/documentOrchestrator";
import { renderCvFromSpec } from "../services/cvRenderer";
import { selectCvTemplate } from "../services/documentMappingService";
import { excelSpecSchema, docSpecSchema, cvSpecSchema } from "../../shared/documentSpecs";
import { llmGateway } from "../lib/llmGateway";
import { generateAgentToolsExcel } from "../lib/agentToolsGenerator";
import { executeDocxCode } from "../services/docxCodeGenerator";
import { requireNetworkAccessEnabled } from "../middleware/networkAccessGuard";
import {
  sanitizeFilename,
  safeContentDisposition,
  validatePrompt,
  validateBufferSize,
  validatePptSlides,
  validatePdfBuffer,
  sharedDocumentStore,
  logDocumentEvent,
  pdfConcurrencyLimiter,
  docConcurrencyLimiter,
  MAX_DOC_BODY_SIZE,
  MAX_HTML_CONTENT_SIZE,
  applyDocumentSecurityHeaders,
  sanitizeErrorMessage,
} from "../services/documentSecurity";
import { documentCliToolRunner } from "../toolRunner/orchestrator";
import {
  getHealthSnapshot,
  isKnownTool,
  listToolDefinitions,
  TOOL_RUNNER_COMMAND_VERSION,
  TOOL_RUNNER_PROTOCOL_VERSION,
} from "../toolRunner/toolRegistry";
import { TOOL_RUNNER_ERROR_CODES, buildToolRunnerErrorMessage } from "../toolRunner/errorContract";
import { ToolAssetRef, ToolRunnerReport } from "../toolRunner/types";

// Maximum request body size for document endpoints (1MB)
const DOC_BODY_LIMIT = "1mb";

// Maximum code length for execute-code endpoint
const MAX_EXECUTE_CODE_LENGTH = 50 * 1024;

/** Whether to expose detailed error messages in API responses */
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Build a safe error response object. In production, internal details
 * are stripped to prevent information leakage.
 */
function safeErrorResponse(publicMessage: string, error: unknown): { error: string; details?: string } {
  if (IS_PRODUCTION) {
    return { error: publicMessage };
  }
  return { error: publicMessage, details: sanitizeErrorMessage(error) };
}

function normalizeObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function normalizeTheme(value: unknown): { id?: string; name?: string; tokens?: Record<string, unknown> } | undefined {
  const normalized = normalizeObject(value);
  if (!normalized) {
    return undefined;
  }

  const normalizedTokens = normalizeObject(normalized.tokens);

  return {
    id: typeof normalized.id === "string" && normalized.id.trim().length > 0 ? normalized.id.trim() : undefined,
    name:
      typeof normalized.name === "string" && normalized.name.trim().length > 0
        ? normalized.name.trim()
        : undefined,
    tokens:
      normalizedTokens && Object.keys(normalizedTokens).length > 0 ? normalizedTokens : undefined,
  };
}

function normalizeAssets(value: unknown): ToolAssetRef[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const assets: ToolAssetRef[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const entry = candidate as Partial<ToolAssetRef>;
    if (typeof entry.name !== "string" || !entry.name.trim() || typeof entry.path !== "string" || !entry.path.trim()) {
      continue;
    }

    assets.push({
      name: entry.name.trim(),
      path: entry.path.trim(),
      mediaType: typeof entry.mediaType === "string" ? entry.mediaType : undefined,
      sha256: typeof entry.sha256 === "string" ? entry.sha256 : undefined,
    });
  }

  return assets.length > 0 ? assets : undefined;
}

function buildToolRunnerFallbackReport(
  command: "docx" | "xlsx" | "pptx",
  locale: string
): ToolRunnerReport {
  const now = new Date().toISOString();
  const sandbox = process.env.TOOL_RUNNER_SANDBOX === "docker" ? "docker" : "subprocess";
  const code = TOOL_RUNNER_ERROR_CODES.FALLBACK_FAILED;
  const message = buildToolRunnerErrorMessage({
    code,
    locale,
    details: "Tool runner did not return a report payload.",
  });

  const incident = {
    code,
    message,
    severity: "warning" as const,
    details: {
      source: "documentsRouter",
      command,
    },
  };

  return {
    protocolVersion: TOOL_RUNNER_PROTOCOL_VERSION,
    locale,
    requestHash: `fallback-${command}-${Date.now()}`,
    documentType: command,
    toolVersionPin: TOOL_RUNNER_COMMAND_VERSION,
    sandbox,
    usedFallback: true,
    cacheHit: false,
    artifactPath: "in-memory://tool-runner-no-report",
    validation: {
      valid: false,
      checks: {
        relationships: false,
        styles: false,
        fonts: false,
        images: false,
        schema: false,
      },
      metadata: {
        artifactPath: "in-memory://tool-runner-no-report",
        bytes: 0,
      },
      issues: [incident],
    },
    traces: [],
    incidents: [incident],
    metrics: {
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      retries: 0,
    },
  };
}

function sendToolRunnerHeaders(
  res: Response,
  report: ToolRunnerReport | undefined,
  command: "docx" | "xlsx" | "pptx",
  toolRunnerRequested: boolean,
  locale: string = "es"
): void {
  if (!toolRunnerRequested) {
    return;
  }

  const fallback = report ?? buildToolRunnerFallbackReport(command, locale);
  const incidentCodes = (fallback.incidents ?? []).map((incident) => incident.code);

  res.setHeader("X-Tool-Runner-Request-Hash", fallback.requestHash);
  res.setHeader("X-Tool-Runner-Status", fallback.usedFallback ? "fallback" : "success");
  res.setHeader("X-Tool-Runner-Cache-Hit", String(fallback.cacheHit));
  res.setHeader("X-Tool-Runner-Command", command);
  res.setHeader("X-Tool-Runner-Validation", fallback.validation.valid ? "valid" : "invalid");
  res.setHeader("X-Tool-Runner-Incident-Count", String(incidentCodes.length));
  res.setHeader("X-Tool-Runner-Incident-Codes", incidentCodes.join(","));
}

export function createDocumentsRouter() {
  const router = Router();

  // Apply security headers to all document routes
  router.use((_req, res, next) => {
    applyDocumentSecurityHeaders(res);
    next();
  });

  router.get("/tool-runner/capabilities", async (req, res) => {
    const command = typeof req.query.command === "string" ? req.query.command.toLowerCase() : undefined;

    if (!command) {
      const health = getHealthSnapshot();
      return res.json({
        protocolVersion: health.protocolVersion,
        commandVersion: health.commandVersion,
        tools: listToolDefinitions(),
      });
    }

    if (!isKnownTool(command)) {
      return res.status(404).json({ error: "Tool not found", tool: command });
    }

    const match = listToolDefinitions().find((tool) => tool.name === command);
    if (!match) {
      return res.status(404).json({ error: "Tool definition not found", tool: command });
    }

    res.json(match);
  });

  router.get("/tool-runner/healthcheck", async (req, res) => {
    const command = typeof req.query.command === "string" ? req.query.command.toLowerCase() : undefined;

    if (command && !isKnownTool(command)) {
      return res.status(404).json({ error: "Tool not found", tool: command });
    }

    res.json(getHealthSnapshot(command));
  });

  // ============================================
  // SIMPLE DOCUMENT GENERATION
  // ============================================

  router.post("/generate", async (req, res) => {
    const startTime = Date.now();

    try {
      const { type, title, content } = req.body;

      if (!type || title === undefined || title === null || content === undefined || content === null) {
        return res.status(400).json({ error: "type, title, and content are required" });
      }

      // Validate type
      if (!["word", "excel", "ppt"].includes(type)) {
        return res.status(400).json({ error: "Invalid document type. Use 'word', 'excel', or 'ppt'" });
      }

      const safeTitle = typeof title === "string" ? title.substring(0, 500) : `${title}`.substring(0, 500);
      const safeContent = typeof content === "string" ? content.substring(0, MAX_DOC_BODY_SIZE) : `${content}`.substring(0, MAX_DOC_BODY_SIZE);
      const runnerLocale = typeof req.body?.locale === "string" && req.body.locale.length > 0 ? req.body.locale : "es";
      const useToolRunner = process.env.DISABLE_TOOL_RUNNER !== "true";
      const designTokens = normalizeObject(req.body?.designTokens);
      const theme = normalizeTheme(req.body?.theme);
      const assets = normalizeAssets(req.body?.assets);
      const runnerOptions = normalizeObject(req.body?.options);
      const runnerDocumentType = type === "word" ? "docx" : type === "excel" ? "xlsx" : "pptx";
      let toolRunnerReport: ToolRunnerReport | undefined;

      if (safeTitle.trim().length === 0) {
        return res.status(400).json({ error: "title cannot be empty" });
      }

      // Acquire concurrency slot
      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: type });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "generate_start", docType: type });

      let buffer: Buffer;
      let filename: string;
      let mimeType: string;
      let toolRunnerRequested = false;

      try {
        switch (type) {
          case "word":
            try {
              if (useToolRunner) {
                toolRunnerRequested = true;
                const result = await documentCliToolRunner.generate({
                  documentType: "docx",
                  title: safeTitle,
                  data: {
                    content: safeContent,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                });
                buffer = await fs.readFile(result.artifactPath);
                toolRunnerReport = result.report;
              } else {
                buffer = await generateWordDocument(safeTitle, safeContent);
              }
            } catch (error) {
              logDocumentEvent({
                timestamp: new Date().toISOString(),
                event: "generate_fallback",
                docType: "word",
                details: { error: sanitizeErrorMessage(error) },
              });
              const fallbackResult = await generateFallbackReport(
                {
                  type: "docx",
                  templateId: "legacy-fallback",
                  data: {
                    title: safeTitle,
                    content: safeContent,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                },
                "docx",
                error,
                async () => generateWordDocument(safeTitle, safeContent)
              );
              toolRunnerReport = fallbackResult.report;
              buffer = fallbackResult.buffer;
            }
            filename = sanitizeFilename(safeTitle, ".docx");
            mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            break;
          case "excel": {
            try {
              if (useToolRunner) {
                toolRunnerRequested = true;
                const result = await documentCliToolRunner.generate({
                  documentType: "xlsx",
                  title: safeTitle,
                  data: {
                    content: safeContent,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                });
                buffer = await fs.readFile(result.artifactPath);
                toolRunnerReport = result.report;
              } else {
                const excelData = parseExcelFromText(safeContent);
                buffer = await generateExcelDocument(safeTitle, excelData);
              }
            } catch (error) {
              logDocumentEvent({
                timestamp: new Date().toISOString(),
                event: "generate_fallback",
                docType: "excel",
                details: { error: sanitizeErrorMessage(error) },
              });
              const fallbackResult = await generateFallbackReport(
                {
                  type: "xlsx",
                  templateId: "legacy-fallback",
                  data: {
                    title: safeTitle,
                    content: safeContent,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                },
                "xlsx",
                error,
                async () => {
                  const excelData = parseExcelFromText(safeContent);
                  return generateExcelDocument(safeTitle, excelData);
                }
              );
              toolRunnerReport = fallbackResult.report;
              buffer = fallbackResult.buffer;
            }
            filename = sanitizeFilename(safeTitle, ".xlsx");
            mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            break;
          }
          case "ppt": {
            const slides = parseSlidesFromText(safeContent);
            const normalized = normalizePptSlides(safeTitle, slides);
            const pptReport = validatePptSlides(normalized.slides as { title: string; content: string[] }[]);

            if (!pptReport.valid) {
              logDocumentEvent({
                timestamp: new Date().toISOString(),
                event: "validation_error",
                docType: "ppt",
                details: { errors: pptReport.errors },
              });
            }

            try {
              if (useToolRunner) {
                toolRunnerRequested = true;
                const result = await documentCliToolRunner.generate({
                  documentType: "pptx",
                  title: safeTitle,
                  data: {
                    slides: normalized.slides,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                });
                buffer = await fs.readFile(result.artifactPath);
                toolRunnerReport = result.report;
              } else {
                buffer = await generatePptDocument(normalized.title, normalized.slides, {
                  trace: {
                    source: "documentsRouter",
                  },
                });
              }
            } catch (error) {
              logDocumentEvent({
                timestamp: new Date().toISOString(),
                event: "generate_fallback",
                docType: "ppt",
                details: { error: sanitizeErrorMessage(error) },
              });
              const fallbackResult = await generateFallbackReport(
                {
                  type: "pptx",
                  templateId: "legacy-fallback",
                  data: {
                    title: safeTitle,
                    slides: normalized.slides,
                  },
                  locale: runnerLocale,
                  options: runnerOptions,
                  designTokens,
                  theme,
                  assets,
                },
                "pptx",
                error,
                async () =>
                  generatePptDocument(normalized.title, normalized.slides, {
                    trace: {
                      source: "documentsRouter",
                    },
                  })
              );
              toolRunnerReport = fallbackResult.report;
              buffer = fallbackResult.buffer;
            }
            filename = sanitizeFilename(safeTitle, ".pptx");
            mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            break;
          }
          default:
            return res.status(400).json({ error: "Invalid document type. Use 'word', 'excel', or 'ppt'" });
        }
      } finally {
        docConcurrencyLimiter.release();
      }

      // Validate generated buffer
      const bufferCheck = validateBufferSize(buffer, type);
      if (!bufferCheck.valid) {
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "generate_failure",
          docType: type,
          details: { error: bufferCheck.error },
        });
        return res.status(500).json({ error: bufferCheck.error });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: type,
        durationMs: Date.now() - startTime,
        details: { bufferSize: buffer.length },
      });

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      sendToolRunnerHeaders(
        res,
        toolRunnerReport,
        runnerDocumentType,
        toolRunnerRequested,
        runnerLocale
      );
      res.send(buffer);
    } catch (error: any) {
      console.error("Document generation error:", error);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_failure",
        docType: req.body?.type || "unknown",
        durationMs: Date.now() - startTime,
        details: { error: sanitizeErrorMessage(error) },
      });
      res.status(500).json(safeErrorResponse("Failed to generate document", error));
    }
  });

  // ============================================
  // AGENT TOOLS CATALOG
  // ============================================

  router.get("/agent-tools-catalog", async (req, res) => {
    try {
      const buffer = await generateAgentToolsExcel();
      const filename = sanitizeFilename(`Agent_Tools_PRO_Edition_${new Date().toISOString().split('T')[0]}`, ".xlsx");

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.send(buffer);
    } catch (error: any) {
      console.error("Agent tools catalog generation error:", error);
      res.status(500).json(safeErrorResponse("Failed to generate agent tools catalog", error));
    }
  });

  // ============================================
  // TEMPLATES
  // ============================================

  router.get("/templates", async (req, res) => {
    try {
      const templates = getTemplates();
      const type = req.query.type as string | undefined;

      if (type) {
        const filtered = templates.filter(t => t.type.includes(type as any));
        return res.json(filtered);
      }

      res.json(templates);
    } catch (error: any) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  router.get("/templates/:id", async (req, res) => {
    try {
      const template = getTemplateById(req.params.id);
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      res.json(template);
    } catch (error: any) {
      console.error("Error fetching template:", error);
      res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  // ============================================
  // DOCUMENT RENDER (TEMPLATE-BASED)
  // ============================================

  router.post("/render", async (req, res) => {
    try {
      const parseResult = DocumentRenderRequestSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid request",
          details: parseResult.error.flatten().fieldErrors
        });
      }

      const document = await renderDocument(parseResult.data);

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const downloadUrl = `${baseUrl}/api/documents/${document.id}`;

      res.json({
        id: document.id,
        fileName: document.fileName,
        mimeType: document.mimeType,
        downloadUrl,
        expiresAt: document.expiresAt.toISOString(),
        ...(document.generationReport
          ? {
              toolRunnerReport: {
                requestHash: document.generationReport.requestHash,
                documentType: document.generationReport.documentType,
                usedFallback: document.generationReport.usedFallback,
                cacheHit: document.generationReport.cacheHit,
                sandbox: document.generationReport.sandbox,
                validation: {
                  valid: document.generationReport.validation.valid,
                  checks: document.generationReport.validation.checks,
                },
                metrics: document.generationReport.metrics,
                incidents: document.generationReport.incidents,
              },
            }
          : undefined),
      });
    } catch (error: any) {
      console.error("Document render error:", error);
      res.status(500).json(safeErrorResponse("Failed to render document", error));
    }
  });

  // ============================================
  // DOCUMENT DOWNLOAD
  // ============================================

  router.get("/reports/:id", async (req, res) => {
    try {
      const document = getGeneratedDocument(req.params.id);

      if (!document) {
        return res.status(404).json({ error: "Document not found or expired" });
      }

      if (!document.generationReport) {
        return res.status(404).json({ error: "Generation report unavailable for this document" });
      }

      res.json({
        documentId: document.id,
        toolRunnerReport: document.generationReport,
      });
    } catch (error: any) {
      console.error("Tool runner report error:", error);
      res.status(500).json({ error: "Failed to fetch generation report" });
    }
  });

  router.get("/:id", async (req, res) => {
    try {
      const document = getGeneratedDocument(req.params.id);

      if (!document) {
        return res.status(404).json({ error: "Document not found or expired" });
      }

      res.setHeader("Content-Type", document.mimeType);
      res.setHeader("Content-Disposition", safeContentDisposition(document.fileName));
      res.setHeader("Content-Length", document.buffer.length);
      res.send(document.buffer);
    } catch (error: any) {
      console.error("Document download error:", error);
      res.status(500).json({ error: "Failed to download document" });
    }
  });

  // ============================================
  // RENDER FROM SPEC (EXCEL)
  // ============================================

  router.post("/render/excel", async (req, res) => {
    const startTime = Date.now();

    try {
      const parseResult = excelSpecSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid Excel spec",
          details: parseResult.error.flatten().fieldErrors
        });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "render_start", docType: "excel" });

      const buffer = await renderExcelFromSpec(parseResult.data);

      // Validate buffer
      const bufferCheck = validateBufferSize(buffer, "excel");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      const filename = sanitizeFilename(parseResult.data.workbook_title || "workbook", ".xlsx");

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "render_success",
        docType: "excel",
        durationMs: Date.now() - startTime,
        details: { bufferSize: buffer.length },
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Excel render error:", error);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "render_failure",
        docType: "excel",
        durationMs: Date.now() - startTime,
        details: { error: error.message },
      });
      res.status(500).json(safeErrorResponse("Failed to render Excel document", error));
    }
  });

  // ============================================
  // RENDER FROM SPEC (WORD)
  // ============================================

  router.post("/render/word", async (req, res) => {
    const startTime = Date.now();

    try {
      const parseResult = docSpecSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid Word doc spec",
          details: parseResult.error.flatten().fieldErrors
        });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "render_start", docType: "word" });

      const buffer = await renderWordFromSpec(parseResult.data);

      // Validate buffer
      const bufferCheck = validateBufferSize(buffer, "word");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      const filename = sanitizeFilename(parseResult.data.title || "document", ".docx");

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "render_success",
        docType: "word",
        durationMs: Date.now() - startTime,
        details: { bufferSize: buffer.length },
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Word render error:", error);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "render_failure",
        docType: "word",
        durationMs: Date.now() - startTime,
        details: { error: error.message },
      });
      res.status(500).json(safeErrorResponse("Failed to render Word document", error));
    }
  });

  // ============================================
  // LLM-DRIVEN GENERATION (EXCEL)
  // ============================================

  router.post("/generate/excel", async (req, res) => {
    const startTime = Date.now();

    try {
      const { prompt, returnMetadata } = req.body;

      // Validate prompt
      const promptCheck = validatePrompt(prompt);
      if (!promptCheck.valid) {
        return res.status(400).json({ error: promptCheck.error });
      }

      // Acquire concurrency slot
      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: "excel" });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_start",
        docType: "excel",
        details: { promptLength: promptCheck.sanitizedPrompt!.length },
      });

      let result;
      try {
        result = await generateExcelFromPrompt(promptCheck.sanitizedPrompt!);
      } finally {
        docConcurrencyLimiter.release();
      }

      const { buffer, spec, qualityReport, postRenderValidation, attemptsUsed } = result;

      // Validate buffer
      const bufferCheck = validateBufferSize(buffer, "excel");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "excel",
        durationMs: Date.now() - startTime,
        details: { attemptsUsed, bufferSize: buffer.length },
      });

      if (returnMetadata === true) {
        return res.json({
          success: true,
          filename: sanitizeFilename(spec.workbook_title || "generated", ".xlsx"),
          buffer: buffer.toString("base64"),
          qualityWarnings: qualityReport.warnings,
          postRenderWarnings: postRenderValidation.warnings,
          metadata: postRenderValidation.metadata,
          attemptsUsed,
        });
      }

      const filename = sanitizeFilename(spec.workbook_title || "generated", ".xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Excel generation error:", error);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_failure",
        docType: "excel",
        durationMs: Date.now() - startTime,
        details: { error: error.message },
      });
      res.status(500).json(safeErrorResponse("Failed to generate Excel document", error));
    }
  });

  // ============================================
  // LLM-DRIVEN GENERATION (WORD)
  // ============================================

  router.post("/generate/word", async (req, res) => {
    const startTime = Date.now();

    try {
      const { prompt, returnMetadata } = req.body;

      // Validate prompt
      const promptCheck = validatePrompt(prompt);
      if (!promptCheck.valid) {
        return res.status(400).json({ error: promptCheck.error });
      }

      // Acquire concurrency slot
      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: "word" });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_start",
        docType: "word",
        details: { promptLength: promptCheck.sanitizedPrompt!.length },
      });

      let result;
      try {
        result = await generateWordFromPrompt(promptCheck.sanitizedPrompt!);
      } finally {
        docConcurrencyLimiter.release();
      }

      const { buffer, spec, qualityReport, postRenderValidation, attemptsUsed } = result;

      // Validate buffer
      const bufferCheck = validateBufferSize(buffer, "word");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "word",
        durationMs: Date.now() - startTime,
        details: { attemptsUsed, bufferSize: buffer.length },
      });

      if (returnMetadata === true) {
        return res.json({
          success: true,
          filename: sanitizeFilename(spec.title || "generated", ".docx"),
          buffer: buffer.toString("base64"),
          qualityWarnings: qualityReport.warnings,
          postRenderWarnings: postRenderValidation.warnings,
          metadata: postRenderValidation.metadata,
          attemptsUsed,
        });
      }

      const filename = sanitizeFilename(spec.title || "generated", ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Word generation error:", error);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_failure",
        docType: "word",
        durationMs: Date.now() - startTime,
        details: { error: error.message },
      });
      res.status(500).json(safeErrorResponse("Failed to generate Word document", error));
    }
  });

  // ============================================
  // LLM-DRIVEN GENERATION (CV)
  // ============================================

  router.post("/generate/cv", async (req, res) => {
    const startTime = Date.now();

    try {
      const { prompt } = req.body;

      // Validate prompt
      const promptCheck = validatePrompt(prompt);
      if (!promptCheck.valid) {
        return res.status(400).json({ error: promptCheck.error });
      }

      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: "cv" });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "generate_start", docType: "cv" });

      let result;
      try {
        result = await generateCvFromPrompt(promptCheck.sanitizedPrompt!);
      } finally {
        docConcurrencyLimiter.release();
      }

      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;

      const bufferCheck = validateBufferSize(buffer, "cv");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "cv",
        durationMs: Date.now() - startTime,
        details: { attemptsUsed, bufferSize: buffer.length },
      });

      const timestamp = Date.now();
      const filename = sanitizeFilename(`cv_${timestamp}`, ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("CV generation error:", error);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_failure",
        docType: "cv",
        durationMs: Date.now() - startTime,
        details: { error: error.message },
      });
      res.status(500).json(safeErrorResponse("Failed to generate CV document", error));
    }
  });

  // ============================================
  // LLM-DRIVEN GENERATION (REPORT)
  // ============================================

  router.post("/generate/report", async (req, res) => {
    const startTime = Date.now();

    try {
      const { prompt } = req.body;

      const promptCheck = validatePrompt(prompt);
      if (!promptCheck.valid) {
        return res.status(400).json({ error: promptCheck.error });
      }

      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: "report" });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "generate_start", docType: "report" });

      let result;
      try {
        result = await generateReportFromPrompt(promptCheck.sanitizedPrompt!);
      } finally {
        docConcurrencyLimiter.release();
      }

      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;

      const bufferCheck = validateBufferSize(buffer, "report");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "report",
        durationMs: Date.now() - startTime,
        details: { attemptsUsed, bufferSize: buffer.length },
      });

      const timestamp = Date.now();
      const filename = sanitizeFilename(`report_${timestamp}`, ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Report generation error:", error);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_failure",
        docType: "report",
        durationMs: Date.now() - startTime,
        details: { error: error.message },
      });
      res.status(500).json(safeErrorResponse("Failed to generate Report document", error));
    }
  });

  // ============================================
  // LLM-DRIVEN GENERATION (LETTER)
  // ============================================

  router.post("/generate/letter", async (req, res) => {
    const startTime = Date.now();

    try {
      const { prompt } = req.body;

      const promptCheck = validatePrompt(prompt);
      if (!promptCheck.valid) {
        return res.status(400).json({ error: promptCheck.error });
      }

      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        logDocumentEvent({ timestamp: new Date().toISOString(), event: "rate_limit_exceeded", docType: "letter" });
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "generate_start", docType: "letter" });

      let result;
      try {
        result = await generateLetterFromPrompt(promptCheck.sanitizedPrompt!);
      } finally {
        docConcurrencyLimiter.release();
      }

      const { buffer, qualityReport, postRenderValidation, attemptsUsed } = result;

      const bufferCheck = validateBufferSize(buffer, "letter");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      if (qualityReport.warnings.length > 0) {
        res.setHeader("X-Quality-Warnings", JSON.stringify(qualityReport.warnings.map(w => w.message)));
      }
      if (postRenderValidation.warnings.length > 0) {
        res.setHeader("X-PostRender-Warnings", JSON.stringify(postRenderValidation.warnings));
      }
      res.setHeader("X-Generation-Attempts", attemptsUsed.toString());

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "letter",
        durationMs: Date.now() - startTime,
        details: { attemptsUsed, bufferSize: buffer.length },
      });

      const timestamp = Date.now();
      const filename = sanitizeFilename(`letter_${timestamp}`, ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Letter generation error:", error);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_failure",
        docType: "letter",
        durationMs: Date.now() - startTime,
        details: { error: error.message },
      });
      res.status(500).json(safeErrorResponse("Failed to generate Letter document", error));
    }
  });

  // ============================================
  // RENDER CV FROM SPEC
  // ============================================

  router.post("/render/cv", async (req, res) => {
    const startTime = Date.now();

    try {
      const parseResult = cvSpecSchema.safeParse(req.body);

      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid CV spec",
          details: parseResult.error.flatten().fieldErrors
        });
      }

      logDocumentEvent({ timestamp: new Date().toISOString(), event: "render_start", docType: "cv" });

      const spec = parseResult.data;
      const templateConfig = selectCvTemplate(spec.template_style || "modern");
      const buffer = await renderCvFromSpec(spec, templateConfig);

      const bufferCheck = validateBufferSize(buffer, "cv");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "render_success",
        docType: "cv",
        durationMs: Date.now() - startTime,
        details: { bufferSize: buffer.length },
      });

      const timestamp = Date.now();
      const filename = sanitizeFilename(`cv_${timestamp}`, ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("CV render error:", error);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "render_failure",
        docType: "cv",
        durationMs: Date.now() - startTime,
        details: { error: error.message },
      });
      res.status(500).json(safeErrorResponse("Failed to render CV document", error));
    }
  });

  // ============================================
  // EXECUTE USER CODE (SANDBOXED)
  // ============================================

  router.post("/execute-code", requireNetworkAccessEnabled(), async (req, res) => {
    const startTime = Date.now();

    try {
      const { code } = req.body;

      if (!code || typeof code !== "string") {
        return res.status(400).json({ error: "Code is required" });
      }

      // Enforce code length limit
      if (code.length > MAX_EXECUTE_CODE_LENGTH) {
        logDocumentEvent({
          timestamp: new Date().toISOString(),
          event: "security_violation",
          docType: "docx-code",
          details: { reason: "code_too_long", codeLength: code.length },
        });
        return res.status(400).json({
          error: `Code exceeds maximum length of ${MAX_EXECUTE_CODE_LENGTH / 1024}KB`,
        });
      }

      const acquired = await docConcurrencyLimiter.acquire();
      if (!acquired) {
        return res.status(429).json({ error: "Too many concurrent document generations. Please try again." });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_start",
        docType: "docx-code",
        details: { codeLength: code.length },
      });

      let buffer: Buffer;
      try {
        buffer = await executeDocxCode(code);
      } finally {
        docConcurrencyLimiter.release();
      }

      const bufferCheck = validateBufferSize(buffer, "docx");
      if (!bufferCheck.valid) {
        return res.status(500).json({ error: bufferCheck.error });
      }

      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_success",
        docType: "docx-code",
        durationMs: Date.now() - startTime,
        details: { bufferSize: buffer.length },
      });

      const filename = sanitizeFilename("document", ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error: any) {
      console.error("Code execution error:", error);
      logDocumentEvent({
        timestamp: new Date().toISOString(),
        event: "generate_failure",
        docType: "docx-code",
        durationMs: Date.now() - startTime,
        details: { error: error.message },
      });
      const response = safeErrorResponse("Failed to execute document code", error);
      if (!IS_PRODUCTION) {
        (response as any).hint = "Check your code syntax and ensure createDocument() function is defined";
      }
      res.status(500).json(response);
    }
  });

  // ============================================
  // DOCUMENT PLAN (LLM-DRIVEN)
  // ============================================

  router.post("/plan", async (req, res) => {
    try {
      const { prompt, selectedText, documentContent } = req.body;

      // Validate prompt
      const promptCheck = validatePrompt(prompt);
      if (!promptCheck.valid) {
        return res.status(400).json({ error: promptCheck.error });
      }

      // Validate optional fields
      if (selectedText && (typeof selectedText !== "string" || selectedText.length > 10000)) {
        return res.status(400).json({ error: "selectedText must be a string with max 10000 characters" });
      }
      if (documentContent && (typeof documentContent !== "string" || documentContent.length > 50000)) {
        return res.status(400).json({ error: "documentContent must be a string with max 50000 characters" });
      }

      const systemPrompt = `You are a document editing assistant. Given a user's instruction, generate a plan of document editing commands.

Available commands:
- bold: Toggle bold formatting
- italic: Toggle italic formatting
- underline: Toggle underline formatting
- strikethrough: Toggle strikethrough
- heading1, heading2, heading3: Set heading level
- paragraph: Set as paragraph
- bulletList: Toggle bullet list
- orderedList: Toggle numbered list
- alignLeft, alignCenter, alignRight, alignJustify: Text alignment
- insertLink: Insert link (payload: {url: string})
- insertImage: Insert image (payload: {src: string})
- insertTable: Insert table (payload: {rows: number, cols: number})
- blockquote: Toggle blockquote
- codeBlock: Toggle code block
- insertHorizontalRule: Insert horizontal line
- setTextColor: Set text color (payload: {color: string})
- setHighlight: Highlight text (payload: {color: string})
- insertText: Insert text (payload: {text: string})
- replaceSelection: Replace selected text (payload: {content: string})
- clearFormatting: Remove all formatting

Respond with a JSON object containing:
{
  "intent": "brief description of what user wants",
  "commands": [
    {"name": "commandName", "payload": {...}, "description": "what this step does"}
  ]
}

Only respond with valid JSON, no markdown code blocks.`;

      const userMessage = `User instruction: ${promptCheck.sanitizedPrompt}
${selectedText ? `\nSelected text: "${selectedText.substring(0, 2000)}"` : ''}
${documentContent ? `\nDocument context (first 500 chars): "${documentContent.substring(0, 500)}"` : ''}

Generate the command plan:`;

      const result = await llmGateway.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ], {
        temperature: 0.3,
        maxTokens: 1024,
      });

      let plan;
      try {
        const jsonStr = result.content.replace(/```json\n?|\n?```/g, '').trim();
        plan = JSON.parse(jsonStr);
      } catch {
        plan = {
          intent: promptCheck.sanitizedPrompt,
          commands: [],
          error: "Failed to parse AI response"
        };
      }

      res.json(plan);
    } catch (error: any) {
      console.error("Document plan error:", error);
      res.status(500).json(safeErrorResponse("Failed to generate document plan", error));
    }
  });

  // ============================================
  // WORD EDITOR PRO ENDPOINTS
  // ============================================

  // Import DOCX and convert to code
  router.post("/import", async (req, res) => {
    try {
      const code = `async function createDocument() {
  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      children: [
        new Paragraph({
          children: [new TextRun({ text: "Contenido importado", bold: true })]
        }),
        new Paragraph({
          children: [new TextRun({ text: "Edita este documento según tus necesidades." })]
        })
      ]
    }]
  });
  return doc;
}`;
      res.json({ code });
    } catch (error: any) {
      res.status(500).json(safeErrorResponse("Import failed", error));
    }
  });

  // Grammar check using LLM
  router.post("/grammar-check", async (req, res) => {
    try {
      const { code } = req.body;

      if (!code || typeof code !== "string") {
        return res.status(400).json({ error: "Code is required" });
      }

      if (code.length > MAX_DOC_BODY_SIZE) {
        return res.status(400).json({ error: `Code exceeds maximum size of ${MAX_DOC_BODY_SIZE / 1024}KB` });
      }

      const textMatches = code.match(/text:\s*["'`]([^"'`]+)["'`]/g) || [];
      const texts = textMatches.map((m: string) => m.replace(/text:\s*["'`]|["'`]$/g, ''));

      if (texts.length === 0) {
        return res.json({ errors: [] });
      }

      const result = await llmGateway.chat([
        {
          role: "system",
          content: "Eres un corrector gramatical. Analiza el texto y devuelve errores en formato JSON array. Cada error debe tener: {text, suggestion, type}. Solo responde con JSON válido."
        },
        {
          role: "user",
          content: `Revisa estos textos y encuentra errores gramaticales u ortográficos:\n${texts.join('\n')}`
        }
      ], { temperature: 0.1, maxTokens: 500 });

      let errors: string[] = [];
      try {
        const parsed = JSON.parse(result.content.replace(/```json\n?|\n?```/g, ''));
        errors = parsed.map((e: any) => `${e.text} → ${e.suggestion}`);
      } catch {
        errors = [];
      }

      res.json({ errors });
    } catch (error: any) {
      res.status(500).json(safeErrorResponse("Grammar check failed", error));
    }
  });

  // Translate document code
  router.post("/translate", async (req, res) => {
    try {
      const { code, targetLang = "en" } = req.body;

      if (!code || typeof code !== "string") {
        return res.status(400).json({ error: "Code is required" });
      }

      if (code.length > MAX_DOC_BODY_SIZE) {
        return res.status(400).json({ error: `Code exceeds maximum size of ${MAX_DOC_BODY_SIZE / 1024}KB` });
      }

      // Validate target language
      const validLangs = ["en", "es", "fr", "pt", "de"];
      if (typeof targetLang !== "string" || !validLangs.includes(targetLang)) {
        return res.status(400).json({ error: `Invalid target language. Use one of: ${validLangs.join(", ")}` });
      }

      const langNames: Record<string, string> = {
        en: "English",
        es: "Spanish",
        fr: "French",
        pt: "Portuguese",
        de: "German"
      };

      const result = await llmGateway.chat([
        {
          role: "system",
          content: `You are a document translator. Translate all text content in the docx code to ${langNames[targetLang] || targetLang}. Keep the code structure identical, only translate the text strings inside TextRun, Paragraph, etc. Return only the translated code.`
        },
        {
          role: "user",
          content: code
        }
      ], { temperature: 0.2, maxTokens: 4000 });

      res.json({ translatedCode: result.content });
    } catch (error: any) {
      res.status(500).json(safeErrorResponse("Translation failed", error));
    }
  });

  // ============================================
  // DOCUMENT SHARING (WITH TTL)
  // ============================================

  router.post("/share", async (req, res) => {
    try {
      const shareId = crypto.randomUUID().slice(0, 8);
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const shareUrl = `${baseUrl}/api/documents/shared/${shareId}`;

      // In production, store the document buffer with the ID via sharedDocumentStore
      // const stored = sharedDocumentStore.set(shareId, { blob: buffer, filename: "doc.docx" });
      // if (!stored) return res.status(429).json({ error: "Too many shared documents" });

      res.json({ shareUrl, expiresIn: "24 hours" });
    } catch (error: any) {
      res.status(500).json(safeErrorResponse("Share failed", error));
    }
  });

  router.get("/shared/:id", async (req, res) => {
    try {
      const doc = sharedDocumentStore.get(req.params.id);
      if (!doc) {
        return res.status(404).json({ error: "Document not found or expired" });
      }
      const filename = sanitizeFilename(doc.filename || "shared_document", ".docx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", safeContentDisposition(filename));
      res.send(doc.blob);
    } catch (error: any) {
      res.status(500).json({ error: "Download failed" });
    }
  });

  // Email endpoint (placeholder)
  router.post("/email", async (req, res) => {
    try {
      res.json({ success: true, message: "Email would be sent in production" });
    } catch (error: any) {
      res.status(500).json(safeErrorResponse("Email failed", error));
    }
  });

  // PDF conversion endpoint (placeholder)
  router.post("/convert-to-pdf", async (req, res) => {
    try {
      res.status(501).json({ error: "PDF conversion requires LibreOffice installation" });
    } catch (error: any) {
      res.status(500).json(safeErrorResponse("PDF conversion failed", error));
    }
  });

  return router;
}
