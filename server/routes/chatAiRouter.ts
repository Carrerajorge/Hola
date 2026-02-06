import { Router } from "express";
import { storage } from "../storage";
import { chatService, AVAILABLE_MODELS, DEFAULT_PROVIDER, DEFAULT_MODEL } from "../services/ChatServiceV2";
import { llmGateway } from "../lib/llmGateway";
import { normalizeProvider } from "../lib/llmProviders";
import { getOrCreateSession, getEnforcedModel, getSessionById, type GptSessionContract } from "../services/gptSessionService";
import { generateImage, detectImageRequest, extractImagePrompt } from "../services/imageGeneration";
import { runETLAgent, getAvailableCountries, getAvailableIndicators } from "../etl";
import { extractAllAttachmentsContent, extractAttachmentContent, formatAttachmentsAsContext, type Attachment } from "../services/attachmentService";
import { pareOrchestrator, type RobustRouteResult, type SimpleAttachment } from "../services/pare";
import { DocumentBatchProcessor, type BatchProcessingResult, type SimpleAttachment as BatchAttachment } from "../services/documentBatchProcessor";
import { pareRequestContract, pareRateLimiter, pareQuotaGuard, requirePareContext, pareIdempotencyGuard, pareAnalyzeSchemaValidator } from "../middleware";
import { completeIdempotencyKey, failIdempotencyKey } from "../lib/idempotencyStore";
import { createPareLogger, type PareLogger } from "../lib/pareLogger";
import { pareMetrics } from "../lib/pareMetrics";
import { AuditTrailCollector, type AuditBatchSummary } from "../lib/pareAuditTrail";
import { createChunkStore } from "../lib/pareChunkStore";
import { withSpan, SPAN_NAMES, SPAN_ATTRIBUTES } from "../lib/tracing";
import { normalizeDocument } from "../services/structuredDocumentNormalizer";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import type { DocumentSemanticModel, Table, Metric, Anomaly, Insight, SuggestedQuestion, SheetSummary } from "../../shared/schemas/documentSemanticModel";
import { buildCanonicalBrief, type BriefAttachmentSummary } from "../pipeline/requestUnderstanding/requestUnderstandingAgent";
import { ingestSemanticDocumentToChunks } from "../pipeline/ingestion2026/documentIngestion2026";
import type { IngestedChunk } from "../pipeline/ingestion2026/ingestionTypes";
import { indexIngestedChunksToFileChunks } from "../pipeline/ingestion2026/indexToFileChunks";
import { extractImageSemantics } from "../pipeline/ingestion2026/imageIngestion2026";
import { loadEncargoContext, rememberEncargoContext } from "../pipeline/context/encargoContextStore";
import { loadPersistentEncargoContextFromDb } from "../pipeline/context/encargoPersistentContext";
import { hybridRetrieveInMemory } from "../pipeline/retrieval/hybridRetrieval";
import { hybridRetrieveFromDb } from "../pipeline/retrieval/hybridRetrievalDb";
import { rerankCandidatesWithLlm } from "../pipeline/retrieval/llmReranker";
import { verifyAnswer } from "../pipeline/verifier/verifier";
import { agentEventBus } from "../agent/eventBus";
import { createUnifiedRun, hydrateSessionState, emitTraceEvent } from "../agent/unifiedChatHandler";
import type { UnifiedChatRequest, UnifiedChatContext } from "../agent/unifiedChatHandler";
import { createRequestSpec, AttachmentSpecSchema } from "../agent/requestSpec";
import { routeIntent, type IntentResult } from "../services/intentRouter";
import { questionClassifier, type QuestionClassification } from "../services/questionClassifier";
import { answerFirstEnforcer } from "../services/answerFirstEnforcer";
import { academicSearchService } from "../services/academicSearchService";
import { isProductionIntent, handleProductionRequest, getDeliverables } from "../services/productionHandler";
import type { z } from "zod";

type AttachmentSpec = z.infer<typeof AttachmentSpecSchema>;

import { v4 as uuidv4 } from "uuid";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../types/express";
import { usageQuotaService, type UsageCheckResult } from "../services/usageQuotaService";
import { conversationMemoryManager } from "../services/conversationMemory";

type ErrorCategory = 'network' | 'rate_limit' | 'api_error' | 'validation' | 'auth' | 'timeout' | 'unknown';

function writeSse(res: Response, event: string, data: object): boolean {
  try {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(chunk);
    if (typeof (res as unknown as { flush: Function }).flush === 'function') {
      (res as unknown as { flush: Function }).flush();
    } else if (res.socket && typeof res.socket.write === 'function') {
      res.socket.write('');
    }
    return true;
  } catch (err) {
    console.error('[SSE] Write failed:', err);
    return false;
  }
}

function buildExtractedTextFromChunks(chunks: IngestedChunk[], maxChars = 40_000): string {
  const parts: string[] = [];
  for (const c of chunks) {
    if (c.kind !== "document") continue;
    const body = (c.rawContent || c.content || "").trim();
    if (!body) continue;
    parts.push(body);
    if (parts.length >= 120) break;
  }
  const joined = parts.join("\n\n---\n\n").trim();
  if (!joined) return "";
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}

interface CategorizedError {
  category: ErrorCategory;
  userMessage: string;
  technicalDetails: string;
  requestId: string;
  retryable: boolean;
  statusCode: number;
}

function categorizeError(error: any, requestId: string): CategorizedError {
  const errorMessage = error?.message?.toLowerCase() || '';
  const errorCode = error?.code || error?.statusCode;

  if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests') || errorCode === 429) {
    return {
      category: 'rate_limit',
      userMessage: 'Has excedido el límite de solicitudes. Por favor espera unos segundos e intenta de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 429
    };
  }

  if (errorMessage.includes('timeout') || errorMessage.includes('timed out') || errorCode === 'ETIMEDOUT') {
    return {
      category: 'timeout',
      userMessage: 'La solicitud tardó demasiado tiempo. Por favor intenta de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 504
    };
  }

  if (errorMessage.includes('network') || errorMessage.includes('econnrefused') ||
    errorMessage.includes('enotfound') || errorCode === 'ECONNREFUSED') {
    return {
      category: 'network',
      userMessage: 'Error de conexión. Verifica tu conexión a internet e intenta de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 503
    };
  }

  if (errorMessage.includes('unauthorized') || errorMessage.includes('authentication') ||
    errorCode === 401 || errorCode === 403) {
    return {
      category: 'auth',
      userMessage: 'Error de autenticación. Por favor inicia sesión de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: false,
      statusCode: 401
    };
  }

  if (errorMessage.includes('invalid') || errorMessage.includes('validation') || errorCode === 400) {
    return {
      category: 'validation',
      userMessage: 'Los datos enviados no son válidos. Por favor verifica tu solicitud.',
      technicalDetails: error.message,
      requestId,
      retryable: false,
      statusCode: 400
    };
  }

  if (error?.response?.status >= 500 || errorMessage.includes('internal') || errorMessage.includes('server error')) {
    return {
      category: 'api_error',
      userMessage: 'El servicio de IA está experimentando problemas. Por favor intenta de nuevo en unos minutos.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 502
    };
  }

  return {
    category: 'unknown',
    userMessage: 'Ocurrió un error inesperado. Por favor intenta de nuevo.',
    technicalDetails: error.message || 'Unknown error',
    requestId,
    retryable: true,
    statusCode: 500
  };
}

