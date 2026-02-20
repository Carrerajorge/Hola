import { Router } from "express";
import { storage } from "../storage";
import { chatService, AVAILABLE_MODELS, DEFAULT_PROVIDER, DEFAULT_MODEL } from "../services/ChatServiceV2";
import { llmGateway } from "../lib/llmGateway";
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
import { normalizeDocument } from "../services/structuredDocumentNormalizer";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import type { DocumentSemanticModel, Table, Metric, Anomaly, Insight, SuggestedQuestion, SheetSummary } from "../../shared/schemas/documentSemanticModel";
import { agentEventBus } from "../agent/eventBus";
import { createUnifiedRun, hydrateSessionState, emitTraceEvent, SseBufferedWriter, resolveLatencyLane } from "../agent/unifiedChatHandler";
import { executeAgentLoop } from "../agent/agentExecutor";
import type { UnifiedChatRequest, UnifiedChatContext, LatencyMode } from "../agent/unifiedChatHandler";
import { createRequestSpec, AttachmentSpecSchema } from "../agent/requestSpec";
import { routeIntent, type IntentResult } from "../services/intentRouter";
import { questionClassifier, type QuestionClassification } from "../services/questionClassifier";
import { answerFirstEnforcer } from "../services/answerFirstEnforcer";
import { academicSearchService } from "../services/academicSearchService";
import { isProductionIntent, handleProductionRequest, getDeliverables } from "../services/productionHandler";
import type { z } from "zod";
import { getUserId } from "../types/express";
import { semanticMemoryStore } from "../memory/SemanticMemoryStore";
import { type SkillScope } from "@shared/schema/skillPlatform";
import { handleEmailChatRequest } from "../services/gmailChatIntegration";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { ensureUserRowExists } from "../lib/ensureUserRowExists";
import { buildSkillSystemPromptSection, drizzleSkillStore, resolveSkillContextFromRequest } from "../services/skillContextResolver";
import { getSkillPlatformService, type SkillExecutionResult } from "../services/skillPlatform";

type AttachmentSpec = z.infer<typeof AttachmentSpecSchema>;

import { v4 as uuidv4 } from "uuid";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../types/express";
import { auditLog } from "../services/auditLogger";
import { usageQuotaService, type UsageCheckResult } from "../services/usageQuotaService";
import { conversationMemoryManager } from "../services/conversationMemory";
import { conversationStateService } from "../services/conversationStateService";
import { generateAndPersistChatTitle } from "../lib/chatTitleGenerator";
import { validate } from "../lib/requestValidator";
import { streamChatRequestSchema } from "../schemas/chatSchemas";

type ErrorCategory = 'network' | 'rate_limit' | 'api_error' | 'validation' | 'auth' | 'timeout' | 'unknown';
const isDebugLogEnabled = process.env.DEBUG === "true";
const MAX_STREAM_REQUEST_ID_LEN = 140;
const MAX_STREAM_EVENT_PAYLOAD_BYTES = 4600;
const MAX_STREAM_ATTACHMENT_NAME_LEN = 220;
const MAX_STREAM_ATTACHMENT_MIME_LEN = 120;
const MAX_STREAM_ATTACHMENT_SIZE = 200_000_000;
const MAX_STREAM_SKILL_SCOPES = 12;
const MAX_STREAM_SKILL_ATTACHMENTS = 12;
const DEFAULT_STREAM_SKILL_SCOPES: SkillScope[] = ["storage.read", "files", "code_interpreter"];
const VALID_STREAM_SCOPE_SET = new Set<SkillScope>([
  "storage.read",
  "storage.write",
  "browser",
  "email",
  "database",
  "external_network",
  "code_interpreter",
  "files",
  "system",
]);
const STREAM_IDENTIFIER_RE = /^[a-zA-Z0-9._-]{1,140}$/;
const STREAM_ATTACHMENT_NAME_RE = /^[^<>:\"/\\|?*\u0000-\u001f]{1,220}$/;
const STREAM_MIME_RE = /^[a-zA-Z0-9][a-zA-Z0-9.+-\/]*/;

// ── PER-USER SSE CONNECTION LIMITER ────────────────────────────
const MAX_SSE_CONNECTIONS_PER_USER = 5;
const SSE_CONNECTION_TRACKER = new Map<string, Set<string>>();

type ConversationStreamLock = {
  requestId: string;
  startedAt: number;
  cancel: (reason?: string) => void;
};

const CONVERSATION_STREAM_LOCK_TTL_MS = 15 * 60 * 1000;
const CONVERSATION_STREAM_LOCKS = new Map<string, ConversationStreamLock>();

function cleanConversationStreamLocks(): void {
  const now = Date.now();
  for (const [key, value] of CONVERSATION_STREAM_LOCKS.entries()) {
    if (now - value.startedAt > CONVERSATION_STREAM_LOCK_TTL_MS) {
      CONVERSATION_STREAM_LOCKS.delete(key);
    }
  }
}

function acquireSseSlot(userId: string, requestId: string): boolean {
  let connections = SSE_CONNECTION_TRACKER.get(userId);
  if (!connections) {
    connections = new Set();
    SSE_CONNECTION_TRACKER.set(userId, connections);
  }
  if (connections.size >= MAX_SSE_CONNECTIONS_PER_USER) return false;
  connections.add(requestId);
  return true;
}

function releaseSseSlot(userId: string, requestId: string): void {
  const connections = SSE_CONNECTION_TRACKER.get(userId);
  if (connections) {
    connections.delete(requestId);
    if (connections.size === 0) SSE_CONNECTION_TRACKER.delete(userId);
  }
}

/**
 * Sanitize external web content before injecting into system prompt.
 * Strips patterns that could be interpreted as LLM instructions/prompt injection.
 */
function sanitizeWebSearchContent(text: string, maxLen = 50_000): string {
  if (!text) return "";
  const repeatedPromptPattern = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
  return text
    .replace(/\b(?:ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?)/gi, "[filtered]")
    .replace(/\b(?:you\s+are\s+now|act\s+as\s+if|pretend\s+(?:you|that)|system\s*:\s*)/gi, "[filtered]")
    .replace(/\b(?:disregard|forget|override)\s+(?:all\s+)?(?:previous|above|prior|your)\s+(?:instructions?|rules?|guidelines?|prompt)/gi, "[filtered]")
    .replace(/\b(?:new\s+instructions?|updated?\s+instructions?|real\s+instructions?):/gi, "[filtered]")
    .replace(repeatedPromptPattern, "[filtered]")
    .replace(/\[(?:system|SYSTEM)\]/g, "[filtered]")
    .replace(/<\/?(?:system|prompt|instruction|rules?|override)>/gi, "[filtered]")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\/\/\]:\s*#\s*\([\s\S]*?\)/g, "")
    .replace(/\b(?:javascript|vbscript|data)\s*:/gi, "[filtered]:")
    .slice(0, maxLen);
}

function sanitizeStreamIdentifier(raw: unknown, fallbackPrefix = "stream_req"): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed && STREAM_IDENTIFIER_RE.test(trimmed)) return trimmed;
  }
  return `${fallbackPrefix}_${uuidv4().replace(/-/g, "").slice(0, 16)}`;
}

function sanitizeStreamText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  const safe = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return safe.length > maxLen ? safe.slice(0, maxLen) : safe;
}

function sanitizeStreamAttachment(raw: unknown): {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  storagePath?: string;
  fileId?: string;
  type?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const name = sanitizeStreamText(source.name, MAX_STREAM_ATTACHMENT_NAME_LEN);
  if (!name || !STREAM_ATTACHMENT_NAME_RE.test(name)) return null;
  const mimeType = sanitizeStreamText(
    source.mimeType || source.type,
    MAX_STREAM_ATTACHMENT_MIME_LEN
  );
  if (mimeType && !STREAM_MIME_RE.test(mimeType)) return null;
  const sizeValue = Number(source.size);
  const size = Number.isFinite(sizeValue) && sizeValue >= 0 && sizeValue <= MAX_STREAM_ATTACHMENT_SIZE
    ? Math.floor(sizeValue)
    : undefined;
  const type = sanitizeStreamText(source.type, MAX_STREAM_ATTACHMENT_MIME_LEN);
  const id = sanitizeStreamText(source.id || source.fileId, 160);
  const storagePath = sanitizeStreamText(source.storagePath, 255);
  const fileId = sanitizeStreamText(source.fileId, 160);
  return {
    id: id || fileId || undefined,
    name,
    mimeType: mimeType || type || undefined,
    size,
    storagePath: storagePath || undefined,
    fileId: fileId || undefined,
    type: type || undefined,
  };
}

function clampSsePayload<T>(payload: T, maxBytes: number = MAX_STREAM_EVENT_PAYLOAD_BYTES): T {
  const text = JSON.stringify(payload);
  if (text.length <= maxBytes) return payload;
  const candidate: Record<string, unknown> = { ...(payload as Record<string, unknown>), truncated: true };
  if (candidate.content && typeof candidate.content === "string") {
    candidate.content = sanitizeStreamText(candidate.content, Math.max(256, maxBytes - 120));
  }
  if (candidate.message && typeof candidate.message === "string") {
    candidate.message = sanitizeStreamText(candidate.message, 512);
  }
  if (candidate.details && typeof candidate.details === "string") {
    candidate.details = sanitizeStreamText(candidate.details, 512);
  }
  if (candidate.error && typeof candidate.error === "string") {
    candidate.error = sanitizeStreamText(candidate.error, 512);
  }
  return candidate as T;
}

function normalizeStreamSkillScopes(rawScopes: unknown): SkillScope[] {
  if (!Array.isArray(rawScopes)) return [...DEFAULT_STREAM_SKILL_SCOPES];
  const seen = new Set<SkillScope>();
  for (const scope of rawScopes) {
    if (typeof scope !== "string") continue;
    if (!VALID_STREAM_SCOPE_SET.has(scope as SkillScope)) continue;
    seen.add(scope as SkillScope);
    if (seen.size >= MAX_STREAM_SKILL_SCOPES) break;
  }
  return seen.size ? Array.from(seen) : [...DEFAULT_STREAM_SKILL_SCOPES];
}

function writeSse(res: Response, event: string, data: object): boolean {
  try {
    // Guard: don't write to a destroyed or finished response
    const r = res as any;
    if (r.writableEnded || r.destroyed) return false;

    const streamMeta = r?.locals?.streamMeta;
    const assistantMessageId =
      streamMeta?.assistantMessageId ||
      (typeof streamMeta?.getAssistantMessageId === "function"
        ? streamMeta.getAssistantMessageId()
        : undefined);

    const enrichedPayload: Record<string, unknown> = {
      ...(data as Record<string, unknown>),
    };

    if (!enrichedPayload.conversationId && streamMeta?.conversationId) {
      enrichedPayload.conversationId = streamMeta.conversationId;
    }
    if (!enrichedPayload.requestId && streamMeta?.requestId) {
      enrichedPayload.requestId = streamMeta.requestId;
    }
    if (!enrichedPayload.assistantMessageId && assistantMessageId) {
      enrichedPayload.assistantMessageId = assistantMessageId;
    }

    const payload = clampSsePayload(enrichedPayload);
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch (serializationError) {
      serialized = JSON.stringify(
        clampSsePayload({
          ...(payload as Record<string, unknown>),
          serializationError: sanitizeStreamText(String(serializationError), 120),
          truncated: true,
        }, MAX_STREAM_EVENT_PAYLOAD_BYTES)
      );
    }
    const chunk = `event: ${sanitizeStreamText(event, 120)}\ndata: ${serialized.length > MAX_STREAM_EVENT_PAYLOAD_BYTES
      ? JSON.stringify(clampSsePayload(payload, MAX_STREAM_EVENT_PAYLOAD_BYTES))
      : serialized}\n\n`;
    res.write(chunk);
    if (typeof (res as unknown as { flush: Function }).flush === 'function') {
      (res as unknown as { flush: Function }).flush();
    } else if (res.socket && typeof res.socket.write === 'function') {
      res.socket.write('');
    }
    if (typeof streamMeta?.onWrite === "function") {
      try {
        streamMeta.onWrite();
      } catch (observerError) {
        console.warn("[SSE] streamMeta.onWrite failed:", observerError);
      }
    }
    return true;
  } catch (err) {
    console.error('[SSE] Write failed:', err);
    return false;
  }
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

  router.post("/chat", async (req, res) => {
    try {
      const { messages: clientMessages, useRag = true, conversationId, images, gptConfig, gptId, documentMode, figmaMode, provider = DEFAULT_PROVIDER, model = DEFAULT_MODEL, attachments, lastImageBase64, lastImageId, session_id, skillId, skill } = req.body;

      if (!clientMessages || !Array.isArray(clientMessages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      // `getUserId` returns an authenticated user (if present). For anonymous users,
      // fall back to a stable, secure cookie-based ID so we can load settings and
      // persist conversation state.
      const effectiveUserId = getUserId(req) || getOrCreateSecureUserId(req);
      const userId = effectiveUserId;

      // CONTEXT FIX: Augment client messages with server-side history
      const messages = await conversationMemoryManager.augmentWithHistory(
        conversationId,
        clientMessages,
        8000 // token budget
      );
      console.log(`[Chat API] Context augmented: ${clientMessages.length} client msgs -> ${messages.length} total`);

      // userId already extracted above

      if (userId) {
        // Anonymous users (anon_*) won't have a `users` row yet. Ensure one exists so
        // quota checks and FK-backed features work instead of hard-failing.
        await ensureUserRowExists(userId);

        // 1. Token Quota Check (Read-only)
		        const hasTokenQuota = await usageQuotaService.hasTokenQuota(userId);
		        if (!hasTokenQuota) {
		          return res.status(402).json({
		            error: "Has excedido tu límite de tokens. Actualiza tu plan o agrega créditos para continuar.",
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

      // DATA_MODE ENFORCEMENT: Reject document attachments - must use /analyze endpoint
      const normalizedChatAttachments = Array.isArray(attachments)
        ? attachments
          .slice(0, MAX_STREAM_SKILL_ATTACHMENTS)
          .map(sanitizeStreamAttachment)
          .filter((att): att is NonNullable<ReturnType<typeof sanitizeStreamAttachment>> => !!att)
        : [];
      const hasDocumentAttachments = normalizedChatAttachments.length > 0
        ? normalizedChatAttachments.some((a) => isDocumentAttachment(a.mimeType || a.type || "", a.name || "", a.type || a.mimeType || ""))
        : false;

      if (hasDocumentAttachments) {
        console.log(`[Chat API] DATA_MODE: Rejecting document attachments - must use /analyze endpoint`);
        return res.status(400).json({
          error: "Document attachments must be processed via /api/analyze endpoint for proper analysis",
          code: "USE_ANALYZE_ENDPOINT"
        });
      }

      let attachmentContext = "";
      const hasAttachments = normalizedChatAttachments.length > 0;

      if (hasAttachments) {
        console.log(`[Chat API] Processing ${normalizedChatAttachments.length} attachment(s)`);
        try {
          const extractedContents: { extracted: Awaited<ReturnType<typeof extractAttachmentContent>>; attachment: Attachment }[] = [];
          for (const attachment of normalizedChatAttachments as Attachment[]) {
            const extracted = await extractAttachmentContent(attachment);
            extractedContents.push({ extracted, attachment });
          }

          const failedExtractions = extractedContents.filter(e => e.extracted === null);
          if (failedExtractions.length > 0) {
            console.warn(`[Chat API] Failed to extract content from ${failedExtractions.length} attachment(s):`,
              failedExtractions.map(e => e.attachment.name).join(', '));
          }
          const successfulExtractions = extractedContents.filter(e => e.extracted !== null).map(e => e.extracted!);
          if (successfulExtractions.length > 0) {
            attachmentContext = formatAttachmentsAsContext(successfulExtractions);
            console.log(`[Chat API] Extracted content from ${successfulExtractions.length} attachment(s), context length: ${attachmentContext.length}`);
          }

          if (conversationId) {
            for (const { extracted, attachment } of extractedContents) {
              if (extracted) {
                try {
                  await storage.createConversationDocument({
                    chatId: conversationId,
                    fileName: extracted.fileName,
                    storagePath: attachment.storagePath || null,
                    mimeType: extracted.mimeType || "application/octet-stream",
                    fileSize: (attachment as any).size || null,
                    extractedText: extracted.content,
                    metadata: { fileId: attachment.fileId }
                  });
                  console.log(`[Chat API] Persisted document: ${extracted.fileName} to conversation ${conversationId}`);
                } catch (persistError) {
                  console.error(`[Chat API] Error persisting document ${extracted.fileName}:`, persistError);
                }
              }
            }
          }
        } catch (attachmentError) {
          console.error("[Chat API] Error extracting attachment content:", attachmentError);
        }
      }

      const resolvedSkillContext = await resolveSkillContextFromRequest(drizzleSkillStore, {
        userId,
        skillId,
        skill,
      });
      const skillSystemSection = buildSkillSystemPromptSection(resolvedSkillContext);
      if (skillSystemSection) {
        console.info("[SkillContext] Applied to /api/chat", {
          userId,
          source: resolvedSkillContext?.source,
          skillId: resolvedSkillContext?.id || null,
          skillName: resolvedSkillContext?.name,
        });
      }

      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      const messagesWithSkill = skillSystemSection
        ? [{ role: "system" as const, content: skillSystemSection }, ...formattedMessages]
        : formattedMessages;

      // Build gptSession info - prefer contract-based session over legacy gptConfig
      const gptSession = gptSessionContract ? {
        contract: gptSessionContract,
      } : gptConfig ? {
        contract: null,
        legacyConfig: gptConfig
      } : undefined;

      const response = await chatService.chat(messagesWithSkill, {
        useRag,
        conversationId,
        userId,
        images,
        gptSession,
        gptConfig, // Keep for backward compatibility
        documentMode,
        figmaMode,
        provider,
        model: effectiveModel,
        attachmentContext,
        forceDirectResponse: hasAttachments && attachmentContext.length > 0,
        hasRawAttachments: hasAttachments,
        lastImageBase64,
        lastImageId,
        onAgentProgress: (update) => broadcastAgentUpdate(update.runId, update)
      });

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

      const userId = getOrCreateSecureUserId(req);
      let featureFlags = {
        voiceEnabled: true,
        voiceAdvanced: false,
        memoryEnabled: false,
        recordingHistoryEnabled: false,
      };
      let responseStyle: string = "default";
      let customInstructions: string = "";
      let userProfile: any = null;

      try {
        const userSettings = await storage.getUserSettings(userId);
        featureFlags = {
          voiceEnabled: userSettings?.featureFlags?.voiceEnabled ?? true,
          voiceAdvanced: userSettings?.featureFlags?.voiceAdvanced ?? false,
          memoryEnabled: userSettings?.featureFlags?.memoryEnabled ?? false,
          recordingHistoryEnabled: userSettings?.featureFlags?.recordingHistoryEnabled ?? false,
        };
        responseStyle = userSettings?.responsePreferences?.responseStyle || "default";
        customInstructions = userSettings?.responsePreferences?.customInstructions || "";
        userProfile = userSettings?.userProfile || null;
      } catch (e) {
        console.warn("[VoiceChat] Failed to load user settings:", (e as any)?.message || e);
      }

      if (!featureFlags.voiceEnabled) {
        return res.status(403).json({
          error: "Voice mode is disabled in your settings",
          code: "VOICE_DISABLED",
        });
      }

      const voiceStyleLine =
        responseStyle === "formal"
          ? "Usa un tono formal y profesional."
          : responseStyle === "casual"
            ? "Usa un tono casual y amigable."
            : responseStyle === "concise"
              ? "Sé muy conciso y ve directo al punto."
              : "Usa un tono neutro y claro.";

      const userProfileLine =
        userProfile && (userProfile.nickname || userProfile.occupation)
          ? `Usuario: ${userProfile.nickname ? userProfile.nickname : "N/A"}${userProfile.occupation ? ` (${userProfile.occupation})` : ""}.`
          : "";

      const result = await llmGateway.chat([
        {
          role: "system",
          content: `Eres Sira, un asistente de voz amigable y conversacional. 
Responde de manera natural y concisa, como si estuvieras hablando directamente con el usuario.
${featureFlags.voiceAdvanced ? "Puedes dar respuestas un poco más completas (hasta 5 oraciones) cuando haga falta." : "Mantén las respuestas cortas (2-3 oraciones máximo) para que sean fáciles de escuchar."}
Usa un tono cálido y conversacional en español. ${voiceStyleLine}
No uses markdown, emojis ni formatos especiales ya que tu respuesta será leída en voz alta.${userProfileLine ? `\n${userProfileLine}` : ""}${customInstructions ? `\n\nInstrucciones personalizadas del usuario:\n${customInstructions}` : ""}`
        },
        {
          role: "user",
          content: message
        }
      ], {
        model: featureFlags.voiceAdvanced ? "grok-4-fast-non-reasoning" : "grok-3-fast",
        temperature: 0.7,
        maxTokens: featureFlags.voiceAdvanced ? 250 : 150,
      });

      // Best-effort: store voice interactions depending on user settings.
      if (userId && (featureFlags.memoryEnabled || featureFlags.recordingHistoryEnabled)) {
        void (async () => {
          try {
            await ensureUserRowExists(userId);
            await semanticMemoryStore.initialize();

            if (featureFlags.recordingHistoryEnabled) {
              const stamp = new Date().toISOString();
              const convo = `(${stamp}) Voz: Usuario dijo: "${message}". Asistente respondió: "${result.content}".`;
              await semanticMemoryStore.remember(userId, convo, "conversation", {
                source: "voice_chat",
                confidence: 0.7,
              });
            }

            if (featureFlags.memoryEnabled) {
              await semanticMemoryStore.extractFromConversation(userId, [
                { role: "user", content: message },
              ]);
            }
          } catch (e) {
            console.warn("[VoiceChat] Failed to store memory:", (e as any)?.message || e);
          }
        })();
      }

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

  router.post("/chat/stream", validate({ body: streamChatRequestSchema }), async (req, res) => {
    const requestId = sanitizeStreamIdentifier(req.headers["x-request-id"], `stream_${Date.now()}`);
    const streamStartMs = performance.now();
    const stageTimings: Record<string, number> = {};
    let firstTokenAtMs: number | null = null;
    let timingReported = false;
    const roundMs = (value: number): number => Number(Math.max(0, value).toFixed(1));
    const recordStage = (stage: string, stageStartMs: number): void => {
      stageTimings[stage] = roundMs(performance.now() - stageStartMs);
    };
    const markFirstToken = (): void => {
      if (firstTokenAtMs === null) {
        firstTokenAtMs = performance.now();
      }
    };
    const buildTimingPayload = (): Record<string, number | null> => {
      const now = performance.now();
      const totalMs = roundMs(now - streamStartMs);
      const processingMs =
        firstTokenAtMs === null
          ? totalMs
          : roundMs(firstTokenAtMs - streamStartMs);
      const streamingMs =
        firstTokenAtMs === null
          ? 0
          : roundMs(now - firstTokenAtMs);

      return {
        ...stageTimings,
        totalMs,
        processingMs,
        firstTokenMs: firstTokenAtMs === null ? null : roundMs(firstTokenAtMs - streamStartMs),
        streamingMs,
      };
    };
    const reportTimings = (status: string): Record<string, number | null> => {
      const timings = buildTimingPayload();
      if (!timingReported) {
        timingReported = true;
        console.log("[Perf][chat_stream]", {
          traceId: requestId,
          status,
          ...timings,
        });
      }
      return timings;
    };

let heartbeatInterval: NodeJS.Timeout | null = null;
let isConnectionClosed = false;
let claimedRun: any = null;
let runFinalized = false; // true once run status has been set to done/failed
let assistantMessageId: string | null = null;
let streamHardTimeout: NodeJS.Timeout | null = null;
let streamIdleTimeout: NodeJS.Timeout | null = null;

const STREAM_HARD_TIMEOUT_MS = 180_000;
const STREAM_IDLE_TIMEOUT_MS = 90_000; // must exceed llmGateway idle timeout (60s)

const clearStreamTimeouts = (): void => {
  if (streamHardTimeout) {
    clearTimeout(streamHardTimeout);
    streamHardTimeout = null;
  }
  if (streamIdleTimeout) {
    clearTimeout(streamIdleTimeout);
    streamIdleTimeout = null;
  }
};

const endStreamByTimeout = (code: string, message: string): void => {
  if (isConnectionClosed) return;
  isConnectionClosed = true;
  clearStreamTimeouts();
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  const streamMeta = (res as any)?.locals?.streamMeta;
  if (streamMeta) {
    streamMeta.onWrite = undefined;
  }
  writeSse(res, "error", {
    code,
    error: message,
    timeout: true,
    timestamp: Date.now(),
  });
  if (!(res as any).writableEnded) {
    res.end();
  }
};

const resetIdleTimeout = (): void => {
  if (isConnectionClosed) return;
  if (streamIdleTimeout) {
    clearTimeout(streamIdleTimeout);
  }
  streamIdleTimeout = setTimeout(() => {
    endStreamByTimeout(
      "stream_inactivity_timeout",
      `Stream closed after ${STREAM_IDLE_TIMEOUT_MS}ms without SSE activity`
    );
  }, STREAM_IDLE_TIMEOUT_MS);
};

const skipRunStreamDedup = new Map<string, { requestId: string; startedAt: number }>();
const SKIPRUN_STREAM_DEDUP_TTL_MS = 20_000;

const buildSkipRunStreamKey = (chatId: string | undefined, clientRequestId?: string, userRequestId?: string): string | null => {
  if (!chatId || !clientRequestId) {
    return null;
  }
  return `skipRunStream:${chatId}:${clientRequestId}:${userRequestId || ""}`;
};

const cleanSkipRunStreamDedup = (): void => {
  const now = Date.now();
  for (const [key, value] of skipRunStreamDedup.entries()) {
    if (now - value.startedAt > SKIPRUN_STREAM_DEDUP_TTL_MS) {
      skipRunStreamDedup.delete(key);
    }
  }
};

    try {
      const {
        messages: clientMessages,
        conversationId,
        runId,
        chatId,
        clientRequestId: rawClientRequestId,
        userRequestId: rawUserRequestId,
        attachments,
        gptId,
        model,
        provider: rawProvider,
        session_id,
        docTool,
        forceWebSearch,
        webSearchAuto,
        latencyMode: rawLatencyMode,
        lastImageBase64,
        lastImageId,
        skillId,
        skill,
        skillScopes
      } = req.body;
      let latencyMode: LatencyMode = ['fast', 'deep', 'auto'].includes(rawLatencyMode) ? rawLatencyMode : 'auto';
      const effectiveUserId = getOrCreateSecureUserId(req);
      const streamConversationId = sanitizeStreamIdentifier(
        typeof conversationId === "string" && conversationId.trim().length > 0
          ? conversationId
          : (typeof chatId === "string" && chatId.trim().length > 0
            ? chatId
            : `chat_${requestId}`),
        "chat_stream"
      );

      cleanConversationStreamLocks();
      const queueMode = (req.body as any)?.queueMode === "reject" ? "reject" : "replace";
      const existingConversationLock = CONVERSATION_STREAM_LOCKS.get(streamConversationId);
      if (existingConversationLock && existingConversationLock.requestId !== requestId) {
        if (queueMode === "reject") {
          return res.status(409).json({
            status: "already_processing",
            conversationId: streamConversationId,
            requestId: existingConversationLock.requestId,
          });
        }
        existingConversationLock.cancel("stream_replaced");
        CONVERSATION_STREAM_LOCKS.delete(streamConversationId);
      }

      (res as any).locals = (res as any).locals || {};
      (res as any).locals.streamMeta = {
        conversationId: streamConversationId,
        requestId,
        getAssistantMessageId: () => assistantMessageId,
        onWrite: () => resetIdleTimeout(),
      };

      let conversationLockReleased = false;
      const releaseConversationLock = () => {
        if (conversationLockReleased) return;
        conversationLockReleased = true;
        const current = CONVERSATION_STREAM_LOCKS.get(streamConversationId);
        if (current?.requestId === requestId) {
          CONVERSATION_STREAM_LOCKS.delete(streamConversationId);
        }
      };
      res.on("close", releaseConversationLock);
      res.on("finish", releaseConversationLock);

      const cancelThisStream = (reason: string = "stream_replaced") => {
        endStreamByTimeout("stream_replaced", `Stream replaced (${reason})`);
      };
      CONVERSATION_STREAM_LOCKS.set(streamConversationId, {
        requestId,
        startedAt: Date.now(),
        cancel: cancelThisStream,
      });

      if (!streamHardTimeout) {
        streamHardTimeout = setTimeout(() => {
          endStreamByTimeout(
            "stream_hard_timeout",
            `Stream exceeded maximum duration of ${STREAM_HARD_TIMEOUT_MS}ms`
          );
        }, STREAM_HARD_TIMEOUT_MS);
      }
      resetIdleTimeout();

      const parsedSkillScopes = normalizeStreamSkillScopes(skillScopes);

      if (isDebugLogEnabled) {
        // DEBUG: Log attachments received from frontend
        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
          console.log(`[Stream] INCOMING ATTACHMENTS (${attachments.length}):`, JSON.stringify(attachments.map((a: any) => ({
            type: a.type, name: a.name, mimeType: a.mimeType, storagePath: a.storagePath,
            fileId: a.fileId, hasContent: !!a.content,
          }))));
        } else {
          console.log(`[Stream] NO ATTACHMENTS in request body. Keys: ${Object.keys(req.body).join(', ')}`);
        }
        if (lastImageBase64) {
          console.log(`[Stream] lastImageBase64 present: ${typeof lastImageBase64 === 'string' ? `${lastImageBase64.substring(0, 50)}... (${lastImageBase64.length} chars)` : typeof lastImageBase64}`);
        }

        // DEBUG: Log all incoming request parameters for docTool verification
        // Avoid externally-controlled format strings: don't interpolate user-controlled values into
        // the first console argument (console uses util.format semantics).
        console.log("[Stream] REQUEST RECEIVED", { docTool, chatId, runId, forceWebSearch });
      }

      if (!clientMessages || !Array.isArray(clientMessages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const resolvedSkillContext = await resolveSkillContextFromRequest(drizzleSkillStore, {
        userId: effectiveUserId,
        skillId,
        skill,
      });
      const skillSystemSection = buildSkillSystemPromptSection(resolvedSkillContext);
      if (skillSystemSection) {
        console.info("[SkillContext] Applied to /api/chat/stream", {
          requestId,
          userId: effectiveUserId,
          source: resolvedSkillContext?.source,
          skillId: resolvedSkillContext?.id || null,
          skillName: resolvedSkillContext?.name,
        });
      }

      const clientRequestId =
        typeof rawClientRequestId === "string" && rawClientRequestId.trim().length > 0
          ? sanitizeStreamText(rawClientRequestId, MAX_STREAM_REQUEST_ID_LEN)
          : undefined;
      const userRequestId =
        typeof rawUserRequestId === "string" && rawUserRequestId.trim().length > 0
          ? sanitizeStreamText(rawUserRequestId, MAX_STREAM_REQUEST_ID_LEN)
          : undefined;
      const latestUserForRun = [...clientMessages].reverse().find((m: any) => m?.role === "user");
      const latestUserTextForRun =
        typeof latestUserForRun?.content === "string"
          ? latestUserForRun.content
          : String(latestUserForRun?.content || "");
      const sanitizedRunAttachments =
        attachments && Array.isArray(attachments)
          ? attachments
              .slice(0, MAX_STREAM_SKILL_ATTACHMENTS)
              .map(sanitizeStreamAttachment)
              .filter((att) => !!att?.name)
          : null;

      // Claim run as early as possible (before any expensive routing/search work).
      // This avoids duplicate processing and ensures idempotency responses are true JSON
      // (before SSE headers are sent).
      if (chatId && !claimedRun && (runId || clientRequestId)) {
        const claimStageStart = performance.now();

        let existingRun =
          runId
            ? await storage.getChatRun(runId)
            : await storage.getChatRunByClientRequestId(chatId, clientRequestId!);

        // If caller did not provide runId but did provide clientRequestId,
        // create a lightweight run here so streaming can start.
        if (!existingRun && !runId && clientRequestId && latestUserTextForRun) {
          const runPrepStart = performance.now();
          try {
            // 1) Prefer linking the run to an already-persisted user message
            // when /chats/:id/messages used skipRun mode.
            let runMessageIdStart = performance.now();
            let runMessageId = userRequestId
              ? await storage.findMessageByRequestId(userRequestId)
              : null;
            recordStage("user_message_lookup_ms", runMessageIdStart);
            if (runMessageId && runMessageId.chatId === chatId) {
              const createRunStart = performance.now();
              const createdRun = await storage.createChatRun({
                chatId,
                clientRequestId,
                userMessageId: runMessageId.id,
                status: "pending",
              });
              existingRun = createdRun;
              recordStage("run_from_existing_message_ms", createRunStart);
            }

            // 2) Fallback: create user message + run atomically (legacy first-write path).
            if (!existingRun && latestUserTextForRun) {
              // If stream starts before /api/chats finishes, make sure the chat row exists
              // so createUserMessageAndRun won't fail with FK violations.
              const existingChat = await storage.getChat(chatId);
              if (!existingChat) {
                try {
                  await storage.createChat({
                    id: chatId,
                    title: "New Chat",
                    userId: effectiveUserId || undefined,
                  });
                } catch (chatCreateError: any) {
                  if (chatCreateError?.code !== "23505") {
                    throw chatCreateError;
                  }
                }
              }

              const createdRunStart = performance.now();
              const created = await storage.createUserMessageAndRun(
                chatId,
                {
                  chatId,
                  role: "user",
                  content: latestUserTextForRun,
                  status: "done",
                  requestId: userRequestId || `${requestId}:user`,
                  userMessageId: null,
                  attachments: sanitizedRunAttachments,
                } as any,
                clientRequestId
              );
              existingRun = created.run;
              recordStage("create_message_run_ms", createdRunStart);
            }
            recordStage("run_prep_ms", runPrepStart);
          } catch (createRunError: any) {
            // Unique violation means another concurrent request created it first.
            if (createRunError?.code !== "23505") {
              throw createRunError;
            }
            existingRun = await storage.getChatRunByClientRequestId(chatId, clientRequestId);
            recordStage("run_prep_ms", runPrepStart);
          }
        }

        if (!existingRun) {
          recordStage("run_claim_ms", claimStageStart);
          if (runId) {
            return res.status(404).json({
              error: "Run not found",
              traceId: requestId,
              timings: reportTimings("run_not_found"),
            });
          }
          // No run found for clientRequestId yet: continue in legacy mode
          // (best-effort), /chat/stream will still function.
        } else {
          if (existingRun.status === "processing") {
            const STALE_RUN_THRESHOLD_MS = 5 * 60 * 1000;
            const runStartedAt = existingRun.startedAt ? new Date(existingRun.startedAt).getTime() : 0;
            const runAge = Date.now() - runStartedAt;

            // Allow run replacement in two cases:
            // 1. queueMode "replace" (default) — client explicitly wants to supersede
            // 2. Stale run (processing > 5 min) — abandoned connection safety net
            if (queueMode === "replace" || runAge > STALE_RUN_THRESHOLD_MS) {
              const reason = runAge > STALE_RUN_THRESHOLD_MS ? "stale_run_recovered" : "run_replaced";
              console.log(`[Run] Resetting run ${existingRun.id} to pending (${reason}, age=${Math.round(runAge / 1000)}s)`);
              await storage.updateChatRunStatus(existingRun.id, "pending", reason);
              existingRun = { ...existingRun, status: "pending" };
              // Fall through to claim the reset run below
            } else {
              recordStage("run_claim_ms", claimStageStart);
              console.log(`[Run] Run ${existingRun.id} is already being processed (${Math.round(runAge / 1000)}s), returning status`);
              return res.json({
                status: "already_processing",
                run: existingRun,
                traceId: requestId,
                timings: reportTimings("already_processing"),
              });
            }
          }
          if (existingRun.status === "done") {
            recordStage("run_claim_ms", claimStageStart);
            console.log(`[Run] Run ${existingRun.id} already completed`);
            return res.json({
              status: "already_done",
              run: existingRun,
              traceId: requestId,
              timings: reportTimings("already_done"),
            });
          }
          if (existingRun.status === "failed") {
            console.log(`[Run] Run ${existingRun.id} previously failed — resetting to pending for retry`);
            await storage.updateChatRunStatus(existingRun.id, "pending");
            existingRun = { ...existingRun, status: "pending" };
          }

          const claimKey = existingRun.clientRequestId || clientRequestId;
          claimedRun = await storage.claimPendingRun(chatId, claimKey || undefined);
          recordStage("run_claim_ms", claimStageStart);
          if (!claimedRun) {
            const refreshedRun =
              runId
                ? await storage.getChatRun(runId)
                : (claimKey ? await storage.getChatRunByClientRequestId(chatId, claimKey) : null);
            if (refreshedRun?.status === "processing") {
              return res.json({
                status: "already_processing",
                run: refreshedRun,
                traceId: requestId,
                timings: reportTimings("already_processing"),
              });
            }
            if (refreshedRun?.status === "done") {
              return res.json({
                status: "already_done",
                run: refreshedRun,
                traceId: requestId,
                timings: reportTimings("already_done"),
              });
            }
            console.log(`[Run] Failed to claim run ${existingRun.id} - may have been claimed by another request`);
            return res.json({
              status: "claim_failed",
              message: "Run already claimed or not pending",
              traceId: requestId,
              timings: reportTimings("claim_failed"),
            });
          }
          console.log(`[Run] Successfully claimed run ${claimedRun.id}`);
        }
      }

      const provider = (
        rawProvider && ['xai', 'gemini', 'openai', 'anthropic', 'deepseek', 'auto'].includes(rawProvider)
          ? rawProvider
          : undefined
      ) as any;

      const hasAnyAttachments = sanitizedRunAttachments && sanitizedRunAttachments.length > 0;
      const lastUserMsg = [...clientMessages].reverse().find((m: any) => m.role === 'user');
      const userQuery = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : String(lastUserMsg?.content || '');
      const earlyQuestionClassification = questionClassifier.classifyQuestion(userQuery || "");

      // Auto: decide based on complexity signals (simple vs complex).
      if (latencyMode === 'auto') {
        if (
          earlyQuestionClassification.type === 'greeting' ||
          earlyQuestionClassification.type === 'factual_simple' ||
          earlyQuestionClassification.type === 'yes_no'
        ) {
          latencyMode = 'fast';
        } else if (
          earlyQuestionClassification.type === 'analysis' ||
          earlyQuestionClassification.type === 'summary' ||
          earlyQuestionClassification.type === 'comparison' ||
          earlyQuestionClassification.type === 'extraction' ||
          earlyQuestionClassification.type === 'action'
        ) {
          latencyMode = 'deep';
        }
      }

      // ── EARLY SSE SETUP ────────────────────────────────────────────
      // Open SSE *before* any heavy I/O (web search, academic search,
      // history augmentation) to minimize TTFT (Time-To-First-Token).
      const sseAlreadyOpen = res.headersSent;
      if (!sseAlreadyOpen) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Request-Id", requestId);
        res.setHeader("X-Trace-Id", requestId);
        res.setHeader("X-Latency-Mode", latencyMode);
        res.flushHeaders();

        // Immediately send a start-handshake so the client knows the stream is alive
        writeSse(res, 'start', {
          requestId,
          latencyMode,
          timestamp: Date.now(),
        });

        // Register connection-close handler as early as possible so every
        // subsequent writeSse can be guarded by isConnectionClosed.
        req.on("close", () => {
          isConnectionClosed = true;
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
          }
          clearStreamTimeouts();
          console.log("[SSE] Connection closed (early handler)", { requestId });
        });
      }

      let fullContent = "";
      let lastAckSequence = -1;
      let agentLoopHandled = false;
      let shouldRunModel = true;
      let skillSeedForModel = "";
      // NOTE: doneSent is wrapped in an object so that the bundler cannot
      // tree-shake it away (the declaration was previously stripped from the
      // compiled output, causing "doneSent is not defined" ReferenceErrors
      // in catch/finally blocks).
      const streamFlags = { doneSent: false };
      let skillExecutionResult: SkillExecutionResult | null = null;

      const effectiveSkillRunId = claimedRun?.id || sanitizeStreamText(runId, MAX_STREAM_REQUEST_ID_LEN) || requestId;
      const emitSkillTrace = (trace: { stage: string; status: string; message: string; details?: Record<string, unknown> }) => {
        if (isConnectionClosed) {
          return;
        }
        writeSse(res, 'skill_trace', {
          requestId,
          runId: effectiveSkillRunId,
          ...trace,
          timestamp: new Date().toISOString(),
        });
      };

      const emitSkillChunk = (payload: {
        stage: string;
        status: string;
        source: string;
        skill?: string | null;
        content: string;
        isFallback?: boolean;
      }) => {
        if (isConnectionClosed) {
          return;
        }
        const safePayload = {
          ...payload,
          content: sanitizeStreamText(payload.content, MAX_STREAM_EVENT_PAYLOAD_BYTES - 1200),
        };
        lastAckSequence += 1;
        writeSse(res, 'skill_chunk', {
          requestId,
          runId: effectiveSkillRunId,
          sequenceId: lastAckSequence,
          timestamp: Date.now(),
          ...safePayload,
        });
      };

      const skillTimeoutMs = 12000;
      const normalizedUserQuery = typeof userQuery === "string" ? userQuery.trim() : "";
      if (normalizedUserQuery && !isConnectionClosed) {
        emitSkillTrace({ stage: 'planner', status: 'ok', message: 'skill_router_started', details: { hasAttachments: hasAnyAttachments } });
        try {
          const executeSkillPromise = getSkillPlatformService().executeFromMessage({
            requestId,
            conversationId: streamConversationId,
            runId: effectiveSkillRunId,
            userId: effectiveUserId,
            userMessage: normalizedUserQuery,
            attachments: Array.isArray(sanitizedRunAttachments) ? sanitizedRunAttachments : [],
            allowedScopes: parsedSkillScopes,
            autoCreate: true,
            maxRetries: 1,
            emitTrace: emitSkillTrace,
            now: new Date(),
          });
          let skillTimeoutId: NodeJS.Timeout | null = null;
          const timeoutPromise = new Promise<never>((_, reject) => {
            skillTimeoutId = setTimeout(() => reject(new Error(`Skill execution timeout after ${skillTimeoutMs}ms`)), skillTimeoutMs);
          });

          try {
            skillExecutionResult = await Promise.race([executeSkillPromise, timeoutPromise]);
          } finally {
            if (skillTimeoutId) {
              clearTimeout(skillTimeoutId);
            }
          }
          emitSkillTrace({ stage: 'planner', status: 'ok', message: 'skill_router_finished', details: { status: skillExecutionResult.status, continueWithModel: skillExecutionResult.continueWithModel } });

          const seed = typeof skillExecutionResult.outputText === "string" ? skillExecutionResult.outputText.trim() : "";
          if (seed) {
            fullContent = seed;
            markFirstToken();
            emitSkillChunk({
              stage: 'execution',
              status: skillExecutionResult.status,
              source: skillExecutionResult.autoCreated ? 'auto' : 'catalog',
              skill: skillExecutionResult.selectedSkill?.slug || null,
              content: seed,
            });
          }

          if (skillExecutionResult.status === "partial" && skillExecutionResult.continueWithModel) {
            shouldRunModel = true;
            skillSeedForModel = seed;
          } else {
            shouldRunModel = skillExecutionResult.continueWithModel !== false;
          }

          if (skillExecutionResult.status === 'blocked' || skillExecutionResult.status === 'failed') {
            writeSse(res, 'skill_blocked', {
              requestId,
              runId: effectiveSkillRunId,
              status: skillExecutionResult.status,
              code: skillExecutionResult.error?.code || 'SKILL_BLOCKED',
              message: skillExecutionResult.error?.message || skillExecutionResult.fallbackText || 'Skill no disponible en este momento',
              requiresConfirmation: skillExecutionResult.requiresConfirmation,
              blockedScopes: skillExecutionResult.policyBreached?.blockedScopes || [],
              timestamp: Date.now(),
            });
          }

          if (!seed && skillExecutionResult.fallbackText) {
            fullContent = skillExecutionResult.fallbackText;
            emitSkillChunk({
              stage: 'fallback',
              status: skillExecutionResult.status,
              source: 'fallback',
              content: skillExecutionResult.fallbackText,
              isFallback: true,
            });
            if (skillExecutionResult.continueWithModel) {
              skillSeedForModel = skillExecutionResult.fallbackText;
            }
            markFirstToken();
          }
        } catch (skillError: any) {
          emitSkillTrace({ stage: 'factory', status: 'error', message: 'skill_router_error', details: { error: skillError?.message || String(skillError) } });
          writeSse(res, 'skill_blocked', {
            requestId,
            runId: effectiveSkillRunId,
            status: 'failed',
            code: 'SKILL_ROUTER_ERROR',
            message: 'No fue posible usar el enrutador de Skills, se usa fallback al modelo.',
            timestamp: Date.now(),
          });
          skillExecutionResult = {
            status: 'failed',
            continueWithModel: true,
            outputText: '',
            autoCreated: false,
            requiresConfirmation: false,
            traces: [],
            fallbackText: 'No fue posible usar el enrutador de Skills, se usa fallback al modelo.',
            error: {
              code: 'SKILL_ROUTER_ERROR',
              message: skillError?.message || 'No se pudo ejecutar el router de Skills',
              retryable: true,
            },
            output: undefined,
            policyBreached: undefined,
            selectedSkill: undefined,
          };
        }
      }

      const skipSkillShortcuts = !!skillExecutionResult && skillExecutionResult.status !== 'skipped';

      // Ultra-fast path for greetings: avoid expensive intent routing, context hydration,
      // and LLM calls entirely.
      if (
        earlyQuestionClassification.type === 'greeting' &&
        !hasAnyAttachments &&
        !docTool &&
        !forceWebSearch &&
        !webSearchAuto &&
        !isConnectionClosed &&
        !skipSkillShortcuts
      ) {
        const isThanks = /\b(gracias|muchas\s+gracias|te\s+agradezco)\b/i.test(userQuery);
        const content = isThanks
          ? "De nada. ¿Necesitas algo más?"
          : "Hola. ¿En qué puedo ayudarte?";

        markFirstToken();
        writeSse(res, 'chunk', {
          content,
          sequence: 1,
          runId: runId || requestId,
          timestamp: Date.now(),
        });
        writeSse(res, 'done', {
          sequenceId: 1,
          requestId,
          runId: runId || requestId,
          latencyMode,
          traceId: requestId,
          timings: reportTimings("greeting_fast_path"),
          timestamp: Date.now(),
        });
        return res.end();
      }

      // Simple QA fast-path: avoid heavy intent routing/history hydration for single-turn
      // factual/yes-no questions. Use a short timeout + provider fallback so users don't
      // wait ~30s for trivial prompts.
      if (
        latencyMode === 'fast' &&
        (earlyQuestionClassification.type === 'factual_simple' || earlyQuestionClassification.type === 'yes_no') &&
        !hasAnyAttachments &&
        !docTool &&
        !forceWebSearch &&
        !webSearchAuto &&
        !runId &&
        !gptId &&
        !session_id &&
        clientMessages.length <= 2 &&
        !isConnectionClosed &&
        !skipSkillShortcuts
      ) {
        try {
          const answerFirstPrompt = answerFirstEnforcer.generateAnswerFirstSystemPrompt(userQuery, false);
          const fastPathSystemPrompt = `${answerFirstPrompt.fullPrompt}${skillSystemSection}`;
          const llmMessages = [
            { role: "system" as const, content: fastPathSystemPrompt },
            ...clientMessages.map((m: any) => ({
              role: m.role as "user" | "assistant" | "system",
              content: String(m.content ?? "")
            }))
          ];

          const quick = await llmGateway.chat(llmMessages as any, {
          userId: effectiveUserId || streamConversationId || "anonymous",
            requestId,
            model: model || DEFAULT_MODEL,
            provider,
            maxTokens: Math.min(answerFirstPrompt.maxTokens || 300, 600), // Was 200 cap — caused mid-sentence truncation on simple questions
            temperature: 0.2,
            timeout: 12000,
            enableFallback: true,
          });

          markFirstToken();
          writeSse(res, 'chunk', {
            content: quick.content || "",
            sequence: 1,
            runId: runId || requestId,
            timestamp: Date.now(),
            provider: quick.provider,
          });
          writeSse(res, 'done', {
            sequenceId: 1,
            requestId,
            runId: runId || requestId,
            latencyMode,
            traceId: requestId,
            timings: reportTimings("simple_fast_path"),
            timestamp: Date.now(),
            provider: quick.provider,
            model: quick.model,
          });
          return res.end();
        } catch (e: any) {
          console.warn("[Stream] Simple fast-path failed, falling back to full pipeline:", e?.message || e);
        }
      }

      // Load user settings after the stream is already open to reduce perceived latency.
      let userSettings: Awaited<ReturnType<typeof storage.getUserSettings>> = null;
      const userSettingsStageStart = performance.now();
      try {
        userSettings = await storage.getUserSettings(effectiveUserId);
      } catch (e) {
        console.warn("[Stream] Failed to load user settings:", (e as any)?.message || e);
      } finally {
        recordStage("user_settings_ms", userSettingsStageStart);
      }

      const featureFlags = {
        memoryEnabled: userSettings?.featureFlags?.memoryEnabled ?? false,
        recordingHistoryEnabled: userSettings?.featureFlags?.recordingHistoryEnabled ?? false,
        webSearchAuto: userSettings?.featureFlags?.webSearchAuto ?? true,
        codeInterpreterEnabled: userSettings?.featureFlags?.codeInterpreterEnabled ?? true,
        canvasEnabled: userSettings?.featureFlags?.canvasEnabled ?? true,
        voiceEnabled: userSettings?.featureFlags?.voiceEnabled ?? true,
        voiceAdvanced: userSettings?.featureFlags?.voiceAdvanced ?? false,
        connectorSearchAuto: userSettings?.featureFlags?.connectorSearchAuto ?? false,
      };

      const responseStyle = userSettings?.responsePreferences?.responseStyle || "default";
      const customInstructions = userSettings?.responsePreferences?.customInstructions || "";
      const userProfile = userSettings?.userProfile || null;

      let detectedWebSources: any[] = [];
      let webSearchContextForLLM = ""; // Will be injected into system prompt

      const requestedWebSearch = !!forceWebSearch || !!webSearchAuto;
      const allowAutoSearch = featureFlags.webSearchAuto && !requestedWebSearch && !hasAnyAttachments;
      // Allow web search in ALL latency lanes when auto-search is enabled
      // Previously fast lane blocked auto-search, but this prevented news/current-event queries from working
      const shouldSearch = requestedWebSearch || allowAutoSearch;

      if (shouldSearch && userQuery && !isConnectionClosed) {
        // Emit thinking event so the user sees progress while search runs
        if (!isConnectionClosed) {
          writeSse(res, 'thinking', {
            step: 'searching',
            message: 'Buscando fuentes relevantes...',
            requestId,
            timestamp: Date.now(),
          });
        }
        try {
          const { needsAcademicSearch, needsWebSearch, searchWeb } = await import('../services/webSearch');
          const { academicEngineV3, generateAPACitation } = await import('../services/academicResearchEngineV3');

          const doAcademic = needsAcademicSearch(userQuery);
          const doWeb = requestedWebSearch ? !doAcademic : needsWebSearch(userQuery);

          if (doAcademic) {
            console.log("[Stream] Academic search", {
              mode: requestedWebSearch ? "requested" : "auto",
              queryPreview: userQuery.slice(0, 60),
            });
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

                clientMessages.unshift({
                  role: 'system',
                  content: `ARTÍCULOS ACADÉMICOS ENCONTRADOS (${engineResult.papers.length} resultados de ${engineResult.sources.map(s => s.name).join(', ')}):\n\n${academicContext}\n\nUSA ESTOS ARTÍCULOS para responder al usuario. Incluye citas APA y URLs para cada referencia.`
                });

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

                console.log("[Stream] Academic search complete", { papers: engineResult.papers.length });
              }
            } catch (academicError) {
              console.error('[Stream] Academic search error:', academicError);
            }
          } else if (doWeb) {
            console.log("[Stream] Web search", {
              mode: requestedWebSearch ? "requested" : "auto",
              queryPreview: userQuery.slice(0, 60),
            });
            try {
              const searchResults = await searchWeb(userQuery, 50);

              if (searchResults.results.length > 0) {
                // Build rich context: prefer full page content (from contents[]), fall back to snippets
                let searchContext: string;
                if (searchResults.contents && searchResults.contents.length > 0) {
                  searchContext = searchResults.contents
                    .map((c: any, i: number) => `[${i + 1}] ${c.title} (${c.url}):\n${c.content}`)
                    .join('\n\n');
                  // Add remaining results that only have snippets
                  const contentUrls = new Set(searchResults.contents.map((c: any) => c.url));
                  const extraResults = searchResults.results
                    .filter((r: any) => !contentUrls.has(r.url))
                    .slice(0, 5);
                  if (extraResults.length > 0) {
                    const startIdx = searchResults.contents.length + 1;
                    searchContext += '\n\n' + extraResults
                      .map((r: any, i: number) => `[${startIdx + i}] ${r.title}: ${r.snippet} (${r.url})`)
                      .join('\n');
                  }
                } else {
                  searchContext = searchResults.results
                    .map((r: any, i: number) => `[${i + 1}] ${r.title}\n${r.snippet}\nFuente: ${r.url}`)
                    .join('\n\n');
                }

                // Store for injection into system prompt (most reliable path)
                webSearchContextForLLM = `\n\n---\nBÚSQUEDA WEB REALIZADA - RESULTADOS ACTUALIZADOS:\n${searchContext}\n\nINSTRUCCIÓN CRÍTICA SOBRE LA BÚSQUEDA WEB:\n- Usa TODA la información de los resultados de búsqueda anteriores para dar una respuesta COMPLETA y DETALLADA.\n- NO digas que no tienes acceso a internet, noticias o información actualizada.\n- Los datos anteriores son reales y actuales, obtenidos en tiempo real.\n- Cita las fuentes con [número] al final de cada punto.\n- IGNORA cualquier límite de caracteres o instrucción de brevedad anterior: esta respuesta debe ser EXTENSA y cubrir todos los resultados relevantes.\n- Presenta la información en formato de lista con bullets o numerada, con detalles de cada noticia/resultado.`;

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

                console.log("[Stream] Web search complete", { results: searchResults.results.length, contentsCount: searchResults.contents?.length || 0 });
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
      const effectiveChatId = chatId || conversationId || streamConversationId;
      const messages = await conversationMemoryManager.augmentWithHistory(
        effectiveChatId,
        clientMessages,
        8000 // token budget
      );
      console.log(`[Stream API] Context augmented: ${clientMessages.length} client msgs -> ${messages.length} total`);

      // DOC TOOL: Stream content directly to client editor (real-time rendering)
      // Previously this routed through handleProductionRequest which generates binary files.
      // Now we let the normal streaming path handle it — content streams to TipTap/Handsontable/PPT editors.
      if (docTool && ['word', 'excel', 'ppt'].includes(docTool)) {
        console.log(`[Stream] 📝 DOC TOOL STREAMING: docTool=${docTool} - using real-time editor streaming`);
      }

      // DATA_MODE ENFORCEMENT: Reject document attachments - must use /analyze endpoint
      const hasDocumentAttachments = sanitizedRunAttachments && sanitizedRunAttachments.length > 0
        ? sanitizedRunAttachments.some((a) => isDocumentAttachment(a.mimeType || a.type || "", a.name || "", a.type || a.mimeType || ""))
        : false;

      if (hasDocumentAttachments) {
        console.log(`[Stream API] DATA_MODE: Rejecting document attachments - must use /analyze endpoint`);
        return res.status(400).json({
          error: "Document attachments must be processed via /api/analyze endpoint for proper analysis",
          code: "USE_ANALYZE_ENDPOINT"
        });
      }

      const userId = effectiveUserId;

      // GPT Session Contract Resolution for streaming
      // Priority: session_id (reuse existing) > gptId (create new)
      let gptSessionContract: GptSessionContract | null = null;
      let effectiveModel = model || DEFAULT_MODEL;
      let serverSessionId: string | null = null;
      const effectiveProvider = provider || DEFAULT_PROVIDER;

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
          const effectiveChatIdForSession = chatId || conversationId || streamConversationId;
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
          if (featureFlags.canvasEnabled && isProductionIntent(intentResult, userMessageText) && intentResult.confidence >= 0.5) {
            console.log(`[Stream] 🚀 PRODUCTION MODE ACTIVATED: intent=${intentResult.intent}, topic=${intentResult.slots.topic}`);

            try {
              const effectiveChatId = chatId || conversationId || streamConversationId;

              await handleProductionRequest(
                {
                  message: userMessageText,
                  userId: userId,
                  chatId: effectiveChatId,
                  conversationId: streamConversationId,
                  requestId,
                  assistantMessageId,
                  intentResult,
                  locale: intentResult.language_detected || 'es',
                },
                res
              );

              // Production handler completed, exit early
              return;
            } catch (productionError: any) {
              console.error('[Stream] ❌ Production handler error (first intercept), falling back to chat:', productionError?.message || productionError);
              console.error('[Stream] ❌ Production error stack:', productionError?.stack);
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
      if (sanitizedRunAttachments && sanitizedRunAttachments.length > 0) {
        for (const att of sanitizedRunAttachments) {
          const resolved = { ...att } as Record<string, unknown>;
          if (!resolved.storagePath && resolved.fileId) {
            const fileRecord = await storage.getFile(String(resolved.fileId));
            if (fileRecord && fileRecord.storagePath) {
              resolved.storagePath = fileRecord.storagePath;
              console.log(`[Stream] Pre-resolved storagePath for ${String(resolved.name || "unknown")}: ${resolved.storagePath}`);
            }
          }
          resolvedAttachments.push(resolved);
        }
      } else if (attachments && Array.isArray(attachments)) {
        for (const att of attachments.slice(0, MAX_STREAM_SKILL_ATTACHMENTS)) {
          const normalized = sanitizeStreamAttachment(att);
          if (!normalized || !normalized.name) continue;
          const resolved = { ...normalized } as Record<string, unknown>;
          if (!resolved.storagePath && resolved.fileId) {
            const fileRecord = await storage.getFile(String(resolved.fileId));
            if (fileRecord && fileRecord.storagePath) {
              resolved.storagePath = fileRecord.storagePath;
              console.log(`[Stream] Pre-resolved storagePath for ${String(resolved.name || "unknown")}: ${resolved.storagePath}`);
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
        const effectiveChatId = chatId || conversationId || streamConversationId;
        unifiedContext = await createUnifiedRun({
          messages: messages as Array<{ role: string; content: string }>,
          chatId: effectiveChatId,
          userId: userId || 'anonymous',
          runId: runId,
          messageId: `msg_${Date.now()}`,
          attachments: attachmentSpecs,
          latencyMode,
        });
        console.log(`[Stream] UnifiedContext created - intent: ${unifiedContext.requestSpec.intent}, confidence: ${unifiedContext.requestSpec.intentConfidence.toFixed(2)}, lane: ${unifiedContext.resolvedLane}, primaryAgent: ${unifiedContext.requestSpec.primaryAgent}`);
      } catch (contextError) {
        console.error('[Stream] Failed to create unified context:', contextError);
      }

      // If runId provided, claim the pending run (idempotent processing)
      if (runId && chatId && !claimedRun) {
        const existingRun = await storage.getChatRun(runId);
        if (!existingRun) {
          return res.status(404).json({ error: "Run not found" });
        }

        // If run is already processing or done, don't re-process
        if (existingRun.status === 'processing') {
          const runStartedAt = existingRun.startedAt ? new Date(existingRun.startedAt).getTime() : 0;
          const runAge = Date.now() - runStartedAt;
          if (queueMode === "replace" || runAge > 5 * 60 * 1000) {
            const reason = runAge > 5 * 60 * 1000 ? "stale_run_recovered" : "run_replaced";
            console.log(`[Run] Resetting run ${runId} to pending (${reason}, age=${Math.round(runAge / 1000)}s)`);
            await storage.updateChatRunStatus(existingRun.id, "pending", reason);
            // Fall through to claim below
          } else {
            console.log(`[Run] Run ${runId} is already being processed, returning status`);
            return res.json({ status: 'already_processing', run: existingRun });
          }
        }
        if (existingRun.status === 'done') {
          console.log(`[Run] Run ${runId} already completed`);
          return res.json({ status: 'already_done', run: existingRun });
        }
        if (existingRun.status === 'failed') {
          console.log(`[Run] Run ${runId} previously failed — resetting to pending for retry`);
          await storage.updateChatRunStatus(existingRun.id, "pending");
        }

        // Atomically claim the pending run using clientRequestId for specificity
        claimedRun = await storage.claimPendingRun(chatId, existingRun.clientRequestId);
        if (!claimedRun || claimedRun.id !== runId) {
          console.log(`[Run] Failed to claim run ${runId} - may have been claimed by another request`);
          return res.json({ status: 'claim_failed', message: 'Run already claimed or not pending' });
        }
        console.log(`[Run] Successfully claimed run ${runId}`);
      }

      // SSE headers were already set early (before search). This block only
      // runs if we somehow got here without the early setup (e.g. production
      // mode intercepted and then fell through). In normal flow, headers are
      // already sent and these calls become no-ops.
      if (!res.headersSent) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Request-Id", requestId);
        res.setHeader("X-Trace-Id", requestId);
        res.setHeader("X-Latency-Mode", latencyMode);
        res.flushHeaders();
      }

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
        if (featureFlags.canvasEnabled && isProductionIntent(intentResult, userMessageText) && intentResult.confidence >= 0.5) {
          const effectiveChatId = chatId || conversationId || streamConversationId;

          console.log(`[Stream] 🚀 PRODUCTION MODE ACTIVATED: intent=${intentResult.intent}, topic=${intentResult.slots.topic}`);

          try {
            await handleProductionRequest(
              {
                message: userMessageText,
                userId: userId,
                chatId: effectiveChatId,
                conversationId: streamConversationId,
                requestId,
                assistantMessageId,
                intentResult,
                locale: intentResult.language_detected || 'es',
              },
              res
            );

            // Production handler takes over response, we're done
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            return;
          } catch (productionError: any) {
            console.error('[Stream] ❌ Production handler error (second intercept), falling back to chat:', productionError?.message || productionError);
            console.error('[Stream] ❌ Production error stack:', productionError?.stack);
            // Continue to normal chat flow if production fails
          }
        }
      }

      // Idempotent close handler: the early SSE handler above may already
      // have registered one; this ensures coverage for the non-early path.
      if (!res.headersSent) {
        req.on("close", () => {
          isConnectionClosed = true;
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
          }
          clearStreamTimeouts();
          console.log(`[SSE] Connection closed (late handler): ${requestId}`);
        });
      }

      heartbeatInterval = setInterval(() => {
        const r = res as any;
        if (!isConnectionClosed && !r.writableEnded && !r.destroyed) {
          try {
            res.write(`:heartbeat\n\n`);
            if (typeof (res as unknown as { flush?: Function }).flush === "function") {
              (res as unknown as { flush: Function }).flush();
            } else if (res.socket && typeof res.socket.write === "function") {
              res.socket.write("");
            }

            // Heartbeats count as stream activity; keep the server-side idle timer from firing.
            resetIdleTimeout();
          } catch {
            // Connection gone — stop heartbeat
            isConnectionClosed = true;
            if (heartbeatInterval) clearInterval(heartbeatInterval);
          }
        }
      }, 15000);

      // Process attachments using DocumentBatchProcessor for atomic batch handling
      let attachmentContext = "";
      let batchResult: BatchProcessingResult | null = null;
      const hasAttachments = resolvedAttachments.length > 0;
      const attachmentsCount = hasAttachments ? resolvedAttachments.length : 0;

      // GUARD: Detect if user requests "analyze all" - requires full coverage
      const userMessage = messages[messages.length - 1]?.content || "";
      const requiresFullCoverage = /\b(todos|all|completo|complete|cada|every)\b/i.test(userMessage);

      if (hasAttachments) {
        console.log(`[Stream] Processing ${attachmentsCount} attachment(s) as atomic batch:`,
          resolvedAttachments.map((a: any) => ({
            name: a.name,
            type: a.type,
            storagePath: a.storagePath,
            fileId: a.fileId
          }))
        );

        try {
          const batchProcessor = new DocumentBatchProcessor();

          // Convert resolved attachments to BatchAttachment format
          // storagePaths were already resolved earlier
          const batchAttachments: BatchAttachment[] = resolvedAttachments
            .filter((att: any) => {
              if (!(att.storagePath || att.content)) return false;
              // Exclude image attachments — they are handled by the Vision pipeline below
              const mime = (att.mimeType || att.type || "").toLowerCase();
              if (mime.startsWith("image/")) return false;
              return true;
            })
            .map((att: any) => ({
              name: att.name || 'document',
              mimeType: att.mimeType || att.type || 'application/octet-stream',
              storagePath: att.storagePath || '',
              content: att.content
            }));

          // Skip batch processing if all attachments were images (handled by Vision pipeline)
          if (batchAttachments.length === 0) {
            console.log(`[Stream] All attachments are images — skipping DocumentBatchProcessor`);
          } else {
            batchResult = await batchProcessor.processBatch(batchAttachments);
          }

          if (batchResult) {
            // Log observability metrics per file
            console.log(`[Stream] Batch processing complete:`, {
              attachmentsCount: batchResult.attachmentsCount,
              processedFiles: batchResult.processedFiles,
              failedFiles: batchResult.failedFiles.length,
              totalChunks: batchResult.chunks.length,
              totalTokens: batchResult.totalTokens
            });

            // Log per-file stats
            for (const stat of batchResult.stats) {
              console.log(`[Stream] File stats: ${stat.filename}`, {
                bytesRead: stat.bytesRead,
                pagesProcessed: stat.pagesProcessed,
                tokensExtracted: stat.tokensExtracted,
                parseTimeMs: stat.parseTimeMs,
                chunkCount: stat.chunkCount,
                status: stat.status
              });
            }

            // COVERAGE CHECK: If user asked to analyze "all" files, verify complete coverage
            if (requiresFullCoverage && batchResult.processedFiles !== batchResult.attachmentsCount) {
              const failedList = batchResult.failedFiles.map(f => `${f.filename}: ${f.error}`).join(', ');
              const errorMsg = `Coverage check failed: processed ${batchResult.processedFiles}/${batchResult.attachmentsCount} files. Failed: ${failedList}`;
              console.error(`[Stream] ${errorMsg}`);

              writeSse(res, "error", {
                type: 'coverage_failure',
                message: 'No se pudieron procesar todos los archivos solicitados',
                details: {
                  requested: batchResult.attachmentsCount,
                  processed: batchResult.processedFiles,
                  failedFiles: batchResult.failedFiles
                },
                requestId,
                timestamp: Date.now()
              });

              clearInterval(heartbeatInterval);
              clearStreamTimeouts();
              return res.end();
            }

            // Use unified context from batch processor
            if (batchResult.unifiedContext) {
              attachmentContext = batchResult.unifiedContext;
              console.log(`[Stream] Unified context from ${batchResult.processedFiles} files, length: ${attachmentContext.length} chars`);
            }
          }

        } catch (batchError: any) {
          console.error("[Stream] Batch processing error:", batchError);

          writeSse(res, "error", {
            type: 'batch_processing_error',
            message: 'Error al procesar los archivos adjuntos',
            details: batchError.message,
            requestId,
            timestamp: Date.now()
          });

          clearInterval(heartbeatInterval);
          clearStreamTimeouts();
          return res.end();
        }
      }

      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      // ── IMAGE VISION SUPPORT ──────────────────────────────────────
      // Collect image data to inject as multimodal content into the last user message.
      // Sources: (1) lastImageBase64 from image-edit flow, (2) image attachments uploaded by user.
      const imagePartsForVision: Array<{ type: "image_url"; image_url: { url: string } }> = [];

      console.log(`[Stream] Vision pipeline: resolvedAttachments=${resolvedAttachments.length}, lastImageBase64=${!!lastImageBase64}, lastImageId=${lastImageId || 'none'}`);
      if (resolvedAttachments.length > 0) {
        console.log(`[Stream] Vision pipeline: attachments detail:`, resolvedAttachments.map((a: any) => ({
          name: a.name, type: a.type, mimeType: a.mimeType, storagePath: a.storagePath, fileId: a.fileId,
          hasContent: !!a.content,
        })));
      }

      // Source 1: Image edit context (lastImageBase64 from frontend)
      if (lastImageBase64 && typeof lastImageBase64 === "string") {
        const dataUrl = lastImageBase64.startsWith("data:")
          ? lastImageBase64
          : `data:image/png;base64,${lastImageBase64}`;
        imagePartsForVision.push({ type: "image_url", image_url: { url: dataUrl } });
        console.log(`[Stream] Vision: injecting lastImageBase64 (${Math.round(lastImageBase64.length / 1024)}KB)`);
      }

      // Source 2: Image attachments (uploaded files with image/* mimeType)
      if (resolvedAttachments.length > 0) {
        for (const att of resolvedAttachments) {
          const mime = (att.mimeType || att.type || "").toLowerCase();
          console.log(`[Stream] Vision: checking att "${att.name}" mime="${mime}" isImage=${mime.startsWith("image/")}`);
          if (!mime.startsWith("image/")) continue;

          const storagePath = att.storagePath || "";
          let imageBuffer: Buffer | null = null;

          // Try GCS (object storage) first — production stores files there
          try {
            const objStore = new ObjectStorageService();
            imageBuffer = await objStore.getObjectEntityBuffer(storagePath);
            console.log(`[Stream] Vision: loaded image from GCS "${att.name}" (${imageBuffer.length} bytes)`);
          } catch (gcsErr: any) {
            console.log(`[Stream] Vision: GCS failed for "${att.name}": ${gcsErr?.message || gcsErr}`);
          }

          // Local file fallback
          if (!imageBuffer) {
            try {
              const fs = await import("fs/promises");
              const path = await import("path");
              let filePath = storagePath;
              const cwd = process.cwd();
              console.log(`[Stream] Vision: local fallback for "${att.name}", storagePath="${storagePath}", cwd="${cwd}"`);
              if (filePath.startsWith("/objects/uploads/")) {
                filePath = path.default.join(cwd, filePath.replace("/objects/", ""));
              } else if (filePath.startsWith("/objects/")) {
                filePath = path.default.join(cwd, filePath.replace("/objects/", ""));
              } else if (!path.default.isAbsolute(filePath)) {
                filePath = path.default.join(cwd, "uploads", filePath);
              }
              console.log(`[Stream] Vision: resolved filePath="${filePath}"`);
              // Check if file exists before reading
              try {
                const stat = await fs.stat(filePath);
                console.log(`[Stream] Vision: file exists, size=${stat.size} bytes`);
              } catch {
                console.warn(`[Stream] Vision: file NOT found at "${filePath}"`);
                // Try listing the uploads directory to see what's there
                try {
                  const uploadsDir = path.default.join(cwd, "uploads");
                  const files = await fs.readdir(uploadsDir);
                  console.log(`[Stream] Vision: uploads dir has ${files.length} files: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`);
                } catch (dirErr: any) {
                  console.warn(`[Stream] Vision: cannot list uploads dir: ${dirErr?.message}`);
                }
              }
              imageBuffer = await fs.readFile(filePath);
              console.log(`[Stream] Vision: loaded image from local "${att.name}" (${imageBuffer.length} bytes)`);
            } catch (localErr: any) {
              console.warn(`[Stream] Vision: failed to load image "${att.name}":`, localErr?.message);
            }
          }

          if (imageBuffer) {
            const base64 = imageBuffer.toString("base64");
            const dataUrl = `data:${mime};base64,${base64}`;
            imagePartsForVision.push({ type: "image_url", image_url: { url: dataUrl } });
            console.log(`[Stream] Vision: added image "${att.name}" to multimodal parts (${Math.round(base64.length / 1024)}KB base64)`);
          } else {
            console.error(`[Stream] Vision: FAILED to load image "${att.name}" from ANY source — image will NOT be sent to LLM`);
          }
        }
      }

      console.log(`[Stream] Vision: total imagePartsForVision=${imagePartsForVision.length}`);

      // If we have images, convert the last user message to multimodal format
      if (imagePartsForVision.length > 0) {
        for (let i = formattedMessages.length - 1; i >= 0; i--) {
          if (formattedMessages[i].role === "user") {
            const textContent = typeof formattedMessages[i].content === "string"
              ? formattedMessages[i].content
              : JSON.stringify(formattedMessages[i].content);
            formattedMessages[i] = {
              role: "user",
              content: [
                ...imagePartsForVision,
                { type: "text", text: textContent },
              ] as any,
            };
            console.log(`[Stream] Vision: converted user message[${i}] to multimodal (${imagePartsForVision.length} images, text="${textContent.substring(0, 100)}")`);
            break;
          }
        }

        // Force deep lane for vision requests (images need more tokens)
        if (latencyMode === 'fast') {
          latencyMode = 'deep' as LatencyMode;
          console.log(`[Stream] Vision: upgraded latency mode to 'deep' for image analysis`);
        }
      } else {
        console.log(`[Stream] Vision: NO images found — proceeding with text-only`);
      }

      // GUARD: Block image generation when attachments are present
      if (hasAttachments && attachmentsCount > 0) {
        console.log(`[Stream] GUARD: Image generation BLOCKED - ${attachmentsCount} attachments present`);
        // Ensure route decision does not include image generation tools
        if (routeDecision) {
          routeDecision.tools = routeDecision.tools.filter(t => !['generate_image', 'image_gen', 'dall_e'].includes(t));
          // Force agent mode for document analysis when attachments present
          if (routeDecision.route === 'chat') {
            routeDecision.route = 'agent';
            routeDecision.intent = 'analysis';
          }
        }
      }


      // Classify the question to set token limits (simple vs complex).
      const questionClassification = questionClassifier.classifyQuestion(userMessageText || "");



      // Build Answer-First system prompt based on question type
      const answerFirstPrompt = answerFirstEnforcer.generateAnswerFirstSystemPrompt(
        userMessageText,
        hasAttachments,
        attachmentContext
      );

      let systemContent = answerFirstPrompt.fullPrompt;

      if (shouldRunModel && skillSeedForModel) {
        systemContent += `\n\n[CONTEXTO SKILL] Ya existe una respuesta parcial: "${skillSeedForModel.slice(0, 2200)}".\n` +
          "Continúa desde ese punto, evitando repetir contenido ya emitido por la Skill, y completa sólo lo faltante con precisión.";
      }

      if (hasAttachments && attachmentContext && batchResult) {
        // Build citation format instructions based on document types
        const citationFormats = batchResult.stats
          .filter(s => s.status === 'success')
          .map(s => {
            const ext = s.filename.split('.').pop()?.toLowerCase();
            switch (ext) {
              case 'pdf': return `- ${s.filename}: [doc:${s.filename} p#]`;
              case 'xlsx': case 'xls': return `- ${s.filename}: [doc:${s.filename} sheet:NombreHoja cell:A1]`;
              case 'docx': case 'doc': return `- ${s.filename}: [doc:${s.filename} p#]`;
              case 'pptx': case 'ppt': return `- ${s.filename}: [doc:${s.filename} slide:#]`;
              case 'csv': return `- ${s.filename}: [doc:${s.filename} row:#]`;
              default: return `- ${s.filename}: [doc:${s.filename}]`;
            }
          })
          .join('\n');

        // Add document context to Answer-First prompt
        systemContent += `\n\nDOCUMENTOS PROCESADOS (${batchResult.processedFiles}/${batchResult.attachmentsCount}):
${batchResult.stats.map(s => `- ${s.filename}: ${s.status === 'success' ? `${s.tokensExtracted} tokens` : `ERROR: ${s.error}`}`).join('\n')}

FORMATO DE CITAS REQUERIDO:
${citationFormats}

CONTENIDO DE LOS DOCUMENTOS:
${attachmentContext}`;
      }

      // Apply user personalization (style, custom instructions, profile) and semantic memory.
      const userProfileContext = userProfile && (userProfile.nickname || userProfile.occupation || userProfile.bio)
        ? `\n\nInformación del usuario:${userProfile.nickname ? `\n- Nombre/Apodo: ${userProfile.nickname}` : ''}${userProfile.occupation ? `\n- Ocupación: ${userProfile.occupation}` : ''}${userProfile.bio ? `\n- Bio: ${userProfile.bio}` : ''}`
        : '';

      const customInstructionsSection = customInstructions
        ? `\n\nInstrucciones personalizadas del usuario:\n${customInstructions}`
        : '';

      const responseStyleModifier = responseStyle !== 'default'
        ? `\n\nEstilo de respuesta preferido: ${responseStyle === 'formal' ? 'formal y profesional' :
          responseStyle === 'casual' ? 'casual y amigable' :
            responseStyle === 'concise' ? 'muy conciso y breve' : ''
        }`
        : '';

      let semanticMemoryContext: string | null = null;
      if ((featureFlags.memoryEnabled || featureFlags.recordingHistoryEnabled) && userId && userMessageText) {
        try {
          await semanticMemoryStore.initialize();
          const types: Array<"fact" | "preference" | "conversation" | "instruction" | "note"> = [];
          if (featureFlags.memoryEnabled) {
            types.push("fact", "preference", "instruction", "note");
          }
          if (featureFlags.recordingHistoryEnabled) {
            types.push("conversation");
          }

          if (types.length > 0) {
            const results = await semanticMemoryStore.search(userId, userMessageText, {
              limit: 10,
              minScore: 0.4,
              types,
              hybridSearch: true,
            });

            if (results.length > 0) {
              const lines: string[] = ["[Memoria relevante]"];
              let tokenBudget = 350;
              for (const r of results) {
                const line = `• [${r.chunk.type}] ${r.chunk.content}`;
                const estTokens = Math.ceil(line.length / 4);
                if (tokenBudget - estTokens < 0) break;
                tokenBudget -= estTokens;
                lines.push(line);
              }
              semanticMemoryContext = lines.length > 1 ? lines.join("\n") : null;
            }
          }
        } catch (e) {
          console.warn("[Stream] Failed to load semantic memory:", (e as any)?.message || e);
        }
      }

      // If code interpreter is enabled and the user is asking for a chart, force python output.
      const wantsChart = /\b(gr[aá]fic[oa]|chart|plot|visualiz|histograma|diagrama de barras|pie chart|scatter|l[ií]nea|barras)\b/i.test(userMessageText || "");
      const codeInterpreterPrompt = (wantsChart && featureFlags.codeInterpreterEnabled)
        ? `\n\n⚠️ CODE INTERPRETER ACTIVO ⚠️\nEl usuario ha solicitado una gráfica/visualización. Responde con un bloque \`\`\`python\`\`\` ejecutable (matplotlib) y NO con una descripción en texto.`
        : '';

      // Current date/time context for real-time awareness
      const now = new Date();
      const currentDateTimeContext = `\n\nFECHA Y HORA ACTUAL:\n- ISO: ${now.toISOString()}`;

      systemContent += `${currentDateTimeContext}${userProfileContext}${customInstructionsSection}${responseStyleModifier}${semanticMemoryContext ? `\n\n${semanticMemoryContext}` : ''}${codeInterpreterPrompt}${webSearchContextForLLM}${skillSystemSection}`;

      // DOC TOOL: Add format-specific system prompt so the LLM outputs structured content
      // that the client-side editors can render (markdown for Word, CSV for Excel, JSON for PPT)
      if (docTool && ['word', 'excel', 'ppt'].includes(docTool)) {
        const docSystemPrompts: Record<string, string> = {
          word: '\n\nMODO DOCUMENTO WORD:\nGenera el contenido del documento en formato Markdown bien estructurado con títulos (#, ##, ###), párrafos, listas, tablas y formato de texto (negrita, cursiva). Escribe contenido completo y profesional. No incluyas bloques de código, instrucciones meta ni explicaciones sobre lo que estás haciendo — solo el contenido del documento.',
          excel: '\n\nMODO HOJA DE CÁLCULO:\nGenera los datos en formato CSV con cabeceras en la primera fila. Usa comas como separador de columnas y saltos de línea como separador de filas. No incluyas explicaciones ni texto adicional, solo los datos tabulares puros.',
          ppt: '\n\nMODO PRESENTACIÓN:\nGenera una presentación como JSON array de slides con esta estructura: [{"title":"Título de slide", "bullets":["Punto 1","Punto 2"]}, ...]. No incluyas explicaciones ni bloques de código, solo el JSON puro.',
        };
        systemContent += docSystemPrompts[docTool] || '';
        console.log(`[Stream] 📝 Added docTool system prompt for: ${docTool}`);
      }

      // Debug: uncomment to trace web search injection
      // console.log(`[Stream:Debug] webSearchContextForLLM length: ${webSearchContextForLLM.length}, systemContent length: ${systemContent.length}`);

      const systemMessage = {
        role: "system" as const,
        content: systemContent
      };

      // Ensure chat exists so we can persist messages (critical for memory)
      const effectiveChatIdForPersistence = chatId || conversationId || streamConversationId;
      const ensureChatStageStart = performance.now();
      try {
        const existingChat = await storage.getChat(effectiveChatIdForPersistence);
        if (!existingChat) {
          await storage.createChat({
            id: effectiveChatIdForPersistence,
            title: "New Chat",
            userId: userId || undefined,
          });
        }
      } catch (e) {
        // Best-effort: if chat creation fails, streaming can still proceed, but memory will degrade.
        console.warn('[Stream] Failed to ensure chat exists for persistence:', e);
      } finally {
        recordStage("ensure_chat_ms", ensureChatStageStart);
      }

      // Persist the latest user message (best-effort). Without this, server-side memory is empty.
      // Skip if a run was claimed - the user message was already created atomically with the run
      // via createUserMessageAndRun in the /chats/:id/messages endpoint.
      let persistedUserMessageId: string | null = claimedRun?.userMessageId || null;
      const persistUserStageStart = performance.now();
      if (!claimedRun) {
        try {
          if (userMessageText && effectiveChatIdForPersistence) {
            // Sanitize attachments: strip large binary/text data, keep only metadata for JSONB storage.
            // The actual file content lives in object storage (storagePath) and conversationDocuments.
            const sanitizedAttachments = resolvedAttachments.length > 0
              ? resolvedAttachments.map((att: any) => {
                  // Only keep lightweight metadata fields — strip content, imageUrl, thumbnail, dataUrl
                  return {
                    id: att.id || att.fileId,
                    fileId: att.fileId,
                    name: att.name,
                    type: att.type,
                    mimeType: att.mimeType || att.type,
                    size: att.size,
                    storagePath: att.storagePath,
                  };
                }).filter((att: any) => att.name)
              : (attachments && Array.isArray(attachments) && attachments.length > 0
                ? attachments.map((att: any) => ({
                    id: att.id || att.fileId,
                    fileId: att.fileId,
                    name: att.name,
                    type: att.type,
                    mimeType: att.mimeType || att.type,
                    size: att.size,
                    storagePath: att.storagePath,
                  })).filter((att: any) => att.name)
                : null);

            const userMsg = await storage.createChatMessage({
              chatId: effectiveChatIdForPersistence,
              role: 'user',
              content: userMessageText,
              status: 'done',
              requestId,
              attachments: sanitizedAttachments,
            });
            persistedUserMessageId = userMsg.id;

            // Persist each attachment as a conversationDocument for durable cross-session retrieval.
            // This was previously only done in the legacy /chat endpoint, causing attachments sent
            // via /chat/stream to be lost on reload.
            if (resolvedAttachments.length > 0) {
              for (const att of resolvedAttachments) {
                try {
                  // Determine extracted text: use batch result if available, else attachment content
                  let extractedText = att.content || null;
                  if (batchResult && batchResult.stats) {
                    const fileStat = batchResult.stats.find(
                      (s: any) => s.filename === att.name && s.status === 'success'
                    );
                    if (fileStat) {
                      // Find the matching chunk from batch result for this file's content
                      const fileChunks = batchResult.chunks.filter(
                        (c: any) => c.source === att.name
                      );
                      if (fileChunks.length > 0) {
                        extractedText = fileChunks.map((c: any) => c.content).join('\n');
                      }
                    }
                  }

                  await storage.createConversationDocument({
                    chatId: effectiveChatIdForPersistence,
                    messageId: userMsg.id,
                    fileName: att.name || 'document',
                    storagePath: att.storagePath || null,
                    mimeType: att.mimeType || att.type || 'application/octet-stream',
                    fileSize: att.size || null,
                    extractedText,
                    metadata: { fileId: att.fileId || att.id },
                  });
                  console.log("[Stream] Persisted conversationDocument", {
                    fileName: att.name,
                    chatId: effectiveChatIdForPersistence,
                    messageId: userMsg.id,
                  });
                } catch (docError) {
                  console.error("[Stream] Failed to persist conversationDocument", {
                    fileName: att.name,
                    chatId: effectiveChatIdForPersistence,
                    docError,
                  });
                }
              }
            }

            // Also persist into Conversation State (separate store used by /api/memory/chats/:id/state)
            // Best-effort + idempotent (per-request) to avoid UI retry loops duplicating messages.
            await conversationStateService.appendMessage(
              effectiveChatIdForPersistence,
              'user',
              userMessageText,
              {
                chatMessageId: userMsg.id,
                requestId: `${requestId}:state:user`,
              }
            );
          }
        } catch (e) {
          console.warn('[Stream] Failed to persist user message (best-effort):', e);
        }
      }
      recordStage("persist_user_ms", persistUserStageStart);

      // For claimed runs (run-based flow), the user message was already persisted
      // via createUserMessageAndRun, but conversationDocuments were not created.
      // Persist them now so attachments survive reload.
      if (claimedRun && resolvedAttachments.length > 0 && effectiveChatIdForPersistence) {
        for (const att of resolvedAttachments) {
          try {
            let extractedText = att.content || null;
            if (batchResult && batchResult.stats) {
              const fileStat = batchResult.stats.find(
                (s: any) => s.filename === att.name && s.status === 'success'
              );
              if (fileStat) {
                const fileChunks = batchResult.chunks.filter(
                  (c: any) => c.source === att.name
                );
                if (fileChunks.length > 0) {
                  extractedText = fileChunks.map((c: any) => c.content).join('\n');
                }
              }
            }
            await storage.createConversationDocument({
              chatId: effectiveChatIdForPersistence,
              messageId: claimedRun.userMessageId || null,
              fileName: att.name || 'document',
              storagePath: att.storagePath || null,
              mimeType: att.mimeType || att.type || 'application/octet-stream',
              fileSize: att.size || null,
              extractedText,
              metadata: { fileId: att.fileId || att.id },
            });
            console.log("[Stream] Persisted conversationDocument (run)", {
              fileName: att.name,
              chatId: effectiveChatIdForPersistence,
            });
          } catch (docError) {
            console.error("[Stream] Failed to persist conversationDocument (run)", {
              fileName: att.name,
              chatId: effectiveChatIdForPersistence,
              docError,
            });
          }
        }
      }

      // Best-effort: extract semantic memories from the user's latest message.
      // This is gated by the user's "allowMemories" setting (featureFlags.memoryEnabled).
      if (userId && featureFlags.memoryEnabled && userMessageText) {
        void (async () => {
          try {
            await ensureUserRowExists(userId);
            await semanticMemoryStore.initialize();
            await semanticMemoryStore.extractFromConversation(userId, [
              { role: "user", content: userMessageText }
            ]);
          } catch (e) {
            console.warn("[Stream] Failed to extract/store semantic memory:", (e as any)?.message || e);
          }
        })();
      }

      // Create an assistant message placeholder at the start (so we can stream-update and persist)
      const assistantPlaceholderStageStart = performance.now();
      try {
        const assistantMessage = await storage.createChatMessage({
          chatId: effectiveChatIdForPersistence,
          role: 'assistant',
          content: '', // Will be updated during streaming
          status: 'pending',
          runId: claimedRun?.id,
          userMessageId: claimedRun?.userMessageId || persistedUserMessageId || undefined,
          // chat_messages has a global UNIQUE(request_id). The user message above uses requestId,
          // so the assistant placeholder must NOT reuse it.
          requestId: claimedRun ? undefined : `${requestId}:assistant`,
        });
        assistantMessageId = assistantMessage.id;

        if (claimedRun) {
          await storage.updateChatRunAssistantMessage(claimedRun.id, assistantMessageId);
        }
      } catch (e) {
        console.warn('[Stream] Failed to create assistant placeholder message (best-effort):', e);
      } finally {
        recordStage("assistant_placeholder_ms", assistantPlaceholderStageStart);
      }

      const effectiveRunId = claimedRun?.id || unifiedContext?.runId || requestId;

      // Enriched context event — only emit when connection is alive.
      // Use nullish fallbacks so the frontend receives valid metadata even
      // if unifiedContext creation failed.
      if (!isConnectionClosed) {
        writeSse(res, 'context', {
          requestId,
          runId: effectiveRunId,
          assistantMessageId,
          latencyMode,
          latencyLane: unifiedContext?.resolvedLane || 'fast',
          intent: unifiedContext?.requestSpec?.intent ?? 'chat',
          intentConfidence: unifiedContext?.requestSpec?.intentConfidence ?? 0,
          deliverableType: unifiedContext?.requestSpec?.deliverableType ?? null,
          primaryAgent: unifiedContext?.requestSpec?.primaryAgent ?? null,
          targetAgents: unifiedContext?.requestSpec?.targetAgents ?? [],
          isAgenticMode: unifiedContext?.isAgenticMode ?? false,
          webSources: detectedWebSources.length > 0 ? detectedWebSources : undefined,
          timestamp: Date.now(),
          ...sessionMetadata
        });
      }

      emitTraceEvent(effectiveRunId, 'task_start', {
        metadata: {
          chatId,
          userId,
          message: messages[messages.length - 1]?.content?.slice(0, 200) || '',
          intent: unifiedContext?.requestSpec.intent,
          intentConfidence: unifiedContext?.requestSpec.intentConfidence,
          deliverableType: unifiedContext?.requestSpec.deliverableType,
          attachmentsCount: attachmentsCount,
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

      if (unifiedContext?.isAgenticMode) {
        emitTraceEvent(effectiveRunId, 'agent_delegated', {
          agent: {
            name: unifiedContext.requestSpec.primaryAgent,
            role: 'primary',
            status: 'active'
          }
        }).catch(() => { });
      }

      emitTraceEvent(effectiveRunId, 'thinking', {
        content: `Analyzing request: ${unifiedContext?.requestSpec.intent || 'chat'}`,
        phase: 'planning'
      }).catch(() => { });

      // Apply dynamic token limit based on question type (Answer-First)
      const hasWebSearchContext = webSearchContextForLLM.length > 0;
      const effectiveMaxTokens = hasWebSearchContext
        ? 2500 // Web search responses need room to summarize results with citations
        : questionClassification.type === 'summary' ||
          questionClassification.type === 'analysis'
          ? 2000 // Allow longer responses for summaries/analysis
          : questionClassification.maxTokens * 4; // Apply stricter limit for factual questions

      console.log(`[Stream] Answer-First: type=${questionClassification.type}, maxTokens=${effectiveMaxTokens}, hasWebSearch=${hasWebSearchContext}`);

      // Apply latency-lane-aware token limit:
      //  fast → hard cap to keep response short & snappy (but not when web search is active)
      //  deep → use the question-classification-derived limit
      const resolvedLane = unifiedContext?.resolvedLane || 'fast';
      const safeMaxTokens = Number.isFinite(effectiveMaxTokens) && effectiveMaxTokens > 0
        ? effectiveMaxTokens
        : 1000; // safety floor
      const laneMaxTokens = hasWebSearchContext
        ? safeMaxTokens // Web search results need full token budget regardless of lane
        : resolvedLane === 'fast'
          ? Math.min(safeMaxTokens, 1200) // Was 400 — too restrictive, caused mid-sentence truncation
          : safeMaxTokens;

      // Emit thinking event so user sees we're about to generate
      if (!isConnectionClosed) {
        writeSse(res, 'thinking', {
          step: 'generating',
          message: resolvedLane === 'fast' ? 'Generando respuesta...' : 'Generando respuesta detallada...',
          requestId,
          timestamp: Date.now(),
        });
      }

      // ── AGENT LOOP INTERCEPT ──────────────────────────────────
      // For web_automation intent, route through the agent executor which has
      // tools like browse_and_act (Playwright), web_search, fetch_url
      if (shouldRunModel && unifiedContext?.isAgenticMode && unifiedContext.requestSpec.intent === "web_automation") {
        console.log(`[Stream] 🤖 WEB AUTOMATION: routing through executeAgentLoop with browse_and_act tool`);
        try {
          const agentMessages = [
            { role: "system", content: typeof systemMessage.content === "string" ? systemMessage.content : "" },
            ...formattedMessages.map((m: any) => ({ role: m.role as string, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }))
          ];

          const agentResponse = await executeAgentLoop(agentMessages, res, {
            runId: effectiveRunId,
            userId: userId || streamConversationId || "anonymous",
            chatId: effectiveChatIdForPersistence,
            requestSpec: unifiedContext.requestSpec,
            maxIterations: 10
          });

          // Use the real response from the agent loop (not a placeholder)
          // The agent loop already wrote chunk SSE events — fullContent is used for DB persistence
          fullContent = agentResponse || "He procesado tu solicitud de automatización web.";
          if (fullContent.trim()) {
            markFirstToken();
          }
          agentLoopHandled = true;
          console.log(`[Stream] Agent loop completed, fullContent length: ${fullContent.length}`);
        } catch (agentError: any) {
          console.error(`[Stream] Agent loop error:`, agentError?.message || agentError);
          // If the agent already sent some chunks (e.g. browse_and_act ran but
          // the follow-up LLM failed), use whatever was sent as the final content
          // rather than falling back to a completely different LLM stream.
          if (fullContent.trim()) {
            agentLoopHandled = true;
          } else {
            // Provide a direct fallback message instead of falling through to
            // normal streaming which would ignore the browser automation context
            fullContent = "He intentado realizar la automatización web pero encontré un problema. " +
              "Puedes intentar de nuevo o describir tu solicitud de otra manera.";
            agentLoopHandled = true;
            if (!isConnectionClosed) {
              writeSse(res, 'chunk', {
                content: fullContent,
                sequenceId: lastAckSequence + 1,
                requestId,
                runId: effectiveRunId,
                timestamp: Date.now(),
              });
              lastAckSequence++;
            }
          }
        }
      }

      if (shouldRunModel && !agentLoopHandled) {
      const modelStreamStageStart = performance.now();
      const modelMessages = [systemMessage, ...formattedMessages] as any[];
      if (skillSeedForModel) {
        modelMessages.push({ role: "assistant", content: skillSeedForModel });
      }
      const streamGenerator = llmGateway.streamChat(
        modelMessages,
        {
          userId: userId || streamConversationId || "anonymous",
          requestId,
          model: effectiveModel,
          provider: effectiveProvider,
          disableImageGeneration: hasAttachments,
          maxTokens: laneMaxTokens,
        }
      );

      // ── BUFFERED WRITER ────────────────────────────────────────
      // Batch small deltas into ~30ms flushes to reduce res.write()
      // overhead. The frontend already does RAF throttling, so this
      // matches perfectly.
      const writer = new SseBufferedWriter(res, effectiveRunId, 30, 512);

      // Cleanup writer timer if the client disconnects mid-stream
      const onClose = () => writer.destroy();
      req.once("close", onClose);

      for await (const chunk of streamGenerator) {
        if (isConnectionClosed) break;

        if (chunk.content) {
          markFirstToken();
        }
        fullContent += chunk.content;
        lastAckSequence = Math.max(lastAckSequence, chunk.sequenceId);

        // Update run's lastSeq for deduplication on reconnect
        if (claimedRun && chunk.sequenceId > (claimedRun.lastSeq || 0)) {
          await storage.updateChatRunLastSeq(claimedRun.id, chunk.sequenceId);
        }

        if (chunk.done) {
          // Flush remaining buffered content before done event
          writer.finalize();

          console.log(`[Stream] Sending 'done' event with ${detectedWebSources.length} webSources`);
          streamFlags.doneSent = true;
          writeSse(res, 'done', {
            sequenceId: chunk.sequenceId,
            requestId: chunk.requestId,
            runId: effectiveRunId,
            intent: unifiedContext?.requestSpec.intent,
            latencyLane: resolvedLane,
            webSources: detectedWebSources.length > 0 ? detectedWebSources : undefined,
            traceId: requestId,
            timings: buildTimingPayload(),
            timestamp: Date.now(),
            ...sessionMetadata
          });
        } else {
          // Push delta into buffer — will be flushed on interval/size threshold
          writer.pushDelta(chunk.content);
        }
      }

      // Ensure buffer is fully flushed after loop and clean up listener
      writer.finalize();
      req.removeListener("close", onClose);
      recordStage("model_stream_ms", modelStreamStageStart);
      } // end if (!agentLoopHandled)

      // If upstream agentic pipeline produced no content, don't leave the UI hanging.
      // Emit a fallback chunk so clients can render something, and persist it.
      if (!fullContent.trim()) {
        const fallbackContent = shouldRunModel
          ? "Lo siento, el modo agente no pudo generar una respuesta esta vez. Intenta de nuevo o desactiva el modo agente para esta pregunta."
          : "No se pudo completar la respuesta con skills. Reintenta o reformula la consulta.";
        fullContent = fallbackContent;

        if (!isConnectionClosed) {
          markFirstToken();
          const nextSeq = lastAckSequence + 1;
          lastAckSequence = nextSeq;
          writeSse(res, 'chunk', {
            content: fallbackContent,
            sequenceId: nextSeq,
            requestId,
            runId: effectiveRunId,
            timestamp: Date.now(),
            isFallback: true,
          });
        }
      }

      // Update assistant message with full content + webSources
      const finalizePersistenceStageStart = performance.now();
      if (assistantMessageId) {
        try {
          const metadata = detectedWebSources.length > 0 ? { webSources: detectedWebSources } : undefined;
          await storage.updateChatMessageContent(assistantMessageId, fullContent, 'done', metadata);

          // Also persist assistant into Conversation State so /api/memory/chats/:id/state reflects reality.
          // Best-effort + idempotent.
          await conversationStateService.appendMessage(
            effectiveChatIdForPersistence,
            'assistant',
            fullContent,
            {
              chatMessageId: assistantMessageId,
              requestId: `${requestId}:state:assistant`,
              metadata: metadata || undefined,
            }
          );
        } catch (e) {
          console.warn('[Stream] Failed to finalize assistant message (best-effort):', e);
        }
      }
      recordStage("finalize_persistence_ms", finalizePersistenceStageStart);

      // Mark run as done if we claimed one
      if (claimedRun) {
        await storage.updateChatRunStatus(claimedRun.id, 'done');
        runFinalized = true;
      }

      // Fire-and-forget: Generate an AI-powered descriptive title for this chat
      // based on the user's message and the assistant's response.
      if (effectiveChatIdForPersistence && userMessageText && fullContent.trim()) {
        void generateAndPersistChatTitle(
          effectiveChatIdForPersistence,
          userMessageText,
          fullContent,
        ).catch(e => console.warn('[Stream] Async title generation failed:', e));
      }

      const durationMs = unifiedContext ? Date.now() - unifiedContext.startTime : 0;
      const finalTimings = reportTimings("completed");
      const finalSequenceCount = fullContent.trim() && lastAckSequence < 0 ? 1 : Math.max(0, lastAckSequence + 1);

      if (!isConnectionClosed) {
        if (unifiedContext?.isAgenticMode) {
          emitTraceEvent(effectiveRunId, 'agent_completed', {
            agent: {
              name: unifiedContext.requestSpec.primaryAgent,
              role: 'primary',
              status: 'completed'
            },
            durationMs
          }).catch(() => { });
        }

        // Send done event with webSources for frontend NewsCards
        if (!streamFlags.doneSent) {
          streamFlags.doneSent = true;
          writeSse(res, 'done', {
            requestId,
            runId: effectiveRunId,
            assistantMessageId,
            latencyLane: resolvedLane,
            webSources: detectedWebSources.length > 0 ? detectedWebSources : undefined,
            traceId: requestId,
            timings: finalTimings,
            timestamp: Date.now()
          });
        }

        writeSse(res, 'complete', {
          requestId,
          runId: effectiveRunId,
          assistantMessageId,
          latencyMode,
          latencyLane: resolvedLane,
          totalSequences: finalSequenceCount,
          contentLength: fullContent.length,
          intent: unifiedContext?.requestSpec.intent,
          deliverableType: unifiedContext?.requestSpec.deliverableType,
          durationMs,
          traceId: requestId,
          timings: finalTimings,
          timestamp: Date.now(),
          ...sessionMetadata
        });

        emitTraceEvent(effectiveRunId, 'done', {
          summary: fullContent.slice(0, 200),
          durationMs,
          phase: 'completed',
          metadata: { contentLength: fullContent.length, sequences: finalSequenceCount }
        }).catch(() => { });
      }

      try {
        await auditLog(req, {
          action: "chat_stream",
          resource: "chats",
          resourceId: streamConversationId || undefined,
          details: {
            messageCount: messages.length,
            requestId,
            runId: claimedRun?.id,
            streaming: true,
          },
          category: "user",
          severity: "info",
        });
      } catch (auditError) {
        console.error("Failed to create audit log:", auditError);
      }

    } catch (error: any) {
      console.error(`[SSE] Stream error ${requestId}:`, error);

      // Mark run as failed if we claimed one
      if (claimedRun) {
        try {
          await storage.updateChatRunStatus(claimedRun.id, 'failed', error.message);
          runFinalized = true;
        } catch (updateError) {
          console.error(`[SSE] Failed to update run status:`, updateError);
        }
      }

      const errorRunId = claimedRun?.id || requestId;
      const errorTimings = reportTimings("error");
      if (!isConnectionClosed) {
        writeSse(res, 'error', {
          error: error.message,
          requestId,
          runId: errorRunId,
          traceId: requestId,
          timings: errorTimings,
          timestamp: Date.now()
        });

        // Always send a done event after error so the client can finalize.
        // Without this, the client relies on its own timeout to detect the stream
        // ended, which can leave the UI spinner stuck for up to 45s.
        if (!streamFlags.doneSent) {
          streamFlags.doneSent = true;
          writeSse(res, 'done', {
            requestId,
            runId: errorRunId,
            traceId: requestId,
            timings: errorTimings,
            timestamp: Date.now(),
            error: true,
          });
        }

        emitTraceEvent(errorRunId, 'error', {
          error: { message: error.message, code: error.code || 'UNKNOWN' }
        }).catch(() => { });
      }
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      clearStreamTimeouts();

      // Safety net: if we claimed a run but neither the try nor catch block
      // updated its status (e.g. client disconnected mid-stream and the code
      // fell through), mark it failed so it doesn't stay "processing" forever.
      // We check startedAt to avoid clobbering a run that was re-claimed by a
      // replacement request (queueMode=replace resets startedAt).
      if (claimedRun && !runFinalized) {
        try {
          const currentRun = await storage.getChatRun(claimedRun.id);
          const ourStartedAt = claimedRun.startedAt ? new Date(claimedRun.startedAt).getTime() : 0;
          const currentStartedAt = currentRun?.startedAt ? new Date(currentRun.startedAt).getTime() : 0;
          if (currentRun?.status === "processing" && currentStartedAt <= ourStartedAt) {
            console.log(`[Run] Cleaning up orphaned run ${claimedRun.id} (connection_closed=${isConnectionClosed})`);
            await storage.updateChatRunStatus(claimedRun.id, "failed", "stream_cleanup");
          }
        } catch (cleanupErr) {
          console.warn("[Run] Failed to cleanup orphaned run:", cleanupErr);
        }
      }

      if (!timingReported) {
        reportTimings(isConnectionClosed ? "connection_closed" : "ended");
      }
      // Safety net: if no done event was sent and the connection is still open,
      // emit one now so the client can finalize its UI state (spinner, etc.).
      if (!streamFlags.doneSent && !isConnectionClosed && !(res as any).writableEnded) {
        try {
          writeSse(res, 'done', {
            requestId,
            runId: claimedRun?.id || requestId,
            traceId: requestId,
            timestamp: Date.now(),
            safety_net: true,
          });
        } catch { /* connection may have closed between our check and this write */ }
      }

      if (!isConnectionClosed && !(res as any).writableEnded) {
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

            // Call normalizeDocument with a 30s timeout to prevent hanging on malformed documents
            const PARSE_TIMEOUT_MS = 30_000;
            const docModel = await Promise.race([
              normalizeDocument(buffer, filename, att.storagePath),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Document parsing timed out after ${PARSE_TIMEOUT_MS / 1000}s for ${filename}`)), PARSE_TIMEOUT_MS)
              ),
            ]);
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