export function createChatAiRouter(broadcastAgentUpdate: (runId: string, update: any) => void) {
  const router = Router();

  router.get("/models", (req, res) => {
    res.json(AVAILABLE_MODELS);
  });

  // Helper function to detect if a file is a document (not an image)
  // Uses mimeType AND file extension for reliable detection
  const isDocumentAttachment = (mimeType: string, fileName: string, type?: string): boolean => {
    const lowerMime = (mimeType || "").toLowerCase();
    const lowerName = (fileName || "").toLowerCase();
    const lowerType = (type || "").toLowerCase();

    // Check for explicit image type/MIME first
    if (lowerType === "image" || lowerMime.startsWith("image/")) return false;

    // Document MIME patterns
    const docMimePatterns = [
      "pdf", "word", "document", "sheet", "excel",
      "spreadsheet", "presentation", "powerpoint", "csv",
      "text/plain", "text/csv", "application/json"
    ];
    if (docMimePatterns.some(p => lowerMime.includes(p))) return true;

    // Document file extensions
    const docExtensions = [
      ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
      ".csv", ".txt", ".json", ".rtf", ".odt", ".ods", ".odp"
    ];
    if (docExtensions.some(ext => lowerName.endsWith(ext))) return true;

    // If type is explicitly a document type
    if (["pdf", "word", "excel", "ppt", "document"].includes(lowerType)) return true;

    // If mimeType is empty/unknown, check extension before treating as document
    if (!lowerMime || lowerMime === "application/octet-stream") {
      const hasImageExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"].some(ext => lowerName.endsWith(ext));
      return !hasImageExt; // If not an image extension, treat as document
    }

    return false;
  };

  const shouldIncludeStoredEncargoContext = (text: string): boolean => {
    const t = (text || "").toLowerCase();
    if (!t) return false;

    // Only trigger when the user is clearly referring to an existing file/image/table,
    // not when they just say "crear un documento" (production mode already covers that).
    const refersToAttachments = /\b(adjunt|archivo|pdf|excel|xlsx|docx|pptx|imagen|captura|screenshot|tabla|hoja|sheet|seg[uú]n|con base en|del\s+(documento|pdf|excel|archivo|adjunto)|en\s+el\s+(documento|pdf|excel|archivo)|en\s+la\s+(imagen|captura))\b/i.test(t);

    // Also trigger when the user refers to the "previous/earlier" output in the same conversation.
    // This prevents "context loss" when the user says "mejora el documento anterior" without re-attaching files.
    const refersToPreviousOutput =
      /\b(anterior|previo|previ[oa]|de\s+antes|lo\s+anterior|respuesta\s+anterior|versi[oó]n\s+anterior|que\s+me\s+diste|que\s+generaste|que\s+hiciste)\b/i.test(t) &&
      /\b(documento|doc|archivo|texto|borrador|informe|reporte|presentaci[oó]n|plan)\b/i.test(t);

    const editVerbs = /\b(mejor|corrig|correg|revis|editar|edita|pulir|optimiza|ajusta|refina|reescrib|re-escrib|actualiza)\b/i.test(t);
    const refersToThatThing = /\b(lo\s+anterior|el\s+anterior|la\s+anterior|ese\s+(documento|archivo|texto)|el\s+documento\s+anterior)\b/i.test(t);

    return refersToAttachments || refersToPreviousOutput || (editVerbs && refersToThatThing);
  };

  router.post("/chat", async (req, res) => {
    try {
      const requestId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const { messages: clientMessages, useRag = true, conversationId, images, gptConfig, gptId, documentMode, figmaMode, provider = DEFAULT_PROVIDER, model = DEFAULT_MODEL, attachments, lastImageBase64, lastImageId, session_id } = req.body;
      const normalizedProvider = normalizeProvider(provider) ?? DEFAULT_PROVIDER;

      if (!clientMessages || !Array.isArray(clientMessages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const user = (req as AuthenticatedRequest).user;
      const userId = user?.claims?.sub;

      // CONTEXT FIX: Augment client messages with server-side history
      const messages = await conversationMemoryManager.augmentWithHistory(
        conversationId,
        clientMessages,
        8000 // token budget
      );
      console.log(`[Chat API] Context augmented: ${clientMessages.length} client msgs -> ${messages.length} total`);

      // userId already extracted above

      if (userId) {
        // 1. Token Quota Check (Read-only)
        const hasTokenQuota = await usageQuotaService.hasTokenQuota(userId);
        if (!hasTokenQuota) {
          return res.status(402).json({
            error: "Has excedido tu límite de tokens. Actualiza tu plan para continuar.",
            code: "TOKEN_QUOTA_EXCEEDED"
          });
        }

        // 2. Daily Request Limit Check (Increments)
        const usageCheck = await usageQuotaService.checkAndIncrementUsage(userId);
        if (!usageCheck.allowed) {
          return res.status(402).json({
            error: usageCheck.message || "Límite de solicitudes alcanzado",
            code: "QUOTA_EXCEEDED",
            quota: {
              remaining: usageCheck.remaining,
              limit: usageCheck.limit,
              resetAt: usageCheck.resetAt,
              plan: usageCheck.plan
            }
          });
        }
      }

      // GPT Session Contract Resolution
      // Priority: session_id (reuse existing) > gptId (create new) > gptConfig (legacy)
      let gptSessionContract: GptSessionContract | null = null;
      let effectiveModel = model;
      let serverSessionId: string | null = null;

      // Helper to determine if conversationId is valid for session lookup
      const isValidConversationId = (id?: string): boolean => {
        if (!id) return false;
        if (id.startsWith('pending-')) return false;
        if (id.trim() === '') return false;
        return true;
      };

      // First, try to retrieve existing session by session_id
      if (session_id) {
        try {
          gptSessionContract = await getSessionById(session_id);
          if (gptSessionContract) {
            serverSessionId = gptSessionContract.sessionId;
            effectiveModel = getEnforcedModel(gptSessionContract, model);
            console.log(`[Chat API] Reusing existing session: session_id=${session_id}, gptId=${gptSessionContract.gptId}, configVersion=${gptSessionContract.configVersion}`);
          } else {
            console.log(`[Chat API] Session not found: session_id=${session_id}, will create new if gptId provided`);
          }
        } catch (sessionError) {
          console.error(`[Chat API] Error retrieving session ${session_id}:`, sessionError);
        }
      }

      // If no session from session_id, try to create/get one via gptId
      if (!gptSessionContract && gptId) {
        try {
          if (isValidConversationId(conversationId)) {
            // Valid conversationId - use it for session lookup
            gptSessionContract = await getOrCreateSession(conversationId, gptId);
            console.log(`[Chat API] GPT Session created/retrieved: gptId=${gptId}, configVersion=${gptSessionContract.configVersion}`);
          } else {
            // No valid conversationId - create session with null chatId (still persisted)
            gptSessionContract = await getOrCreateSession("", gptId);
            console.log(`[Chat API] New GPT Session created: gptId=${gptId}, sessionId=${gptSessionContract.sessionId}, configVersion=${gptSessionContract.configVersion}`);
          }
          serverSessionId = gptSessionContract.sessionId;
          effectiveModel = getEnforcedModel(gptSessionContract, model);
        } catch (sessionError) {
          console.error(`[Chat API] Error creating GPT session for gptId=${gptId}:`, sessionError);
          // Fall back to legacy gptConfig if session creation fails
        }
      }

      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      // Resolve storagePaths for attachments (some clients only send fileId).
      const resolvedAttachments: any[] = [];
      if (attachments && Array.isArray(attachments)) {
        for (const att of attachments) {
          const resolved = { ...att };
          if (!resolved.storagePath && resolved.fileId) {
            const fileRecord = await storage.getFile(resolved.fileId);
            if (fileRecord && fileRecord.storagePath) {
              resolved.storagePath = fileRecord.storagePath;
            }
          }
          resolvedAttachments.push(resolved);
        }
      }

      const hasAttachments = resolvedAttachments.length > 0;
      const hasLastImageContext = !!lastImageBase64 && !!lastImageId;
      const inlineImages: string[] = Array.isArray(images) ? images.filter((x: any) => typeof x === "string") : [];

      // ===== ingestion2026 → canonical brief (gating) → hybrid RAG → verifier (when attachments/images exist) =====
      const userMessageText = ([...formattedMessages].reverse().find(m => m.role === "user")?.content || "").toString();

      const contextChatId = typeof conversationId === "string" ? conversationId : "";
      const wantsStoredContext = isValidConversationId(contextChatId) && shouldIncludeStoredEncargoContext(userMessageText);
      const storedContext = wantsStoredContext ? loadEncargoContext(contextChatId) : null;

      const shouldUseEncargoPipeline = hasAttachments || hasLastImageContext || inlineImages.length > 0 || wantsStoredContext;
      const allChunks: IngestedChunk[] = [];
      const briefAttachments: BriefAttachmentSummary[] = [];
      const failedFiles: Array<{ filename: string; error: string }> = [];
      const indexedFileIds = new Set<string>();

      const seenChunkIds = new Set<string>();
      const seenBriefAttachmentKeys = new Set<string>();
      let persistentFileIds: string[] = [];
      const addChunk = (chunk: IngestedChunk) => {
        if (seenChunkIds.has(chunk.id)) return;
        seenChunkIds.add(chunk.id);
        allChunks.push(chunk);
      };
      const addBriefAttachment = (att: BriefAttachmentSummary) => {
        const key = `${att.kind}:${att.id}`;
        if (seenBriefAttachmentKeys.has(key)) return;
        seenBriefAttachmentKeys.add(key);
        briefAttachments.push(att);
      };

      if (wantsStoredContext) {
        if (storedContext) {
          for (const c of storedContext.chunks) addChunk(c);
          for (const a of storedContext.attachments) addBriefAttachment(a);
        } else if (contextChatId) {
          const dbRetrievalEnabled = String(process.env.ENCARGO_DB_RETRIEVAL_ENABLED || "true").toLowerCase() === "true";
          const includeDocumentChunks = !(dbRetrievalEnabled && !hasAttachments && !hasLastImageContext && inlineImages.length === 0);
          const persistent = await loadPersistentEncargoContextFromDb({
            chatId: contextChatId,
            maxDocuments: 5,
            maxChunksTotal: 600,
            includeDocumentChunks,
          });
          if (persistent) {
            persistentFileIds = persistent.fileIds || [];
            for (const c of persistent.chunks) addChunk(c);
            for (const a of persistent.attachments) addBriefAttachment(a);
          }
        }
      }

      if (shouldUseEncargoPipeline) {
        const objectStorageService = new ObjectStorageService();

        // Ingest resolved attachments (documents + images)
        if (hasAttachments) {
          for (const att of resolvedAttachments) {
            const filename = att.name || 'attachment';
            const mimeType = (att.mimeType || att.type || 'application/octet-stream').toLowerCase();
            const isImage = mimeType.startsWith("image/") || String(att.type || "").toLowerCase() === "image";

            try {
              let buffer: Buffer;
              if (att.storagePath) {
                buffer = await objectStorageService.getObjectEntityBuffer(att.storagePath);
              } else if (att.content) {
                buffer = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content, 'base64');
              } else {
                throw new Error('No storagePath or content provided for attachment');
              }

              if (isImage) {
                const imageId = att.fileId || `img_${filename}_${Date.now()}`;
                const base64 = buffer.toString("base64");
                const { extraction, chunk } = await extractImageSemantics({
                  imageId,
                  base64,
                  requestId,
                  userId: userId || conversationId || "anonymous",
                });
                addChunk(chunk);
                addBriefAttachment({
                  id: imageId,
                  kind: "image",
                  label: filename,
                  mimeType,
                  summary: [extraction.summary, extraction.detected_text ? `TEXT: ${extraction.detected_text.slice(0, 300)}` : ""].filter(Boolean).join("\n"),
                  citationHint: `img:${imageId}`,
                });
                continue;
              }

              const docModel = await normalizeDocument(buffer, filename, att.storagePath);
              const { chunks, summary } = ingestSemanticDocumentToChunks({ model: docModel, mimeType });
              for (const c of chunks) addChunk(c);

              const docSummaryLines = [
                `${summary.filename} (${summary.documentType || 'document'}, mime=${summary.mimeType})`,
                summary.pageCount ? `Pages: ${summary.pageCount}` : '',
                summary.sheetCount ? `Sheets: ${summary.sheetCount}` : '',
                `Sections: ${summary.sectionCount}, Tables: ${summary.tableCount}`,
                summary.headingPreview.length ? `Headings: ${summary.headingPreview.join(" | ")}` : '',
                summary.notes && summary.notes.length ? `Warnings: ${summary.notes.slice(0, 3).join(" | ")}` : '',
              ].filter(Boolean).join("\n");

              addBriefAttachment({
                id: att.fileId || summary.docId || filename,
                kind: "document",
                label: filename,
                mimeType,
                summary: docSummaryLines,
                citationHint: `doc:${filename}`,
              });

              // Persist a lightweight conversation document record for durable cross-turn context
              // (used by KnowledgeBaseService + persistent context loader).
              if (isValidConversationId(contextChatId)) {
                const extractedText = buildExtractedTextFromChunks(chunks);
                if (extractedText) {
                  const fileId = typeof att.fileId === "string" ? att.fileId : undefined;
                  queueMicrotask(() => {
                    storage.createConversationDocument({
                      chatId: contextChatId,
                      messageId: null,
                      fileName: filename,
                      storagePath: att.storagePath || null,
                      mimeType,
                      fileSize: buffer.length,
                      extractedText,
                      metadata: {
                        fileId,
                        ingestionVersion: "ingestion2026",
                        chunkCount: chunks.length,
                        pageCount: summary.pageCount,
                        sheetCount: summary.sheetCount,
                      },
                    }).catch((err: any) => {
                      console.warn(`[Chat API] Failed to persist conversationDocument for ${filename}:`, err?.message || err);
                    });
                  });
                }
              }

              // Optional: DB index ingestion2026 chunks for durable RAG across turns.
              const fileIdToIndex = typeof att.fileId === "string" ? att.fileId : null;
              const dbIndexEnabled = String(process.env.ENCARGO_DB_INDEX_ENABLED || "true").toLowerCase() === "true";
              if (dbIndexEnabled && fileIdToIndex && !indexedFileIds.has(fileIdToIndex)) {
                indexedFileIds.add(fileIdToIndex);
                queueMicrotask(() => {
                  indexIngestedChunksToFileChunks({
                    fileId: fileIdToIndex,
                    chunks,
                    filename,
                    userId: userId || undefined,
                    requestId,
                    ingestionVersion: "ingestion2026",
                  }).catch((err: any) => {
                    console.warn(`[Chat API] Failed to index file_chunks for ${filename} (${fileIdToIndex}):`, err?.message || err);
                  });
                });
              }
            } catch (err: any) {
              const msg = err?.message || String(err);
              failedFiles.push({ filename, error: msg });
              console.error(`[Chat API] ingestion2026 failed for ${filename}:`, msg);
              // Ensure the brief step knows a file existed but could not be ingested (prevents "silent" missing context).
              addBriefAttachment({
                id: att.fileId || filename,
                kind: isImage ? "image" : "document",
                label: filename,
                mimeType,
                summary: `FAILED_TO_INGEST: ${msg}`,
              });
            }
          }
        }

        // Ingest last image context (edit / follow-up tasks)
        if (hasLastImageContext) {
          try {
            const { extraction, chunk } = await extractImageSemantics({
              imageId: String(lastImageId),
              base64: String(lastImageBase64),
              requestId,
              userId: userId || conversationId || "anonymous",
            });
            addChunk(chunk);
            addBriefAttachment({
              id: String(lastImageId),
              kind: "image",
              label: `lastImage:${lastImageId}`,
              mimeType: "image/*",
              summary: [extraction.summary, extraction.detected_text ? `TEXT: ${extraction.detected_text.slice(0, 300)}` : ""].filter(Boolean).join("\n"),
              citationHint: `img:${lastImageId}`,
            });
          } catch (imgErr: any) {
            console.warn(`[Chat API] Image context extraction failed (${lastImageId}):`, imgErr?.message || imgErr);
          }
        }

        // Ingest inline image data URLs (cap to avoid runaway costs)
        const parseDataUrlBase64 = (dataUrl: string): string | null => {
          const s = (dataUrl || "").trim();
          if (!s) return null;
          if (s.startsWith("data:")) {
            const idx = s.indexOf("base64,");
            if (idx === -1) return null;
            return s.slice(idx + "base64,".length).trim() || null;
          }
          // If the client sent raw base64, accept it.
          if (/^[A-Za-z0-9+/=\n\r]+$/.test(s) && s.length > 100) return s.replace(/\s+/g, "");
          return null;
        };

        for (let i = 0; i < Math.min(3, inlineImages.length); i++) {
          const base64 = parseDataUrlBase64(inlineImages[i]);
          if (!base64) continue;
          const imageId = `inline_${Date.now()}_${i}`;
          try {
            const { extraction, chunk } = await extractImageSemantics({
              imageId,
              base64,
              requestId,
              userId: userId || conversationId || "anonymous",
            });
            addChunk(chunk);
            addBriefAttachment({
              id: imageId,
              kind: "image",
              label: `inlineImage:${i + 1}`,
              mimeType: "image/*",
              summary: [extraction.summary, extraction.detected_text ? `TEXT: ${extraction.detected_text.slice(0, 300)}` : ""].filter(Boolean).join("\n"),
              citationHint: `img:${imageId}`,
            });
          } catch (imgErr: any) {
            console.warn(`[Chat API] Inline image extraction failed (#${i + 1}):`, imgErr?.message || imgErr);
          }
        }
      }

      if (contextChatId && shouldUseEncargoPipeline && (allChunks.length > 0 || briefAttachments.length > 0)) {
        rememberEncargoContext({
          chatId: contextChatId,
          chunks: allChunks,
          attachments: briefAttachments,
        });
      }

      // ===== 1) Canonical brief (gating, always) =====
      const briefRes = await withSpan(
        SPAN_NAMES.PIPELINE_STAGE,
        async (span) => {
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, "encargo");
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, "brief");
          span.setAttribute("encargo.attachments_summaries", briefAttachments.length);
          span.setAttribute("encargo.chunks_total", allChunks.length);
          return buildCanonicalBrief({
            userMessage: userMessageText,
            conversationContext: formattedMessages,
            attachments: briefAttachments,
            requestId,
            userId: userId || conversationId || "anonymous",
          });
        },
        { userId: userId || conversationId || "anonymous", requestId }
      );

      const brief = briefRes.brief;

      if (brief.blocker.is_blocked && brief.blocker.clarification_question) {
        const question = brief.blocker.clarification_question.trim();
        return res.json({
          content: question,
          role: "assistant",
          metadata: { brief, blocked: true }
        });
      }

      // If we ingested context, run the encargo pipeline end-to-end (RAG + citations + verifier).
      if (shouldUseEncargoPipeline) {
        const retrieval = await withSpan(
          SPAN_NAMES.PIPELINE_STAGE,
          async (span) => {
            span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, "encargo");
            span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, "retrieval");
            span.setAttribute("encargo.chunks_total", allChunks.length);
            const dbRetrievalEnabled = String(process.env.ENCARGO_DB_RETRIEVAL_ENABLED || "true").toLowerCase() === "true";
            const shouldUseDbRetrieval =
              dbRetrievalEnabled &&
              persistentFileIds.length > 0 &&
              !hasAttachments &&
              !hasLastImageContext &&
              inlineImages.length === 0;

            span.setAttribute("encargo.retrieval_mode", shouldUseDbRetrieval ? "db" : "memory");

            if (!shouldUseDbRetrieval) {
              return hybridRetrieveInMemory({
                query: userMessageText,
                chunks: allChunks,
                topK: Math.min(24, allChunks.length || 24),
                enableGraphExpansion: allChunks.filter(c => c.kind === 'document').length > 20,
              });
            }

            try {
              const dbRes = await hybridRetrieveFromDb({
                query: userMessageText,
                fileIds: persistentFileIds,
                userId,
                topK: 18,
              });

              const nonDocChunks = allChunks.filter(c => c.kind !== "document");
              if (nonDocChunks.length === 0) return dbRes;

              const memRes = await hybridRetrieveInMemory({
                query: userMessageText,
                chunks: nonDocChunks,
                topK: 6,
                enableGraphExpansion: false,
              });

              const merged = [...dbRes.selected, ...memRes.selected]
                .sort((a, b) => b.hybridScore - a.hybridScore)
                .slice(0, 24);

              return {
                query: userMessageText,
                selected: merged,
                stats: {
                  totalChunks: (dbRes.stats?.totalChunks || 0) + (memRes.stats?.totalChunks || 0),
                  keywordCandidates: (dbRes.stats?.keywordCandidates || 0) + (memRes.stats?.keywordCandidates || 0),
                  embeddedCandidates: (dbRes.stats?.embeddedCandidates || 0) + (memRes.stats?.embeddedCandidates || 0),
                  graphExpanded: Boolean(dbRes.stats?.graphExpanded || memRes.stats?.graphExpanded),
                  durationMs: (dbRes.stats?.durationMs || 0) + (memRes.stats?.durationMs || 0),
                },
              };
            } catch (err: any) {
              span.setAttribute("encargo.retrieval_mode", "db_failed_fallback");
              console.warn(`[Chat API] DB retrieval failed; falling back to in-memory:`, err?.message || err);
              return hybridRetrieveInMemory({
                query: userMessageText,
                chunks: allChunks,
                topK: Math.min(24, allChunks.length || 24),
                enableGraphExpansion: allChunks.filter(c => c.kind === 'document').length > 20,
              });
            }
          },
          { userId: userId || conversationId || "anonymous", requestId }
        );

        let retrieved = retrieval.selected;

        const rerankEnabled = String(process.env.ENCARGO_RERANK_ENABLED || "true").toLowerCase() === "true";
        if (rerankEnabled && retrieved.length > 6) {
          const reranked = await withSpan(
            SPAN_NAMES.PIPELINE_STAGE,
            async (span) => {
              span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, "encargo");
              span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, "rerank");
              span.setAttribute("encargo.rerank_candidates", retrieved.length);
              return rerankCandidatesWithLlm({
                query: userMessageText,
                brief,
                candidates: retrieved,
                topK: Math.min(12, retrieved.length),
                userId: userId || conversationId || "anonymous",
                requestId,
              });
            },
            { userId: userId || conversationId || "anonymous", requestId }
          );

          retrieved = reranked.selected;
        }

        retrieved = retrieved.slice(0, Math.min(12, retrieved.length));
        const allowedCitationTags = retrieved.map(r => `[${r.chunk.sourceId}]`);
        const allowedCitationsBlock = allowedCitationTags.join("\n");
        const citationsPossible = allowedCitationTags.length > 0;

        // Build retrieval context within a token budget
        const MAX_CTX_TOKENS = 3500;
        let usedTokens = 0;
        const ctxParts: string[] = [];

        for (const r of retrieved) {
          const tag = `[${r.chunk.sourceId}]`;
          const body = (r.chunk.content || "").slice(0, 3000);
          const part = `${tag}\n${body}`.trim();
          const partTokens = Math.ceil(part.length / 4);
          if (usedTokens + partTokens > MAX_CTX_TOKENS) break;
          ctxParts.push(part);
          usedTokens += partTokens;
        }

        const retrievalContext = ctxParts.join("\n\n---\n\n").trim();

        const answerFirstPrompt = answerFirstEnforcer.generateAnswerFirstSystemPrompt(
          userMessageText,
          false
        );

        const briefSummaryForPrompt = JSON.stringify({
          primary_intent: brief.primary_intent,
          subtasks: brief.subtasks,
          deliverable: brief.deliverable,
          audience_tone: brief.audience_tone,
          restrictions: brief.restrictions,
          inputs: {
            provided: brief.inputs.provided.slice(0, 10),
            assumed: brief.inputs.assumed.slice(0, 10),
          },
          success_criteria: brief.success_criteria.slice(0, 10),
        });

        const citationsRules = citationsPossible
          ? [
              `CITAS OBLIGATORIAS:`,
              `- Cuando afirmes hechos concretos (fechas, numeros, definiciones, quotes), agrega al final de la frase una o mas citas EXACTAS de la lista permitida.`,
              `- Formato de cita: [doc:...], [img:...], [web:...] exactamente como aparecen abajo.`,
              `- Si la respuesta no se puede sustentar con las fuentes recuperadas, pide UNA sola aclaracion y DETENTE.`,
              ``,
              `CITAS PERMITIDAS (copiar/pegar tal cual):\n${allowedCitationsBlock || "(ninguna)"}`,
            ].join("\n")
          : [
              `CITAS:`,
              `- No hay fuentes recuperadas para citar (lista vacía). Responde SIN citas.`,
              `- Si el usuario EXIGE citas/fuentes, pide UNA sola aclaración sobre si puede adjuntar documentos o habilitar búsqueda web.`,
            ].join("\n");

        const systemContent = [
          answerFirstPrompt.fullPrompt,
          ``,
          `BRIEF_CANONICO (para ejecucion, no lo repitas literal):\n${briefSummaryForPrompt}`,
          ``,
          citationsRules,
          retrievalContext ? `\n\nFUENTES RECUPERADAS (usa solo esto como base factual y citalo):\n${retrievalContext}` : `\n\nFUENTES RECUPERADAS: (ninguna)`,
        ].join("\n");

        const systemMessage = {
          role: "system" as const,
          content: systemContent
        };

        const draft = await withSpan(
          SPAN_NAMES.PIPELINE_STAGE,
          async (span) => {
            span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, "encargo");
            span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, "draft_generate");
            span.setAttribute(SPAN_ATTRIBUTES.LLM_MODEL, effectiveModel);
            return llmGateway.chat(
              [systemMessage, ...formattedMessages],
              {
                userId: userId || conversationId || "anonymous",
                requestId,
                provider: normalizedProvider,
                model: effectiveModel,
                maxTokens: 2000,
                temperature: 0.4,
                disableImageGeneration: true,
                skipCache: true,
              }
            );
          },
          { userId: userId || conversationId || "anonymous", requestId }
        );

        const draftAnswer = (draft.content || "").trim() || "No pude generar una respuesta.";

        const verification = await withSpan(
          SPAN_NAMES.PIPELINE_STAGE,
          async (span) => {
            span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, "encargo");
            span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, "verifier");
            span.setAttribute("encargo.retrieved", retrieved.length);
            return verifyAnswer({
              userMessage: userMessageText,
              brief,
              draftAnswer,
              retrieved,
              requestId,
              userId: userId || conversationId || "anonymous",
            });
          },
          { userId: userId || conversationId || "anonymous", requestId }
        );

        const v = verification.result;
        const finalAnswer = (v.needs_clarification && v.clarification_question)
          ? v.clarification_question
          : v.final_answer;

        // Token Usage Accounting (best-effort; structured subcalls are logged via llmGateway API logs).
        if (userId && draft.usage?.totalTokens) {
          usageQuotaService.recordTokenUsage(userId, draft.usage.totalTokens).catch(err => {
            console.error(`[Chat API] Failed to record token usage for user ${userId}:`, err);
          });
        }

        const responseWithMetadata = gptSessionContract ? {
          content: finalAnswer,
          role: "assistant",
          metadata: {
            verified: v.verdict === 'pass',
            verificationAttempts: verification.attempts,
            brief: { ...brief, _raw_attempts: briefRes.attempts },
            retrieval: retrieval.stats,
            verification: {
              verdict: v.verdict,
              confidence: v.confidence,
              issues: v.issues?.slice(0, 20),
            },
            failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
          },
          usage: draft.usage,
          gpt_id: gptSessionContract.gptId,
          config_version: gptSessionContract.configVersion,
          tool_permissions: gptSessionContract.toolPermissions,
          session_id: serverSessionId || gptSessionContract.sessionId
        } : {
          content: finalAnswer,
          role: "assistant",
          metadata: {
            verified: v.verdict === 'pass',
            verificationAttempts: verification.attempts,
            brief: { ...brief, _raw_attempts: briefRes.attempts },
            retrieval: retrieval.stats,
            verification: {
              verdict: v.verdict,
              confidence: v.confidence,
              issues: v.issues?.slice(0, 20),
            },
            failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
          },
          usage: draft.usage,
        };

        return res.json(responseWithMetadata);
      }

      // Build gptSession info - prefer contract-based session over legacy gptConfig
      const gptSession = gptSessionContract ? {
        contract: gptSessionContract,
      } : gptConfig ? {
        contract: null,
        legacyConfig: gptConfig
      } : undefined;

      const briefSummaryForLegacy = JSON.stringify({
        primary_intent: brief.primary_intent,
        subtasks: brief.subtasks,
        deliverable: brief.deliverable,
        audience_tone: brief.audience_tone,
        restrictions: brief.restrictions,
        inputs: {
          provided: brief.inputs.provided.slice(0, 10),
          assumed: brief.inputs.assumed.slice(0, 10),
        },
        success_criteria: brief.success_criteria.slice(0, 10),
      });

      const formattedMessagesWithBrief = [
        {
          role: "system" as const,
          content: `BRIEF_CANONICO (para ejecucion, no lo repitas literal):\n${briefSummaryForLegacy}`,
        },
        ...formattedMessages,
      ];

      const response = await withSpan(
        SPAN_NAMES.PIPELINE_STAGE,
        async (span) => {
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, "chat");
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, "legacy_chat");
          span.setAttribute(SPAN_ATTRIBUTES.LLM_MODEL, effectiveModel);
          return chatService.chat(formattedMessagesWithBrief, {
            useRag,
            conversationId,
            userId,
            images,
            gptSession,
            gptConfig, // Keep for backward compatibility
            documentMode,
            figmaMode,
            provider: normalizedProvider,
            model: effectiveModel,
            attachmentContext: "",
            forceDirectResponse: false,
            hasRawAttachments: false,
            lastImageBase64,
            lastImageId,
            onAgentProgress: (update) => broadcastAgentUpdate(update.runId, update)
          });
        },
        { userId: userId || "anonymous", requestId }
      );

      // Token Usage Accounting
      if (userId && response.usage?.totalTokens) {
        usageQuotaService.recordTokenUsage(userId, response.usage.totalTokens).catch(err => {
          console.error(`[Chat API] Failed to record token usage for user ${userId}:`, err);
        });
      }

      if (userId) {
        try {
          await storage.createAuditLog({
            userId,
            action: "chat_query",
            resource: "chats",
            resourceId: conversationId || null,
            details: {
              messageCount: messages.length,
              useRag,
              documentMode: documentMode || false,
              hasImages: !!images && images.length > 0,
              gptId: gptSessionContract?.gptId || gptConfig?.id || null,
              configVersion: gptSessionContract?.configVersion || null,
              tokens: response.usage?.totalTokens || 0
            }
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
      }

      // Add GPT session metadata to response if contract-based session is active
      const responseWithMetadata = gptSessionContract ? {
        ...response,
        gpt_id: gptSessionContract.gptId,
        config_version: gptSessionContract.configVersion,
        tool_permissions: gptSessionContract.toolPermissions,
        session_id: serverSessionId || gptSessionContract.sessionId
      } : response;

      res.json(responseWithMetadata);
    } catch (error: any) {
      const requestId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.error(`[Chat API Error] requestId=${requestId}:`, error);

      const categorized = categorizeError(error, requestId);
      res.status(categorized.statusCode).json({
        error: categorized.userMessage,
        category: categorized.category,
        details: categorized.technicalDetails,
        requestId: categorized.requestId,
        retryable: categorized.retryable
      });
    }
  });

  router.post("/voice-chat", async (req, res) => {
    try {
      const { message } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      console.log("[VoiceChat] Processing voice input:", message);

      const result = await llmGateway.chat([
        {
          role: "system",
          content: `Eres Sira, un asistente de voz amigable y conversacional. 
Responde de manera natural y concisa, como si estuvieras hablando directamente con el usuario.
Mantén las respuestas cortas (2-3 oraciones máximo) para que sean fáciles de escuchar.
Usa un tono cálido y conversacional en español.
No uses markdown, emojis ni formatos especiales ya que tu respuesta será leída en voz alta.`
        },
        {
          role: "user",
          content: message
        }
      ], {
        model: "grok-3-fast",
        temperature: 0.7,
        maxTokens: 150,
      });

      res.json({
        success: true,
        response: result.content,
        latencyMs: result.latencyMs
      });
    } catch (error: any) {
      console.error("Voice chat error:", error);
      res.status(500).json({
        error: "Failed to process voice message",
        details: error.message
      });
    }
  });

  router.post("/image/generate", async (req, res) => {
    try {
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log("[ImageGen] Generating image for prompt:", prompt);

      const result = await generateImage(prompt);

      res.json({
        success: true,
        imageData: `data:${result.mimeType};base64,${result.imageBase64}`,
        prompt: result.prompt
      });
    } catch (error: any) {
      console.error("Image generation error:", error);
      res.status(500).json({
        error: "Failed to generate image",
        details: error.message
      });
    }
  });

  router.post("/image/detect", (req, res) => {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const isImageRequest = detectImageRequest(message);
    const extractedPrompt = isImageRequest ? extractImagePrompt(message) : null;

    res.json({ isImageRequest, extractedPrompt });
  });

  router.get("/etl/config", async (req, res) => {
    try {
      res.json({
        countries: getAvailableCountries(),
        indicators: getAvailableIndicators()
      });
    } catch (error: any) {
      console.error("ETL config error:", error);
      res.status(500).json({ error: "Failed to get ETL config" });
    }
  });

  router.post("/etl/run", async (req, res) => {
    try {
      const { countries, indicators, startDate, endDate } = req.body;

      if (!countries || !Array.isArray(countries) || countries.length === 0) {
        return res.status(400).json({ error: "Countries array is required" });
      }

      console.log("[ETL API] Starting ETL for countries:", countries);

      const result = await runETLAgent({
        countries,
        indicators,
        startDate,
        endDate
      });

      if (result.success && result.workbookBuffer) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.workbookBuffer);
      } else {
        res.status(result.success ? 200 : 500).json({
          success: result.success,
          message: result.message,
          summary: result.summary,
          errors: result.errors
        });
      }
    } catch (error: any) {
      console.error("ETL API error:", error);
      res.status(500).json({
        error: "ETL pipeline failed",
        details: error.message
      });
    }
  });

  // Get run status - for polling
  router.get("/chat/runs/:runId", async (req, res) => {
    try {
      const run = await storage.getChatRun(req.params.runId);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/chat/stream", async (req, res) => {
    const requestId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let isConnectionClosed = false;
    let claimedRun: any = null;

    try {
      const { messages: clientMessages, conversationId, runId, chatId, attachments, gptId, provider = DEFAULT_PROVIDER, model = DEFAULT_MODEL, session_id, docTool, forceWebSearch, webSearchAuto, lastImageBase64, lastImageId } = req.body;
      const normalizedProvider = normalizeProvider(provider) ?? DEFAULT_PROVIDER;

      // DEBUG: Log all incoming request parameters for docTool verification
      console.log(`[Stream] 📥 REQUEST RECEIVED - docTool: ${JSON.stringify(docTool)}, chatId: ${chatId}, runId: ${runId}, forceWebSearch: ${forceWebSearch}`);

      if (!clientMessages || !Array.isArray(clientMessages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      // WEB SEARCH MODE: If forceWebSearch is true, perform web search first
      if (forceWebSearch || webSearchAuto) {
        console.log(`[Stream] 🌐 WEB SEARCH MODE ACTIVATED`);
        const lastUserMessage = [...clientMessages].reverse().find((m: any) => m.role === 'user');
        const searchQuery = lastUserMessage?.content || '';
        
        if (searchQuery) {
          try {
            const { searchWeb } = await import('../services/webSearch');
            const searchResults = await searchWeb(searchQuery, 5);
            
            if (searchResults.results.length > 0) {
              // Format search results as context
              const searchContext = searchResults.results
                .map((r: any, i: number) => `[${i + 1}] ${r.title}\n${r.snippet}\nFuente: ${r.url}`)
                .join('\n\n');
              
              // Add search results as system context
              const systemMessage = {
                role: 'system',
                content: `El usuario ha solicitado búsqueda web. Aquí están los resultados de búsqueda para "${searchQuery}":\n\n${searchContext}\n\nUsa esta información para responder al usuario de forma útil y citando las fuentes cuando sea apropiado.`
              };
              
              clientMessages.unshift(systemMessage);
              console.log(`[Stream] 🌐 Web search found ${searchResults.results.length} results`);
            }
          } catch (searchError) {
            console.error('[Stream] Web search error:', searchError);
            // Continue without web search results
          }
        }
      }

      // AUTOMATIC ACADEMIC/WEB SEARCH: Always detect if message needs search and add results
      const lastUserMsg = [...clientMessages].reverse().find((m: any) => m.role === 'user');
      const userQuery = lastUserMsg?.content || '';
      
      // Store webSources for SSE response
      let detectedWebSources: any[] = [];
      
      // Always try to detect search needs, regardless of forceWebSearch/webSearchAuto flags
      if (userQuery) {
        try {
          const { needsAcademicSearch, needsWebSearch, searchWeb } = await import('../services/webSearch');
          const { academicEngineV3, generateAPACitation } = await import('../services/academicResearchEngineV3');
          
          // Check for academic search patterns
          if (needsAcademicSearch(userQuery)) {
            console.log(`[Stream] 🎓 ACADEMIC SEARCH DETECTED for: "${userQuery.slice(0, 50)}..."`);
            
            try {
              const engineResult = await academicEngineV3.search({
                query: userQuery,
                maxResults: 15,
                yearFrom: 2020,
                yearTo: new Date().getFullYear(),
                sources: ["scielo", "openalex", "semantic_scholar", "crossref", "core", "pubmed", "arxiv", "doaj"]
              });
              
              if (engineResult.papers.length > 0) {
                const academicContext = engineResult.papers.slice(0, 10).map((paper, i) => 
                  `[${i + 1}] ${paper.title}\nAutores: ${paper.authors.map(a => a.name).join(', ') || 'No disponible'}\nAño: ${paper.year || 'N/A'}\nJournal: ${paper.journal || 'N/A'}\nDOI: ${paper.doi || 'N/A'}\nURL: ${paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : 'N/A')}\nResumen: ${(paper.abstract || '').substring(0, 300)}...\nCita APA: ${generateAPACitation(paper)}`
                ).join('\n\n');
                
                const systemMessage = {
                  role: 'system',
                  content: `ARTÍCULOS ACADÉMICOS ENCONTRADOS (${engineResult.papers.length} resultados de ${engineResult.sources.map(s => s.name).join(', ')}):\n\n${academicContext}\n\nUSA ESTOS ARTÍCULOS para responder al usuario. Incluye citas APA y URLs para cada referencia.`
                };
                
                clientMessages.unshift(systemMessage);
                
                // Convert papers to webSources format for frontend cards
                detectedWebSources = engineResult.papers.slice(0, 10).map(paper => ({
                  url: paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : ''),
                  title: paper.title,
                  snippet: paper.abstract?.substring(0, 200) || '',
                  domain: paper.journal || 'Academic',
                  favicon: null,
                  imageUrl: null,
                  siteName: paper.journal || engineResult.sources[0]?.name || 'Academic Source',
                  publishedDate: paper.year ? `${paper.year}` : null
                }));
                
                console.log(`[Stream] 🎓 Academic search found ${engineResult.papers.length} papers from ${engineResult.sources.length} sources`);
              }
            } catch (academicError) {
              console.error('[Stream] Academic search error:', academicError);
            }
          }
          // Check for web search patterns (news, current events, etc)
          else if (needsWebSearch(userQuery)) {
            console.log(`[Stream] 🌐 WEB SEARCH DETECTED for: "${userQuery.slice(0, 50)}..."`);
            
            try {
              const searchResults = await searchWeb(userQuery, 10);
              
              if (searchResults.results.length > 0) {
                const searchContext = searchResults.results
                  .map((r: any, i: number) => `[${i + 1}] ${r.title}\n${r.snippet}\nFuente: ${r.url}`)
                  .join('\n\n');
                
                const systemMessage = {
                  role: 'system',
                  content: `RESULTADOS DE BÚSQUEDA WEB para "${userQuery}":\n\n${searchContext}\n\nUsa esta información actualizada para responder al usuario, citando las fuentes cuando sea apropiado.`
                };
                
                clientMessages.unshift(systemMessage);
                
                // Store webSources for frontend cards
                detectedWebSources = searchResults.results.map((r: any) => ({
                  url: r.url,
                  title: r.title,
                  snippet: r.snippet,
                  domain: new URL(r.url).hostname.replace('www.', ''),
                  favicon: r.favicon || null,
                  imageUrl: r.imageUrl || null,
                  siteName: r.siteName || new URL(r.url).hostname.replace('www.', ''),
                  publishedDate: r.publishedDate || null
                }));
                
                console.log(`[Stream] 🌐 Web search found ${searchResults.results.length} results`);
              }
            } catch (webError) {
              console.error('[Stream] Web search error:', webError);
            }
          }
        } catch (importError) {
          console.error('[Stream] Failed to import search modules:', importError);
        }
      }

      // CONTEXT FIX: Augment client messages with server-side history
      const effectiveChatId = chatId || conversationId;
      const messages = await conversationMemoryManager.augmentWithHistory(
        effectiveChatId,
        clientMessages,
        8000 // token budget
      );
      console.log(`[Stream API] Context augmented: ${clientMessages.length} client msgs -> ${messages.length} total`);

      // DOC TOOL PRODUCTION MODE: When Word/Excel/PPT tool is selected, activate production directly
      if (docTool && ['word', 'excel', 'ppt'].includes(docTool)) {
        console.log(`[Stream] 🛠️ DOC TOOL PRODUCTION: docTool=${docTool} - activating production mode directly`);

        const lastUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
        const userMessageText = lastUserMessage?.content || '';
        let messageForProduction = userMessageText;

        // If the user is asking to improve/edit a previous document, try to pull the last extracted document
        // snapshot from conversation_documents and inject it as context for production (so it won't "forget").
        const looksLikeEdit =
          /\b(mejor|corrig|correg|revis|editar|edita|pulir|optimiza|ajusta|refina|reescrib|re-escrib|actualiza)\b/i.test(userMessageText) &&
          /\b(anterior|previo|de\s+antes|lo\s+anterior|respuesta\s+anterior|que\s+me\s+diste|que\s+generaste|ese\s+documento|ese\s+archivo)\b/i.test(userMessageText);

        const existingChatId = (chatId || conversationId || "").trim();
        const canLoadConversationDocs = !!existingChatId && !existingChatId.startsWith("pending-");

        if (looksLikeEdit && canLoadConversationDocs) {
          try {
            const docs = await storage.getConversationDocuments(existingChatId);
            const lastDoc = [...docs].reverse().find(d => typeof d.extractedText === "string" && d.extractedText.trim().length > 400);
            if (lastDoc?.extractedText) {
              const base = lastDoc.extractedText.trim().slice(0, 60_000);
              messageForProduction = [
                userMessageText,
                ``,
                `DOCUMENTO_BASE (del chat, extracto):`,
                base,
              ].join("\n");
              console.log(`[Stream] DocTool edit context: injected extractedText chars=${base.length}`);
            } else {
              console.log(`[Stream] DocTool edit context: no conversation_documents with extractedText found for chatId=${existingChatId}`);
            }
          } catch (e: any) {
            console.warn(`[Stream] DocTool edit context: failed to load conversation_documents for chatId=${existingChatId}:`, e?.message || e);
          }
        }

        // Map docTool to corresponding intent
        const toolToIntent = {
          'word': 'CREATE_DOCUMENT' as const,
          'excel': 'CREATE_SPREADSHEET' as const,
          'ppt': 'CREATE_PRESENTATION' as const
        };

        const syntheticIntent: IntentResult = {
          intent: toolToIntent[docTool as keyof typeof toolToIntent] || 'CREATE_DOCUMENT',
          confidence: 1.0, // Full confidence since user explicitly selected tool
          slots: {
            topic: userMessageText
          },
          output_format: docTool,
          language_detected: 'es',
          normalized_text: userMessageText
        };

        try {
          const effectiveUserId = (req as AuthenticatedRequest).user?.claims?.sub || 'anonymous';
          const effectiveChatId = chatId || conversationId || `chat_${Date.now()}`;

          await handleProductionRequest(
            {
              message: messageForProduction,
              userId: effectiveUserId,
              chatId: effectiveChatId,
              intentResult: syntheticIntent,
              locale: 'es',
              forceProduction: true,
            },
            res
          );

          // Production handler completed, exit early
          return;
        } catch (productionError: any) {
          console.error('[Stream] DocTool production handler error, falling back to chat:', productionError);
          // Continue to normal chat flow if production fails
        }
      }

      // NOTE: Document attachments are supported in /chat/stream via the ingestion2026 + brief/RAG/verifier pipeline.
      // /analyze remains available for dedicated document-only workflows.
      const hasDocumentAttachments = attachments && Array.isArray(attachments) &&
        attachments.some((a: any) => isDocumentAttachment(a.mimeType || a.type, a.name, a.type));
      if (hasDocumentAttachments) {
        console.log(`[Stream API] 📎 Document attachments detected - ingestion2026 enabled`);
      }

      const user = (req as AuthenticatedRequest).user;
      const userId = user?.claims?.sub;

      // GPT Session Contract Resolution for streaming
      // Priority: session_id (reuse existing) > gptId (create new)
      let gptSessionContract: GptSessionContract | null = null;
      let effectiveModel = model || DEFAULT_MODEL;
      let serverSessionId: string | null = null;

      const isValidConversationIdForStream = (id?: string): boolean => {
        if (!id) return false;
        if (id.startsWith('pending-')) return false;
        if (id.trim() === '') return false;
        return true;
      };

      // First, try to retrieve existing session by session_id
      if (session_id) {
        try {
          gptSessionContract = await getSessionById(session_id);
          if (gptSessionContract) {
            serverSessionId = gptSessionContract.sessionId;
            effectiveModel = getEnforcedModel(gptSessionContract, model);
            console.log(`[Stream] Reusing existing session: session_id=${session_id}, gptId=${gptSessionContract.gptId}, configVersion=${gptSessionContract.configVersion}`);
          } else {
            console.log(`[Stream] Session not found: session_id=${session_id}, will create new if gptId provided`);
          }
        } catch (sessionError) {
          console.error(`[Stream] Error retrieving session ${session_id}:`, sessionError);
        }
      }

      // If no session from session_id, try to create/get one via gptId
      if (!gptSessionContract && gptId) {
        try {
          const effectiveChatIdForSession = chatId || conversationId;
          if (isValidConversationIdForStream(effectiveChatIdForSession)) {
            gptSessionContract = await getOrCreateSession(effectiveChatIdForSession, gptId);
            console.log(`[Stream] GPT Session created/retrieved: gptId=${gptId}, configVersion=${gptSessionContract.configVersion}`);
          } else {
            gptSessionContract = await getOrCreateSession("", gptId);
            console.log(`[Stream] New GPT Session created: gptId=${gptId}, sessionId=${gptSessionContract.sessionId}`);
          }
          serverSessionId = gptSessionContract.sessionId;
          effectiveModel = getEnforcedModel(gptSessionContract, model);
        } catch (sessionError) {
          console.error(`[Stream] Error creating GPT session for gptId=${gptId}:`, sessionError);
        }
      }

      // Session metadata for SSE events
      const sessionMetadata = gptSessionContract ? {
        gpt_id: gptSessionContract.gptId,
        config_version: gptSessionContract.configVersion,
        tool_permissions: gptSessionContract.toolPermissions,
        session_id: serverSessionId || gptSessionContract.sessionId,
      } : null;

      // Get the last user message for PARE routing
      const lastUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
      const userMessageText = lastUserMessage?.content || '';

      // Run Intent Router FIRST for NLU-based intent classification
      let intentResult: IntentResult | null = null;
      if (userMessageText) {
        try {
          intentResult = await routeIntent(userMessageText);
          console.log(`[Stream] IntentRouter: intent=${intentResult.intent}, confidence=${intentResult.confidence.toFixed(2)}, format=${intentResult.output_format || 'none'}`);

          // PRODUCTION MODE INTERCEPT - Check immediately after intent detection
          // Pass userMessageText to detect if user wants to search for articles first
          if (isProductionIntent(intentResult, userMessageText) && intentResult.confidence >= 0.5) {
            console.log(`[Stream] 🚀 PRODUCTION MODE ACTIVATED: intent=${intentResult.intent}, topic=${intentResult.slots.topic}`);

            try {
              const effectiveUserId = (req as AuthenticatedRequest).user?.claims?.sub || 'anonymous';
              const effectiveChatId = chatId || conversationId || `chat_${Date.now()}`;

              await handleProductionRequest(
                {
                  message: userMessageText,
                  userId: effectiveUserId,
                  chatId: effectiveChatId,
                  intentResult,
                  locale: intentResult.language_detected || 'es',
                },
                res
              );

              // Production handler completed, exit early
              return;
            } catch (productionError: any) {
              console.error('[Stream] Production handler error, falling back to chat:', productionError);
              // Continue to normal chat flow if production fails
            }
          }
        } catch (intentError) {
          console.error('[Stream] IntentRouter error:', intentError);
        }
      }

      // Resolve storagePaths for all attachments first (before PARE routing)
      // This ensures PARE has valid paths for routing decisions
      const resolvedAttachments: any[] = [];
      if (attachments && Array.isArray(attachments)) {
        for (const att of attachments) {
          const resolved = { ...att };
          if (!resolved.storagePath && resolved.fileId) {
            const fileRecord = await storage.getFile(resolved.fileId);
            if (fileRecord && fileRecord.storagePath) {
              resolved.storagePath = fileRecord.storagePath;
              console.log(`[Stream] Pre-resolved storagePath for ${resolved.name}: ${resolved.storagePath}`);
            }
          }
          resolvedAttachments.push(resolved);
        }
      }

      // Convert attachments to PARE format using resolved paths
      const pareAttachments: SimpleAttachment[] = resolvedAttachments.map((att: any) => ({
        name: att.name,
        type: att.type || att.mimeType,
        path: att.storagePath || '',
      }));

      // Use PARE for intelligent routing when attachments are present
      let routeDecision: RobustRouteResult | null = null;
      if (pareOrchestrator.isEnabled() && userMessageText) {
        try {
          routeDecision = pareOrchestrator.robustRoute(userMessageText, pareAttachments);
          console.log(`[Stream] PARE routing: route=${routeDecision.route}, intent=${routeDecision.intent}, confidence=${routeDecision.confidence.toFixed(2)}, tools=${routeDecision.tools.slice(0, 3).join(',')}`);
        } catch (routeError) {
          console.error('[Stream] PARE routing error, falling back to chat:', routeError);
        }
      }

      // Create UnifiedChatContext for RequestSpec-driven execution
      const attachmentSpecs: AttachmentSpec[] = resolvedAttachments.map((att: any) => ({
        id: att.fileId || `att_${Date.now()}`,
        name: att.name || 'document',
        mimeType: att.mimeType || att.type || 'application/octet-stream',
        size: att.size || 0,
        storagePath: att.storagePath,
      }));

      let unifiedContext: UnifiedChatContext | null = null;
      try {
        const effectiveChatId = chatId || conversationId || `chat_${Date.now()}`;
        unifiedContext = await createUnifiedRun({
          messages: messages as Array<{ role: string; content: string }>,
          chatId: effectiveChatId,
          userId: userId || 'anonymous',
          runId: runId,
          messageId: `msg_${Date.now()}`,
          attachments: attachmentSpecs,
        });
        console.log(`[Stream] UnifiedContext created - intent: ${unifiedContext.requestSpec.intent}, confidence: ${unifiedContext.requestSpec.intentConfidence.toFixed(2)}, primaryAgent: ${unifiedContext.requestSpec.primaryAgent}`);
      } catch (contextError) {
        console.error('[Stream] Failed to create unified context:', contextError);
      }

      // If runId provided, claim the pending run (idempotent processing)
      if (runId && chatId) {
        const existingRun = await storage.getChatRun(runId);
        if (!existingRun) {
          return res.status(404).json({ error: "Run not found" });
        }

        // If run is already processing or done, don't re-process
        if (existingRun.status === 'processing') {
          console.log(`[Run] Run ${runId} is already being processed, returning status`);
          return res.json({ status: 'already_processing', run: existingRun });
        }
        if (existingRun.status === 'done') {
          console.log(`[Run] Run ${runId} already completed`);
          return res.json({ status: 'already_done', run: existingRun });
        }
        if (existingRun.status === 'failed') {
          console.log(`[Run] Run ${runId} previously failed`);
          // Allow retry for failed runs by claiming again
        }

        // Atomically claim the pending run using clientRequestId for specificity
        claimedRun = await storage.claimPendingRun(chatId, existingRun.clientRequestId);
        if (!claimedRun || claimedRun.id !== runId) {
          console.log(`[Run] Failed to claim run ${runId} - may have been claimed by another request`);
          return res.json({ status: 'claim_failed', message: 'Run already claimed or not pending' });
        }
        console.log(`[Run] Successfully claimed run ${runId}`);
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Request-Id", requestId);
      if (claimedRun) {
        res.setHeader("X-Run-Id", claimedRun.id);
      }
      if (unifiedContext) {
        res.setHeader("X-Intent", unifiedContext.requestSpec.intent);
        res.setHeader("X-Intent-Confidence", String(unifiedContext.requestSpec.intentConfidence.toFixed(2)));
        res.setHeader("X-Primary-Agent", unifiedContext.requestSpec.primaryAgent);
        res.setHeader("X-Agentic-Mode", String(unifiedContext.isAgenticMode));
      }
      if (intentResult) {
        res.setHeader("X-NLU-Intent", intentResult.intent);
        res.setHeader("X-NLU-Confidence", String(intentResult.confidence.toFixed(2)));
        res.setHeader("X-NLU-Format", intentResult.output_format || "none");
      }
      res.flushHeaders();

      // Emit NLU intent result as SSE event for frontend visibility
      if (intentResult) {
        writeSse(res, "intent", {
          intent: intentResult.intent,
          confidence: intentResult.confidence,
          output_format: intentResult.output_format,
          slots: intentResult.slots,
          matched_patterns: intentResult.matched_patterns
        });

        // If clarification needed, emit immediately so UI can prompt user
        if (intentResult.intent === 'NEED_CLARIFICATION' && intentResult.clarification_question) {
          writeSse(res, "clarification", {
            question: intentResult.clarification_question,
            confidence: intentResult.confidence
          });
          console.log(`[Stream] Emitted clarification request: "${intentResult.clarification_question}"`);
        }

        // PRODUCTION MODE INTERCEPT: Handle document creation requests
        // Debug log to trace production mode evaluation
        console.log(`\n\n🔥🔥🔥 [Stream] PRODUCTION CHECK START 🔥🔥🔥`);
        console.log(`[Stream] PRODUCTION CHECK: intent=${intentResult.intent}, confidence=${intentResult.confidence.toFixed(2)}, isProductionIntent=${isProductionIntent(intentResult, userMessageText)}`);
        console.log(`🔥🔥🔥 [Stream] PRODUCTION CHECK END 🔥🔥🔥\n\n`);

        // Pass userMessageText to detect if user wants to search for articles first
        if (isProductionIntent(intentResult, userMessageText) && intentResult.confidence >= 0.5) {
          const effectiveUserId = user?.claims?.sub || 'anonymous';
          const effectiveChatId = chatId || conversationId || `chat_${Date.now()}`;

          console.log(`[Stream] 🚀 PRODUCTION MODE ACTIVATED: intent=${intentResult.intent}, topic=${intentResult.slots.topic}`);

          try {
            await handleProductionRequest(
              {
                message: userMessageText,
                userId: effectiveUserId,
                chatId: effectiveChatId,
                intentResult,
                locale: intentResult.language_detected || 'es',
              },
              res
            );

            // Production handler takes over response, we're done
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            return;
          } catch (productionError: any) {
            console.error('[Stream] Production handler error, falling back to chat:', productionError);
            // Continue to normal chat flow if production fails
          }
        }
      }

      req.on("close", () => {
        isConnectionClosed = true;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
        console.log(`[SSE] Connection closed: ${requestId}`);
      });

      heartbeatInterval = setInterval(() => {
        if (!isConnectionClosed) {
          res.write(`:heartbeat\n\n`);
        }
      }, 15000);

      // ===== ingestion2026 → canonical brief (gating) → hybrid RAG → verifier (gating) → stream answer =====
      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      const hasAttachments = resolvedAttachments.length > 0;
      const hasLastImageContext = !!lastImageBase64 && !!lastImageId;
      const attachmentsCount = (hasAttachments ? resolvedAttachments.length : 0) + (hasLastImageContext ? 1 : 0);

      // GUARD: Detect if user requests "analyze all" - requires full coverage
      const userMessage = messages[messages.length - 1]?.content || "";
      const requiresFullCoverage = /\b(todos|all|completo|complete|cada|every)\b/i.test(userMessage);

      // GUARD: Block image generation tools when attachments or image context are present
      if (attachmentsCount > 0) {
        console.log(`[Stream] GUARD: Image generation BLOCKED - attachmentsCount=${attachmentsCount}`);
        if (routeDecision) {
          routeDecision.tools = routeDecision.tools.filter(t => !['generate_image', 'image_gen', 'dall_e'].includes(t));
          if (routeDecision.route === 'chat') {
            routeDecision.route = 'agent';
            routeDecision.intent = 'analysis';
          }
        }
      }

      // Default question classification for token limits (Answer-First enforcer has its own classifier)
      const questionClassification = {
        type: 'general',
        maxTokens: 1000
      } as Partial<QuestionClassification>;

      // If we have a run, create an assistant message placeholder at the start
      let assistantMessageId: string | null = null;
      if (claimedRun && chatId) {
        const assistantMessage = await storage.createChatMessage({
          chatId,
          role: 'assistant',
          content: '',
          status: 'pending',
          runId: claimedRun.id,
          userMessageId: claimedRun.userMessageId,
        });
        assistantMessageId = assistantMessage.id;
        await storage.updateChatRunAssistantMessage(claimedRun.id, assistantMessageId);
      }

      const effectiveRunId = claimedRun?.id || unifiedContext?.runId || requestId;

      writeSse(res, 'start', {
        requestId,
        runId: effectiveRunId,
        assistantMessageId,
        intent: unifiedContext?.requestSpec.intent,
        intentConfidence: unifiedContext?.requestSpec.intentConfidence,
        deliverableType: unifiedContext?.requestSpec.deliverableType,
        primaryAgent: unifiedContext?.requestSpec.primaryAgent,
        targetAgents: unifiedContext?.requestSpec.targetAgents,
        isAgenticMode: unifiedContext?.isAgenticMode,
        webSources: detectedWebSources.length > 0 ? detectedWebSources : undefined,
        timestamp: Date.now(),
        ...sessionMetadata
      });

      emitTraceEvent(effectiveRunId, 'task_start', {
        metadata: {
          chatId,
          userId,
          message: messages[messages.length - 1]?.content?.slice(0, 200) || '',
          intent: unifiedContext?.requestSpec.intent,
          intentConfidence: unifiedContext?.requestSpec.intentConfidence,
          deliverableType: unifiedContext?.requestSpec.deliverableType,
          attachmentsCount,
          isAgenticMode: unifiedContext?.isAgenticMode
        }
      }).catch(() => { });

      if (unifiedContext?.requestSpec.sessionState) {
        emitTraceEvent(effectiveRunId, 'memory_loaded', {
          memory: {
            keys: unifiedContext.requestSpec.sessionState.memoryKeys,
            loaded: unifiedContext.requestSpec.sessionState.turnNumber
          }
        }).catch(() => { });
      }

      emitTraceEvent(effectiveRunId, 'thinking', {
        content: `Building canonical brief + retrieval context`,
        phase: 'planning'
      }).catch(() => { });

      // Apply dynamic token limit based on question type (Answer-First)
      const effectiveMaxTokens = questionClassification.type === 'summary' ||
        questionClassification.type === 'analysis'
        ? 2000
        : questionClassification.maxTokens * 4;

      const objectStorageService = new ObjectStorageService();
      const allChunks: IngestedChunk[] = [];
      const briefAttachments: BriefAttachmentSummary[] = [];
      const failedFiles: Array<{ filename: string; error: string }> = [];
      const indexedFileIds = new Set<string>();

      const contextChatId = String(chatId || conversationId || "");
      const wantsStoredContext = !!contextChatId && (
        attachmentsCount > 0 ||
        detectedWebSources.length > 0 ||
        shouldIncludeStoredEncargoContext(userMessageText)
      );
      const storedContext = wantsStoredContext ? loadEncargoContext(contextChatId) : null;

      const seenChunkIds = new Set<string>();
      const seenBriefAttachmentKeys = new Set<string>();
      let persistentFileIds: string[] = [];
      const addChunk = (chunk: IngestedChunk) => {
        if (seenChunkIds.has(chunk.id)) return;
        seenChunkIds.add(chunk.id);
        allChunks.push(chunk);
      };
      const addBriefAttachment = (att: BriefAttachmentSummary) => {
        const key = `${att.kind}:${att.id}`;
        if (seenBriefAttachmentKeys.has(key)) return;
        seenBriefAttachmentKeys.add(key);
        briefAttachments.push(att);
      };

      if (wantsStoredContext) {
        if (storedContext) {
          for (const c of storedContext.chunks) addChunk(c);
          for (const a of storedContext.attachments) addBriefAttachment(a);
        } else if (contextChatId) {
          const dbRetrievalEnabled = String(process.env.ENCARGO_DB_RETRIEVAL_ENABLED || "true").toLowerCase() === "true";
          const includeDocumentChunks = !(dbRetrievalEnabled && !hasAttachments && !hasLastImageContext);
          const persistent = await loadPersistentEncargoContextFromDb({
            chatId: contextChatId,
            maxDocuments: 6,
            maxChunksTotal: 800,
            includeDocumentChunks,
          });
          if (persistent) {
            persistentFileIds = persistent.fileIds || [];
            for (const c of persistent.chunks) addChunk(c);
            for (const a of persistent.attachments) addBriefAttachment(a);
          }
        }
      }

      // Ingest web sources as retrievable context
      if (detectedWebSources.length > 0) {
        for (const ws of detectedWebSources.slice(0, 10)) {
          const url = ws.url || ws.canonicalUrl || ws.link;
          if (!url) continue;
          const sourceId = `web:${url}`;
          const snippet = ws.snippet || "";
          const title = ws.title || ws.siteName || ws.domain || "web";
          const content = `Type: web\nTitle: ${title}\nURL: ${url}\nSnippet: ${snippet}`.trim();
          addChunk({
            id: `webchunk_${Buffer.from(url).toString("base64").slice(0, 18)}`,
            kind: "web",
            sourceId,
            location: {},
            headingPath: [],
            content,
            rawContent: snippet,
            metadata: { title },
          });
          addBriefAttachment({
            id: url,
            kind: "web",
            label: title,
            summary: `${title}\n${snippet}`.trim(),
            citationHint: sourceId,
          });
        }
      }

      // Ingest resolved attachments (documents + images)
      if (hasAttachments) {
        console.log(`[Stream] ingestion2026: processing ${resolvedAttachments.length} attachment(s)`);

        for (const att of resolvedAttachments) {
          const filename = att.name || 'attachment';
          const mimeType = (att.mimeType || att.type || 'application/octet-stream').toLowerCase();
          const isImage = mimeType.startsWith("image/") || String(att.type || "").toLowerCase() === "image";

          try {
            let buffer: Buffer;
            if (att.storagePath) {
              buffer = await objectStorageService.getObjectEntityBuffer(att.storagePath);
            } else if (att.content) {
              buffer = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content, 'base64');
            } else {
              throw new Error('No storagePath or content provided for attachment');
            }

            if (isImage) {
              const imageId = att.fileId || `img_${filename}_${Date.now()}`;
              const base64 = buffer.toString("base64");
              const { extraction, chunk } = await extractImageSemantics({
                imageId,
                base64,
                requestId,
                userId: userId || conversationId || "anonymous",
              });
              addChunk(chunk);
              addBriefAttachment({
                id: imageId,
                kind: "image",
                label: filename,
                mimeType,
                summary: [extraction.summary, extraction.detected_text ? `TEXT: ${extraction.detected_text.slice(0, 300)}` : ""].filter(Boolean).join("\n"),
                citationHint: `img:${imageId}`,
              });
              continue;
            }

            const docModel = await normalizeDocument(buffer, filename, att.storagePath);
            const { chunks, summary } = ingestSemanticDocumentToChunks({ model: docModel, mimeType });
            for (const c of chunks) addChunk(c);

            const docSummaryLines = [
              `${summary.filename} (${summary.documentType || 'document'}, mime=${summary.mimeType})`,
              summary.pageCount ? `Pages: ${summary.pageCount}` : '',
              summary.sheetCount ? `Sheets: ${summary.sheetCount}` : '',
              `Sections: ${summary.sectionCount}, Tables: ${summary.tableCount}`,
              summary.headingPreview.length ? `Headings: ${summary.headingPreview.join(" | ")}` : '',
              summary.notes && summary.notes.length ? `Warnings: ${summary.notes.slice(0, 3).join(" | ")}` : '',
            ].filter(Boolean).join("\n");

            addBriefAttachment({
              id: att.fileId || summary.docId || filename,
              kind: "document",
              label: filename,
              mimeType,
              summary: docSummaryLines,
              citationHint: `doc:${filename}`,
            });

            // Persist a lightweight conversation document record for durable cross-turn context
            // (used by KnowledgeBaseService + persistent context loader).
            if (isValidConversationIdForStream(contextChatId)) {
              const extractedText = buildExtractedTextFromChunks(chunks);
              if (extractedText) {
                const fileId = typeof att.fileId === "string" ? att.fileId : undefined;
                const messageId = claimedRun?.userMessageId || null;
                queueMicrotask(() => {
                  storage.createConversationDocument({
                    chatId: contextChatId,
                    messageId,
                    fileName: filename,
                    storagePath: att.storagePath || null,
                    mimeType,
                    fileSize: buffer.length,
                    extractedText,
                    metadata: {
                      fileId,
                      ingestionVersion: "ingestion2026",
                      chunkCount: chunks.length,
                      pageCount: summary.pageCount,
                      sheetCount: summary.sheetCount,
                    },
                  }).catch((err: any) => {
                    console.warn(`[Stream] Failed to persist conversationDocument for ${filename}:`, err?.message || err);
                  });
                });
              }
            }

            // Optional: DB index ingestion2026 chunks for durable RAG across turns.
            const fileIdToIndex = typeof att.fileId === "string" ? att.fileId : null;
            const dbIndexEnabled = String(process.env.ENCARGO_DB_INDEX_ENABLED || "true").toLowerCase() === "true";
            if (dbIndexEnabled && fileIdToIndex && !indexedFileIds.has(fileIdToIndex)) {
              indexedFileIds.add(fileIdToIndex);
              queueMicrotask(() => {
                indexIngestedChunksToFileChunks({
                  fileId: fileIdToIndex,
                  chunks,
                  filename,
                  userId: userId || undefined,
                  requestId,
                  ingestionVersion: "ingestion2026",
                }).catch((err: any) => {
                  console.warn(`[Stream] Failed to index file_chunks for ${filename} (${fileIdToIndex}):`, err?.message || err);
                });
              });
            }
          } catch (err: any) {
            const msg = err?.message || String(err);
            failedFiles.push({ filename, error: msg });
            console.error(`[Stream] ingestion2026 failed for ${filename}:`, msg);
            // Ensure the brief step knows a file existed but could not be ingested (prevents "silent" missing context).
            addBriefAttachment({
              id: att.fileId || filename,
              kind: isImage ? "image" : "document",
              label: filename,
              mimeType,
              summary: `FAILED_TO_INGEST: ${msg}`,
            });
          }
        }
      }

      // Ingest last image context (edit / follow-up tasks)
      if (hasLastImageContext) {
        try {
          const { extraction, chunk } = await extractImageSemantics({
            imageId: String(lastImageId),
            base64: String(lastImageBase64),
            requestId,
            userId: userId || conversationId || "anonymous",
          });
          addChunk(chunk);
          addBriefAttachment({
            id: String(lastImageId),
            kind: "image",
            label: `lastImage:${lastImageId}`,
            mimeType: "image/*",
            summary: [extraction.summary, extraction.detected_text ? `TEXT: ${extraction.detected_text.slice(0, 300)}` : ""].filter(Boolean).join("\n"),
            citationHint: `img:${lastImageId}`,
          });
        } catch (imgErr: any) {
          console.warn(`[Stream] Image context extraction failed (${lastImageId}):`, imgErr?.message || imgErr);
        }
      }

      if (contextChatId && (allChunks.length > 0 || briefAttachments.length > 0) && (
        hasAttachments ||
        hasLastImageContext ||
        detectedWebSources.length > 0 ||
        wantsStoredContext
      )) {
        rememberEncargoContext({
          chatId: contextChatId,
          chunks: allChunks,
          attachments: briefAttachments,
        });
      }

      // COVERAGE CHECK: if user asked for "all", require zero ingestion failures when attachments exist.
      if (requiresFullCoverage && hasAttachments && failedFiles.length > 0) {
        res.write(`event: error\ndata: ${JSON.stringify({
          type: 'coverage_failure',
          message: 'No se pudieron procesar todos los archivos solicitados',
          details: {
            requested: resolvedAttachments.length,
            processed: resolvedAttachments.length - failedFiles.length,
            failedFiles
          },
          requestId,
          timestamp: Date.now()
        })}\n\n`);
        clearInterval(heartbeatInterval);
        return res.end();
      }

      // ===== 1) Canonical brief (gating) =====
      const briefRes = await withSpan(
        SPAN_NAMES.PIPELINE_STAGE,
        async (span) => {
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, "encargo_stream");
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, "brief");
          span.setAttribute("encargo.attachments_summaries", briefAttachments.length);
          span.setAttribute("encargo.chunks_total", allChunks.length);
          return buildCanonicalBrief({
            userMessage: userMessageText,
            conversationContext: formattedMessages,
            attachments: briefAttachments,
            requestId,
            userId: userId || conversationId || "anonymous",
          });
        },
        { userId: userId || conversationId || "anonymous", requestId }
      );

      const brief = briefRes.brief;

      emitTraceEvent(effectiveRunId, 'plan_created', {
        plan: {
          objective: brief.primary_intent,
          steps: brief.subtasks.map((t, idx) => ({
            index: idx + 1,
            toolName: 'subtask',
            description: `${t.title}: ${t.description}`
          })),
        },
        metadata: {
          brief,
          attempts: briefRes.attempts,
          attachments: briefAttachments.map(a => ({ id: a.id, kind: a.kind, label: a.label })),
        }
      }).catch(() => { });

      // Optional: expose brief for debugging (frontend currently ignores this event)
      writeSse(res, 'brief', {
        requestId,
        runId: effectiveRunId,
        brief,
        timestamp: Date.now(),
      });

      if (brief.blocker.is_blocked && brief.blocker.clarification_question) {
        const question = brief.blocker.clarification_question.trim();
        let fullContent = "";
        let lastAckSequence = -1;

        if (!isConnectionClosed) {
          fullContent = question;
          lastAckSequence = 0;
          writeSse(res, 'chunk', {
            content: question,
            sequenceId: 0,
            requestId,
            runId: effectiveRunId,
            timestamp: Date.now(),
          });
        }

        if (claimedRun && assistantMessageId) {
          const metadata = { webSources: detectedWebSources, brief, blocked: true };
          await storage.updateChatMessageContent(assistantMessageId, fullContent, 'done', metadata as any);
          await storage.updateChatRunStatus(claimedRun.id, 'done');
        }

        if (!isConnectionClosed) {
          writeSse(res, 'done', {
            requestId,
            runId: effectiveRunId,
            assistantMessageId,
            webSources: detectedWebSources.length > 0 ? detectedWebSources : undefined,
            timestamp: Date.now()
          });

          writeSse(res, 'complete', {
            requestId,
            runId: effectiveRunId,
            assistantMessageId,
            totalSequences: lastAckSequence + 1,
            contentLength: fullContent.length,
            intent: unifiedContext?.requestSpec.intent,
            deliverableType: unifiedContext?.requestSpec.deliverableType,
            durationMs: unifiedContext ? Date.now() - unifiedContext.startTime : 0,
            timestamp: Date.now(),
            ...sessionMetadata
          });
        }

        emitTraceEvent(effectiveRunId, 'done', {
          summary: question.slice(0, 200),
          phase: 'completed',
          metadata: { blocked: true }
        }).catch(() => { });

        // End early: we asked the single clarifying question.
        return;
      }

      // ===== 2) Hybrid RAG (keyword + embeddings) + GraphRAG-lite =====
      emitTraceEvent(effectiveRunId, 'tool_call_started', {
        tool_name: 'hybrid_retrieval',
        tool_input: { chunks: allChunks.length, graph: true },
      }).catch(() => { });

      const retrieval = await withSpan(
        SPAN_NAMES.PIPELINE_STAGE,
        async (span) => {
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, "encargo_stream");
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, "retrieval");
          span.setAttribute("encargo.chunks_total", allChunks.length);
          const dbRetrievalEnabled = String(process.env.ENCARGO_DB_RETRIEVAL_ENABLED || "true").toLowerCase() === "true";
          const shouldUseDbRetrieval =
            dbRetrievalEnabled &&
            persistentFileIds.length > 0 &&
            !hasAttachments &&
            !hasLastImageContext;

          span.setAttribute("encargo.retrieval_mode", shouldUseDbRetrieval ? "db" : "memory");

          if (!shouldUseDbRetrieval) {
            return hybridRetrieveInMemory({
              query: userMessageText,
              chunks: allChunks,
              topK: Math.min(24, allChunks.length || 24),
              enableGraphExpansion: allChunks.filter(c => c.kind === 'document').length > 20,
            });
          }

          try {
            const dbRes = await hybridRetrieveFromDb({
              query: userMessageText,
              fileIds: persistentFileIds,
              userId,
              topK: 18,
            });

            const nonDocChunks = allChunks.filter(c => c.kind !== "document");
            if (nonDocChunks.length === 0) return dbRes;

            const memRes = await hybridRetrieveInMemory({
              query: userMessageText,
              chunks: nonDocChunks,
              topK: 6,
              enableGraphExpansion: false,
            });

            const merged = [...dbRes.selected, ...memRes.selected]
              .sort((a, b) => b.hybridScore - a.hybridScore)
              .slice(0, 24);

            return {
              query: userMessageText,
              selected: merged,
              stats: {
                totalChunks: (dbRes.stats?.totalChunks || 0) + (memRes.stats?.totalChunks || 0),
                keywordCandidates: (dbRes.stats?.keywordCandidates || 0) + (memRes.stats?.keywordCandidates || 0),
                embeddedCandidates: (dbRes.stats?.embeddedCandidates || 0) + (memRes.stats?.embeddedCandidates || 0),
                graphExpanded: Boolean(dbRes.stats?.graphExpanded || memRes.stats?.graphExpanded),
                durationMs: (dbRes.stats?.durationMs || 0) + (memRes.stats?.durationMs || 0),
              },
            };
          } catch (err: any) {
            span.setAttribute("encargo.retrieval_mode", "db_failed_fallback");
            console.warn(`[Stream] DB retrieval failed; falling back to in-memory:`, err?.message || err);
            return hybridRetrieveInMemory({
              query: userMessageText,
              chunks: allChunks,
              topK: Math.min(24, allChunks.length || 24),
              enableGraphExpansion: allChunks.filter(c => c.kind === 'document').length > 20,
            });
          }
        },
        { userId: userId || conversationId || "anonymous", requestId }
      );

      emitTraceEvent(effectiveRunId, 'tool_call_succeeded', {
        tool_name: 'hybrid_retrieval',
        metadata: retrieval.stats,
      }).catch(() => { });

      let retrieved = retrieval.selected;

      const rerankEnabled = String(process.env.ENCARGO_RERANK_ENABLED || "true").toLowerCase() === "true";
      if (rerankEnabled && retrieved.length > 6) {
        emitTraceEvent(effectiveRunId, 'tool_call_started', {
          tool_name: 'rerank',
          tool_input: { candidates: retrieved.length },
        }).catch(() => { });

        const reranked = await withSpan(
          SPAN_NAMES.PIPELINE_STAGE,
          async (span) => {
            span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, "encargo_stream");
            span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, "rerank");
            span.setAttribute("encargo.rerank_candidates", retrieved.length);
            return rerankCandidatesWithLlm({
              query: userMessageText,
              brief,
              candidates: retrieved,
              topK: Math.min(12, retrieved.length),
              userId: userId || conversationId || "anonymous",
              requestId,
            });
          },
          { userId: userId || conversationId || "anonymous", requestId }
        );

        emitTraceEvent(effectiveRunId, 'tool_call_succeeded', {
          tool_name: 'rerank',
          metadata: { selected: reranked.selected.length },
        }).catch(() => { });

        retrieved = reranked.selected;
      }

      retrieved = retrieved.slice(0, Math.min(12, retrieved.length));
      const allowedCitationTags = retrieved.map(r => `[${r.chunk.sourceId}]`);
      const allowedCitationsBlock = allowedCitationTags.join("\n");
      const citationsPossible = allowedCitationTags.length > 0;

      // Build retrieval context within a token budget
      const MAX_CTX_TOKENS = 3500;
      let usedTokens = 0;
      const ctxParts: string[] = [];

      for (const r of retrieved) {
        const tag = `[${r.chunk.sourceId}]`;
        const body = (r.chunk.content || "").slice(0, 3000);
        const part = `${tag}\n${body}`.trim();
        const partTokens = Math.ceil(part.length / 4);
        if (usedTokens + partTokens > MAX_CTX_TOKENS) break;
        ctxParts.push(part);
        usedTokens += partTokens;
      }

      const retrievalContext = ctxParts.join("\n\n---\n\n").trim();

      // ===== 3) Answer generation (batch) =====
      const answerFirstPrompt = answerFirstEnforcer.generateAnswerFirstSystemPrompt(
        userMessageText,
        false
      );

      const briefSummaryForPrompt = JSON.stringify({
        primary_intent: brief.primary_intent,
        subtasks: brief.subtasks,
        deliverable: brief.deliverable,
        audience_tone: brief.audience_tone,
        restrictions: brief.restrictions,
        inputs: {
          provided: brief.inputs.provided.slice(0, 10),
          assumed: brief.inputs.assumed.slice(0, 10),
        },
        success_criteria: brief.success_criteria.slice(0, 10),
      });

      const citationsRules = citationsPossible
        ? [
            `CITAS OBLIGATORIAS:`,
            `- Cuando afirmes hechos concretos (fechas, numeros, definiciones, quotes), agrega al final de la frase una o mas citas EXACTAS de la lista permitida.`,
            `- Formato de cita: [doc:...], [img:...], [web:...] exactamente como aparecen abajo.`,
            `- Si la respuesta no se puede sustentar con las fuentes recuperadas, pide UNA sola aclaracion y DETENTE.`,
            ``,
            `CITAS PERMITIDAS (copiar/pegar tal cual):\n${allowedCitationsBlock || "(ninguna)"}`,
          ].join("\n")
        : [
            `CITAS:`,
            `- No hay fuentes recuperadas para citar (lista vacía). Responde SIN citas.`,
            `- Si el usuario EXIGE citas/fuentes, pide UNA sola aclaración sobre si puede adjuntar documentos o habilitar búsqueda web.`,
          ].join("\n");

      let systemContent = [
        answerFirstPrompt.fullPrompt,
        ``,
        `BRIEF_CANONICO (para ejecucion, no lo repitas literal):\n${briefSummaryForPrompt}`,
        ``,
        citationsRules,
        retrievalContext ? `\n\nFUENTES RECUPERADAS (usa solo esto como base factual y citalo):\n${retrievalContext}` : `\n\nFUENTES RECUPERADAS: (ninguna)`,
      ].join("\n");

      const systemMessage = {
        role: "system" as const,
        content: systemContent
      };

      console.log(`[Stream] Brief+RAG: chunks=${allChunks.length}, retrieved=${retrieved.length}, ctxTokens~=${usedTokens}`);

      const draft = await withSpan(
        SPAN_NAMES.PIPELINE_STAGE,
        async (span) => {
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, "encargo_stream");
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, "draft_generate");
          span.setAttribute(SPAN_ATTRIBUTES.LLM_MODEL, effectiveModel);
          return llmGateway.chat(
            [systemMessage, ...formattedMessages],
            {
              userId: userId || conversationId || "anonymous",
              requestId,
              provider: normalizedProvider,
              model: effectiveModel,
              maxTokens: effectiveMaxTokens,
              temperature: 0.4,
              disableImageGeneration: attachmentsCount > 0,
              skipCache: true,
            }
          );
        },
        { userId: userId || conversationId || "anonymous", requestId }
      );

      const draftAnswer = (draft.content || "").trim() || "No pude generar una respuesta.";

      // ===== 4) Verifier/QA (gating) =====
      emitTraceEvent(effectiveRunId, 'verification', {
        content: 'Running verifier checks (coherence, citations, contradictions)',
        phase: 'verifying'
      }).catch(() => { });

      const verification = await withSpan(
        SPAN_NAMES.PIPELINE_STAGE,
        async (span) => {
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_NAME, "encargo_stream");
          span.setAttribute(SPAN_ATTRIBUTES.PIPELINE_STAGE_NAME, "verifier");
          span.setAttribute("encargo.retrieved", retrieved.length);
          return verifyAnswer({
            userMessage: userMessageText,
            brief,
            draftAnswer,
            retrieved,
            requestId,
            userId: userId || conversationId || "anonymous",
          });
        },
        { userId: userId || conversationId || "anonymous", requestId }
      );

      const v = verification.result;
      const finalAnswer = (v.needs_clarification && v.clarification_question)
        ? v.clarification_question
        : v.final_answer;

      emitTraceEvent(effectiveRunId, v.verdict === 'pass' ? 'verification_passed' : 'verification_failed', {
        confidence: v.confidence,
        metadata: {
          verdict: v.verdict,
          issues: v.issues?.slice(0, 10),
          missing_citations: v.missing_citations?.slice(0, 10),
          citations_used: v.citations_used?.slice(0, 20),
        }
      }).catch(() => { });

      if (retrieved.length > 0) {
        emitTraceEvent(effectiveRunId, 'citations_added', {
          citations: retrieved.slice(0, 10).map(r => ({ source: r.chunk.sourceId, text: (r.chunk.rawContent || r.chunk.content).slice(0, 120) })),
        }).catch(() => { });
      }

      // ===== 5) Stream final answer (post-verified) =====
      let fullContent = "";
      let lastAckSequence = -1;
      const OUT_CHUNK_SIZE = 900;

      if (!isConnectionClosed) {
        for (let i = 0, seq = 0; i < finalAnswer.length; i += OUT_CHUNK_SIZE, seq++) {
          const piece = finalAnswer.slice(i, i + OUT_CHUNK_SIZE);
          if (!piece) continue;
          fullContent += piece;
          lastAckSequence = seq;

          if (claimedRun && seq > (claimedRun.lastSeq || 0)) {
            await storage.updateChatRunLastSeq(claimedRun.id, seq);
          }

          writeSse(res, 'chunk', {
            content: piece,
            sequenceId: seq,
            requestId,
            runId: effectiveRunId,
            timestamp: Date.now(),
          });
        }
      }

      // Update assistant message with full content and mark run as done
      if (claimedRun && assistantMessageId) {
        const metadata = {
          webSources: detectedWebSources.length > 0 ? detectedWebSources : undefined,
          brief: { ...brief, _raw_attempts: briefRes.attempts },
          retrieval: retrieval.stats,
          verification: {
            verdict: v.verdict,
            confidence: v.confidence,
            issues: v.issues?.slice(0, 20),
          },
        };
        await storage.updateChatMessageContent(assistantMessageId, fullContent, 'done', metadata as any);
        await storage.updateChatRunStatus(claimedRun.id, 'done');
      }

      const durationMs = unifiedContext ? Date.now() - unifiedContext.startTime : 0;

      if (!isConnectionClosed) {
        writeSse(res, 'done', {
          requestId,
          runId: effectiveRunId,
          assistantMessageId,
          webSources: detectedWebSources.length > 0 ? detectedWebSources : undefined,
          timestamp: Date.now()
        });

        writeSse(res, 'complete', {
          requestId,
          runId: effectiveRunId,
          assistantMessageId,
          totalSequences: Math.max(0, lastAckSequence + 1),
          contentLength: fullContent.length,
          intent: unifiedContext?.requestSpec.intent,
          deliverableType: unifiedContext?.requestSpec.deliverableType,
          durationMs,
          timestamp: Date.now(),
          ...sessionMetadata
        });

        emitTraceEvent(effectiveRunId, 'done', {
          summary: fullContent.slice(0, 200),
          durationMs,
          phase: 'completed',
          metadata: { contentLength: fullContent.length, sequences: Math.max(0, lastAckSequence + 1) }
        }).catch(() => { });
      }

      if (userId) {
        try {
          await storage.createAuditLog({
            userId,
            action: "chat_stream",
            resource: "chats",
            resourceId: conversationId || null,
            details: {
              messageCount: messages.length,
              requestId,
              runId: claimedRun?.id,
              streaming: true
            }
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
      }

    } catch (error: any) {
      console.error(`[SSE] Stream error ${requestId}:`, error);

      // Mark run as failed if we claimed one
      if (claimedRun) {
        try {
          await storage.updateChatRunStatus(claimedRun.id, 'failed', error.message);
        } catch (updateError) {
          console.error(`[SSE] Failed to update run status:`, updateError);
        }
      }

      const errorRunId = claimedRun?.id || requestId;
      if (!isConnectionClosed) {
        writeSse(res, 'error', {
          error: error.message,
          requestId,
          runId: errorRunId,
          timestamp: Date.now()
        });

        emitTraceEvent(errorRunId, 'error', {
          error: { message: error.message, code: error.code || 'UNKNOWN' }
        }).catch(() => { });
      }
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      if (!isConnectionClosed) {
        res.end();
      }
    }
  });



  // 3. Handle DOCUMENT_ANALYSIS intent- POST /analyze
  // ============================================================================================
  // UNIVERSAL DOCUMENT ANALYZER - POST /analyze
  // DATA_MODE enforced: NO image generation, NO artifact creation, NO web search
  // Only deterministic text extraction and LLM analysis with per-document citations
  // PARE Phase 1: Request contract, rate limiting, and quota guard middlewares applied
  // ============================================================================================
  router.post("/analyze",
    pareRequestContract,
    pareAnalyzeSchemaValidator,
    pareRateLimiter(),
    pareQuotaGuard(),
    pareIdempotencyGuard,
    async (req, res) => {
      const pareContext = requirePareContext(req);
      const { requestId, isDataMode, attachmentsCount: pareAttachmentsCount, startTime } = pareContext;
      const timestamp = new Date(startTime).toISOString();

      // Initialize observability infrastructure
      const logger = createPareLogger(requestId);
      logger.setContext({
        userId: pareContext.userId || undefined,
        clientIp: pareContext.clientIp
      });
      const auditCollector = new AuditTrailCollector(requestId);
      const chunkStore = createChunkStore({ maxChunksPerDoc: 50 });

      // SERVER-SIDE isDocumentMode flag - computed from PARE context (attachments.length > 0)
      // PARE enforces DATA_MODE when attachments are present, regardless of frontend flag
      const isDocumentMode = isDataMode; // Derived from PARE context (server-side enforcement)
      const productionWorkflowBlocked = isDataMode; // ProductionWorkflowRunner is NEVER called in DATA_MODE

      // Log request start using structured logger
      logger.logRequest({
        method: req.method,
        path: req.path,
        attachmentsCount: pareAttachmentsCount,
        clientIp: pareContext.clientIp,
        userAgent: req.headers['user-agent']
      });

      try {
        const { messages, attachments, conversationId } = req.body;

        // GUARD: attachments are REQUIRED for /analyze endpoint
        if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
          console.log(`[Analyze] REJECTED: No attachments provided (requestId: ${requestId})`);
          return res.status(400).json({
            error: "ATTACHMENTS_REQUIRED",
            message: "El endpoint /analyze requiere al menos un documento adjunto.",
            requestId,
            isDocumentMode,
            productionWorkflowBlocked
          });
        }

        const attachmentsCount = attachments.length;

        // Log detailed attachment metadata
        const attachmentMetadata = attachments.map((att: any, idx: number) => ({
          index: idx,
          filename: att.name || 'unknown',
          mimeType: att.mimeType || att.type || 'unknown',
          type: att.type || 'unknown',
          hasStoragePath: !!att.storagePath,
          hasContent: !!att.content,
          fileId: att.fileId || null
        }));

        console.log(`[Analyze] attachments_count: ${attachmentsCount}`);
        console.log(`[Analyze] filenames: ${attachmentMetadata.map(a => a.filename).join(', ')}`);
        console.log(`[Analyze] attachment_metadata:`, JSON.stringify(attachmentMetadata, null, 2));
        console.log(`[Analyze] DATA_MODE ACTIVATED - image_generation: BLOCKED, artifact_creation: BLOCKED`);

        // Get user message
        const lastUserMessage = messages && Array.isArray(messages)
          ? [...messages].reverse().find((m: any) => m.role === 'user')
          : null;
        const userQuery = lastUserMessage?.content || "Analiza el contenido de los documentos.";

        // ===================================================================================
        // AGENTIC IMPROVEMENT #1: Use Intent Router to understand user's request
        // ===================================================================================
        let intentResult: IntentResult | null = null;
        try {
          intentResult = await routeIntent(userQuery);
          console.log(`[Analyze] INTENT DETECTED:`, {
            intent: intentResult.intent,
            confidence: intentResult.confidence?.toFixed(2),
            output_format: intentResult.output_format,
            slots: intentResult.slots,
            language: intentResult.language_detected,
            fallback_used: intentResult.fallback_used,
            clarification: intentResult.clarification_question
          });

          // AGENTIC IMPROVEMENT #3: Clarification Loop when confidence is low
          if (intentResult.confidence < 0.7 && intentResult.clarification_question) {
            console.log(`[Analyze] LOW CONFIDENCE (${intentResult.confidence?.toFixed(2)}) - Returning clarification question`);
            return res.status(200).json({
              needs_clarification: true,
              clarification_question: intentResult.clarification_question,
              detected_intent: intentResult.intent,
              confidence: intentResult.confidence,
              suggested_actions: [
                { label: "Resumir el documento", action: "dame un resumen" },
                { label: "Analizar datos", action: "analiza los datos" },
                { label: "Extraer información", action: "extrae la información principal" }
              ],
              requestId,
              answer_text: intentResult.clarification_question
            });
          }
        } catch (intentError: any) {
          console.warn(`[Analyze] Intent routing failed, continuing with default analysis:`, intentError.message);
          // Continue with default behavior if intent routing fails
        }

        // Detect coverage requirement
        const requiresFullCoverage = /\b(todos|all|completo|complete|cada|every|analiza\s+todos)\b/i.test(userQuery);

        // Detect if user explicitly requests enrichment (summary/insights/questions)
        // AGENTIC: Also use intent result to determine enrichment
        const enrichmentPatterns = /\b(resumen|summary|insights|analiza|análisis|analisis|preguntas sugeridas|sugerencias|key findings|hallazgos|overview|resúmen|conclusiones)\b/i;
        const enrichmentFromIntent = intentResult?.intent === 'SUMMARIZE' || intentResult?.intent === 'ANALYZE_DOCUMENT';
        const enrichmentEnabled = enrichmentPatterns.test(userQuery) || enrichmentFromIntent;
        console.log(`[Analyze] enrichmentEnabled: ${enrichmentEnabled} (query: "${userQuery.substring(0, 50)}...", intent: ${intentResult?.intent || 'unknown'})`);

        // Resolve storagePaths for all attachments
        const resolvedAttachments: any[] = [];
        for (const att of attachments) {
          const resolved = { ...att };
          if (!resolved.storagePath && resolved.fileId) {
            const fileRecord = await storage.getFile(resolved.fileId);
            if (fileRecord && fileRecord.storagePath) {
              resolved.storagePath = fileRecord.storagePath;
            }
          }
          resolvedAttachments.push(resolved);
        }

        // Initialize ObjectStorageService for downloading files
        const objectStorageService = new ObjectStorageService();

        // Process each attachment using normalizeDocument for structured extraction
        const documentModels: DocumentSemanticModel[] = [];
        const processingStats: Array<{
          filename: string;
          status: 'success' | 'error';
          bytesRead: number;
          pagesProcessed: number;
          tokensExtracted: number;
          parseTimeMs: number;
          chunkCount: number;
          error?: string;
        }> = [];
        const failedFiles: Array<{ filename: string; error: string }> = [];

        for (const att of resolvedAttachments) {
          const filename = att.name || 'document';
          const parseStartTime = Date.now();

          try {
            let buffer: Buffer;

            // Download file from object storage using storagePath
            if (att.storagePath) {
              try {
                buffer = await objectStorageService.getObjectEntityBuffer(att.storagePath);
                console.log(`[Analyze] Downloaded ${filename} from storage: ${buffer.length} bytes`);
              } catch (downloadError: any) {
                // LOCAL FALLBACK: Try reading from local uploads/ directory
                // This handles development environments where Replit sidecar is unavailable
                if (att.storagePath.startsWith('/objects/uploads/')) {
                  const objectId = att.storagePath.replace('/objects/uploads/', '');
                  const fs = await import("fs");
                  const path = await import("path");
                  const localFilePath = path.default.join(process.cwd(), "uploads", objectId);

                  if (fs.default.existsSync(localFilePath)) {
                    buffer = await fs.promises.readFile(localFilePath);
                    console.log(`[Analyze] LOCAL FALLBACK: Read ${filename} from ${localFilePath}: ${buffer.length} bytes`);
                  } else {
                    console.error(`[Analyze] LOCAL FALLBACK: File not found at ${localFilePath}`);
                    throw new Error(`Failed to download file from storage and local fallback also failed: ${downloadError.message}`);
                  }
                } else {
                  console.error(`[Analyze] Failed to download ${filename} from ${att.storagePath}:`, downloadError);
                  throw new Error(`Failed to download file from storage: ${downloadError.message}`);
                }
              }
            } else if (att.content) {
              // Use inline content if provided (base64 or string)
              buffer = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content, 'base64');
            } else {
              throw new Error('No storagePath or content provided for attachment');
            }

            // Call normalizeDocument to extract structured data
            const docModel = await normalizeDocument(buffer, filename, att.storagePath);
            documentModels.push(docModel);

            const parseTimeMs = Date.now() - parseStartTime;
            const tokensEstimate = Math.ceil(buffer.length / 4); // Rough token estimate

            processingStats.push({
              filename,
              status: 'success',
              bytesRead: buffer.length,
              pagesProcessed: docModel.documentMeta.pageCount || docModel.documentMeta.sheetCount || 1,
              tokensExtracted: tokensEstimate,
              parseTimeMs,
              chunkCount: docModel.sections.length + docModel.tables.length
            });

            console.log(`[Analyze] Processed ${filename}: ${docModel.documentMeta.documentType}, ${docModel.tables.length} tables, ${docModel.metrics.length} metrics, ${docModel.anomalies.length} anomalies`);

          } catch (error: any) {
            const parseTimeMs = Date.now() - parseStartTime;
            const errorMessage = error.message || 'Unknown error during document processing';

            processingStats.push({
              filename,
              status: 'error',
              bytesRead: 0,
              pagesProcessed: 0,
              tokensExtracted: 0,
              parseTimeMs,
              chunkCount: 0,
              error: errorMessage
            });

            failedFiles.push({ filename, error: errorMessage });
            console.error(`[Analyze] Failed to process ${filename}:`, errorMessage);
          }
        }

        // Create combined batch-like result for compatibility
        const batchResult = {
          attachmentsCount: resolvedAttachments.length,
          processedFiles: documentModels.length,
          failedFiles,
          totalTokens: processingStats.reduce((sum, s) => sum + s.tokensExtracted, 0),
          chunks: documentModels.flatMap(doc =>
            doc.sections.map(section => ({
              docId: doc.documentMeta.fileName,
              filename: doc.documentMeta.fileName,
              content: section.content || '',
              location: section.sourceRef,
              offsets: { start: 0, end: section.content?.length || 0 },
              metadata: { sectionType: section.type }
            }))
          ),
          stats: processingStats,
          documentModels
        };

        // Determine parser used based on mimeType/extension
        const getParserInfo = (mimeType: string, filename: string): { mime_detect: string; parser_used: string } => {
          const ext = filename.split('.').pop()?.toLowerCase() || '';
          const mime = mimeType.toLowerCase();

          if (mime.includes('pdf') || ext === 'pdf') return { mime_detect: 'application/pdf', parser_used: 'PdfParser' };
          if (mime.includes('word') || mime.includes('document') || ext === 'docx' || ext === 'doc') return { mime_detect: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parser_used: 'DocxParser' };
          if (mime.includes('sheet') || mime.includes('excel') || ext === 'xlsx' || ext === 'xls') return { mime_detect: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parser_used: 'XlsxParser' };
          if (mime.includes('presentation') || mime.includes('powerpoint') || ext === 'pptx' || ext === 'ppt') return { mime_detect: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', parser_used: 'PptxParser' };
          if (mime.includes('csv') || ext === 'csv') return { mime_detect: 'text/csv', parser_used: 'CsvParser' };
          if (mime.includes('text') || ext === 'txt') return { mime_detect: 'text/plain', parser_used: 'TextParser' };
          return { mime_detect: mimeType || 'application/octet-stream', parser_used: 'TextParser' };
        };

        // Build progress report (per-file metrics) with mime_detect and parser_used
        const progressReport = {
          requestId,
          isDocumentMode,
          productionWorkflowBlocked,
          attachments_count: batchResult.attachmentsCount,
          processedFiles: batchResult.processedFiles,
          failedFiles: batchResult.failedFiles.length,
          tokens_extracted_total: batchResult.totalTokens,
          totalChunks: batchResult.chunks.length,
          perFileStats: batchResult.stats.map((stat, idx) => {
            const originalAtt = resolvedAttachments[idx] || {};
            const parserInfo = getParserInfo(originalAtt.mimeType || originalAtt.type || '', stat.filename);
            return {
              filename: stat.filename,
              status: stat.status,
              bytesRead: stat.bytesRead,
              pagesProcessed: stat.pagesProcessed,
              tokensExtracted: stat.tokensExtracted,
              parseTimeMs: stat.parseTimeMs,
              chunkCount: stat.chunkCount,
              mime_detect: parserInfo.mime_detect,
              parser_used: parserInfo.parser_used,
              error: stat.error || null
            };
          }),
          coverageCheck: {
            required: requiresFullCoverage,
            passed: !requiresFullCoverage || (batchResult.processedFiles === batchResult.attachmentsCount)
          }
        };

        // Record metrics and create audit records for each processed file
        for (const stat of batchResult.stats) {
          const originalAtt = resolvedAttachments.find((a: any) => a.name === stat.filename) || {};
          const parserInfo = getParserInfo(originalAtt.mimeType || originalAtt.type || '', stat.filename);

          // Record parse duration metrics
          pareMetrics.recordParseDuration(stat.parseTimeMs);
          pareMetrics.recordFileProcessed(stat.status === 'success');
          pareMetrics.recordParserExecution(parserInfo.parser_used, stat.parseTimeMs, stat.status === 'success');

          if (stat.status === 'success') {
            pareMetrics.recordTokensExtracted(stat.tokensExtracted);
          }

          // Log parsing result
          logger.logParsing({
            filename: stat.filename,
            mimeType: parserInfo.mime_detect,
            sizeBytes: stat.bytesRead,
            parserUsed: parserInfo.parser_used,
            durationMs: stat.parseTimeMs,
            tokensExtracted: stat.tokensExtracted,
            chunksGenerated: stat.chunkCount,
            success: stat.status === 'success',
            error: stat.error
          });

          // Create audit record
          auditCollector.addRecord(
            {
              filename: stat.filename,
              mimeType: parserInfo.mime_detect,
              sizeBytes: stat.bytesRead,
              content: '' // Content hash computed from buffer in real scenario
            },
            {
              success: stat.status === 'success',
              parserUsed: parserInfo.parser_used,
              tokensExtracted: stat.tokensExtracted,
              chunksGenerated: stat.chunkCount,
              parseTimeMs: stat.parseTimeMs,
              error: stat.error
            }
          );
        }

        // Store chunks with deduplication
        for (const chunk of batchResult.chunks) {
          chunkStore.addChunks(chunk.docId, chunk.filename, [{
            content: chunk.content,
            location: chunk.location,
            offsets: chunk.offsets
          }]);
        }

        // Get audit summary and coverage report
        const auditSummary = auditCollector.getSummary();
        const coverageReport = chunkStore.getCoverageReport();

        // Log observability summary
        logger.info("PARE_BATCH_COMPLETE", {
          attachments_count: progressReport.attachments_count,
          processedFiles: progressReport.processedFiles,
          failedFiles: progressReport.failedFiles,
          tokens_extracted_total: progressReport.tokens_extracted_total,
          totalChunks: progressReport.totalChunks,
          auditBatchId: auditSummary.batchId,
          coverageRate: coverageReport.coverageRate
        });

        // COVERAGE CHECK: If user asked to analyze "all", verify complete coverage
        if (requiresFullCoverage && batchResult.processedFiles !== batchResult.attachmentsCount) {
          const failedList = batchResult.failedFiles.map(f => `${f.filename}: ${f.error}`).join('; ');
          return res.status(422).json({
            error: "COVERAGE_CHECK_FAILED",
            message: `No se pudieron procesar todos los archivos. Procesados: ${batchResult.processedFiles}/${batchResult.attachmentsCount}`,
            failedFiles: failedList,
            progressReport,
            requestId
          });
        }

        // TOKENS CHECK: Ensure we extracted something
        if (batchResult.totalTokens === 0) {
          return res.status(422).json({
            error: "PARSE_FAILED",
            message: "No se pudo extraer texto de los documentos adjuntos.",
            progressReport,
            requestId
          });
        }

        // Build rich document context from DocumentSemanticModel
        // NOTE: Do NOT include fileName in LLM context to prevent model from repeating it
        const buildDocumentStructureSummary = (doc: DocumentSemanticModel, docIndex: number): string => {
          const meta = doc.documentMeta;
          const parts: string[] = [];
          const docLabel = documentModels.length === 1 ? 'El documento' : `Documento ${docIndex + 1}`;
          parts.push(`📄 ${docLabel} (${meta.documentType})`);
          if (doc.sheets && doc.sheets.length > 0) {
            parts.push(`  Sheets: ${doc.sheets.length} (${doc.sheets.map(s => s.name).join(', ')})`);
          }
          parts.push(`  Sections: ${doc.sections.length}, Tables: ${doc.tables.length}`);
          if (meta.pageCount) parts.push(`  Pages: ${meta.pageCount}`);
          if (meta.wordCount) parts.push(`  Words: ${meta.wordCount}`);
          return parts.join('\n');
        };

        const buildMetricsSummary = (doc: DocumentSemanticModel): string => {
          if (doc.metrics.length === 0) return '';
          const metricsText = doc.metrics.slice(0, 10).map(m => {
            const trend = m.trend ? ` (${m.trend === 'up' ? '↑' : m.trend === 'down' ? '↓' : '→'})` : '';
            return `  • ${m.name}: ${m.value}${m.unit ? ' ' + m.unit : ''}${trend} [${m.sourceRef}]`;
          }).join('\n');
          return `\n📊 Key Metrics (${doc.metrics.length} total):\n${metricsText}`;
        };

        const buildAnomaliesSummary = (doc: DocumentSemanticModel): string => {
          if (doc.anomalies.length === 0) return '';
          const anomaliesText = doc.anomalies.slice(0, 5).map(a =>
            `  ⚠️ [${a.severity.toUpperCase()}] ${a.type}: ${a.description} [${a.sourceRef}]`
          ).join('\n');
          return `\n🔍 Detected Anomalies (${doc.anomalies.length} total):\n${anomaliesText}`;
        };

        const buildTablePreview = (table: Table, maxRows: number = 3): string => {
          const header = table.headers.join(' | ');
          const separator = table.headers.map(() => '---').join(' | ');
          const previewRows = (table.previewRows || table.rows.slice(0, maxRows))
            .map(row => row.map(cell => String(cell.value ?? '')).join(' | '))
            .join('\n');
          return `${table.title || 'Table'} [${table.sourceRef}]:\n| ${header} |\n| ${separator} |\n| ${previewRows.split('\n').join(' |\n| ')} |`;
        };

        const buildTablesSummary = (doc: DocumentSemanticModel): string => {
          if (doc.tables.length === 0) return '';
          const tablesPreview = doc.tables.slice(0, 3).map(t => buildTablePreview(t)).join('\n\n');
          return `\n📋 Tables Preview (${doc.tables.length} total):\n${tablesPreview}`;
        };

        const buildSheetsSummary = (doc: DocumentSemanticModel): string => {
          if (!doc.sheets || doc.sheets.length === 0) return '';
          const sheetsText = doc.sheets.map(s =>
            `  📑 ${s.name}: ${s.rowCount} rows × ${s.columnCount} cols, range: ${s.usedRange}\n` +
            `     Headers: ${s.headers.slice(0, 5).join(', ')}${s.headers.length > 5 ? '...' : ''}`
          ).join('\n');
          return `\n📊 Sheets Overview:\n${sheetsText}`;
        };

        // Build comprehensive context for each document
        const documentContexts = documentModels.map((doc, idx) => {
          return [
            buildDocumentStructureSummary(doc, idx),
            buildSheetsSummary(doc),
            buildMetricsSummary(doc),
            buildAnomaliesSummary(doc),
            buildTablesSummary(doc)
          ].filter(Boolean).join('\n');
        });

        // Build citation format examples - use generic labels instead of filenames
        const citationFormats = documentModels.map((doc, idx) => {
          const meta = doc.documentMeta;
          const docRef = documentModels.length === 1 ? 'documento' : `doc${idx + 1}`;
          switch (meta.documentType) {
            case 'excel':
            case 'csv':
              return `[${docRef} sheet:NombreHoja!A1:Z100]`;
            case 'pdf':
              return `[${docRef} p:1]`;
            case 'word':
              return `[${docRef} section:Título]`;
            default:
              return `[${docRef}]`;
          }
        });

        // Build the combined document text from sections - NO filename in LLM context
        const documentText = documentModels.map((doc, idx) => {
          const sectionContent = doc.sections.map(section => {
            const content = section.content || '';
            return `[${section.type}${section.title ? ': ' + section.title : ''}] ${content}`;
          }).join('\n');
          const docLabel = documentModels.length === 1 ? 'DOCUMENTO' : `DOCUMENTO ${idx + 1}`;
          return `--- ${docLabel} ---\n${sectionContent}`;
        }).join('\n\n');

        // ===================================================================================
        // AGENTIC IMPROVEMENT #2: Dynamic System Prompt based on detected intent
        // ===================================================================================
        const getIntentSpecificInstructions = (): string => {
          const detectedIntent = intentResult?.intent || 'ANALYZE_DOCUMENT';
          const slots = intentResult?.slots || {};

          switch (detectedIntent) {
            case 'SUMMARIZE':
              return `
OBJETIVO PRINCIPAL: CREAR UN RESUMEN EJECUTIVO

TU RESPUESTA DEBE INCLUIR:
1. **RESUMEN EJECUTIVO** (obligatorio): Síntesis concisa de 2-3 párrafos del contenido principal
2. **PUNTOS CLAVE**: Lista de 5-7 puntos más importantes
3. **CONCLUSIONES**: Principales conclusiones del documento
${slots.style ? `\nEstilo solicitado: ${slots.style}` : ''}`;

            case 'TRANSLATE':
              const targetLang = slots.target_language || 'inglés';
              return `
OBJETIVO PRINCIPAL: TRADUCIR EL CONTENIDO

Traduce todo el contenido del documento al ${targetLang}.
- Mantén el formato original
- Preserva tecnicismos cuando sea apropiado
- Incluye notas de traducción para términos ambiguos`;

            case 'CREATE_DOCUMENT':
            case 'CREATE_PRESENTATION':
            case 'CREATE_SPREADSHEET':
              return `
OBJETIVO PRINCIPAL: CREAR CONTENIDO NUEVO BASADO EN EL DOCUMENTO

Genera contenido nuevo basándote en la información del documento.
- Organiza la información de manera estructurada
- Crea secciones claras y bien definidas
- Incluye citas del documento original para respaldar cada punto`;

            case 'SEARCH_WEB':
              return `
OBJETIVO PRINCIPAL: EXTRAER INFORMACIÓN ESPECÍFICA

Busca y extrae la información específica solicitada:
${slots.topic ? `- Búsqueda: "${slots.topic}"` : ''}
- Indica claramente si la información no se encuentra en el documento`;

            case 'ANALYZE_DOCUMENT':
            default:
              return `
OBJETIVO PRINCIPAL: ANÁLISIS DETALLADO

TU RESPUESTA DEBE INCLUIR:
1. **RESUMEN EJECUTIVO**: Síntesis de 2-3 párrafos del contenido principal
2. **HALLAZGOS CLAVE**: Lista de los descubrimientos más importantes con citas específicas
3. **DATOS Y MÉTRICAS**: Números, estadísticas y datos cuantitativos encontrados
4. **RIESGOS IDENTIFICADOS**: Problemas, anomalías o áreas de preocupación detectadas
5. **PREGUNTAS RECOMENDADAS**: 3-5 preguntas para profundizar en el análisis`;
          }
        };

        // Build system prompt for document analysis with structured output request
        const systemPrompt = `Eres un asistente experto en análisis de documentos empresariales.

MODO: DATA_MODE (análisis de documentos)
PROHIBIDO: Generar imágenes, crear artefactos, inventar datos, usar fuentes externas

REGLA IMPORTANTE SOBRE NOMBRES DE ARCHIVOS:
- NUNCA menciones nombres de archivos, extensiones (.pdf, .docx, .xlsx, .png, etc.) ni rutas
- Refiérete siempre como "el documento", "este documento" o "los documentos"
- NO uses encabezados como "RESPUESTA AL ANÁLISIS DEL DOCUMENTO X" o "Análisis de archivo.pdf"
- Comienza directamente con el análisis sin mencionar el nombre del archivo

INSTRUCCIONES CRÍTICAS:
1. ANALIZA exclusivamente el contenido de los documentos adjuntos
2. Responde basándote SOLO en el contenido real extraído
3. Para cada afirmación, INCLUYE la cita del documento fuente usando referencias genéricas
4. Si algo no está en los documentos, indica que "no se encontró en los documentos"

INTENT DETECTADO: ${intentResult?.intent || 'ANALYZE_DOCUMENT'} (confianza: ${intentResult?.confidence?.toFixed(2) || 'N/A'})
${getIntentSpecificInstructions()}

FORMATOS DE CITAS (usa estos exactamente):
${citationFormats.join('\n')}

DOCUMENTOS PROCESADOS: ${documentModels.length}

ESTRUCTURA DE LOS DOCUMENTOS:
${documentContexts.join('\n\n')}

CONTENIDO DETALLADO:
${documentText}`;


        // Build messages for LLM
        const llmMessages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userQuery }
        ];

        // Call LLM with strict DATA_MODE (no tools, no image generation)
        const user = (req as AuthenticatedRequest).user;
        const userId = user?.claims?.sub;

        const streamGenerator = llmGateway.streamChat(llmMessages, {
          userId: userId || conversationId || "anonymous",
          requestId,
          provider: normalizedProvider,
          model: effectiveModel,
          disableImageGeneration: true,  // HARD BLOCK
        });

        let answerText = "";
        for await (const chunk of streamGenerator) {
          answerText += chunk.content;
        }

        // POST-PROCESS: Remove any filename references the model might have included
        // Collect all filenames from processed documents
        const allFilenames = batchResult.stats
          .filter(s => s.status === 'success')
          .map(s => s.filename);

        // Build regex patterns for filename sanitization
        const sanitizeFilenameReferences = (text: string, filenames: string[]): string => {
          let sanitized = text;

          // For each filename, replace occurrences with "el documento"
          for (const filename of filenames) {
            // Escape special regex characters in filename
            const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Match filename with or without quotes, with various prefixes
            const patterns = [
              // "filename.pdf" or 'filename.pdf'
              new RegExp(`["']${escapedFilename}["']`, 'gi'),
              // Análisis del documento "filename.pdf":
              new RegExp(`(Análisis|Análisis del documento|Document analysis|RESPUESTA AL ANÁLISIS DEL DOCUMENTO)\\s*["']?${escapedFilename}["']?:?`, 'gi'),
              // [doc:filename.pdf] style citations
              new RegExp(`\\[doc:${escapedFilename}[^\\]]*\\]`, 'gi'),
              // Just the filename
              new RegExp(`\\b${escapedFilename}\\b`, 'gi'),
            ];

            for (const pattern of patterns) {
              sanitized = sanitized.replace(pattern, (match) => {
                // For citation-style matches, use generic citation
                if (match.startsWith('[doc:')) {
                  return documentModels.length === 1 ? '[documento]' : '[doc1]';
                }
                // For header-style matches, remove entirely
                if (match.match(/^(Análisis|Document|RESPUESTA)/i)) {
                  return '';
                }
                // Otherwise replace with "el documento"
                return 'el documento';
              });
            }
          }

          // Also sanitize any remaining file extension patterns
          // Match patterns like ".pdf", ".docx", ".xlsx" not part of citations
          sanitized = sanitized.replace(/(?<![[\w])(\w+)\.(pdf|docx|xlsx|pptx|csv|txt|png|jpg|jpeg)(?![)\]])/gi, 'el documento');

          // Clean up any double spaces or trailing colons left after removal
          sanitized = sanitized.replace(/\s{2,}/g, ' ').replace(/^\s*:\s*/gm, '');

          return sanitized;
        };

        // Apply sanitization unless user explicitly asked for filename
        const userAskedForFilename = /\b(nombre|filename|archivo|file)\b.*\b(cual|cuál|which|what)\b|\b(cual|cuál|which|what)\b.*\b(nombre|filename|archivo|file)\b/i.test(userQuery);
        if (!userAskedForFilename) {
          answerText = sanitizeFilenameReferences(answerText, allFilenames);
        }

        // Parse response for per-doc findings and citations
        const citations: string[] = [];
        const citationRegex = /\[doc:([^\]]+)\]/g;
        let match;
        while ((match = citationRegex.exec(answerText)) !== null) {
          if (!citations.includes(match[0])) {
            citations.push(match[0]);
          }
        }

        // Build per-doc findings (basic extraction)
        const perDocFindings: Record<string, string[]> = {};
        for (const stat of batchResult.stats.filter(s => s.status === 'success')) {
          const docName = stat.filename;
          const findings: string[] = [];
          // Find sentences that reference this document
          const sentences = answerText.split(/[.!?]\s+/);
          for (const sentence of sentences) {
            if (sentence.toLowerCase().includes(docName.toLowerCase()) ||
              sentence.includes(`[doc:${docName}`)) {
              findings.push(sentence.trim());
            }
          }
          if (findings.length > 0) {
            perDocFindings[docName] = findings;
          }
        }

        // Calculate total request duration
        const requestDurationMs = Date.now() - startTime;
        pareMetrics.recordRequestDuration(requestDurationMs);

        // Only generate enrichment UI components when explicitly requested
        let actionableInsights: Array<{
          id: string;
          type: 'finding' | 'risk' | 'opportunity' | 'recommendation';
          title: string;
          description: string;
          confidence: 'low' | 'medium' | 'high';
          sourceRefs: string[];
        }> = [];

        let suggestedQuestionsOutput: Array<{
          id: string;
          question: string;
          category: 'analysis' | 'clarification' | 'action' | 'deep-dive';
          relatedSources: string[];
        }> = [];

        // Aggregate insights and questions only when enrichment is enabled
        let allInsights: Insight[] = [];
        let allSuggestedQuestions: SuggestedQuestion[] = [];

        if (enrichmentEnabled) {
          console.log(`[Analyze] Enrichment ENABLED - generating insights and suggested questions`);

          // Aggregate insights from all document models
          allInsights = documentModels.flatMap(doc => doc.insights || []);

          // Aggregate suggested questions from all document models  
          allSuggestedQuestions = documentModels.flatMap(doc => doc.suggestedQuestions || []);

          // Extract risks from anomalies
          documentModels.forEach(doc => {
            doc.anomalies.forEach(anomaly => {
              actionableInsights.push({
                id: anomaly.id,
                type: 'risk',
                title: `${anomaly.type} detected`,
                description: anomaly.description,
                confidence: anomaly.severity === 'high' ? 'high' : anomaly.severity === 'medium' ? 'medium' : 'low',
                sourceRefs: [anomaly.sourceRef]
              });
            });
          });

          // Add insights from document models
          allInsights.forEach(insight => {
            actionableInsights.push({
              id: insight.id,
              type: insight.type as 'finding' | 'risk' | 'opportunity' | 'recommendation',
              title: insight.title,
              description: insight.description,
              confidence: insight.confidence,
              sourceRefs: insight.sourceRefs
            });
          });

          // Generate suggested questions for further analysis
          suggestedQuestionsOutput = allSuggestedQuestions.map(q => ({
            id: q.id,
            question: q.question,
            category: q.category,
            relatedSources: q.relatedSources
          }));

          // Add default questions if none were extracted
          if (suggestedQuestionsOutput.length === 0) {
            const defaultQuestions = [
              { id: 'q1', question: '¿Cuáles son las tendencias principales en los datos?', category: 'analysis' as const, relatedSources: documentModels.map(d => d.documentMeta.fileName) },
              { id: 'q2', question: '¿Existen valores atípicos o anomalías importantes?', category: 'deep-dive' as const, relatedSources: documentModels.map(d => d.documentMeta.fileName) },
              { id: 'q3', question: '¿Qué acciones se recomiendan basándose en estos datos?', category: 'action' as const, relatedSources: documentModels.map(d => d.documentMeta.fileName) },
            ];
            suggestedQuestionsOutput.push(...defaultQuestions);
          }
        } else {
          console.log(`[Analyze] Enrichment DISABLED - returning direct answer only`);
        }

        // Build response payload with full DocumentSemanticModel and enhanced fields
        const responsePayload = {
          success: true,
          requestId,
          mode: "DATA_MODE",
          answer_text: answerText,
          documentModel: documentModels.length === 1 ? documentModels[0] : {
            version: "1.0" as const,
            documentMeta: {
              id: `batch_${requestId}`,
              fileName: documentModels.map(d => d.documentMeta.fileName).join(', '),
              fileSize: documentModels.reduce((sum, d) => sum + d.documentMeta.fileSize, 0),
              mimeType: 'application/batch',
              documentType: 'unknown' as const,
              title: `Batch Analysis: ${documentModels.length} documents`
            },
            sections: documentModels.flatMap(d => d.sections),
            tables: documentModels.flatMap(d => d.tables),
            metrics: documentModels.flatMap(d => d.metrics),
            anomalies: documentModels.flatMap(d => d.anomalies),
            insights: allInsights,
            sources: documentModels.flatMap(d => d.sources),
            sheets: documentModels.flatMap(d => d.sheets || []),
            suggestedQuestions: allSuggestedQuestions,
            extractionDiagnostics: {
              extractedAt: new Date().toISOString(),
              durationMs: requestDurationMs,
              parserUsed: 'normalizeDocument',
              mimeTypeDetected: 'batch',
              bytesProcessed: documentModels.reduce((sum, d) => sum + d.documentMeta.fileSize, 0)
            }
          },
          documentModels: documentModels,
          insights: actionableInsights,
          suggestedQuestions: suggestedQuestionsOutput,
          ui_components: enrichmentEnabled ? ['executive_summary', 'suggested_questions', 'insights_panel'] : [],
          enrichmentEnabled,
          per_doc_findings: perDocFindings,
          citations,
          progressReport: {
            ...progressReport,
            auditSummary: {
              batchId: auditSummary.batchId,
              totalFiles: auditSummary.totalFiles,
              successCount: auditSummary.successCount,
              failureCount: auditSummary.failureCount,
              totalTokens: auditSummary.totalTokens,
              totalParseTimeMs: auditSummary.totalParseTimeMs
            },
            chunkCoverage: {
              totalDocuments: coverageReport.totalDocuments,
              uniqueChunks: coverageReport.uniqueChunks,
              duplicatesRemoved: coverageReport.duplicatesRemoved,
              coverageRate: coverageReport.coverageRate
            }
          },
          metadata: {
            totalTokensExtracted: batchResult.totalTokens,
            totalChunks: batchResult.chunks.length,
            processingTimeMs: requestDurationMs,
            documentsProcessed: documentModels.length,
            totalTables: documentModels.reduce((sum, d) => sum + d.tables.length, 0),
            totalMetrics: documentModels.reduce((sum, d) => sum + d.metrics.length, 0),
            totalAnomalies: documentModels.reduce((sum, d) => sum + d.anomalies.length, 0)
          }
        };

        // Log response
        logger.logResponse({
          statusCode: 200,
          durationMs: requestDurationMs,
          chunksReturned: batchResult.chunks.length,
          totalTokens: batchResult.totalTokens,
          filesProcessed: batchResult.processedFiles,
          filesFailed: batchResult.failedFiles.length
        });

        // Log audit trail
        logger.logAudit({
          action: "document_analysis",
          resource: "batch",
          resourceId: auditSummary.batchId,
          details: {
            filesCount: auditSummary.totalFiles,
            successCount: auditSummary.successCount,
            failureCount: auditSummary.failureCount
          },
          outcome: auditSummary.failureCount === 0 ? "success" : "failure"
        });

        // KILL-SWITCH: Validate DATA_MODE response before sending
        // Phase 2: Enhanced validation with response contract
        const { validateDataModeResponseEnhanced, DataModeOutputViolationError } = await import('../lib/dataModeValidator');
        const { validateResponseContract } = await import('../lib/pareResponseContract');

        // Extract attachment names for coverage validation
        const attachmentNames = batchResult.stats
          .filter(s => s.status === 'success')
          .map(s => s.filename);

        // Phase 2: Response contract validation with coverage check
        const contractValidation = validateResponseContract(
          responsePayload,
          attachmentNames,
          {
            contentType: 'application/json',
            requireFullCoverage: requiresFullCoverage
          }
        );

        // Log contract validation results
        console.log(`[Analyze] RESPONSE_CONTRACT validation:`, {
          valid: contractValidation.valid,
          hasValidContentType: contractValidation.hasValidContentType,
          hasNoBlobs: contractValidation.hasNoBlobs,
          hasNoBase64Data: contractValidation.hasNoBase64Data,
          hasNoImageUrls: contractValidation.hasNoImageUrls,
          coverageRatio: contractValidation.coverageRatio.toFixed(2),
          meetsCoverageRequirement: contractValidation.meetsCoverageRequirement,
          documentsWithCitations: contractValidation.documentsWithCitations,
          documentsWithoutCitations: contractValidation.documentsWithoutCitations,
          violationCount: contractValidation.violations.length
        });

        if (!contractValidation.valid) {
          console.error(`[Analyze] ========== RESPONSE_CONTRACT_VIOLATION ${requestId} ==========`);
          contractValidation.violations.forEach((v, i) => {
            console.error(`[Analyze] [${i + 1}] ${v.code}: ${v.message}`);
          });

          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.status(500).json({
            error: "RESPONSE_CONTRACT_VIOLATION",
            message: "La respuesta no cumple con el contrato de respuesta PARE Phase 2",
            violations: contractValidation.violations,
            coverageInfo: {
              documentsWithCitations: contractValidation.documentsWithCitations,
              documentsWithoutCitations: contractValidation.documentsWithoutCitations,
              coverageRatio: contractValidation.coverageRatio,
              meetsCoverageRequirement: contractValidation.meetsCoverageRequirement
            },
            requestId,
            progressReport
          });
        }

        // Enhanced DATA_MODE validation with all checks
        const validationResult = validateDataModeResponseEnhanced(responsePayload, requestId, {
          contentType: 'application/json',
          attachmentNames,
          requireFullCoverage: requiresFullCoverage,
          userQuery
        });

        if (!validationResult.valid) {
          console.error(`[Analyze] ========== DATA_MODE_OUTPUT_VIOLATION ${requestId} ==========`);
          console.error(`[Analyze] Violations: ${validationResult.violations.join('; ')}`);
          console.error(`[Analyze] Stack: ${validationResult.stack}`);

          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.status(500).json({
            error: "DATA_MODE_OUTPUT_VIOLATION",
            message: "La respuesta contiene elementos prohibidos en DATA_MODE (imágenes/artefactos)",
            violations: validationResult.violations,
            violationDetails: validationResult.violationDetails,
            requestId,
            progressReport
          });
        }

        // Return structured response (progressReport key matches test expectations)
        console.log(`[Analyze] ========== SUCCESS ${requestId} ==========`);
        console.log(`[Analyze] Response includes isDocumentMode: ${progressReport.isDocumentMode}, productionWorkflowBlocked: ${progressReport.productionWorkflowBlocked}`);
        console.log(`[Analyze] KILL-SWITCH: Payload validated, no image/artifact violations`);
        console.log(`[Analyze] RESPONSE_CONTRACT: All ${attachmentNames.length} documents have citations`);

        if (pareContext.idempotencyKey) {
          try {
            await completeIdempotencyKey(pareContext.idempotencyKey, responsePayload);
          } catch (idempotencyError) {
            console.error(`[Analyze] Failed to complete idempotency key: ${idempotencyError}`);
          }
        }

        // Set Content-Type header explicitly for PARE Phase 2 compliance
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(responsePayload);

      } catch (error: any) {
        // Mark idempotency key as failed
        if (pareContext.idempotencyKey) {
          try {
            await failIdempotencyKey(pareContext.idempotencyKey, error.message || 'Unknown error');
          } catch (idempotencyError) {
            console.error(`[Analyze] Failed to mark idempotency key as failed: ${idempotencyError}`);
          }
        }

        // Log error using structured logger
        logger.logError({
          error,
          phase: "unknown",
          stack: error.stack
        });

        // Record failed request in metrics
        pareMetrics.recordRequestDuration(Date.now() - startTime);

        // Check if it's a DATA_MODE violation error
        if (error.name === 'DataModeOutputViolationError') {
          logger.logAudit({
            action: "document_analysis",
            resource: "batch",
            details: { errorType: "DATA_MODE_OUTPUT_VIOLATION" },
            outcome: "failure"
          });
          return res.status(500).json({
            error: "DATA_MODE_OUTPUT_VIOLATION",
            message: error.message,
            violations: error.violations,
            requestId
          });
        }

        logger.logAudit({
          action: "document_analysis",
          resource: "batch",
          details: { errorType: "ANALYSIS_FAILED", errorMessage: error.message },
          outcome: "failure"
        });

        res.status(500).json({
          error: "ANALYSIS_FAILED",
          message: error.message || "Error durante el análisis de documentos",
          requestId
        });
      }
    });

  return router;
}
