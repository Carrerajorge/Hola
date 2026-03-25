import { Router } from "express";
import { storage } from "../storage";
import {
  chatService,
  AVAILABLE_MODELS,
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
} from "../services/ChatServiceV2";
import { llmGateway } from "../lib/llmGateway";
import {
  buildSystemPromptWithContext,
  getOrCreateSession,
  getEnforcedModel,
  getSessionByChatId,
  getSessionById,
  type GptSessionContract,
} from "../services/gptSessionService";
import {
  generateImage,
  detectImageRequest,
  extractImagePrompt,
} from "../services/imageGeneration";
import {
  runETLAgent,
  getAvailableCountries,
  getAvailableIndicators,
} from "../etl";
import {
  extractAllAttachmentsContent,
  extractAttachmentContent,
  formatAttachmentsAsContext,
  type Attachment,
} from "../services/attachmentService";
import {
  pareOrchestrator,
  type RobustRouteResult,
  type SimpleAttachment,
} from "../services/pare";
import {
  DocumentBatchProcessor,
  type BatchProcessingResult,
  type SimpleAttachment as BatchAttachment,
} from "../services/documentBatchProcessor";
import {
  pareRequestContract,
  pareRateLimiter,
  pareQuotaGuard,
  requirePareContext,
  pareIdempotencyGuard,
  pareAnalyzeSchemaValidator,
} from "../middleware";
import {
  completeIdempotencyKey,
  failIdempotencyKey,
} from "../lib/idempotencyStore";
import {
  AuditTrailCollector,
  type AuditBatchSummary,
} from "../lib/pareAuditTrail";
import { createPareLogger } from "../lib/pareLogger";
import { pareMetrics } from "../lib/pareMetrics";
import { createChunkStore } from "../lib/pareChunkStore";
import { normalizeDocument } from "../services/structuredDocumentNormalizer";
import { ObjectStorageService } from "../replit_integrations/object_storage/objectStorage";
import type {
  DocumentSemanticModel,
  Table,
  Metric,
  Anomaly,
  Insight,
  SuggestedQuestion,
  SheetSummary,
} from "../../shared/schemas/documentSemanticModel";
import { agentEventBus } from "../agent/eventBus";
import {
  createUnifiedRun,
  hydrateSessionState,
  emitTraceEvent,
  SseBufferedWriter,
  resolveLatencyLane,
} from "../agent/unifiedChatHandler";
import { executeAgentLoop } from "../agent/agentExecutor";
import type {
  UnifiedChatRequest,
  UnifiedChatContext,
  LatencyMode,
} from "../agent/unifiedChatHandler";
import {
  buildNativeAgenticFusion,
  hasNativeAgenticSignal,
} from "../agent/nativeAgenticFusion";
import { createRequestSpec, AttachmentSpecSchema } from "../agent/requestSpec";
import { routeIntent, type IntentResult } from "../services/intentRouter";
import {
  questionClassifier,
  type QuestionClassification,
} from "../services/questionClassifier";
import { answerFirstEnforcer } from "../services/answerFirstEnforcer";
import { academicSearchService } from "../services/academicSearchService";
import {
  isProductionIntent,
  handleProductionRequest,
  getDeliverables,
} from "../services/productionHandler";
import { classifyOutputFormat } from "@shared/explicitArtifactRequests";
import type { z } from "zod";
import { getUserId } from "../types/express";
import { semanticMemoryStore } from "../memory/SemanticMemoryStore";
import { type SkillScope } from "@shared/schema/skillPlatform";
import { handleEmailChatRequest } from "../services/gmailChatIntegration";
import { getOrCreateSecureUserId } from "../lib/anonUserHelper";
import { ensureUserRowExists } from "../lib/ensureUserRowExists";
import {
  buildSkillSystemPromptSection,
  drizzleSkillStore,
  resolveSkillContextFromRequest,
} from "../services/skillContextResolver";
import {
  getSkillPlatformService,
  type SkillExecutionResult,
} from "../services/skillPlatform";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { terminalController } from "../agent/terminalController";
import type {
  CommandRequest,
  CommandResult,
  ProcessInfo,
} from "../agent/terminalController";

type AttachmentSpec = z.infer<typeof AttachmentSpecSchema>;
type CodingAgentProfile = "coder" | "reviewer" | "improver";

interface WorkspaceContextInput {
  projectId?: string;
  projectName?: string;
  repositoryPath: string;
  selectedFolder: string;
  codingAgents: CodingAgentProfile[];
  runtimeTarget: string;
  executionAccess: string;
  branch?: string;
}

import { v4 as uuidv4 } from "uuid";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../types/express";
import { auditLog } from "../services/auditLogger";
import {
  DEFAULT_GPT_CAPABILITIES,
  normalizeGptCapabilities,
} from "../lib/gptCapabilities";
import {
  usageQuotaService,
  type UsageCheckResult,
} from "../services/usageQuotaService";
import { conversationMemoryManager } from "../services/conversationMemory";
import { conversationStateService } from "../services/conversationStateService";
import { generateAndPersistChatTitle } from "../lib/chatTitleGenerator";
import { validate } from "../lib/requestValidator";
import { streamChatRequestSchema } from "../schemas/chatSchemas";
import { checkPromptIntegrity } from "../lib/promptIntegrityService";
import {
  recordIntegrityCheck,
  recordTruncation,
  recordPromptTokens,
  recordDroppedChars,
  recordPreprocessDuration,
  recordAnalysisDuration,
  recordContextStrategy,
  recordMustKeepSpans,
  recordLanguageDetected,
  recordDuplicateDetected,
  recordNfcNormalization,
} from "../lib/promptMetrics";
import { promptPreProcessor } from "../lib/promptPreProcessor";
import { promptAuditStore } from "../lib/promptAuditStore";
import { promptAnalysisService } from "../services/promptAnalysisService";
import { normalizeChatRequestProvider } from "../lib/chatProviderNormalization";
import { getGoogleGeminiCliOAuthStatus } from "../services/googleGeminiCliOAuthService";
import { getOpenAICodexOAuthStatus } from "../services/openAICodexOAuthService";
import { runEmbeddedPiAgent } from "../services/superIntelligence/agents/pi-embedded.js";
import { resolveUserScopedAgentDir } from "../services/userScopedAgentDir.js";
import * as macos from "../lib/macos";
import { browserAdapter } from "../agent/webtool/browserAdapter";
import { browserWorker } from "../agent/browser-worker";

type ErrorCategory =
  | "network"
  | "rate_limit"
  | "api_error"
  | "validation"
  | "auth"
  | "timeout"
  | "unknown";
const isDebugLogEnabled = process.env.DEBUG === "true";
const MAX_STREAM_REQUEST_ID_LEN = 140;
const MAX_STREAM_EVENT_PAYLOAD_BYTES = 4600;
const MAX_STREAM_ATTACHMENT_NAME_LEN = 220;
const MAX_STREAM_ATTACHMENT_MIME_LEN = 120;
const MAX_STREAM_ATTACHMENT_SIZE = 200_000_000;
const MAX_STREAM_SKILL_SCOPES = 12;
const MAX_STREAM_SKILL_ATTACHMENTS = 12;
const DEFAULT_STREAM_SKILL_SCOPES: SkillScope[] = [
  "storage.read",
  "files",
  "code_interpreter",
];
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
// eslint-disable-next-line no-control-regex
const STREAM_ATTACHMENT_NAME_RE = /^[^<>:"\\|?*\u0000-\u001f]{1,220}$/;
const STREAM_MIME_RE = /^[a-zA-Z0-9][a-zA-Z0-9.+-\/]*/;
const GOOGLE_GEMINI_CLI_PROVIDER = "google-gemini-cli";
const OPENAI_CODEX_PROVIDER = "openai-codex";
const OPENCLAW_WEBCHAT_SESSION_DIR = "iliagpt-openclaw-chat";
const OPENCLAW_WEBCHAT_TIMEOUT_MS = 120_000;

function extractUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          if (typeof part.text === "string") return part.text;
          if (typeof part.content === "string") return part.content;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  if (content && typeof content === "object") {
    const maybeText = (content as any).text ?? (content as any).content;
    if (typeof maybeText === "string") return maybeText;
  }
  return String(content || "").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseBooleanFlag(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function parseNumberFlag(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function buildFallbackKnowledgeContext(
  items: Array<{
    isActive?: string;
    fileName?: string;
    extractedText?: string | null;
  }>,
): string {
  const active = items.filter(
    (item) => item.isActive === "true" && item.extractedText,
  );
  if (active.length === 0) return "";
  return active
    .map(
      (item) =>
        `=== Knowledge: ${item.fileName || "source"} ===\n${item.extractedText || ""}`,
    )
    .join("\n\n");
}

const MAX_PERSISTENT_CONVERSATION_DOCS = 4;
const MAX_PERSISTENT_DOC_CONTEXT_CHARS = 24_000;
const MAX_SINGLE_PERSISTENT_DOC_CHARS = 8_000;

function buildPersistentConversationDocumentContext(
  docs: Array<{
    fileName?: string | null;
    extractedText?: string | null;
  }>,
): string {
  const candidates = docs
    .filter(
      (doc) =>
        typeof doc.extractedText === "string" &&
        doc.extractedText.trim().length > 0,
    )
    .slice(-MAX_PERSISTENT_CONVERSATION_DOCS);

  if (candidates.length === 0) return "";

  let remainingChars = MAX_PERSISTENT_DOC_CONTEXT_CHARS;
  const parts = [
    "[CONTEXTO DOCUMENTAL DEL HILO]",
    "Estos documentos pertenecen a esta misma conversación.",
    "Úsalos como memoria activa para responder seguimientos sin pedir que el usuario los vuelva a subir.",
  ];

  for (const [index, doc] of candidates.entries()) {
    if (remainingChars <= 0) break;

    const safeText = (doc.extractedText || "").trim();
    if (!safeText) continue;

    const excerpt = safeText.slice(
      0,
      Math.min(MAX_SINGLE_PERSISTENT_DOC_CHARS, remainingChars),
    );
    remainingChars -= excerpt.length;

    parts.push(
      `\n--- Documento ${index + 1}: ${doc.fileName || "archivo"} ---\n${excerpt}`,
    );
  }

  return parts.join("\n");
}

function buildFallbackGptSessionContract(
  gpt: any,
  requestId: string,
  knowledgeContext: string,
): GptSessionContract {
  const definition = asRecord(gpt?.definition);
  const definitionCapabilities = asRecord(definition?.capabilities);
  const gptCapabilities = asRecord(gpt?.capabilities);
  const runtimePolicySource = asRecord(gpt?.runtimePolicy);
  const definitionPolicySource = asRecord(definition?.policies);
  const toolPermissionsSource = asRecord(gpt?.toolPermissions);

  const modelFromDefinition =
    typeof definition?.model === "string" && definition.model.trim()
      ? definition.model.trim()
      : "";
  const modelFromGpt =
    typeof gpt?.recommendedModel === "string" && gpt.recommendedModel.trim()
      ? gpt.recommendedModel.trim()
      : "";
  const preferredModel = modelFromDefinition || modelFromGpt || DEFAULT_MODEL;

  const modelFallbacksRaw = Array.isArray(runtimePolicySource?.modelFallbacks)
    ? runtimePolicySource?.modelFallbacks
    : Array.isArray(definitionPolicySource?.modelFallbacks)
      ? definitionPolicySource?.modelFallbacks
      : [];
  const modelFallbacks = modelFallbacksRaw
    .filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim().length > 0,
    )
    .map((entry) => entry.trim());

  const mergedCapabilities = normalizeGptCapabilities(
    {
      ...(gptCapabilities || {}),
      ...(definitionCapabilities || {}),
    },
    DEFAULT_GPT_CAPABILITIES,
  );

  return {
    sessionId: `fallback_${requestId}`,
    gptId: String(gpt?.id || "").trim() || "unknown_gpt",
    configVersion: Number.isFinite(Number(gpt?.version))
      ? Number(gpt.version)
      : 1,
    systemPrompt:
      typeof definition?.instructions === "string" &&
      definition.instructions.length > 0
        ? definition.instructions
        : String(gpt?.systemPrompt || ""),
    enforcedModelId: parseBooleanFlag(
      runtimePolicySource?.enforceModel,
      parseBooleanFlag(definitionPolicySource?.enforceModel, false),
    )
      ? preferredModel
      : null,
    modelFallbacks,
    capabilities: mergedCapabilities,
    toolPermissions: {
      mode:
        toolPermissionsSource?.mode === "denylist" ? "denylist" : "allowlist",
      allowedTools: Array.isArray(toolPermissionsSource?.tools)
        ? toolPermissionsSource.tools.filter(
            (entry): entry is string =>
              typeof entry === "string" && entry.trim().length > 0,
          )
        : [],
      actionsEnabled: parseBooleanFlag(
        toolPermissionsSource?.actionsEnabled,
        true,
      ),
    },
    runtimePolicy: {
      enforceModel: parseBooleanFlag(
        runtimePolicySource?.enforceModel,
        parseBooleanFlag(definitionPolicySource?.enforceModel, false),
      ),
      modelFallbacks,
      maxTokensOverride: Number.isFinite(
        Number(runtimePolicySource?.maxTokensOverride),
      )
        ? Number(runtimePolicySource?.maxTokensOverride)
        : undefined,
      temperatureOverride: Number.isFinite(
        Number(runtimePolicySource?.temperatureOverride),
      )
        ? Number(runtimePolicySource?.temperatureOverride)
        : undefined,
      allowClientOverride: parseBooleanFlag(
        runtimePolicySource?.allowClientOverride,
        parseBooleanFlag(definitionPolicySource?.allowClientOverride, false),
      ),
    },
    knowledgeContext,
    temperature: parseNumberFlag(gpt?.temperature, 0.7),
    topP: parseNumberFlag(gpt?.topP, 1),
    maxTokens: parseNumberFlag(gpt?.maxTokens, 4096),
  };
}

function isLocalDesktopActionsEnabled() {
  return (
    process.env.ILIAGPT_ENABLE_LOCAL_DESKTOP_ACTIONS === "true" ||
    process.env.NODE_ENV !== "production"
  );
}

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

function extractDesktopFolderNameFromPrompt(input: string): string | null {
  const prompt = String(input || "").trim();
  if (!prompt) return null;

  const cleanCandidate = (candidate: string): string => {
    let cleaned = candidate.trim();
    cleaned = cleaned
      .replace(/^[\s("'`[{]+/, "")
      .replace(/[\s)"'`\]}]+$/g, "")
      .replace(/\s+(?:en\s+(?:mi|el)\s+mac|en\s+mac)\b.*$/i, "")
      .replace(/\s+on\s+(?:my|the)\s+mac\b.*$/i, "")
      .replace(
        /\s+en\s+(?:(?:mi|el|la|tu|su)\s+)?(?:escritorio|excritorio|desktop)\b.*$/i,
        "",
      )
      .replace(/\s+on\s+(?:(?:my|the)\s+)?desktop\b.*$/i, "")
      .replace(/\s+(?:por\s+favor|gracias)\b.*$/i, "")
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    return cleaned;
  };

  const folderNamePatterns = [
    // Priority 1: Explicit name markers (llamada, con nombre, named, que se llame) + desktop context
    /(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\s+(?:otra\s+|una\s+)?(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\s+(?:llamada|con\s+nombre|named)\s+["'“”]?([^"'“”\n]{1,160}?)["'“”]?\s+(?:en\s+)?(?:(?:mi|el|la|tu|su)\s+)?(?:mac|escritorio|excritorio|desktop)\b/i,
    // Priority 2: "carpeta que se llame X" / "carpeta con el nombre X" / "carpeta llamada X"
    /(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\s+(?:con\s+(?:el\s+)?nombre|llamada|named|que\s+se\s+llame)\s+["'“”]?([^"'“”\n]{1,160})["'“”]?/i,
    // Priority 3: "crea carpeta [en desktop] llamada/named X" (desktop in middle, name at end)
    /(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\s+(?:otra\s+|una\s+)?(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)(?:\s+en\s+(?:(?:mi|el)\s+)?(?:escritorio|excritorio|desktop))?\s+(?:llamada|llame|con\s+nombre|named)\s+["'“”]?([^"'“”\n]{1,160})["'“”]?\s*$/i,
    // Priority 4: "crea carpeta X en escritorio" (relies on ending bounds to prevent capturing "en escritorio" as name)
    /(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\s+(?:otra\s+|una\s+)?(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\s+["'“”]?([^"'“”\n]{1,160}?)["'“”]?\s+(?:en\s+)?(?:(?:mi|el|la|tu|su)\s+)?(?:mac|escritorio|excritorio|desktop)\b/i,
    // Priority 5: /mkdir command
    /^(?:\/?mkdir|local:\s*mkdir)\s+["'“”]?([^"'“”\n]{1,120})["'“”]?\s*$/i,
  ];

  for (const pattern of folderNamePatterns) {
    const match = prompt.match(pattern);
    const candidate = match?.[1]?.trim();
    if (!candidate) continue;
    const cleaned = cleanCandidate(candidate);
    // Explicitly reject if candidate is a common stop word due to regex overreach
    if (cleaned && !/^(?:en|mi|el|la|una|un|de|del|con)$/i.test(cleaned)) {
      return cleaned;
    }
  }

  // Fallback heuristic: if phrase clearly asks to create a desktop folder,
  // extract token after "nombre/llamada/named" until first connector.
  const hasCreateVerb =
    /\b(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\b/i.test(
      prompt,
    );
  const hasFolderWord =
    /\b(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\b/i.test(
      prompt,
    );
  const intent = hasCreateVerb && hasFolderWord;

  if (intent) {
    // Strategy A: explicit name markers
    const byNameMatch = prompt.match(
      /(?:nombre|llamada|named|que\s+se\s+llame)\s+["'“”]?([^"'“”\n]{1,180})["'“”]?/i,
    );
    const candidate = byNameMatch?.[1] ? cleanCandidate(byNameMatch[1]) : "";
    if (candidate) return candidate;

    // Strategy B: quoted string anywhere in the phrase
    const quotedMatch = prompt.match(/["'“”]([^"'“”\n]{1,120})["'“”]/);
    if (quotedMatch?.[1]) {
      const qCandidate = cleanCandidate(quotedMatch[1]);
      if (qCandidate) return qCandidate;
    }

    // Strategy C: extract the last meaningful word at the end of the phrase, skipping generic stop words
    const stopWords = new Set([
      "en",
      "mi",
      "una",
      "un",
      "la",
      "el",
      "de",
      "del",
      "con",
      "que",
      "se",
      "por",
      "tu",
      "su",
      "al",
      "es",
      "lo",
      "le",
      "crear",
      "crea",
      "creame",
      "haz",
      "hazme",
      "genera",
      "make",
      "create",
      "carpeta",
      "caroeta",
      "carepta",
      "folder",
      "directorio",
      "escritorio",
      "excritorio",
      "desktop",
      "mac",
      "nombre",
      "llamada",
      "puedes",
      "podrias",
      "porfavor",
      "favor",
      "gracias",
      "please",
      "otra",
      "nueva",
      "nuevo",
      "quiero",
      "necesito",
      "me",
      "los",
      "las",
      "the",
      "on",
      "a",
      "my",
      "llamado",
    ]);

    const words = prompt.split(/\s+/);
    let nameCandidate = "";

    // Scan backwards for the first word not in stopWords
    for (let i = words.length - 1; i >= 0; i--) {
      const w = words[i]
        .replace(/^["'`([{]+/, "")
        .replace(/["'`)\]},.:;!?]+$/, "");
      if (!w) continue;

      const lower = w.toLowerCase();
      // If the word isn't a stopword, assume it's the target name
      if (!stopWords.has(lower)) {
        nameCandidate = w;
        break;
      }
    }

    if (nameCandidate) {
      const qCandidate = cleanCandidate(nameCandidate);
      if (qCandidate) return qCandidate;
    }
  }

  return null;
}

function looksLikeDesktopFolderIntent(input: string): boolean {
  const prompt = String(input || "").trim();
  if (!prompt) return false;
  const hasCreateVerb =
    /\b(?:crea|crear|creame|creá|crees|haz|hazme|genera|generar|make|create)\b/i.test(
      prompt,
    );
  const hasFolderWord =
    /\b(?:carpeta|caroeta|carepta|carptea|careta|folder|directorio|directory)\b/i.test(
      prompt,
    );
  const hasDesktopContext =
    /\b(?:escritorio|excritorio|desktop|mi\s+mac|my\s+mac)\b/i.test(prompt);
  return hasCreateVerb && hasFolderWord && hasDesktopContext;
}

function normalizeWorkspaceContext(
  input: unknown,
): WorkspaceContextInput | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;

  const repositoryPath =
    typeof source.repositoryPath === "string"
      ? source.repositoryPath.trim()
      : "";
  if (!repositoryPath) return undefined;

  const rawFolder =
    typeof source.selectedFolder === "string"
      ? source.selectedFolder.trim()
      : ".";
  let selectedFolder = rawFolder || ".";
  selectedFolder = selectedFolder.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!selectedFolder || selectedFolder === ".") selectedFolder = ".";
  if (selectedFolder.startsWith("/") || selectedFolder.includes(".."))
    selectedFolder = ".";

  const codingAgents = Array.isArray(source.codingAgents)
    ? source.codingAgents.filter(
        (value): value is CodingAgentProfile =>
          value === "coder" || value === "reviewer" || value === "improver",
      )
    : [];

  const runtimeTarget =
    typeof source.runtimeTarget === "string" && source.runtimeTarget.trim()
      ? source.runtimeTarget.trim()
      : "Local";
  const executionAccess =
    typeof source.executionAccess === "string" && source.executionAccess.trim()
      ? source.executionAccess.trim()
      : "Full access";
  const branch =
    typeof source.branch === "string" && source.branch.trim()
      ? source.branch.trim()
      : undefined;

  return {
    projectId:
      typeof source.projectId === "string" ? source.projectId : undefined,
    projectName:
      typeof source.projectName === "string" ? source.projectName : undefined,
    repositoryPath,
    selectedFolder,
    codingAgents: codingAgents.length > 0 ? codingAgents : ["coder"],
    runtimeTarget,
    executionAccess,
    branch,
  };
}

// ── Natural language intent extractors for all local control commands ──

function extractNaturalRmIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "elimina/borra/delete la carpeta/archivo X (de mi escritorio)"
    /\b(?:elimina|eliminar|borra|borrar|delete|remove|quita|quitar)\s+(?:la\s+|el\s+|the\s+)?(?:carpeta|archivo|folder|file|directorio|directory)\s+["']?([^"'\n]{1,160})["']?/i,
    // "elimina X de mi escritorio" / "delete X from my desktop"
    /\b(?:elimina|eliminar|borra|borrar|delete|remove)\s+["']?([^"'\n]{1,120})["']?\s+(?:de|del|from)\s+(?:(?:mi|my)\s+)?(?:escritorio|desktop)/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]) {
      const name = m[1]
        .trim()
        .replace(
          /\s+(?:de|del|from)\s+(?:(?:mi|my)\s+)?(?:escritorio|desktop)\b.*$/i,
          "",
        )
        .replace(/\s+(?:por\s+favor|please)\b.*$/i, "")
        .replace(/[.,;:!?]+$/, "")
        .trim();
      if (name) return name;
    }
  }
  return null;
}

function extractNaturalReadIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "lee/muéstrame/abre el archivo X"
    /\b(?:lee|leer|muestra|muéstrame|mostrar|abre|abrir|show|read|open|display|cat)\s+(?:el\s+)?(?:archivo|file|contenido\s+de(?:l)?)\s+["']?([^"'\n]{1,160})["']?/i,
    // "qué contiene/tiene el archivo X" — require "archivo/file" to avoid matching "qué hay en mi escritorio" (which is ls)
    /\b(?:qué|que|what)\s+(?:contiene|tiene|contains)\s+(?:el\s+)?(?:archivo\s+)?["']?([^"'\n]{1,160})["']?/i,
    /\b(?:qué|que|what)\s+(?:hay\s+en)\s+(?:el\s+)?(?:archivo|file)\s+["']?([^"'\n]{1,160})["']?/i,
    // "lee X" (short form when it looks like a file path)
    /\b(?:lee|leer|read|cat)\s+["']?([^\s"']{2,}\.[\w]{1,10})["']?\s*$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]) {
      const name = m[1]
        .trim()
        .replace(/[.,;:!?]+$/, "")
        .trim();
      if (name) return name;
    }
  }
  return null;
}

function extractNaturalShellIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "ejecuta/corre/run el comando X"
    /\b(?:ejecuta|ejecutar|corre|correr|run|lanza|lanzar|execute)\s+(?:el\s+)?(?:comando|command)?\s*[:\-]?\s*[`"']?(.+?)[`"']?\s*$/i,
    // "en la terminal haz/ejecuta X"
    /\b(?:en\s+(?:la\s+)?terminal|in\s+(?:the\s+)?terminal)\s*[,:]?\s*(?:ejecuta|haz|run|do|type)\s+[`"']?(.+?)[`"']?\s*$/i,
    // "corre en bash: X"
    /\b(?:en\s+)?(?:bash|shell|terminal|consola)\s*[:\-]\s*[`"']?(.+?)[`"']?\s*$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function extractNaturalSysinfoIntent(input: string): boolean {
  const prompt = String(input || "")
    .trim()
    .toLowerCase();
  const keywords = [
    /\b(?:info(?:rmacion)?|información)\s+(?:del?\s+)?(?:sistema|equipo|computadora|mac|pc)\b/i,
    /\b(?:cuanta|cuánta|how\s+much)\s+(?:memoria|ram|memory)\b/i,
    /\b(?:espacio|space)\s+(?:en\s+)?(?:disco|disk)\b/i,
    /\b(?:que|qué|which)\s+(?:version|versión)\s+(?:de\s+)?(?:mac|macos|os)\b/i,
    /\b(?:cuantos|cuántos|how\s+many)\s+(?:cores?|núcleos|procesadores?|cpus?)\b/i,
    /\b(?:datos|detalles|specs|especificaciones)\s+(?:del?\s+)?(?:sistema|equipo|computadora|hardware)\b/i,
  ];
  return keywords.some((re) => re.test(prompt));
}

function extractNaturalWriteIntent(
  input: string,
): { path: string; content: string } | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "crea un archivo X con el contenido Y"
    /\b(?:crea|crear|make|create|genera)\s+(?:un\s+)?(?:archivo|file)\s+["']?([^"'\n]{1,120})["']?\s+(?:con\s+(?:el\s+)?(?:contenido|texto|content)|que\s+(?:contenga|diga|tenga))\s+["']?(.+?)["']?\s*$/i,
    // "escribe/guarda en el archivo X: contenido"
    /\b(?:escribe|escribir|guarda|guardar|write|save)\s+(?:en\s+)?(?:el\s+)?(?:archivo\s+)?["']?([^"'\n]{1,120})["']?\s*[:\-]\s*["']?(.+?)["']?\s*$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim() && m?.[2]?.trim()) {
      return { path: m[1].trim(), content: m[2].trim() };
    }
  }
  return null;
}

function extractNaturalAppWriteIntent(
  input: string,
): { appName: string; text: string; pressEnter: boolean } | null {
  const prompt = String(input || "").trim();
  if (!prompt) return null;

  const patterns = [
    /\b(?:escribe|escribir|teclea|teclear|write|type)\s+en\s+(?:(?:la|el)\s+)?(?:(?:app|aplicaci[oó]n)\s+)?(?:de\s+)?([a-z0-9áéíóúüñ ._\-]{2,60}?)\s+(?:que|:)\s+([\s\S]{1,2500})$/i,
    /\b(?:en|in)\s+(?:(?:la|el)\s+)?(?:(?:app|aplicaci[oó]n)\s+)?(?:de\s+)?([a-z0-9áéíóúüñ ._\-]{2,60}?)\s+(?:escribe|escribir|teclea|teclear|write|type)\s+(?:que|:)?\s*([\s\S]{1,2500})$/i,
  ];

  for (const re of patterns) {
    const match = prompt.match(re);
    if (!match?.[1] || !match?.[2]) continue;

    const appName = normalizeLocalAppName(match[1]);
    if (!appName) continue;

    let text = String(match[2] || "").trim();
    if (!text) continue;
    if (/[.,;:!?]+$/.test(text)) {
      text = text.replace(/[.,;:!?]+$/g, "").trim();
    }
    if (!text) continue;

    const pressEnter = /\s+(?:--enter|enter|enviar|send)$/i.test(text);
    text = text.replace(/\s+(?:--enter|enter|enviar|send)$/i, "").trim();
    if (!text) continue;

    return { appName, text, pressEnter };
  }

  return null;
}

function extractNaturalSendFileIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  if (!prompt) return null;

  const sendVerb = /\b(?:manda(?:me)?|env[ií]a(?:me)?|send)\b/i;
  const fileHint =
    /\b(?:archivo|documento|file|doc|pdf|imagen|foto|captura)\b/i;
  if (!sendVerb.test(prompt) || !fileHint.test(prompt)) return null;

  const quotedPath = prompt.match(
    /["']((?:~|\/|desktop:|downloads:|documents:)[^"']+)["']/i,
  )?.[1];
  if (quotedPath) return quotedPath.trim();

  const pathLike = prompt.match(
    /\b((?:~|\/|desktop:|downloads:|documents:)[^\s,;]+)\b/i,
  )?.[1];
  if (pathLike) return pathLike.trim();

  const fileName = prompt.match(
    /\b([a-z0-9._-]+\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|json|zip|png|jpe?g|webp|gif))\b/i,
  )?.[1];
  if (fileName) return fileName.trim();

  return null;
}

function extractNaturalLsIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const normalizeTarget = (rawTarget: string): string => {
    const cleaned = String(rawTarget || "")
      .trim()
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    if (!cleaned) return "";
    if (
      /^(?:mi\s+)?(?:escritorio|excritorio|desktop|mac|computadora|pc|laptop|home)$/i.test(
        cleaned,
      )
    ) {
      return "desktop:";
    }
    return cleaned;
  };

  const patterns = [
    // "muéstrame los archivos de mi escritorio" / "lista las carpetas de mi escritorio"
    /\b(?:muestra|muéstrame|lista|listar|show|list)\s+(?:los\s+|las\s+)?(?:archivos|carpetas|files|folders|contenido)\s+(?:de|del|en|in|from)\s+(?:mi\s+)?["']?([^"'\n]{1,120})["']?\s*$/i,
    // "qué hay en mi escritorio" / "qué archivos tengo en Desktop"
    /\b(?:qué|que|what)\s+(?:hay|archivos|carpetas|files|folders)\s+(?:en|in|tengo\s+en)\s+(?:mi\s+)?["']?([^"'\n]{1,120})["']?\s*$/i,
    // "cuántas carpetas tengo en mi escritorio" (tolerates common typo "caprteas")
    /\b(?:cu[aá]ntas?|how\s+many|cantidad(?:\s+de)?|n[uú]mero(?:\s+de)?)\s+(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b(?:.*?\b(?:en|in|de|del|from)\s+(?:mi\s+)?["']?([^"'\n]{1,120})["']?)?/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) {
      const target = normalizeTarget(m[1]);
      if (target) return target;
    }
  }

  // Fallback: if the user asks for counts in desktop/mac context, default to Desktop.
  const asksForCount =
    /\b(?:cu[aá]ntas?|how\s+many|cantidad|n[uú]mero)\b/i.test(prompt);
  const asksAboutFoldersOrFiles =
    /\b(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b/i.test(
      prompt,
    );
  const hasDesktopContext =
    /\b(?:escritorio|excritorio|desktop|mi\s+mac|my\s+mac|computadora|pc|laptop)\b/i.test(
      prompt,
    );
  if (asksForCount && asksAboutFoldersOrFiles && hasDesktopContext) {
    return "desktop:";
  }

  return null;
}

function sanitizeDetectedUrlCandidate(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[)\].,!?;:]+$/g, "");
}

function extractNaturalScreenshotIntent(
  input: string,
): { url?: string } | null {
  const prompt = String(input || "").trim();
  if (!prompt) return null;

  const hasScreenshotKeyword =
    /\b(?:screenshot|captura(?:\s+de\s+pantalla)?|pantallazo|screen\s?shot|foto\s+de\s+pantalla)\b/i.test(
      prompt,
    );
  if (!hasScreenshotKeyword) return null;

  const explicitUrlMatch = prompt.match(/\b((?:https?:\/\/|www\.)[^\s<>"']+)/i);
  if (explicitUrlMatch?.[1]) {
    return { url: sanitizeDetectedUrlCandidate(explicitUrlMatch[1]) };
  }

  const domainUrlMatch = prompt.match(
    /\b([a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"']*)?)/i,
  );
  if (domainUrlMatch?.[1]) {
    return { url: sanitizeDetectedUrlCandidate(domainUrlMatch[1]) };
  }

  return {};
}

function extractNaturalWindowshotIntent(
  input: string,
): { appName: string } | null {
  const prompt = String(input || "").trim();
  if (!prompt) return null;

  const hasScreenshotKeyword =
    /\b(?:screenshot|captura(?:\s+de\s+pantalla)?|pantallazo|screen\s?shot|foto\s+de\s+pantalla)\b/i.test(
      prompt,
    );
  if (!hasScreenshotKeyword) return null;

  if (/\b((?:https?:\/\/|www\.)[^\s<>"']+)\b/i.test(prompt)) {
    return null;
  }
  if (/\b[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"']*)?\b/i.test(prompt)) {
    return null;
  }

  const patterns = [
    /\b(?:captura|screenshot|pantallazo|foto\s+de\s+pantalla)\s+(?:de|del|de\s+la|de\s+el)\s+(?:la\s+app\s+|app\s+|aplicaci[oó]n\s+)?([a-z0-9áéíóúüñ ._\-]{2,80})$/i,
    /\b(?:de|del)\s+(?:la\s+app\s+|app\s+|aplicaci[oó]n\s+)?([a-z0-9áéíóúüñ ._\-]{2,80})\s+(?:captura|screenshot|pantallazo)\b/i,
  ];

  for (const re of patterns) {
    const match = prompt.match(re);
    if (!match?.[1]) continue;
    const candidateRaw = String(match[1] || "")
      .replace(/\b(?:por\s+favor|please|ahora|ya|mismo)\b/gi, "")
      .trim();
    const candidate = normalizeLocalAppName(candidateRaw);
    if (!candidate) continue;
    if (/^(?:pantalla|escritorio|desktop|mac|computadora|pc)$/i.test(candidate))
      continue;
    return { appName: candidate };
  }

  return null;
}

function inferDocToolFromPrompt(
  promptInput: string,
): "word" | "excel" | "ppt" | null {
  const prompt = String(promptInput || "")
    .normalize("NFKC")
    .trim();
  if (!prompt) return null;

  const classified = classifyOutputFormat(prompt);
  if (classified.confidence < 0.85) return null;
  if (classified.action === "excel") return "excel";
  if (classified.action === "pptx") return "ppt";
  if (classified.action === "word") return "word";
  return null;
}

type DesktopOrganizationMode = "files" | "folders" | "all";

function extractNaturalOrganizeDesktopIntent(
  input: string,
): { mode: DesktopOrganizationMode } | null {
  const prompt = String(input || "").trim();
  if (!prompt) return null;

  const hasOrganizerVerb =
    /\b(?:organiza|organizar|ordena|ordenar|clasifica|clasificar|acomoda|acomodar|arregla|sort|organize|tidy)\b/i.test(
      prompt,
    );
  const hasDesktopContext =
    /\b(?:escritorio|desktop|mi\s+mac|my\s+desktop)\b/i.test(prompt);
  if (!hasOrganizerVerb || !hasDesktopContext) return null;

  const mentionsFiles = /\b(?:archivos?|files?)\b/i.test(prompt);
  const mentionsFolders =
    /\b(?:carpetas?|folders?|directorios?|directories?)\b/i.test(prompt);

  let mode: DesktopOrganizationMode = "all";
  if (mentionsFolders && !mentionsFiles) {
    mode = "folders";
  } else if (mentionsFiles && !mentionsFolders) {
    mode = "files";
  }

  return { mode };
}

// ── New natural language extractors for expanded commands ──

function extractNaturalPsIntent(input: string): boolean {
  const prompt = String(input || "").trim();
  const patterns = [
    /\b(?:muestra|muéstrame|show|list|lista)\s+(?:los\s+)?(?:procesos|processes)\b/i,
    /\b(?:qué|que|what)\s+(?:procesos|processes)\s+(?:están|estan|are)\s+(?:corriendo|running|activos|active)\b/i,
    /\b(?:procesos|processes)\s+(?:activos|running|corriendo|en\s+ejecución)\b/i,
    /\b(?:running|active)\s+(?:procesos|processes)\b/i,
  ];
  return patterns.some((re) => re.test(prompt));
}

function extractNaturalKillIntent(
  input: string,
): { pid?: string; name?: string } | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "mata/kill/termina el proceso X" or "mata el proceso con PID 1234"
    /\b(?:mata|matar|kill|termina|terminar|detén|deten|para|stop)\s+(?:el\s+)?(?:proceso|process)\s+(?:con\s+)?(?:PID\s+)?["']?(\S+)["']?/i,
    // "kill PID 1234" / "kill 1234"
    /\b(?:kill|mata|matar|termina)\s+(?:PID\s+)?(\d+)\b/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) {
      const val = m[1].trim();
      if (/^\d+$/.test(val)) return { pid: val };
      return { name: val };
    }
  }
  return null;
}

function extractNaturalPortsIntent(input: string): boolean {
  const prompt = String(input || "").trim();
  const patterns = [
    /\b(?:qué|que|which|what)\s+(?:puertos|ports)\s+(?:están|estan|are)\s+(?:abiertos|open|en\s+uso|in\s+use|listening|escuchando)\b/i,
    /\b(?:puertos|ports)\s+(?:abiertos|open|en\s+uso|in\s+use|listening|activos)\b/i,
    /\b(?:muestra|muéstrame|show|list|lista)\s+(?:los\s+)?(?:puertos|ports)\b/i,
    /\b(?:listening)\s+(?:puertos|ports)\b/i,
  ];
  return patterns.some((re) => re.test(prompt));
}

function extractNaturalGitIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "git status" / "git add ." / "git commit -m ..."
    /^git\s+(.+)$/i,
    // "haz un commit con mensaje X"
    /\b(?:haz|hacer|make|do)\s+(?:un\s+)?commit\s+(?:con\s+(?:el\s+)?(?:mensaje|message)\s+)?["']?(.+?)["']?\s*$/i,
    // "estado del repositorio" / "repository status"
    /\b(?:estado|status)\s+(?:del?\s+)?(?:repositorio|repo|repository)\b/i,
    // "push to remote" / "sube los cambios"
    /\b(?:push|sube|subir)\s+(?:(?:los|the)\s+)?(?:cambios|changes|commits?)\b/i,
    // "pull / jala los cambios"
    /\b(?:pull|jala|bajar|download)\s+(?:(?:los|the)\s+)?(?:cambios|changes|commits?)\b/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m) {
      // For the "git <subcommand>" form, return the subcommand
      if (/^git\s+/i.test(prompt)) return prompt.replace(/^git\s+/i, "").trim();
      // For "haz un commit con mensaje X"
      if (m[1] && /commit/i.test(prompt)) return `commit -m "${m[1].trim()}"`;
      // Status
      if (/(?:estado|status)/i.test(prompt)) return "status";
      if (/(?:push|sube|subir)/i.test(prompt)) return "push";
      if (/(?:pull|jala|bajar)/i.test(prompt)) return "pull";
      return m[1]?.trim() || "status";
    }
  }
  return null;
}

function extractNaturalDockerIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    /^docker\s+(.+)$/i,
    /\b(?:contenedores|containers)\s+(?:activos|running|corriendo)\b/i,
    /\b(?:muestra|muéstrame|show|list|lista)\s+(?:los\s+)?(?:contenedores|containers|dockers?)\b/i,
    /\b(?:imágenes|imagenes|images)\s+(?:de\s+)?docker\b/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m) {
      if (/^docker\s+/i.test(prompt))
        return prompt.replace(/^docker\s+/i, "").trim();
      if (/(?:contenedores|containers)/i.test(prompt)) return "ps";
      if (/(?:imágenes|imagenes|images)/i.test(prompt)) return "images";
      return m[1]?.trim() || "ps";
    }
  }
  return null;
}

function extractNaturalInstallIntent(
  input: string,
): { manager: string; packages: string[] } | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "instala express con npm" / "npm install express"
    /\b(?:instala|instalar|install)\s+(.+?)\s+(?:con|with|using|via)\s+(npm|pip|brew|pip3)\b/i,
    /\b(npm|pip|pip3|brew)\s+install\s+(.+?)\s*$/i,
    // "instala X usando npm"
    /\b(?:instala|instalar|install)\s+(.+?)\s+(?:usando|con)\s+(npm|pip|brew|pip3)\b/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m) {
      let manager: string;
      let pkgStr: string;
      if (/^(?:npm|pip|pip3|brew)\s+install/i.test(prompt)) {
        manager = m[1].toLowerCase().replace("pip3", "pip");
        pkgStr = m[2];
      } else {
        pkgStr = m[1];
        manager = m[2].toLowerCase().replace("pip3", "pip");
      }
      const packages = pkgStr.split(/[\s,]+/).filter(Boolean);
      if (packages.length > 0) return { manager, packages };
    }
  }
  return null;
}

function extractNaturalScriptIntent(
  input: string,
): { file: string; language?: string } | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "ejecuta el script test.py" / "corre main.js" / "run script.sh"
    /\b(?:ejecuta|ejecutar|corre|correr|run)\s+(?:el\s+)?(?:script|archivo|file)\s+["']?([^\s"']{2,}\.\w{1,10})["']?/i,
    // "python test.py" / "node main.js"
    /^(?:python3?|node|bash|sh)\s+["']?([^\s"']{2,}\.\w{1,10})["']?/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) {
      const file = m[1].trim();
      const ext = path.extname(file).toLowerCase();
      let language: string | undefined;
      if ([".py", ".python"].includes(ext)) language = "python";
      else if ([".js", ".mjs", ".cjs"].includes(ext)) language = "node";
      else if ([".sh", ".bash", ".zsh"].includes(ext)) language = "bash";
      else if ([".ts", ".tsx"].includes(ext)) language = "node";
      return { file, language };
    }
  }
  return null;
}

function extractNaturalFindIntent(
  input: string,
): { pattern: string; dir?: string } | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "busca archivos .txt en mi escritorio" / "find all json files"
    /\b(?:busca|buscar|find|search)\s+(?:todos?\s+(?:los\s+)?)?(?:archivos|files)\s+(?:con\s+extensión\s+)?["']?(\.\w+|\*\.\w+)["']?\s*(?:en|in)\s+(?:mi\s+)?["']?([^"'\n]{1,120})["']?/i,
    // "busca archivos .txt" (no dir)
    /\b(?:busca|buscar|find|search)\s+(?:todos?\s+(?:los\s+)?)?(?:archivos|files)\s+(?:con\s+extensión\s+)?["']?(\.\w+|\*\.\w+)["']?\s*$/i,
    // "busca *.ts" / "find *.json"
    /\b(?:busca|buscar|find|search)\s+["']?(\*?\.\w+)["']?\s*(?:(?:en|in)\s+(?:mi\s+)?["']?([^"'\n]{1,120})["']?)?\s*$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) {
      let pattern = m[1].trim();
      if (!pattern.startsWith("*")) pattern = `*${pattern}`;
      let dir = m[2]?.trim();
      if (dir && /^(?:escritorio|desktop)$/i.test(dir)) dir = "desktop:";
      return { pattern, dir };
    }
  }
  return null;
}

function extractNaturalCdIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    // "ve a la carpeta X" / "entra en el directorio X" / "cd al proyecto"
    /\b(?:ve|ir|entra|entrar|cambia|cambiar|go|move|switch)\s+(?:a\s+(?:la\s+)?|en\s+(?:el\s+)?|al?\s+|to\s+)(?:carpeta|directorio|folder|directory|dir)?\s*["']?([^"'\n]{1,160})["']?\s*$/i,
    // "cd /tmp" / "cd ~/Desktop"
    /^cd\s+["']?([^"'\n]{1,160})["']?\s*$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function extractNaturalPythonIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  // "python: print('hola')" / "py: 2+2" / "ejecuta en python: ..."
  const patterns = [
    /^(?:python3?|py)\s*[:\-]\s*(.+)$/i,
    /\b(?:ejecuta|run|corre)\s+(?:en\s+)?(?:python3?|py)\s*[:\-]\s*(.+)$/i,
    /^(?:python3?|py)\s+(?![\w/\\~.])(.+)$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function extractNaturalNodeIntent(input: string): string | null {
  const prompt = String(input || "").trim();
  const patterns = [
    /^(?:node|js)\s*[:\-]\s*(.+)$/i,
    /\b(?:ejecuta|run|corre)\s+(?:en\s+)?(?:node|javascript|js)\s*[:\-]\s*(.+)$/i,
  ];
  for (const re of patterns) {
    const m = prompt.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

/**
 * Detects when the user asks about ILIAGPT's local control capabilities.
 * E.g.: "tienes acceso a mi terminal?", "puedes crear archivos?", "qué puedes hacer en mi computadora?"
 */
function isCapabilityQuery(input: string): boolean {
  const prompt = String(input || "")
    .trim()
    .toLowerCase();
  const patterns = [
    // "tienes acceso a mi terminal/computadora/archivos/sistema"
    /\b(?:tienes|tiene|tenés|tengo|hay)\s+(?:acceso|conexión|conexion)\s+(?:a\s+)?(?:mi|la|el|al)?\s*(?:terminal|computadora|computador|pc|mac|sistema|archivos|files|shell|consola|equipo|ordenador|laptop|maquina|máquina)\b/i,
    // "puedes acceder/ver/controlar/ejecutar/usar mi terminal"
    /\b(?:puedes|puede|podés|podrías|podrias|pueden|se\s+puede|es\s+posible|eres\s+capaz)\s+(?:acceder|ver|controlar|ejecutar|usar|manejar|gestionar|administrar|operar|correr|abrir|tocar)\s+(?:a\s+|en\s+)?(?:mi|la|el|al)?\s*(?:terminal|computadora|computador|pc|mac|sistema|archivos|files|shell|consola|equipo|carpetas|folders|disco|disk)\b/i,
    // "tienes acceso a la terminal" / "tienes acceso al sistema"
    /\b(?:tienes|tiene)\s+acceso\b/i,
    // "puedes ejecutar comandos" / "puedes correr scripts"
    /\b(?:puedes|puede|podés)\s+(?:ejecutar|correr|run|crear|eliminar|borrar|leer|escribir|abrir|instalar|desinstalar)\s+(?:comandos|scripts|archivos|carpetas|programas|paquetes|apps|aplicaciones)\b/i,
    // "qué puedes hacer en mi computadora/con mi terminal"
    /\b(?:qué|que|what)\s+(?:puedes|puede|podés|can\s+you)\s+(?:hacer|do)\s+(?:en|con|with|in|on)\s+(?:mi|la|el|al)?\s*(?:terminal|computadora|computador|pc|mac|sistema|equipo)\b/i,
    // "qué capacidades tienes" / "cuáles son tus capacidades"
    /\b(?:qué|que|cuáles|cuales|what)\s+(?:capacidades|habilidades|abilities|capabilities|poderes|funciones|features|powers)\s+(?:tienes|tiene|tenés|do\s+you\s+have)\b/i,
    // "can you access my terminal" / "do you have access to my computer"
    /\b(?:can\s+you|do\s+you)\s+(?:access|control|use|run|execute|manage)\s+(?:my|the)\s+(?:terminal|computer|system|files|shell|machine)\b/i,
    // "do you have access" / "have access to"
    /\b(?:do\s+you\s+have|have\s+you\s+got)\s+access\b/i,
    // Direct: "acceso a mi terminal" / "controlar mi computadora"
    /\b(?:acceso|control|acceder)\s+(?:a\s+)?(?:mi|la|el)?\s*(?:terminal|computadora|equipo|sistema|consola|pc|mac)\b/i,
  ];
  return patterns.some((re) => re.test(prompt));
}

function buildCapabilityResponse(): string {
  if (!isLocalDesktopActionsEnabled()) {
    return `**No tengo acceso a tu computadora en este entorno.** Mis acciones locales y herramientas del sistema están deshabilitadas por seguridad o configuración del sistema.

Mis capacidades actuales se limitan a:
💬 **Asistencia**: Responder preguntas, brindar explicaciones y redactar textos.
💻 **Código**: Escribir, analizar código fuente, leer archivos de proyectos (si se me da acceso explicitamente)
🌐 **Búsqueda**: Consultar información en la web y resumir enlaces.
`;
  }

  return `**Sí, tengo capacidades de acceso a tu computadora.** (Solo disponible si tienes rol de administrador o propietario). Aquí están mis capacidades cuando están habilitadas:

🖥️ **Terminal**: Puedo ejecutar comandos en tu terminal de manera segura
📂 **Archivos**: Leer, escribir, explorar tu escritorio, documentos y espacios de trabajo
🔍 **Búsqueda**: Buscar archivos en tu entorno local y analizarlos
💻 **Código**: Ejecutar scripts y comandos de desarrollo en entornos aislados
📊 **Sistema**: Ver estado del sistema de forma limitada y segura
🌐 **Navegador**: Automatizar tareas en la web de forma local
`;
}

type LocalControlCommand =
  | "help"
  | "status"
  | "deteneroff"
  | "deteneron"
  | "mkdir"
  | "ls"
  | "mv"
  | "rename"
  | "rm"
  | "touch"
  | "read"
  | "write"
  | "append"
  | "replace"
  | "stat"
  | "sysinfo"
  | "shell"
  | "cp"
  | "organize_desktop"
  // ── New commands (Phase 1 expansion) ──
  | "ps"
  | "kill"
  | "ports"
  | "find"
  | "grep"
  | "tree"
  | "chmod"
  | "diff"
  | "python"
  | "node"
  | "script"
  | "npm"
  | "pip"
  | "brew"
  | "git"
  | "docker"
  | "cd"
  | "pwd"
  | "history"
  | "monitor"
  | "open"
  | "appwrite"
  | "env"
  | "top"
  | "du"
  | "which"
  | "sendfile"
  | "capabilities"
  // ── macOS native commands ──
  | "volume"
  | "brightness"
  | "darkmode"
  | "wifi"
  | "bluetooth"
  | "battery"
  | "lock"
  | "screenshot"
  | "windowshot"
  | "webshot"
  | "clipboard"
  | "notify"
  | "say"
  | "calendar"
  | "contacts"
  | "reminders"
  | "spotlight"
  | "shortcut"
  | "music"
  | "apps"
  | "windows"
  | "finder"
  | "osascript";

type LocalControlRequest = {
  command: LocalControlCommand;
  args: string[];
  token: string | null;
  confirm: boolean;
  raw: string;
  source: "prefixed" | "natural" | "kill_switch";
};

type LocalControlState = {
  disabled: boolean;
  updatedAt: string;
  updatedBy?: string;
  reason?: string;
};

export type LocalControlResult =
  | { handled: false }
  | {
      handled: true;
      ok: boolean;
      statusCode: number;
      code: string;
      message: string;
      payload?: Record<string, unknown>;
    };

const LOCAL_ACTION_AUDIT_LOG_PATH = path.join(
  os.homedir(),
  ".iliagpt-control-audit.log",
);
const LOCAL_ACTION_STATE_PATH = path.join(
  os.homedir(),
  ".iliagpt-local-actions-state.json",
);
const LOCAL_ACTIONS_DEFAULT_ROOT = path.resolve(
  path.join(os.homedir(), "Desktop"),
);
const LOCAL_ACTIONS_PROJECT_ROOT = path.resolve(process.cwd());
const LOCAL_ACTION_ADMIN_TOKEN = (
  process.env.ILIAGPT_LOCAL_ACTION_TOKEN || ""
).trim();
const LOCAL_MAX_CONTROL_ENABLED =
  process.env.ILIAGPT_LOCAL_FULL_SHELL === "true" ||
  process.env.ILIAGPT_LOCAL_FULL_ACCESS === "true";
const LOCAL_FULL_SHELL_ENABLED =
  process.env.ILIAGPT_LOCAL_FULL_SHELL === "true" ||
  process.env.ILIAGPT_LOCAL_FULL_ACCESS === "true" ||
  process.env.NODE_ENV !== "production";
const LOCAL_CONFIRM_RE = /\b(?:confirmar|confirm|--confirm)\b/i;
const LOCAL_TOKEN_RE = /(?:^|\s)token=([^\s]+)/i;
const LOCAL_SHELL_TIMEOUT_MS = 45_000;
const LOCAL_WEBSHOT_HOST_SUFFIX_BLOCKLIST = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
];

function isPrivateIpv4Address(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part)))
    return false;
  const nums = parts.map((part) => Number(part));
  if (nums.some((value) => Number.isNaN(value) || value < 0 || value > 255))
    return false;

  if (nums[0] === 10) return true;
  if (nums[0] === 127) return true;
  if (nums[0] === 0) return true;
  if (nums[0] === 192 && nums[1] === 168) return true;
  if (nums[0] === 172 && nums[1] >= 16 && nums[1] <= 31) return true;
  if (nums[0] === 169 && nums[1] === 254) return true;
  return false;
}

function isPrivateIpv6Address(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (!normalized.includes(":")) return false;
  if (normalized === "::1") return true;
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
  return false;
}

function isBlockedWebshotHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized) return true;
  if (normalized === "localhost" || normalized === "0.0.0.0") return true;
  if (
    LOCAL_WEBSHOT_HOST_SUFFIX_BLOCKLIST.some((suffix) =>
      normalized.endsWith(suffix),
    )
  )
    return true;
  if (isPrivateIpv4Address(normalized)) return true;
  if (isPrivateIpv6Address(normalized)) return true;
  return false;
}

function shouldInjectLocalControlPrompt(userMessage: string): boolean {
  const normalized = String(userMessage || "")
    .normalize("NFKC")
    .trim();
  if (!normalized) return false;

  // Reuse parser first: if a concrete local-control intent was detected,
  // include full local-control system context.
  if (parseLocalControlRequest(normalized)) return true;

  // Soft fallback for capability queries that might not map to a concrete
  // executable command in the parser but still need an accurate answer.
  return /\b(?:acceso|control|terminal|shell|archivo|archivos|carpeta|carpetas|computadora|sistema|captura|screenshot)\b/i.test(
    normalized,
  );
}

async function captureWebshotWithoutSandbox(url: string): Promise<{
  buffer: Buffer | null;
  finalUrl?: string;
  title?: string;
  error?: string;
}> {
  let sessionId: string | null = null;
  try {
    sessionId = await browserWorker.createSession();
    const result = await browserWorker.navigate(sessionId, url, true);
    if (!result.success || !result.screenshot) {
      return {
        buffer: null,
        error:
          result.error ||
          "No se pudo navegar al sitio para capturar la imagen.",
      };
    }
    return {
      buffer: result.screenshot,
      finalUrl: result.url,
      title: result.title,
    };
  } catch (error) {
    return {
      buffer: null,
      error: String((error as Error)?.message || error),
    };
  } finally {
    if (sessionId) {
      await browserWorker.destroySession(sessionId).catch(() => undefined);
    }
  }
}
const LOCAL_SHELL_MAX_STDOUT_CHARS = 24_000;
const LOCAL_SHELL_MAX_STDERR_CHARS = 8_000;
const LOCAL_SHELL_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

// ── TerminalController Session Manager ──
// Module-level to avoid bundler try/catch variable renaming bug
let _localTerminalSessionId: string | null = null;
let _localTerminalSessionCwd: string = LOCAL_ACTIONS_DEFAULT_ROOT;
let _localCommandHistory: Array<{
  ts: string;
  command: string;
  exitCode: number | null;
}> = [];

function getOrCreateLocalTerminalSession(): string {
  if (_localTerminalSessionId) {
    try {
      terminalController.getCwd(_localTerminalSessionId);
      return _localTerminalSessionId;
    } catch {
      _localTerminalSessionId = null;
    }
  }
  _localTerminalSessionId = terminalController.createSession(os.homedir(), {
    ...(process.env as Record<string, string>),
  });
  _localTerminalSessionCwd = LOCAL_ACTIONS_DEFAULT_ROOT;
  return _localTerminalSessionId;
}

function pushLocalCommandHistory(
  command: string,
  exitCode: number | null,
): void {
  _localCommandHistory.push({
    ts: new Date().toISOString(),
    command,
    exitCode,
  });
  if (_localCommandHistory.length > 200)
    _localCommandHistory = _localCommandHistory.slice(-200);
}

type LocalShellExecutionResult = {
  commandLine: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
};

function shellQuoteArg(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeLocalSignal(rawSignal?: string): string {
  const cleaned = String(rawSignal || "SIGTERM")
    .trim()
    .toUpperCase();
  if (!cleaned) return "SIGTERM";
  const normalized = cleaned.startsWith("SIG") ? cleaned : `SIG${cleaned}`;
  if (!/^SIG[A-Z0-9]+$/.test(normalized)) return "SIGTERM";
  return normalized;
}

function ensureLocalCwd(allowedRoots: string[]): string {
  const current = path.resolve(
    _localTerminalSessionCwd || LOCAL_ACTIONS_DEFAULT_ROOT,
  );
  if (isAllowedLocalPath(current, allowedRoots)) {
    return current;
  }
  const fallback = isAllowedLocalPath(LOCAL_ACTIONS_DEFAULT_ROOT, allowedRoots)
    ? LOCAL_ACTIONS_DEFAULT_ROOT
    : allowedRoots[0] || path.resolve("/");
  _localTerminalSessionCwd = path.resolve(fallback);
  return _localTerminalSessionCwd;
}

function formatLocalShellMessage(result: LocalShellExecutionResult): string {
  const header = `$ ${result.commandLine}`;
  const stdoutBlock = result.stdout || "(sin salida)";
  const truncatedInfo = result.truncated ? "\n[...salida truncada...]" : "";
  const pieces = [
    `cwd: ${result.cwd}`,
    `\`\`\`\n${header}\n${stdoutBlock}${truncatedInfo}\n\`\`\``,
  ];
  if (result.stderr) {
    pieces.push(`STDERR:\n\`\`\`\n${result.stderr}\n\`\`\``);
  }
  pieces.push(
    `exit_code=${result.exitCode}${result.timedOut ? " (timeout)" : ""}`,
  );
  return pieces.join("\n");
}

async function runLocalShellCommand(
  commandLine: string,
  options: {
    allowedRoots: string[];
    cwd?: string;
    timeoutMs?: number;
    stdoutMaxChars?: number;
    stderrMaxChars?: number;
  },
): Promise<LocalShellExecutionResult> {
  const trimmedCommand = String(commandLine || "").trim();
  const cwd = path.resolve(options.cwd || ensureLocalCwd(options.allowedRoots));
  const timeoutMs = Math.max(1000, options.timeoutMs ?? LOCAL_SHELL_TIMEOUT_MS);
  const stdoutMaxChars = Math.max(
    500,
    options.stdoutMaxChars ?? LOCAL_SHELL_MAX_STDOUT_CHARS,
  );
  const stderrMaxChars = Math.max(
    500,
    options.stderrMaxChars ?? LOCAL_SHELL_MAX_STDERR_CHARS,
  );

  if (!trimmedCommand) {
    return {
      commandLine: "",
      cwd,
      exitCode: 1,
      stdout: "",
      stderr: "Comando vacio.",
      truncated: false,
      timedOut: false,
    };
  }

  const BLOCKED_SHELL_PATTERNS = [
    /:\(\)\s*\{.*\}\s*;/i, // fork bomb
    /\bdd\s+if=\/dev\/(zero|random)/i, // disk destroyer
    /\bmkfs\b/i, // filesystem formatting
    />\s*\/dev\/(sd[a-z]\d*|disk\d+)/i, // writes to raw disks
  ];
  for (const pattern of BLOCKED_SHELL_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return {
        commandLine: trimmedCommand,
        cwd,
        exitCode: 1,
        stdout: "",
        stderr: "Comando bloqueado por filtro de seguridad.",
        truncated: false,
        timedOut: false,
      };
    }
  }

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  try {
    const runResult = await execFileAsync(
      "/bin/bash",
      ["-lc", `set -o pipefail; ${trimmedCommand}`],
      {
        timeout: timeoutMs,
        maxBuffer: LOCAL_SHELL_MAX_BUFFER_BYTES,
        cwd,
        env: { ...process.env, HOME: os.homedir(), PWD: cwd },
      },
    );
    const rawStdout = String(runResult.stdout || "");
    const rawStderr = String(runResult.stderr || "");
    const stdout = rawStdout.slice(0, stdoutMaxChars);
    const stderr = rawStderr.slice(0, stderrMaxChars);
    const truncated =
      rawStdout.length > stdout.length || rawStderr.length > stderr.length;
    pushLocalCommandHistory(trimmedCommand, 0);
    return {
      commandLine: trimmedCommand,
      cwd,
      exitCode: 0,
      stdout,
      stderr,
      truncated,
      timedOut: false,
    };
  } catch (error: any) {
    const rawStdout = String(error?.stdout || "");
    const stderrFromProcess = String(error?.stderr || "");
    const rawExitCandidate = error?.code ?? error?.status;
    const parsedExitCandidate =
      typeof rawExitCandidate === "number"
        ? rawExitCandidate
        : Number.parseInt(String(rawExitCandidate ?? ""), 10);
    const hasKnownExitCode = Number.isFinite(parsedExitCandidate);
    const exitCode = hasKnownExitCode ? Number(parsedExitCandidate) : 1;
    const fallbackMessage = String(error?.message || "");
    const shouldUseFallbackMessage =
      !stderrFromProcess && !rawStdout && !hasKnownExitCode;
    const rawStderr =
      stderrFromProcess || (shouldUseFallbackMessage ? fallbackMessage : "");
    const stdout = rawStdout.slice(0, stdoutMaxChars);
    const stderr = rawStderr.slice(0, stderrMaxChars);
    const timedOut = Boolean(error?.killed);
    const truncated =
      rawStdout.length > stdout.length || rawStderr.length > stderr.length;
    pushLocalCommandHistory(trimmedCommand, exitCode);
    return {
      commandLine: trimmedCommand,
      cwd,
      exitCode,
      stdout,
      stderr,
      truncated,
      timedOut,
    };
  }
}

function tokenizeLocalCommand(input: string): string[] {
  const tokens: string[] = [];
  const tokenRegex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null = null;
  while ((match = tokenRegex.exec(input)) !== null) {
    const token = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (token) tokens.push(token);
  }
  return tokens;
}

function extractLocalToken(input: string): string | null {
  const match = String(input || "").match(LOCAL_TOKEN_RE);
  return match?.[1]?.trim() || null;
}

function parseConfiguredLocalRoot(rawRoot: string): string | null {
  const trimmed = rawRoot.trim();
  if (!trimmed) return null;
  if (/^desktop$/i.test(trimmed)) return LOCAL_ACTIONS_DEFAULT_ROOT;
  if (/^project$/i.test(trimmed)) return LOCAL_ACTIONS_PROJECT_ROOT;
  if (trimmed.startsWith("~/"))
    return path.resolve(path.join(os.homedir(), trimmed.slice(2)));
  return path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(LOCAL_ACTIONS_PROJECT_ROOT, trimmed);
}

function getAllowedLocalRoots(): string[] {
  const roots = new Set<string>([
    LOCAL_ACTIONS_DEFAULT_ROOT,
    LOCAL_ACTIONS_PROJECT_ROOT,
  ]);
  if (LOCAL_MAX_CONTROL_ENABLED) {
    roots.add(path.resolve("/"));
  }
  const rawRoots = process.env.ILIAGPT_LOCAL_ALLOWED_ROOTS;
  if (rawRoots) {
    for (const segment of rawRoots.split(",")) {
      const parsed = parseConfiguredLocalRoot(segment);
      if (parsed) roots.add(parsed);
    }
  }
  return Array.from(roots);
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);
  // Special-case filesystem root ("/" on macOS/Linux): every absolute path is inside it.
  if (resolvedRoot === path.parse(resolvedRoot).root) {
    return path.isAbsolute(resolvedTarget);
  }
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

function isAllowedLocalPath(
  targetPath: string,
  allowedRoots: string[],
): boolean {
  return allowedRoots.some((rootPath) =>
    isPathInsideRoot(targetPath, rootPath),
  );
}

function resolveLocalPath(
  rawPath: string | undefined,
  basePath: string = LOCAL_ACTIONS_DEFAULT_ROOT,
): string {
  const trimmed = String(rawPath || "").trim();
  if (!trimmed) return path.resolve(basePath);

  if (trimmed.startsWith("~/")) {
    return path.resolve(path.join(os.homedir(), trimmed.slice(2)));
  }

  const desktopAlias = trimmed.match(/^desktop:(.*)$/i);
  if (desktopAlias) {
    const relative = (desktopAlias[1] || "").trim().replace(/^[/\\]+/, "");
    return path.resolve(LOCAL_ACTIONS_DEFAULT_ROOT, relative);
  }

  const projectAlias = trimmed.match(/^project:(.*)$/i);
  if (projectAlias) {
    const relative = (projectAlias[1] || "").trim().replace(/^[/\\]+/, "");
    return path.resolve(LOCAL_ACTIONS_PROJECT_ROOT, relative);
  }

  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }

  return path.resolve(basePath, trimmed);
}

const LOCAL_FILE_READ_MAX_BYTES = 120_000;
const LOCAL_FILE_READ_MAX_CHARS = 16_000;
const LOCAL_FILE_WRITE_MAX_CHARS = 200_000;
const DESKTOP_FILE_CATEGORY_EXTENSIONS: Record<string, Set<string>> = {
  Documentos: new Set([
    ".pdf",
    ".doc",
    ".docx",
    ".rtf",
    ".odt",
    ".txt",
    ".md",
    ".markdown",
    ".pages",
    ".tex",
    ".ppt",
    ".pptx",
  ]),
  Datos: new Set([
    ".xls",
    ".xlsx",
    ".csv",
    ".tsv",
    ".ods",
    ".json",
    ".xml",
    ".yaml",
    ".yml",
    ".sql",
  ]),
  Imagenes: new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".svg",
    ".heic",
    ".tif",
    ".tiff",
    ".ico",
  ]),
  Videos: new Set([
    ".mp4",
    ".mov",
    ".mkv",
    ".avi",
    ".webm",
    ".flv",
    ".wmv",
    ".m4v",
  ]),
  Audio: new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".aiff"]),
  Comprimidos: new Set([
    ".zip",
    ".rar",
    ".7z",
    ".tar",
    ".gz",
    ".tgz",
    ".bz2",
    ".xz",
  ]),
  Codigo: new Set([
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".py",
    ".java",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".go",
    ".rs",
    ".php",
    ".rb",
    ".swift",
    ".kt",
    ".m",
    ".mm",
    ".cs",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
  ]),
  Instaladores: new Set([
    ".dmg",
    ".pkg",
    ".msi",
    ".exe",
    ".appimage",
    ".deb",
    ".rpm",
    ".apk",
  ]),
};
const DESKTOP_ORGANIZE_ROOT_FOLDERS = new Set([
  "Documentos",
  "Datos",
  "Imagenes",
  "Videos",
  "Audio",
  "Comprimidos",
  "Codigo",
  "Instaladores",
  "Otros",
  "Carpetas",
]);

function formatLocalBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx += 1;
  }
  const rounded =
    size >= 10 || unitIdx === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${rounded} ${units[unitIdx]}`;
}

const LOCAL_APP_ALIASES: Record<string, string> = {
  codex: "Antigravity",
  códex: "Antigravity",
  antigravity: "Antigravity",
  antigravit: "Antigravity",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  chrome: "Google Chrome",
  "google chrome": "Google Chrome",
  safari: "Safari",
  vscode: "Visual Studio Code",
  "visual studio code": "Visual Studio Code",
};

function normalizeLocalAppName(raw: string): string {
  const normalized = String(raw || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "")
    .slice(0, 80);
  if (!normalized) return "";
  const mapped = LOCAL_APP_ALIASES[normalized.toLowerCase()];
  return mapped || normalized;
}

function escapeAppleScriptStringLiteral(raw: string): string {
  return String(raw || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ");
}

function inferLocalMimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".heic") return "image/heic";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt" || ext === ".md") return "text/plain";
  if (ext === ".json") return "application/json";
  if (ext === ".csv") return "text/csv";
  if (ext === ".doc") return "application/msword";
  if (ext === ".docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".xlsx")
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".ppt") return "application/vnd.ms-powerpoint";
  if (ext === ".pptx")
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (ext === ".zip") return "application/zip";
  return "application/octet-stream";
}

function inferLocalArtifactTypeFromMime(
  mimeType: string,
): "image" | "document" | "spreadsheet" | "presentation" | "pdf" {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized === "application/pdf") return "pdf";
  if (
    normalized.includes("spreadsheet") ||
    normalized.includes("excel") ||
    normalized.includes("csv")
  )
    return "spreadsheet";
  if (normalized.includes("presentation") || normalized.includes("powerpoint"))
    return "presentation";
  return "document";
}

function buildLocalActionArtifact(
  payload?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const localPath = typeof payload.path === "string" ? payload.path.trim() : "";
  if (!localPath) return undefined;

  const mimeTypeRaw =
    typeof payload.mimeType === "string" ? payload.mimeType.trim() : "";
  const mimeType = mimeTypeRaw || inferLocalMimeTypeFromPath(localPath);
  const fileNameRaw =
    typeof payload.fileName === "string" ? payload.fileName.trim() : "";
  const fileName = fileNameRaw || path.basename(localPath);
  const artifactType = inferLocalArtifactTypeFromMime(mimeType);
  const localDownloadUrl = `/api/local/file?path=${encodeURIComponent(localPath)}`;

  return {
    artifactId: `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    type: artifactType,
    mimeType,
    name: fileName,
    filename: fileName,
    downloadUrl: localDownloadUrl,
    previewUrl: artifactType === "image" ? localDownloadUrl : undefined,
    path: localPath,
    sizeBytes: typeof payload.bytes === "number" ? payload.bytes : undefined,
    localControl: true,
  };
}

function isLikelyTextBuffer(buffer: Buffer): boolean {
  if (!buffer.length) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspiciousBytes = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13;
    if (isControl) suspiciousBytes += 1;
  }
  return suspiciousBytes / sample.length < 0.12;
}

function isProtectedLocalRootPath(
  targetPath: string,
  allowedRoots: string[],
): boolean {
  const resolvedTarget = path.resolve(targetPath);
  return allowedRoots.some(
    (rootPath) => path.resolve(rootPath) === resolvedTarget,
  );
}

function classifyDesktopFileCategory(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (!ext) return "Otros";
  for (const [category, extensions] of Object.entries(
    DESKTOP_FILE_CATEGORY_EXTENSIONS,
  )) {
    if (extensions.has(ext)) return category;
  }
  return "Otros";
}

function getDesktopFolderBucket(folderName: string): string {
  const first = folderName.trim().charAt(0);
  if (!first) return "_";
  const normalized = first
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  return /^[A-Z]$/.test(normalized) ? normalized : "_";
}

async function resolveUniqueLocalDestinationPath(
  targetPath: string,
): Promise<string> {
  const directory = path.dirname(targetPath);
  const extension = path.extname(targetPath);
  const baseName = path.basename(targetPath, extension);
  let attempt = 0;
  while (attempt < 5000) {
    const candidate =
      attempt === 0
        ? targetPath
        : path.join(directory, `${baseName} (${attempt})${extension}`);
    try {
      await fs.stat(candidate);
      attempt += 1;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return candidate;
      throw error;
    }
  }
  return path.join(directory, `${baseName}-${Date.now()}${extension}`);
}

async function moveLocalPathSafe(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "EXDEV") throw error;
    await fs.cp(sourcePath, destinationPath, { recursive: true });
    await fs.rm(sourcePath, { recursive: true, force: false });
  }
}

async function readLocalControlState(): Promise<LocalControlState> {
  try {
    const raw = await fs.readFile(LOCAL_ACTION_STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LocalControlState>;
    if (typeof parsed.disabled === "boolean") {
      return {
        disabled: parsed.disabled,
        updatedAt:
          typeof parsed.updatedAt === "string"
            ? parsed.updatedAt
            : new Date(0).toISOString(),
        updatedBy:
          typeof parsed.updatedBy === "string" ? parsed.updatedBy : undefined,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
      };
    }
  } catch {
    // File not found/invalid: treat as enabled.
  }
  return {
    disabled: false,
    updatedAt: new Date(0).toISOString(),
  };
}

async function writeLocalControlState(
  disabled: boolean,
  updatedBy: string,
  reason: string,
): Promise<LocalControlState> {
  const nextState: LocalControlState = {
    disabled,
    updatedAt: new Date().toISOString(),
    updatedBy,
    reason,
  };
  await fs.writeFile(
    LOCAL_ACTION_STATE_PATH,
    JSON.stringify(nextState, null, 2),
    "utf-8",
  );
  return nextState;
}

async function appendLocalControlAudit(
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...payload,
  });
  try {
    await fs.appendFile(LOCAL_ACTION_AUDIT_LOG_PATH, `${line}\n`, "utf-8");
  } catch (error) {
    console.warn(
      "[LocalControl] audit append failed:",
      (error as Error)?.message || error,
    );
  }
}

async function readLocalControlAuditTail(
  limit = 30,
): Promise<Array<Record<string, unknown>>> {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(200, limit))
    : 30;
  let stat;
  try {
    stat = await fs.stat(LOCAL_ACTION_AUDIT_LOG_PATH);
  } catch {
    return [];
  }
  if (!stat.isFile() || stat.size <= 0) return [];

  const maxBytes = Math.min(Number(stat.size), 900_000);
  const start = Math.max(0, Number(stat.size) - maxBytes);
  const handle = await fs.open(LOCAL_ACTION_AUDIT_LOG_PATH, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, start);
    const text = buffer.subarray(0, bytesRead).toString("utf-8");
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const parsed = lines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => !!entry);
    return parsed.slice(-safeLimit);
  } finally {
    await handle.close();
  }
}

function formatLocalControlAuditLine(
  entry: Record<string, unknown>,
  idx: number,
): string {
  const ts = String(entry.ts || "").trim() || "sin-fecha";
  const event = String(entry.event || "evento").trim();
  const interesting = [
    entry.command,
    entry.tool,
    entry.appName,
    entry.targetPath,
    entry.path,
    entry.cwd,
    entry.fileName,
    entry.url,
  ].find(
    (value) => typeof value === "string" && String(value).trim().length > 0,
  );
  const detail = interesting ? ` · ${String(interesting).slice(0, 180)}` : "";
  return `${idx + 1}. [${ts}] ${event}${detail}`;
}

function buildLocalHelpText(): string {
  const tokenHint = LOCAL_ACTION_ADMIN_TOKEN
    ? "Incluye token=<tu_token> en comandos de ejecucion."
    : "Tip: configura ILIAGPT_LOCAL_ACTION_TOKEN para requerir token admin.";
  return [
    "=== Control Local ILIAGPT — 47 Comandos ===\n",
    "📂 Archivos:",
    "  ls [ruta] • mkdir <ruta> • touch <archivo> • read <archivo>",
    '  write <archivo> "contenido" • append <archivo> "contenido"',
    '  replace <archivo> "buscar" "reemplazo" confirmar',
    "  mv <origen> <destino> • rename <origen> <nuevo> • rm <ruta> confirmar",
    "  cp <origen> <destino> • stat <ruta> • find <patron> [ruta]",
    "  grep <patron> <archivo|ruta> • tree [ruta] • chmod <permisos> <ruta> • organize_desktop [all|files|folders]",
    "  diff <archivo1> <archivo2> • sendfile <archivo>\n",
    "💻 Terminal:",
    "  shell <comando> • cd <ruta> • pwd • history",
    "  history audit [n] (registro de acciones locales + shell)",
    "  python <codigo|archivo> • node <codigo|archivo> • script <archivo>",
    "  open <app|archivo> • appwrite <app> <texto> [--enter] • env [VAR=valor] • which <programa>\n",
    "📊 Sistema:",
    "  sysinfo • ps • kill <PID> • ports • top • du <ruta> • monitor\n",
    "🌐 Capturas:",
    "  screenshot • windowshot <app> [indice] • webshot <url>\n",
    "📦 Paquetes:",
    "  npm <subcomando> • pip <subcomando> • brew <subcomando>\n",
    "🔧 Git:",
    '  git status • git add . • git commit -m "msg" • git push',
    "  git pull • git diff • git log • git branch\n",
    "🐳 Docker:",
    "  docker ps • docker images • docker run <image> <cmd>",
    "  docker stop <id> • docker rm <id>\n",
    "⚙️ Control:",
    "  help • status • DETENEROFF • DETENERON token=<token> confirmar\n",
    "Lenguaje natural soportado:",
    '  "muéstrame los procesos" • "qué puertos están abiertos"',
    '  "mata el proceso 1234" • "busca archivos .txt en mi escritorio"',
    '  "git status" • "instala express con npm"',
    '  "ejecuta en python: print(2+2)" • "ve a la carpeta /tmp"',
    "",
    LOCAL_MAX_CONTROL_ENABLED
      ? "🟢 Modo max-control activo: rutas de sistema permitidas."
      : "🔴 Modo restringido: limita rutas con ILIAGPT_LOCAL_ALLOWED_ROOTS.",
    tokenHint,
  ].join("\n");
}

function parseLocalControlRequest(input: string): LocalControlRequest | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const tokenFromRaw = extractLocalToken(raw);
  const confirmFromRaw = LOCAL_CONFIRM_RE.test(raw);

  if (/^(?:deteneroff|deterneroff)\b/i.test(raw)) {
    return {
      command: "deteneroff",
      args: [],
      token: tokenFromRaw,
      confirm: confirmFromRaw,
      raw,
      source: "kill_switch",
    };
  }

  if (/^(?:deteneron|deterneron)\b/i.test(raw)) {
    return {
      command: "deteneron",
      args: [],
      token: tokenFromRaw,
      confirm: confirmFromRaw,
      raw,
      source: "kill_switch",
    };
  }

  const prefixedMatch = raw.match(/^(?:\/local|local:)\s*(.*)$/i);
  if (!prefixedMatch) {
    // ── Natural language detection for ALL local commands ──

    // 1. mkdir — "crea una carpeta llamada X en mi escritorio"
    const folderName = extractDesktopFolderNameFromPrompt(raw);
    if (folderName) {
      return {
        command: "mkdir",
        args: [folderName],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 1.5 organize_desktop — "ordena/organiza mi escritorio"
    const organizeDesktopIntent = extractNaturalOrganizeDesktopIntent(raw);
    if (organizeDesktopIntent) {
      return {
        command: "organize_desktop",
        args: [organizeDesktopIntent.mode],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 2. rm — "elimina/borra/delete la carpeta/archivo X"
    const rmIntent = extractNaturalRmIntent(raw);
    if (rmIntent) {
      return {
        command: "rm",
        args: [rmIntent],
        token: tokenFromRaw,
        confirm: true,
        raw,
        source: "natural",
      };
    }

    // 2.5 sendfile — "mándame/envíame el archivo X"
    const sendFileIntent = extractNaturalSendFileIntent(raw);
    if (sendFileIntent) {
      return {
        command: "sendfile",
        args: [sendFileIntent],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 3. read — "lee/muéstrame/abre el archivo X" / "qué contiene X"
    const readIntent = extractNaturalReadIntent(raw);
    if (readIntent) {
      return {
        command: "read",
        args: [readIntent],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 3.5 Capability query — MUST be checked BEFORE shell intent to avoid "puedes ejecutar comandos" matching shell
    if (isCapabilityQuery(raw)) {
      return {
        command: "capabilities" as LocalControlCommand,
        args: [],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 3.6 appwrite — "escribe en codex ..."
    const appWriteIntent = extractNaturalAppWriteIntent(raw);
    if (appWriteIntent) {
      return {
        command: "appwrite",
        args: [
          appWriteIntent.appName,
          appWriteIntent.text,
          appWriteIntent.pressEnter ? "--enter" : "",
        ].filter(Boolean),
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 3.7 windowshot — "captura de WhatsApp"
    const windowshotIntent = extractNaturalWindowshotIntent(raw);
    if (windowshotIntent) {
      return {
        command: "windowshot",
        args: [windowshotIntent.appName],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 3.8 screenshot/webshot — "haz una captura", "captura ejemplo.com"
    const screenshotIntent = extractNaturalScreenshotIntent(raw);
    if (screenshotIntent) {
      if (screenshotIntent.url) {
        return {
          command: "webshot",
          args: [screenshotIntent.url],
          token: tokenFromRaw,
          confirm: confirmFromRaw,
          raw,
          source: "natural",
        };
      }
      return {
        command: "screenshot",
        args: [],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 4. shell — "ejecuta/corre/run el comando X" / "en la terminal haz X"
    const shellIntent = extractNaturalShellIntent(raw);
    if (shellIntent) {
      return {
        command: "shell",
        args: [shellIntent],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 5. sysinfo — "info del sistema" / "cuanta memoria" / "espacio en disco"
    const sysinfoIntent = extractNaturalSysinfoIntent(raw);
    if (sysinfoIntent) {
      return {
        command: "sysinfo",
        args: [],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 6. write — "crea un archivo X con el contenido Y"
    const writeIntent = extractNaturalWriteIntent(raw);
    if (writeIntent) {
      return {
        command: "write",
        args: [writeIntent.path, writeIntent.content],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 7. ls — "muéstrame los archivos de mi escritorio" / "lista las carpetas"
    const lsIntent = extractNaturalLsIntent(raw);
    if (lsIntent) {
      return {
        command: "ls",
        args: lsIntent ? [lsIntent] : [],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 8. ps — "muéstrame los procesos" / "qué procesos están corriendo"
    if (extractNaturalPsIntent(raw)) {
      return {
        command: "ps",
        args: [],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 9. kill — "mata el proceso X" / "kill 1234"
    const killIntent = extractNaturalKillIntent(raw);
    if (killIntent) {
      return {
        command: "kill",
        args: [killIntent.pid || killIntent.name || ""],
        token: tokenFromRaw,
        confirm: true,
        raw,
        source: "natural",
      };
    }

    // 10. ports — "qué puertos están abiertos"
    if (extractNaturalPortsIntent(raw)) {
      return {
        command: "ports",
        args: [],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 11. git — "git status" / "haz un commit con mensaje X"
    const gitIntent = extractNaturalGitIntent(raw);
    if (gitIntent) {
      return {
        command: "git",
        args: [gitIntent],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 12. docker — "docker ps" / "contenedores activos"
    const dockerIntent = extractNaturalDockerIntent(raw);
    if (dockerIntent) {
      return {
        command: "docker",
        args: [dockerIntent],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 13. install — "instala express con npm" / "pip install numpy"
    const installIntent = extractNaturalInstallIntent(raw);
    if (installIntent) {
      const cmd =
        installIntent.manager === "pip"
          ? "pip"
          : installIntent.manager === "brew"
            ? "brew"
            : "npm";
      return {
        command: cmd as LocalControlCommand,
        args: ["install", ...installIntent.packages],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 14. script — "ejecuta el script test.py" / "corre main.js"
    const scriptIntent = extractNaturalScriptIntent(raw);
    if (scriptIntent) {
      return {
        command: "script",
        args: [scriptIntent.file],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 15. find — "busca archivos .txt en mi escritorio"
    const findIntent = extractNaturalFindIntent(raw);
    if (findIntent) {
      const findArgs = [findIntent.pattern];
      if (findIntent.dir) findArgs.push(findIntent.dir);
      return {
        command: "find",
        args: findArgs,
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 16. cd — "ve a la carpeta X" / "cd /tmp"
    const cdIntent = extractNaturalCdIntent(raw);
    if (cdIntent) {
      return {
        command: "cd",
        args: [cdIntent],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 17. python inline — "python: print(2+2)"
    const pythonIntent = extractNaturalPythonIntent(raw);
    if (pythonIntent) {
      return {
        command: "python",
        args: [pythonIntent],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 18. node inline — "node: console.log('hello')"
    const nodeIntent = extractNaturalNodeIntent(raw);
    if (nodeIntent) {
      return {
        command: "node",
        args: [nodeIntent],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    // 19. direct terminal line — "git status", "npm run dev", "docker ps", etc.
    // Route to dedicated handlers when possible
    const directCmdMatch = raw.match(/^(git|npm|pip|pip3|brew|docker)\s+(.*)/i);
    if (directCmdMatch) {
      const tool = directCmdMatch[1]
        .toLowerCase()
        .replace("pip3", "pip") as LocalControlCommand;
      const subArgs = directCmdMatch[2]?.trim() || "";
      return {
        command: tool,
        args: subArgs ? [subArgs] : [],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }
    // Other direct commands route to shell
    if (
      /^(?:python3?|node|bash|sh|ps|top|du|which|find|grep|tree|open|kill|ports|lsof)\b/i.test(
        raw,
      )
    ) {
      return {
        command: "shell",
        args: [raw],
        token: tokenFromRaw,
        confirm: confirmFromRaw,
        raw,
        source: "natural",
      };
    }

    return null;
  }

  let commandBody = String(prefixedMatch[1] || "").trim();
  const token = extractLocalToken(commandBody);
  const confirm = LOCAL_CONFIRM_RE.test(commandBody);
  commandBody = commandBody
    .replace(/\btoken=[^\s]+\b/gi, " ")
    .replace(/\b(?:confirmar|confirm|--confirm)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = tokenizeLocalCommand(commandBody);
  if (!tokens.length) {
    return {
      command: "help",
      args: [],
      token,
      confirm,
      raw,
      source: "prefixed",
    };
  }

  const operation = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  const commandAliasMap: Record<string, LocalControlCommand> = {
    help: "help",
    ayuda: "help",
    status: "status",
    estado: "status",
    ls: "ls",
    dir: "ls",
    listar: "ls",
    mkdir: "mkdir",
    carpeta: "mkdir",
    "crear-carpeta": "mkdir",
    touch: "touch",
    mkfile: "touch",
    archivo: "touch",
    "crear-archivo": "touch",
    cat: "read",
    read: "read",
    leer: "read",
    write: "write",
    escribir: "write",
    guardar: "write",
    append: "append",
    anexar: "append",
    agregar: "append",
    replace: "replace",
    reemplazar: "replace",
    sustituir: "replace",
    stat: "stat",
    detalle: "stat",
    metadata: "stat",
    mv: "mv",
    mover: "mv",
    rename: "rename",
    renombrar: "rename",
    rm: "rm",
    del: "rm",
    delete: "rm",
    borrar: "rm",
    eliminar: "rm",
    sysinfo: "sysinfo",
    sistema: "sysinfo",
    infoequipo: "sysinfo",
    info_pc: "sysinfo",
    info: "sysinfo",
    shell: "shell",
    sh: "shell",
    bash: "shell",
    exec: "shell",
    ejecutar: "shell",
    comando: "shell",
    terminal: "shell",
    cp: "cp",
    copy: "cp",
    copiar: "cp",
    copia: "cp",
    organize: "organize_desktop",
    organize_desktop: "organize_desktop",
    organizar: "organize_desktop",
    organiza: "organize_desktop",
    ordenar: "organize_desktop",
    ordena: "organize_desktop",
    clasificar: "organize_desktop",
    clasifica: "organize_desktop",
    "ordenar-escritorio": "organize_desktop",
    "organizar-escritorio": "organize_desktop",
    // ── New commands ──
    ps: "ps",
    procesos: "ps",
    processes: "ps",
    kill: "kill",
    matar: "kill",
    terminar: "kill",
    ports: "ports",
    puertos: "ports",
    listening: "ports",
    find: "find",
    buscar: "find",
    search: "find",
    grep: "grep",
    "buscar-contenido": "grep",
    tree: "tree",
    arbol: "tree",
    árbol: "tree",
    chmod: "chmod",
    permisos: "chmod",
    diff: "diff",
    comparar: "diff",
    compare: "diff",
    python: "python",
    py: "python",
    python3: "python",
    node: "node",
    js: "node",
    script: "script",
    "ejecutar-script": "script",
    run: "script",
    correr: "script",
    npm: "npm",
    pip: "pip",
    pip3: "pip",
    brew: "brew",
    homebrew: "brew",
    git: "git",
    docker: "docker",
    contenedor: "docker",
    container: "docker",
    cd: "cd",
    ir: "cd",
    cambiar: "cd",
    pwd: "pwd",
    donde: "pwd",
    "directorio-actual": "pwd",
    history: "history",
    historial: "history",
    monitor: "monitor",
    monitorear: "monitor",
    open: "open",
    abrir: "open",
    "abrir-app": "open",
    appwrite: "appwrite",
    escribir_app: "appwrite",
    "escribir-app": "appwrite",
    teclear: "appwrite",
    type: "appwrite",
    env: "env",
    variables: "env",
    entorno: "env",
    top: "top",
    du: "du",
    tamano: "du",
    tamaño: "du",
    which: "which",
    "donde-esta": "which",
    "donde-está": "which",
    df: "shell",
    disco: "shell",
    deteneroff: "deteneroff",
    deterneroff: "deteneroff",
    deteneron: "deteneron",
    deterneron: "deteneron",
    // ── macOS native aliases ──
    volume: "volume",
    volumen: "volume",
    "set-volume": "volume",
    "subir-volumen": "volume",
    "bajar-volumen": "volume",
    mute: "volume",
    unmute: "volume",
    brightness: "brightness",
    brillo: "brightness",
    darkmode: "darkmode",
    "dark-mode": "darkmode",
    "modo-oscuro": "darkmode",
    oscuro: "darkmode",
    wifi: "wifi",
    bluetooth: "bluetooth",
    bt: "bluetooth",
    battery: "battery",
    bateria: "battery",
    batería: "battery",
    lock: "lock",
    bloquear: "lock",
    "bloquear-pantalla": "lock",
    screenshot: "screenshot",
    captura: "screenshot",
    "captura-pantalla": "screenshot",
    pantallazo: "screenshot",
    foto: "screenshot",
    fotografia: "screenshot",
    fotografía: "screenshot",
    webshot: "webshot",
    "web-shot": "webshot",
    screenshot_web: "webshot",
    "captura-web": "webshot",
    capturaweb: "webshot",
    windowshot: "windowshot",
    "window-shot": "windowshot",
    "captura-app": "windowshot",
    capturaapp: "windowshot",
    appshot: "windowshot",
    clipboard: "clipboard",
    portapapeles: "clipboard",
    copiar_clipboard: "clipboard",
    pegar: "clipboard",
    notify: "notify",
    notificar: "notify",
    notificacion: "notify",
    notificación: "notify",
    alerta: "notify",
    say: "say",
    decir: "say",
    hablar: "say",
    calendar: "calendar",
    calendario: "calendar",
    eventos: "calendar",
    contacts: "contacts",
    contactos: "contacts",
    reminders: "reminders",
    recordatorios: "reminders",
    spotlight: "spotlight",
    buscar_spotlight: "spotlight",
    search_spotlight: "spotlight",
    shortcut: "shortcut",
    shortcuts: "shortcut",
    atajo: "shortcut",
    atajos: "shortcut",
    music: "music",
    musica: "music",
    música: "music",
    spotify: "music",
    apps: "apps",
    aplicaciones: "apps",
    windows: "windows",
    ventanas: "windows",
    finder: "finder",
    sendfile: "sendfile",
    "send-file": "sendfile",
    "enviar-archivo": "sendfile",
    "mandar-archivo": "sendfile",
    osascript: "osascript",
    applescript: "osascript",
  };
  const command: LocalControlCommand = commandAliasMap[operation] || "help";

  return {
    command,
    args,
    token,
    confirm,
    raw,
    source: "prefixed",
  };
}

function localErrorResult(
  statusCode: number,
  code: string,
  message: string,
  payload?: Record<string, unknown>,
): LocalControlResult {
  return {
    handled: true,
    ok: false,
    statusCode,
    code,
    message,
    payload,
  };
}

function localSuccessResult(
  code: string,
  message: string,
  payload?: Record<string, unknown>,
): LocalControlResult {
  return {
    handled: true,
    ok: true,
    statusCode: 200,
    code,
    message,
    payload,
  };
}

export async function executeLocalControlRequest(
  input: string,
  context: { requestId: string; userId?: string | null },
): Promise<LocalControlResult> {
  const parsed = parseLocalControlRequest(input);
  if (!parsed) {
    if (looksLikeDesktopFolderIntent(input)) {
      return localErrorResult(
        400,
        "LOCAL_FOLDER_NAME_NOT_DETECTED",
        "Detecte una orden de crear carpeta, pero no pude leer el nombre. Usa: crea una carpeta con nombre <nombre> en mi escritorio.",
      );
    }
    return { handled: false };
  }

  if (!isLocalDesktopActionsEnabled()) {
    return localErrorResult(
      403,
      "LOCAL_ACTIONS_DISABLED",
      "Las acciones locales estan desactivadas. Activa ILIAGPT_ENABLE_LOCAL_DESKTOP_ACTIONS=true.",
    );
  }

  const actor = (context.userId || "anonymous").slice(0, 120);
  const allowedRoots = getAllowedLocalRoots();
  const tokenRequired = LOCAL_ACTION_ADMIN_TOKEN.length > 0;
  const requiresAdminToken = !["help", "status", "deteneroff"].includes(
    parsed.command,
  );

  if (
    tokenRequired &&
    requiresAdminToken &&
    parsed.token !== LOCAL_ACTION_ADMIN_TOKEN
  ) {
    await appendLocalControlAudit("local_control_denied", {
      requestId: context.requestId,
      userId: actor,
      command: parsed.command,
      reason: "invalid_token",
    });
    return localErrorResult(
      401,
      "LOCAL_ACTION_INVALID_TOKEN",
      "Token admin inválido. Usa token=<tu_token>.",
    );
  }

  if (parsed.command === "help") {
    return localSuccessResult("LOCAL_HELP", buildLocalHelpText(), {
      command: parsed.command,
      allowedRoots,
      tokenRequired,
    });
  }

  if (parsed.command === "capabilities") {
    return localSuccessResult("LOCAL_CAPABILITIES", buildCapabilityResponse(), {
      command: "capabilities",
    });
  }

  if (parsed.command === "deteneroff") {
    const next = await writeLocalControlState(true, actor, "manual_deteneroff");
    await appendLocalControlAudit("local_control_disabled", {
      requestId: context.requestId,
      userId: actor,
      command: parsed.command,
      state: next,
    });
    return localSuccessResult(
      "LOCAL_ACTIONS_DISABLED_BY_KILL_SWITCH",
      "Kill switch activado (DETENEROFF). Las acciones locales quedaron deshabilitadas.",
    );
  }

  const controlState = await readLocalControlState();
  if (parsed.command === "status") {
    const statusText = controlState.disabled ? "DESHABILITADAS" : "HABILITADAS";
    return localSuccessResult("LOCAL_STATUS", `Estado actual: ${statusText}.`, {
      command: parsed.command,
      state: controlState,
      allowedRoots,
      tokenRequired,
    });
  }

  if (controlState.disabled && parsed.command !== "deteneron") {
    return localErrorResult(
      423,
      "LOCAL_ACTIONS_KILL_SWITCH_ACTIVE",
      "Las acciones locales estan bloqueadas por DETENEROFF. Usa DETENERON token=<token> confirmar para reactivarlas.",
    );
  }

  if (parsed.command === "deteneron") {
    if (!parsed.confirm) {
      return localErrorResult(
        400,
        "LOCAL_CONFIRM_REQUIRED",
        "Confirma la reapertura con: DETENERON token=<token> confirmar",
      );
    }
    const next = await writeLocalControlState(false, actor, "manual_deteneron");
    await appendLocalControlAudit("local_control_enabled", {
      requestId: context.requestId,
      userId: actor,
      command: parsed.command,
      state: next,
    });
    return localSuccessResult(
      "LOCAL_ACTIONS_ENABLED",
      "Kill switch desactivado (DETENERON). Las acciones locales volvieron a habilitarse.",
    );
  }

  const commandRequiresConfirm = [
    "mv",
    "rename",
    "rm",
    "replace",
    "kill",
    "chmod",
  ].includes(parsed.command);
  if (commandRequiresConfirm && !parsed.confirm) {
    return localErrorResult(
      400,
      "LOCAL_CONFIRM_REQUIRED",
      "Esta accion requiere confirmacion. Repite con la palabra confirmar.",
    );
  }

  try {
    if (parsed.command === "mkdir") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local mkdir <ruta>",
        );
      }
      const normalizedTargetRaw = targetRaw.trim();
      const targetForValidation = normalizedTargetRaw.replace(
        /^(desktop|project):/i,
        "",
      );
      const targetPath = resolveLocalPath(
        targetRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }
      if (
        /[\\*?"<>|]/.test(targetForValidation) ||
        targetForValidation.includes("..") ||
        /:[^/\\]/.test(targetForValidation)
      ) {
        return localErrorResult(
          400,
          "LOCAL_INVALID_FOLDER_NAME",
          "Nombre o ruta de carpeta inválida.",
        );
      }

      await fs.mkdir(targetPath, { recursive: true });
      await appendLocalControlAudit("local_control_mkdir", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
      });
      return localSuccessResult(
        "LOCAL_MKDIR_OK",
        `Carpeta creada: ${targetPath}`,
        {
          command: parsed.command,
          path: targetPath,
        },
      );
    }

    if (parsed.command === "ls") {
      const targetRaw = parsed.args[0] || "desktop:";
      const targetPath = resolveLocalPath(
        targetRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }
      const stat = await fs.stat(targetPath);
      if (!stat.isDirectory()) {
        return localErrorResult(
          400,
          "LOCAL_NOT_DIRECTORY",
          "La ruta indicada no es un directorio.",
        );
      }
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const sorted = entries
        .map(
          (entry) =>
            `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`,
        )
        .sort((a, b) => a.localeCompare(b, "es"));
      const maxItems = 80;
      const shown = sorted.slice(0, maxItems);
      const remainder =
        sorted.length > shown.length
          ? `\n... y ${sorted.length - shown.length} elemento(s) mas.`
          : "";
      const listingText = shown.join("\n") || "(directorio vacio)";
      const message = `Contenido de ${targetPath}:\n${listingText}${remainder}`;
      await appendLocalControlAudit("local_control_ls", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        total: sorted.length,
      });
      return localSuccessResult("LOCAL_LS_OK", message, {
        command: parsed.command,
        path: targetPath,
        total: sorted.length,
      });
    }

    if (parsed.command === "organize_desktop") {
      const modeRaw = String(parsed.args[0] || "all")
        .trim()
        .toLowerCase();
      const mode: DesktopOrganizationMode =
        modeRaw === "files" || modeRaw === "folders" || modeRaw === "all"
          ? modeRaw
          : "all";
      const desktopPath = LOCAL_ACTIONS_DEFAULT_ROOT;
      if (!isAllowedLocalPath(desktopPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "El escritorio no esta dentro de las rutas permitidas.",
        );
      }

      const desktopStat = await fs.stat(desktopPath).catch((error) => {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") return null;
        throw error;
      });
      if (!desktopStat || !desktopStat.isDirectory()) {
        return localErrorResult(
          404,
          "LOCAL_DESKTOP_NOT_FOUND",
          "No se encontro la carpeta de escritorio.",
        );
      }

      const entries = await fs.readdir(desktopPath, { withFileTypes: true });
      const shouldMoveFiles = mode === "all" || mode === "files";
      const shouldMoveFolders = mode === "all" || mode === "folders";
      const createdDirectories = new Set<string>();
      const movedItems: Array<{
        kind: "file" | "folder";
        name: string;
        from: string;
        to: string;
      }> = [];
      let skippedCount = 0;

      for (const entry of entries) {
        if (entry.name.startsWith(".")) {
          skippedCount += 1;
          continue;
        }

        const sourcePath = path.join(desktopPath, entry.name);
        if (entry.isDirectory()) {
          if (
            !shouldMoveFolders ||
            DESKTOP_ORGANIZE_ROOT_FOLDERS.has(entry.name)
          )
            continue;
          const bucket = getDesktopFolderBucket(entry.name);
          const destinationDirectory = path.join(
            desktopPath,
            "Carpetas",
            bucket,
          );
          await fs.mkdir(destinationDirectory, { recursive: true });
          createdDirectories.add(destinationDirectory);
          const destinationPath = await resolveUniqueLocalDestinationPath(
            path.join(destinationDirectory, entry.name),
          );
          await moveLocalPathSafe(sourcePath, destinationPath);
          movedItems.push({
            kind: "folder",
            name: entry.name,
            from: sourcePath,
            to: destinationPath,
          });
          continue;
        }

        if (entry.isFile()) {
          if (!shouldMoveFiles) continue;
          const category = classifyDesktopFileCategory(entry.name);
          const destinationDirectory = path.join(desktopPath, category);
          await fs.mkdir(destinationDirectory, { recursive: true });
          createdDirectories.add(destinationDirectory);
          const destinationPath = await resolveUniqueLocalDestinationPath(
            path.join(destinationDirectory, entry.name),
          );
          await moveLocalPathSafe(sourcePath, destinationPath);
          movedItems.push({
            kind: "file",
            name: entry.name,
            from: sourcePath,
            to: destinationPath,
          });
          continue;
        }

        skippedCount += 1;
      }

      const movedFiles = movedItems.filter(
        (item) => item.kind === "file",
      ).length;
      const movedFolders = movedItems.length - movedFiles;
      const movedPreview = movedItems
        .slice(0, 20)
        .map((item) => {
          const relativeTo = path.relative(desktopPath, item.to) || item.to;
          return `• ${item.name} -> ${relativeTo}`;
        })
        .join("\n");
      const overflow =
        movedItems.length > 20
          ? `\n... y ${movedItems.length - 20} elemento(s) mas.`
          : "";
      const summary = movedItems.length
        ? [
            `Escritorio organizado (${mode}).`,
            `Movidos: ${movedItems.length} elemento(s) (${movedFiles} archivos, ${movedFolders} carpetas).`,
            `Directorios creados: ${createdDirectories.size}.`,
            skippedCount > 0 ? `Ignorados: ${skippedCount} elemento(s).` : "",
            "",
            movedPreview + overflow,
          ]
            .filter(Boolean)
            .join("\n")
        : `No habia elementos para reorganizar en ${desktopPath}.`;

      await appendLocalControlAudit("local_control_organize_desktop", {
        requestId: context.requestId,
        userId: actor,
        path: desktopPath,
        mode,
        movedFiles,
        movedFolders,
        movedTotal: movedItems.length,
        createdDirectories: createdDirectories.size,
        skippedCount,
      });

      return localSuccessResult("LOCAL_ORGANIZE_DESKTOP_OK", summary, {
        command: parsed.command,
        path: desktopPath,
        mode,
        movedFiles,
        movedFolders,
        movedTotal: movedItems.length,
        createdDirectories: createdDirectories.size,
        skippedCount,
      });
    }

    if (parsed.command === "sysinfo") {
      const cpus = os.cpus();
      const cpuModel = cpus[0]?.model || "unknown";
      const message = [
        `Sistema: ${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
        `Host: ${os.hostname()}`,
        `Node: ${process.version}`,
        `CPU: ${cpuModel} x${cpus.length}`,
        `Memoria libre: ${formatLocalBytes(os.freemem())} / Total: ${formatLocalBytes(os.totalmem())}`,
        `Uptime (s): ${Math.floor(os.uptime())}`,
        `Home: ${os.homedir()}`,
        `Proyecto: ${LOCAL_ACTIONS_PROJECT_ROOT}`,
        `Roots permitidos: ${allowedRoots.join(", ")}`,
      ].join("\n");
      await appendLocalControlAudit("local_control_sysinfo", {
        requestId: context.requestId,
        userId: actor,
      });
      return localSuccessResult("LOCAL_SYSINFO_OK", message, {
        command: parsed.command,
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        nodeVersion: process.version,
      });
    }

    if (parsed.command === "stat") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local stat <ruta>",
        );
      }
      const targetPath = resolveLocalPath(
        targetRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }
      let targetStat;
      try {
        targetStat = await fs.stat(targetPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return localErrorResult(404, "LOCAL_NOT_FOUND", "La ruta no existe.");
        }
        throw error;
      }
      const type = targetStat.isDirectory()
        ? "directory"
        : targetStat.isFile()
          ? "file"
          : "other";
      const details = [
        `Ruta: ${targetPath}`,
        `Tipo: ${type}`,
        `Tamano: ${formatLocalBytes(targetStat.size)} (${targetStat.size} bytes)`,
        `Creado: ${targetStat.birthtime.toISOString()}`,
        `Modificado: ${targetStat.mtime.toISOString()}`,
      ];
      if (targetStat.isDirectory()) {
        try {
          const entries = await fs.readdir(targetPath);
          details.push(`Elementos: ${entries.length}`);
        } catch {
          details.push("Elementos: no disponible");
        }
      }
      await appendLocalControlAudit("local_control_stat", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
      });
      return localSuccessResult("LOCAL_STAT_OK", details.join("\n"), {
        command: parsed.command,
        path: targetPath,
        type,
        size: targetStat.size,
      });
    }

    if (parsed.command === "touch") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local touch <ruta_archivo>",
        );
      }
      const targetPath = resolveLocalPath(
        targetRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }
      let existed = false;
      try {
        const beforeStat = await fs.stat(targetPath);
        if (beforeStat.isDirectory()) {
          return localErrorResult(
            400,
            "LOCAL_IS_DIRECTORY",
            "La ruta apunta a un directorio. Usa una ruta de archivo.",
          );
        }
        existed = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw error;
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      const handle = await fs.open(targetPath, "a");
      await handle.close();
      const now = new Date();
      await fs.utimes(targetPath, now, now).catch(() => undefined);

      await appendLocalControlAudit("local_control_touch", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        existed,
      });
      return localSuccessResult(
        "LOCAL_TOUCH_OK",
        existed
          ? `Archivo actualizado: ${targetPath}`
          : `Archivo creado: ${targetPath}`,
        {
          command: parsed.command,
          path: targetPath,
          existed,
        },
      );
    }

    if (parsed.command === "read") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local read <ruta_archivo>",
        );
      }
      const targetPath = resolveLocalPath(
        targetRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }
      let targetStat;
      try {
        targetStat = await fs.stat(targetPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return localErrorResult(
            404,
            "LOCAL_NOT_FOUND",
            "El archivo no existe.",
          );
        }
        throw error;
      }
      if (!targetStat.isFile()) {
        return localErrorResult(
          400,
          "LOCAL_NOT_FILE",
          "La ruta indicada no es un archivo.",
        );
      }

      const bytesToRead = Math.min(
        Number(targetStat.size) || 0,
        LOCAL_FILE_READ_MAX_BYTES,
      );
      let chunk = Buffer.alloc(0);
      if (bytesToRead > 0) {
        const handle = await fs.open(targetPath, "r");
        try {
          const buffer = Buffer.alloc(bytesToRead);
          const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
          chunk = buffer.subarray(0, bytesRead);
        } finally {
          await handle.close();
        }
      }

      if (!isLikelyTextBuffer(chunk)) {
        return localSuccessResult(
          "LOCAL_READ_BINARY",
          `El archivo parece binario: ${targetPath} (${formatLocalBytes(targetStat.size)}).`,
          {
            command: parsed.command,
            path: targetPath,
            size: targetStat.size,
            binary: true,
          },
        );
      }

      let text = chunk.toString("utf-8");
      const wasByteTruncated = targetStat.size > bytesToRead;
      let wasCharTruncated = false;
      if (text.length > LOCAL_FILE_READ_MAX_CHARS) {
        text = text.slice(0, LOCAL_FILE_READ_MAX_CHARS);
        wasCharTruncated = true;
      }
      const suffix =
        wasByteTruncated || wasCharTruncated
          ? `\n\n[Salida truncada. Tamano total: ${formatLocalBytes(targetStat.size)}]`
          : "";

      await appendLocalControlAudit("local_control_read", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        size: targetStat.size,
        truncated: wasByteTruncated || wasCharTruncated,
      });
      return localSuccessResult(
        "LOCAL_READ_OK",
        `Contenido de ${targetPath}:\n${text || "(archivo vacio)"}${suffix}`,
        {
          command: parsed.command,
          path: targetPath,
          size: targetStat.size,
          truncated: wasByteTruncated || wasCharTruncated,
        },
      );
    }

    if (parsed.command === "sendfile") {
      const targetRaw = parsed.args.join(" ").trim();
      if (!targetRaw) {
        return localErrorResult(
          400,
          "LOCAL_SENDFILE_USAGE",
          "Uso: /local sendfile <ruta_archivo>",
        );
      }
      const isPathLike =
        /^[~/]/.test(targetRaw) ||
        /^(?:desktop|downloads|documents|project):/i.test(targetRaw) ||
        /[\\/]/.test(targetRaw);

      let targetPath = resolveLocalPath(
        targetRaw,
        ensureLocalCwd(allowedRoots),
      );
      let fileStat: Awaited<ReturnType<typeof fs.stat>> | null = null;
      let resolvedViaSpotlight = false;

      const tryResolveAsDirectPath = async (): Promise<void> => {
        if (!isAllowedLocalPath(targetPath, allowedRoots)) {
          throw new Error("LOCAL_PATH_NOT_ALLOWED");
        }
        const stat = await fs.stat(targetPath);
        if (!stat.isFile()) {
          throw new Error("LOCAL_NOT_FILE");
        }
        fileStat = stat;
      };

      try {
        await tryResolveAsDirectPath();
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        const reason = (error as Error)?.message || "";
        const canFallbackToSearch =
          !isPathLike &&
          (code === "ENOENT" ||
            reason === "LOCAL_NOT_FILE" ||
            reason === "LOCAL_PATH_NOT_ALLOWED");
        if (!canFallbackToSearch) {
          if (reason === "LOCAL_PATH_NOT_ALLOWED") {
            return localErrorResult(
              403,
              "LOCAL_PATH_NOT_ALLOWED",
              "Ruta fuera de las carpetas permitidas.",
            );
          }
          if (reason === "LOCAL_NOT_FILE") {
            return localErrorResult(
              400,
              "LOCAL_NOT_FILE",
              "La ruta indicada no es un archivo.",
            );
          }
          if (code === "ENOENT") {
            return localErrorResult(
              404,
              "LOCAL_NOT_FOUND",
              "El archivo no existe.",
            );
          }
          throw error;
        }

        const spotlightMatches = await macos.spotlightSearch(targetRaw, {
          limit: 30,
        });
        const normalizedTarget = targetRaw.toLowerCase();
        const allowedMatches = spotlightMatches
          .map((entry) => path.resolve(entry.path))
          .filter((entryPath) => isAllowedLocalPath(entryPath, allowedRoots))
          .filter(
            (entryPath) =>
              path.basename(entryPath).toLowerCase() === normalizedTarget ||
              path.basename(entryPath).toLowerCase().includes(normalizedTarget),
          );

        if (allowedMatches.length === 0) {
          return localErrorResult(
            404,
            "LOCAL_NOT_FOUND",
            `No encontré "${targetRaw}" en las rutas permitidas. Usa ruta completa o nombre exacto con extensión.`,
          );
        }

        if (allowedMatches.length > 1) {
          const preview = allowedMatches
            .slice(0, 5)
            .map((entryPath) => `• ${entryPath}`)
            .join("\n");
          return localErrorResult(
            409,
            "LOCAL_SENDFILE_AMBIGUOUS",
            `Encontré varios archivos llamados similar a "${targetRaw}". Envia la ruta exacta:\n${preview}${allowedMatches.length > 5 ? `\n... y ${allowedMatches.length - 5} más.` : ""}`,
          );
        }

        targetPath = allowedMatches[0];
        fileStat = await fs.stat(targetPath);
        if (!fileStat.isFile()) {
          return localErrorResult(
            400,
            "LOCAL_NOT_FILE",
            "La coincidencia encontrada no es un archivo.",
          );
        }
        resolvedViaSpotlight = true;
      }

      if (!fileStat) {
        return localErrorResult(
          500,
          "LOCAL_ACTION_FAILED",
          "No pude resolver el archivo solicitado.",
        );
      }

      const fileName = path.basename(targetPath);
      const mimeType = inferLocalMimeTypeFromPath(targetPath);
      await appendLocalControlAudit("local_control_sendfile", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        fileName,
        mimeType,
        bytes: fileStat.size,
        resolvedViaSpotlight,
      });
      return localSuccessResult(
        "LOCAL_SENDFILE_OK",
        `📎 Archivo listo para envío: ${targetPath} (${formatLocalBytes(fileStat.size)}).`,
        {
          command: "sendfile",
          path: targetPath,
          fileName,
          mimeType,
          bytes: fileStat.size,
          resolvedViaSpotlight,
        },
      );
    }

    if (parsed.command === "write") {
      const targetRaw = parsed.args[0];
      const content = parsed.args.slice(1).join(" ");
      if (!targetRaw || parsed.args.length < 2) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          'Uso: /local write <ruta_archivo> "contenido"',
        );
      }
      if (content.length > LOCAL_FILE_WRITE_MAX_CHARS) {
        return localErrorResult(
          400,
          "LOCAL_CONTENT_TOO_LARGE",
          `Contenido demasiado grande. Maximo permitido: ${LOCAL_FILE_WRITE_MAX_CHARS} caracteres.`,
        );
      }

      const targetPath = resolveLocalPath(
        targetRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }

      let existed = false;
      try {
        const current = await fs.stat(targetPath);
        if (current.isDirectory()) {
          return localErrorResult(
            400,
            "LOCAL_IS_DIRECTORY",
            "La ruta apunta a un directorio. Usa una ruta de archivo.",
          );
        }
        existed = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw error;
      }

      if (existed && !parsed.confirm) {
        return localErrorResult(
          400,
          "LOCAL_CONFIRM_REQUIRED",
          "El archivo ya existe. Repite con confirmar para sobrescribir.",
        );
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, "utf-8");
      await appendLocalControlAudit("local_control_write", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        existed,
        contentLength: content.length,
      });
      return localSuccessResult(
        "LOCAL_WRITE_OK",
        existed
          ? `Archivo sobrescrito: ${targetPath}`
          : `Archivo creado: ${targetPath}`,
        {
          command: parsed.command,
          path: targetPath,
          existed,
          contentLength: content.length,
        },
      );
    }

    if (parsed.command === "append") {
      const targetRaw = parsed.args[0];
      const content = parsed.args.slice(1).join(" ");
      if (!targetRaw || parsed.args.length < 2) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          'Uso: /local append <ruta_archivo> "contenido"',
        );
      }
      if (content.length > LOCAL_FILE_WRITE_MAX_CHARS) {
        return localErrorResult(
          400,
          "LOCAL_CONTENT_TOO_LARGE",
          `Contenido demasiado grande. Maximo permitido: ${LOCAL_FILE_WRITE_MAX_CHARS} caracteres.`,
        );
      }
      const targetPath = resolveLocalPath(
        targetRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }

      try {
        const current = await fs.stat(targetPath);
        if (current.isDirectory()) {
          return localErrorResult(
            400,
            "LOCAL_IS_DIRECTORY",
            "La ruta apunta a un directorio. Usa una ruta de archivo.",
          );
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") throw error;
      }

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.appendFile(targetPath, content, "utf-8");
      await appendLocalControlAudit("local_control_append", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        contentLength: content.length,
      });
      return localSuccessResult(
        "LOCAL_APPEND_OK",
        `Contenido agregado en: ${targetPath}`,
        {
          command: parsed.command,
          path: targetPath,
          contentLength: content.length,
        },
      );
    }

    if (parsed.command === "replace") {
      const targetRaw = parsed.args[0];
      const searchText = parsed.args[1];
      const replaceText = parsed.args.slice(2).join(" ");
      if (
        !targetRaw ||
        typeof searchText !== "string" ||
        parsed.args.length < 3
      ) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          'Uso: /local replace <ruta_archivo> "buscar" "reemplazo" confirmar',
        );
      }
      const targetPath = resolveLocalPath(
        targetRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }

      let targetStat;
      try {
        targetStat = await fs.stat(targetPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return localErrorResult(
            404,
            "LOCAL_NOT_FOUND",
            "El archivo no existe.",
          );
        }
        throw error;
      }
      if (!targetStat.isFile()) {
        return localErrorResult(
          400,
          "LOCAL_NOT_FILE",
          "La ruta indicada no es un archivo.",
        );
      }
      if (targetStat.size > 3_000_000) {
        return localErrorResult(
          400,
          "LOCAL_FILE_TOO_LARGE",
          "Archivo demasiado grande para replace (>3MB).",
        );
      }

      const rawBuffer = await fs.readFile(targetPath);
      if (!isLikelyTextBuffer(rawBuffer)) {
        return localErrorResult(
          400,
          "LOCAL_NOT_TEXT_FILE",
          "El archivo parece binario y no se puede reemplazar texto.",
        );
      }

      const currentContent = rawBuffer.toString("utf-8");
      if (!currentContent.includes(searchText)) {
        return localErrorResult(
          404,
          "LOCAL_TEXT_NOT_FOUND",
          "No se encontro el texto a reemplazar.",
        );
      }

      const nextContent = currentContent.replace(searchText, replaceText);
      await fs.writeFile(targetPath, nextContent, "utf-8");
      await appendLocalControlAudit("local_control_replace", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        searchLength: searchText.length,
        replaceLength: replaceText.length,
      });
      return localSuccessResult(
        "LOCAL_REPLACE_OK",
        `Reemplazo aplicado en: ${targetPath}`,
        {
          command: parsed.command,
          path: targetPath,
        },
      );
    }

    if (parsed.command === "rm") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local rm <ruta> confirmar",
        );
      }
      const targetPath = resolveLocalPath(
        targetRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }
      if (isProtectedLocalRootPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PROTECTED_PATH",
          "No se puede eliminar una carpeta root permitida.",
        );
      }

      let targetStat;
      try {
        targetStat = await fs.stat(targetPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return localErrorResult(404, "LOCAL_NOT_FOUND", "La ruta no existe.");
        }
        throw error;
      }

      await fs.rm(targetPath, { recursive: true, force: false });
      await appendLocalControlAudit("local_control_rm", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        targetType: targetStat.isDirectory()
          ? "directory"
          : targetStat.isFile()
            ? "file"
            : "other",
      });
      return localSuccessResult("LOCAL_RM_OK", `Eliminado: ${targetPath}`, {
        command: parsed.command,
        path: targetPath,
      });
    }

    if (parsed.command === "mv" || parsed.command === "rename") {
      const sourceRaw = parsed.args[0];
      const destinationRaw = parsed.args[1];
      if (!sourceRaw || !destinationRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          parsed.command === "mv"
            ? "Uso: /local mv <origen> <destino> confirmar"
            : "Uso: /local rename <origen> <nuevo_nombre> confirmar",
        );
      }

      const sourcePath = resolveLocalPath(
        sourceRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );
      if (!isAllowedLocalPath(sourcePath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta de origen fuera de las carpetas permitidas.",
        );
      }

      const destinationPath =
        parsed.command === "rename" && !/[\\/]/.test(destinationRaw)
          ? path.resolve(path.dirname(sourcePath), destinationRaw)
          : resolveLocalPath(destinationRaw, LOCAL_ACTIONS_DEFAULT_ROOT);

      if (!isAllowedLocalPath(destinationPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta de destino fuera de las carpetas permitidas.",
        );
      }

      if (destinationPath === sourcePath) {
        return localErrorResult(
          400,
          "LOCAL_SAME_PATH",
          "Origen y destino no pueden ser iguales.",
        );
      }

      await fs.stat(sourcePath);
      const destinationParent = path.dirname(destinationPath);
      await fs.mkdir(destinationParent, { recursive: true });
      await fs.rename(sourcePath, destinationPath);
      await appendLocalControlAudit("local_control_move", {
        requestId: context.requestId,
        userId: actor,
        sourcePath,
        destinationPath,
        mode: parsed.command,
      });
      return localSuccessResult(
        "LOCAL_MOVE_OK",
        `Movimiento completado: ${sourcePath} -> ${destinationPath}`,
        {
          command: parsed.command,
          sourcePath,
          destinationPath,
        },
      );
    }

    if (parsed.command === "cd") {
      const targetRaw = parsed.args[0];
      if (!targetRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local cd <ruta>",
        );
      }
      const currentCwd = ensureLocalCwd(allowedRoots);
      const targetPath = resolveLocalPath(targetRaw, currentCwd);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }
      let targetStat;
      try {
        targetStat = await fs.stat(targetPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return localErrorResult(
            404,
            "LOCAL_NOT_FOUND",
            "La ruta indicada no existe.",
          );
        }
        throw error;
      }
      if (!targetStat.isDirectory()) {
        return localErrorResult(
          400,
          "LOCAL_NOT_DIRECTORY",
          "La ruta indicada no es un directorio.",
        );
      }
      _localTerminalSessionCwd = targetPath;
      await appendLocalControlAudit("local_control_cd", {
        requestId: context.requestId,
        userId: actor,
        cwd: _localTerminalSessionCwd,
      });
      return localSuccessResult(
        "LOCAL_CD_OK",
        `Directorio actual: ${_localTerminalSessionCwd}`,
        {
          command: "cd",
          cwd: _localTerminalSessionCwd,
        },
      );
    }

    if (parsed.command === "pwd") {
      const cwd = ensureLocalCwd(allowedRoots);
      return localSuccessResult("LOCAL_PWD_OK", cwd, { command: "pwd", cwd });
    }

    if (parsed.command === "history") {
      const modeRaw = String(parsed.args[0] || "")
        .trim()
        .toLowerCase();
      const isAuditMode = [
        "audit",
        "acciones",
        "actions",
        "registro",
        "log",
        "logs",
        "todo",
      ].includes(modeRaw);
      const limitRaw = isAuditMode ? parsed.args[1] : parsed.args[0];
      const requestedLimit = Number.parseInt(limitRaw || "20", 10);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(100, requestedLimit))
        : 20;

      const shellRecent = _localCommandHistory.slice(-limit);
      const shellLines = shellRecent.length
        ? shellRecent.map(
            (entry, idx) =>
              `${idx + 1}. [${entry.ts}] (${entry.exitCode ?? "?"}) ${entry.command}`,
          )
        : ["(sin historial de shell todavía)"];

      if (!isAuditMode) {
        return localSuccessResult("LOCAL_HISTORY_OK", shellLines.join("\n"), {
          command: "history",
          mode: "shell",
          total: _localCommandHistory.length,
          shown: shellRecent.length,
        });
      }

      const auditEntries = await readLocalControlAuditTail(limit);
      const auditLines = auditEntries.length
        ? auditEntries.map((entry, idx) =>
            formatLocalControlAuditLine(entry, idx),
          )
        : ["(sin registro de acciones todavía)"];

      return localSuccessResult(
        "LOCAL_HISTORY_AUDIT_OK",
        [
          "=== Registro de acciones locales ===",
          ...auditLines,
          "",
          "=== Historial shell ===",
          ...shellLines,
        ].join("\n"),
        {
          command: "history",
          mode: "audit",
          auditShown: auditEntries.length,
          shellShown: shellRecent.length,
        },
      );
    }

    if (parsed.command === "env") {
      if (!parsed.args.length) {
        const entries = Object.entries(process.env)
          .sort(([a], [b]) => a.localeCompare(b, "en"))
          .slice(0, 120)
          .map(([key, value]) => `${key}=${String(value || "")}`);
        return localSuccessResult("LOCAL_ENV_OK", entries.join("\n"), {
          command: "env",
          shown: entries.length,
        });
      }
      const firstArg = parsed.args[0];
      if (firstArg.includes("=")) {
        const eqIdx = firstArg.indexOf("=");
        const varName = firstArg.slice(0, eqIdx).trim();
        const varValue = [firstArg.slice(eqIdx + 1), ...parsed.args.slice(1)]
          .join(" ")
          .trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
          return localErrorResult(
            400,
            "LOCAL_INVALID_ENV_NAME",
            "Nombre de variable invalido.",
          );
        }
        process.env[varName] = varValue;
        return localSuccessResult(
          "LOCAL_ENV_SET_OK",
          `Variable asignada: ${varName}=${varValue}`,
          {
            command: "env",
            key: varName,
            valueLength: varValue.length,
          },
        );
      }
      const key = firstArg.trim();
      if (!key) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local env [VAR] o /local env VAR=valor",
        );
      }
      return localSuccessResult(
        "LOCAL_ENV_VALUE_OK",
        `${key}=${String(process.env[key] || "")}`,
        {
          command: "env",
          key,
        },
      );
    }

    // ── shell: execute arbitrary shell commands with persistent cwd ──
    if (parsed.command === "shell") {
      if (!LOCAL_FULL_SHELL_ENABLED) {
        return localErrorResult(
          403,
          "LOCAL_SHELL_DISABLED",
          "Ejecucion de shell deshabilitada. Establece ILIAGPT_LOCAL_FULL_SHELL=true en .env",
        );
      }
      const commandLine = parsed.args.join(" ").trim();
      if (!commandLine) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local shell <comando>",
        );
      }

      const cdOnlyMatch = commandLine.match(/^cd\s+(.+)$/i);
      if (cdOnlyMatch?.[1]) {
        const targetRaw = cdOnlyMatch[1].trim().replace(/^["']|["']$/g, "");
        const currentCwd = ensureLocalCwd(allowedRoots);
        const targetPath = resolveLocalPath(targetRaw, currentCwd);
        if (!isAllowedLocalPath(targetPath, allowedRoots)) {
          return localErrorResult(
            403,
            "LOCAL_PATH_NOT_ALLOWED",
            "Ruta fuera de las carpetas permitidas.",
          );
        }
        const targetStat = await fs.stat(targetPath);
        if (!targetStat.isDirectory()) {
          return localErrorResult(
            400,
            "LOCAL_NOT_DIRECTORY",
            "La ruta indicada no es un directorio.",
          );
        }
        _localTerminalSessionCwd = targetPath;
        await appendLocalControlAudit("local_control_shell_cd", {
          requestId: context.requestId,
          userId: actor,
          command: commandLine,
          cwd: _localTerminalSessionCwd,
        });
        return localSuccessResult(
          "LOCAL_SHELL_CD_OK",
          `Directorio actualizado: ${_localTerminalSessionCwd}`,
          {
            command: "shell",
            shellCommand: commandLine,
            cwd: _localTerminalSessionCwd,
          },
        );
      }

      const shellResult = await runLocalShellCommand(commandLine, {
        allowedRoots,
        cwd: ensureLocalCwd(allowedRoots),
      });
      await appendLocalControlAudit(
        shellResult.exitCode === 0
          ? "local_control_shell"
          : "local_control_shell_error",
        {
          requestId: context.requestId,
          userId: actor,
          command: shellResult.commandLine,
          cwd: shellResult.cwd,
          exitCode: shellResult.exitCode,
          timedOut: shellResult.timedOut,
        },
      );

      if (shellResult.timedOut) {
        return localErrorResult(
          408,
          "LOCAL_SHELL_TIMEOUT",
          `Comando excedio el timeout de ${LOCAL_SHELL_TIMEOUT_MS / 1000}s.`,
        );
      }
      return localSuccessResult(
        shellResult.exitCode === 0 ? "LOCAL_SHELL_OK" : "LOCAL_SHELL_ERROR",
        formatLocalShellMessage(shellResult),
        {
          command: "shell",
          shellCommand: shellResult.commandLine,
          cwd: shellResult.cwd,
          exitCode: shellResult.exitCode,
          truncated: shellResult.truncated,
        },
      );
    }

    if (parsed.command === "ps") {
      const filter = parsed.args.join(" ").trim();
      const commandLine = filter
        ? `ps aux | grep -i -- ${shellQuoteArg(filter)} | grep -v grep | head -n 180`
        : "ps aux | head -n 180";
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_ps", {
        requestId: context.requestId,
        userId: actor,
        filter,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0 && !result.stdout.trim()) {
        return localErrorResult(
          404,
          "LOCAL_PS_EMPTY",
          filter
            ? `No hay procesos que coincidan con "${filter}".`
            : "No se pudieron obtener procesos.",
        );
      }
      return localSuccessResult(
        "LOCAL_PS_OK",
        formatLocalShellMessage(result),
        {
          command: "ps",
          filter: filter || null,
        },
      );
    }

    if (parsed.command === "kill") {
      const target = String(parsed.args[0] || "").trim();
      if (!target) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local kill <pid|nombre_proceso> [signal] confirmar",
        );
      }
      const signal = normalizeLocalSignal(parsed.args[1]);
      const signalShort = signal.replace(/^SIG/, "");
      const commandLine = /^\d+$/.test(target)
        ? `kill -s ${signalShort} ${shellQuoteArg(target)}`
        : `pkill -${signalShort} -f -- ${shellQuoteArg(target)}`;
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_kill", {
        requestId: context.requestId,
        userId: actor,
        target,
        signal,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0) {
        return localErrorResult(
          400,
          "LOCAL_KILL_FAILED",
          formatLocalShellMessage(result),
        );
      }
      return localSuccessResult(
        "LOCAL_KILL_OK",
        formatLocalShellMessage(result),
        {
          command: "kill",
          target,
          signal,
        },
      );
    }

    if (parsed.command === "ports") {
      const commandLine = "lsof -nP -iTCP -sTCP:LISTEN | head -n 200";
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_ports", {
        requestId: context.requestId,
        userId: actor,
        exitCode: result.exitCode,
      });
      return localSuccessResult(
        "LOCAL_PORTS_OK",
        formatLocalShellMessage(result),
        {
          command: "ports",
        },
      );
    }

    if (parsed.command === "find") {
      if (!parsed.args.length) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local find <ruta> <patron> (o /local find <patron> [ruta])",
        );
      }
      const first = parsed.args[0];
      const second = parsed.args[1];
      const firstLooksPath = /^(?:desktop:|project:|~\/|\/|\.{1,2}\/)/i.test(
        first || "",
      );
      const secondLooksPath = /^(?:desktop:|project:|~\/|\/|\.{1,2}\/)/i.test(
        second || "",
      );
      let patternRaw = "";
      let searchPathRaw = ".";
      if (parsed.args.length === 1) {
        patternRaw = first;
      } else if (firstLooksPath && !secondLooksPath) {
        searchPathRaw = first;
        patternRaw = parsed.args.slice(1).join(" ").trim();
      } else {
        patternRaw = first;
        searchPathRaw = second || ".";
      }
      if (!patternRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Debes indicar el patron de busqueda.",
        );
      }
      const searchBase = ensureLocalCwd(allowedRoots);
      const searchPath = resolveLocalPath(searchPathRaw, searchBase);
      if (!isAllowedLocalPath(searchPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta de busqueda fuera de las carpetas permitidas.",
        );
      }
      const commandLine = `find ${shellQuoteArg(searchPath)} -iname ${shellQuoteArg(patternRaw)} -print | head -n 250`;
      const result = await runLocalShellCommand(commandLine, {
        allowedRoots,
        cwd: searchPath,
      });
      await appendLocalControlAudit("local_control_find", {
        requestId: context.requestId,
        userId: actor,
        searchPath,
        pattern: patternRaw,
        exitCode: result.exitCode,
      });
      return localSuccessResult(
        "LOCAL_FIND_OK",
        formatLocalShellMessage(result),
        {
          command: "find",
          searchPath,
          pattern: patternRaw,
        },
      );
    }

    if (parsed.command === "grep") {
      if (parsed.args.length < 2) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local grep <ruta> <texto> (o /local grep <texto> [ruta])",
        );
      }
      const first = parsed.args[0];
      const second = parsed.args[1];
      const firstLooksPath = /^(?:desktop:|project:|~\/|\/|\.{1,2}\/)/i.test(
        first || "",
      );
      let targetRaw = ".";
      let patternRaw = "";
      if (firstLooksPath) {
        targetRaw = first;
        patternRaw = parsed.args.slice(1).join(" ").trim();
      } else {
        patternRaw = first;
        targetRaw = second || ".";
      }
      if (!patternRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Debes indicar el texto/patron a buscar.",
        );
      }
      const searchBase = ensureLocalCwd(allowedRoots);
      const targetPath = resolveLocalPath(targetRaw, searchBase);
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }
      const commandLine = `grep -RIn --binary-files=without-match -- ${shellQuoteArg(patternRaw)} ${shellQuoteArg(targetPath)} | head -n 250`;
      const result = await runLocalShellCommand(commandLine, {
        allowedRoots,
        cwd: path.dirname(targetPath),
      });
      await appendLocalControlAudit("local_control_grep", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        pattern: patternRaw,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0 && !result.stderr.trim()) {
        return localSuccessResult(
          "LOCAL_GREP_EMPTY",
          `Sin coincidencias para "${patternRaw}" en ${targetPath}.`,
          {
            command: "grep",
            targetPath,
            pattern: patternRaw,
          },
        );
      }
      return localSuccessResult(
        "LOCAL_GREP_OK",
        formatLocalShellMessage(result),
        {
          command: "grep",
          targetPath,
          pattern: patternRaw,
        },
      );
    }

    if (parsed.command === "tree") {
      const depthArg = parsed.args.at(-1) || "";
      const parsedDepth = Number.parseInt(depthArg, 10);
      const depth = Number.isFinite(parsedDepth)
        ? Math.max(1, Math.min(8, parsedDepth))
        : 3;
      const pathArgs = Number.isFinite(parsedDepth)
        ? parsed.args.slice(0, -1)
        : parsed.args;
      const targetRaw = pathArgs[0] || ".";
      const targetPath = resolveLocalPath(
        targetRaw,
        ensureLocalCwd(allowedRoots),
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }
      const commandLine = `if command -v tree >/dev/null 2>&1; then tree -a -L ${depth} ${shellQuoteArg(targetPath)}; else find ${shellQuoteArg(targetPath)} -maxdepth ${depth} -print; fi`;
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_tree", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        depth,
        exitCode: result.exitCode,
      });
      return localSuccessResult(
        "LOCAL_TREE_OK",
        formatLocalShellMessage(result),
        {
          command: "tree",
          targetPath,
          depth,
        },
      );
    }

    if (parsed.command === "chmod") {
      const mode = String(parsed.args[0] || "").trim();
      const targetRaw = parsed.args[1];
      if (!mode || !targetRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local chmod <modo> <ruta> confirmar",
        );
      }
      if (!/^(?:[0-7]{3,4}|[ugoa]+[+\-=][rwxXst]+)$/.test(mode)) {
        return localErrorResult(
          400,
          "LOCAL_INVALID_CHMOD_MODE",
          "Modo chmod invalido.",
        );
      }
      const targetPath = resolveLocalPath(
        targetRaw,
        ensureLocalCwd(allowedRoots),
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }
      const result = await runLocalShellCommand(
        `chmod ${shellQuoteArg(mode)} ${shellQuoteArg(targetPath)}`,
        { allowedRoots },
      );
      await appendLocalControlAudit("local_control_chmod", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        mode,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0) {
        return localErrorResult(
          400,
          "LOCAL_CHMOD_FAILED",
          formatLocalShellMessage(result),
        );
      }
      return localSuccessResult(
        "LOCAL_CHMOD_OK",
        formatLocalShellMessage(result),
        {
          command: "chmod",
          targetPath,
          mode,
        },
      );
    }

    if (parsed.command === "diff") {
      const leftRaw = parsed.args[0];
      const rightRaw = parsed.args[1];
      if (!leftRaw || !rightRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local diff <archivo_a> <archivo_b>",
        );
      }
      const baseCwd = ensureLocalCwd(allowedRoots);
      const leftPath = resolveLocalPath(leftRaw, baseCwd);
      const rightPath = resolveLocalPath(rightRaw, baseCwd);
      if (
        !isAllowedLocalPath(leftPath, allowedRoots) ||
        !isAllowedLocalPath(rightPath, allowedRoots)
      ) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Alguna ruta esta fuera de las carpetas permitidas.",
        );
      }
      const result = await runLocalShellCommand(
        `diff -u -- ${shellQuoteArg(leftPath)} ${shellQuoteArg(rightPath)} | head -n 500`,
        { allowedRoots },
      );
      await appendLocalControlAudit("local_control_diff", {
        requestId: context.requestId,
        userId: actor,
        leftPath,
        rightPath,
        exitCode: result.exitCode,
      });
      if (result.exitCode > 1) {
        return localErrorResult(
          400,
          "LOCAL_DIFF_FAILED",
          formatLocalShellMessage(result),
        );
      }
      if (result.exitCode === 0) {
        return localSuccessResult(
          "LOCAL_DIFF_IDENTICAL",
          `Sin diferencias entre:\n${leftPath}\n${rightPath}`,
          {
            command: "diff",
            leftPath,
            rightPath,
          },
        );
      }
      return localSuccessResult(
        "LOCAL_DIFF_DIFFERENT",
        formatLocalShellMessage(result),
        {
          command: "diff",
          leftPath,
          rightPath,
        },
      );
    }

    if (
      parsed.command === "python" ||
      parsed.command === "node" ||
      parsed.command === "script"
    ) {
      if (!LOCAL_FULL_SHELL_ENABLED) {
        return localErrorResult(
          403,
          "LOCAL_SHELL_DISABLED",
          "Ejecucion de scripts deshabilitada. Establece ILIAGPT_LOCAL_FULL_SHELL=true en .env",
        );
      }
      let language: string = parsed.command;
      let scriptArgs = [...parsed.args];
      if (parsed.command === "script") {
        const maybeLanguage = (scriptArgs[0] || "").toLowerCase();
        if (
          ["python", "python3", "node", "js", "bash", "sh"].includes(
            maybeLanguage,
          )
        ) {
          language = maybeLanguage.startsWith("py")
            ? "python"
            : maybeLanguage === "js"
              ? "node"
              : maybeLanguage.startsWith("sh")
                ? "bash"
                : maybeLanguage;
          scriptArgs = scriptArgs.slice(1);
        } else if (scriptArgs[0]) {
          const ext = path.extname(scriptArgs[0]).toLowerCase();
          if (ext === ".py") language = "python";
          else if (ext === ".js" || ext === ".mjs" || ext === ".cjs")
            language = "node";
          else language = "bash";
        }
      }
      if (!scriptArgs.length) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          parsed.command === "script"
            ? "Uso: /local script <python|node|bash> <codigo|archivo>"
            : parsed.command === "python"
              ? "Uso: /local python <codigo|archivo.py>"
              : "Uso: /local node <codigo|archivo.js>",
        );
      }

      const currentCwd = ensureLocalCwd(allowedRoots);
      const maybePath = resolveLocalPath(scriptArgs[0], currentCwd);
      let commandLine = "";
      let executionMode: "file" | "inline" = "inline";
      try {
        const st = await fs.stat(maybePath);
        if (st.isFile() && isAllowedLocalPath(maybePath, allowedRoots)) {
          executionMode = "file";
          const tailArgs = scriptArgs
            .slice(1)
            .map((arg) => shellQuoteArg(arg))
            .join(" ");
          if (language === "python")
            commandLine = `python3 ${shellQuoteArg(maybePath)}${tailArgs ? ` ${tailArgs}` : ""}`;
          else if (language === "node")
            commandLine = `node ${shellQuoteArg(maybePath)}${tailArgs ? ` ${tailArgs}` : ""}`;
          else
            commandLine = `bash ${shellQuoteArg(maybePath)}${tailArgs ? ` ${tailArgs}` : ""}`;
        }
      } catch {
        executionMode = "inline";
      }
      if (!commandLine) {
        const inlineCode = scriptArgs.join(" ").trim();
        if (!inlineCode) {
          return localErrorResult(
            400,
            "LOCAL_MISSING_ARG",
            "No hay codigo para ejecutar.",
          );
        }
        if (language === "python")
          commandLine = `python3 -c ${shellQuoteArg(inlineCode)}`;
        else if (language === "node")
          commandLine = `node -e ${shellQuoteArg(inlineCode)}`;
        else commandLine = inlineCode;
      }
      const result = await runLocalShellCommand(commandLine, {
        allowedRoots,
        cwd: currentCwd,
      });
      await appendLocalControlAudit("local_control_script", {
        requestId: context.requestId,
        userId: actor,
        language,
        mode: executionMode,
        exitCode: result.exitCode,
      });
      return localSuccessResult(
        result.exitCode === 0 ? "LOCAL_SCRIPT_OK" : "LOCAL_SCRIPT_ERROR",
        formatLocalShellMessage(result),
        {
          command: parsed.command,
          language,
          mode: executionMode,
          exitCode: result.exitCode,
        },
      );
    }

    if (
      parsed.command === "npm" ||
      parsed.command === "pip" ||
      parsed.command === "brew" ||
      parsed.command === "git" ||
      parsed.command === "docker"
    ) {
      if (!LOCAL_FULL_SHELL_ENABLED) {
        return localErrorResult(
          403,
          "LOCAL_SHELL_DISABLED",
          "Ejecucion de comandos de terminal deshabilitada. Establece ILIAGPT_LOCAL_FULL_SHELL=true en .env",
        );
      }
      const normalizedArgs =
        parsed.source === "natural" &&
        parsed.args.length === 1 &&
        /\s/.test(parsed.args[0] || "")
          ? tokenizeLocalCommand(parsed.args[0])
          : parsed.args;
      if (!normalizedArgs.length) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          `Uso: /local ${parsed.command} <args>`,
        );
      }
      const executable = parsed.command === "pip" ? "pip3" : parsed.command;
      const joinedArgs = normalizedArgs
        .map((arg) => shellQuoteArg(arg))
        .join(" ");
      const commandLine = `${executable}${joinedArgs ? ` ${joinedArgs}` : ""}`;
      const result = await runLocalShellCommand(commandLine, {
        allowedRoots,
        cwd: ensureLocalCwd(allowedRoots),
      });
      await appendLocalControlAudit("local_control_package_or_tool", {
        requestId: context.requestId,
        userId: actor,
        tool: parsed.command,
        commandLine,
        exitCode: result.exitCode,
      });
      return localSuccessResult(
        result.exitCode === 0 ? "LOCAL_TOOL_OK" : "LOCAL_TOOL_ERROR",
        formatLocalShellMessage(result),
        {
          command: parsed.command,
          shellCommand: commandLine,
          exitCode: result.exitCode,
        },
      );
    }

    if (parsed.command === "appwrite") {
      const appNameRaw = String(parsed.args[0] || "").trim();
      if (!appNameRaw) {
        return localErrorResult(
          400,
          "MACOS_APPWRITE_USAGE",
          "Uso: /local appwrite <app> <texto> [--enter]",
        );
      }

      const appName = normalizeLocalAppName(appNameRaw);
      let text = parsed.args.slice(1).join(" ").trim();
      const pressEnter = /(?:^|\s)--enter(?:\s|$)/i.test(text);
      text = text.replace(/(?:^|\s)--enter(?:\s|$)/gi, " ").trim();
      if (!text) {
        return localErrorResult(
          400,
          "MACOS_APPWRITE_USAGE",
          "Falta texto. Uso: /local appwrite <app> <texto> [--enter]",
        );
      }

      if (text.length > 2500) {
        text = text.slice(0, 2500);
      }

      const scriptLines = [
        `tell application "${escapeAppleScriptStringLiteral(appName)}" to activate`,
        "delay 0.35",
        'tell application "System Events"',
        `  keystroke "${escapeAppleScriptStringLiteral(text)}"`,
      ];
      if (pressEnter) {
        scriptLines.push("  key code 36");
      }
      scriptLines.push("end tell");

      const script = scriptLines.join("\n");
      const result = await macos.runOsascript(script, { timeout: 15_000 });
      await appendLocalControlAudit("local_control_appwrite", {
        requestId: context.requestId,
        userId: actor,
        appName,
        textLength: text.length,
        pressEnter,
        success: result.success,
      });
      if (!result.success) {
        return localErrorResult(
          500,
          "MACOS_APPWRITE_FAIL",
          `No pude escribir en ${appName}. Revisa permisos de Accesibilidad en macOS. Detalle: ${result.error || "error desconocido"}`,
        );
      }

      return localSuccessResult(
        "MACOS_APPWRITE_OK",
        `⌨️ Texto escrito en ${appName}${pressEnter ? " (con Enter)" : ""}.`,
        {
          command: "appwrite",
          appName,
          textLength: text.length,
          pressEnter,
        },
      );
    }

    if (parsed.command === "open") {
      const targetRaw = parsed.args.join(" ").trim();
      if (!targetRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local open <ruta|url|app>",
        );
      }
      const isUrl = /^https?:\/\//i.test(targetRaw);
      let commandLine = "";
      let resolvedPath: string | null = null;
      if (isUrl) {
        commandLine = `open ${shellQuoteArg(targetRaw)}`;
      } else {
        const candidate = resolveLocalPath(
          targetRaw,
          ensureLocalCwd(allowedRoots),
        );
        try {
          const st = await fs.stat(candidate);
          if (st && isAllowedLocalPath(candidate, allowedRoots)) {
            resolvedPath = candidate;
            commandLine = `open ${shellQuoteArg(candidate)}`;
          }
        } catch {
          resolvedPath = null;
        }
        if (!commandLine) {
          commandLine = `open -a ${shellQuoteArg(targetRaw)}`;
        }
      }
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_open", {
        requestId: context.requestId,
        userId: actor,
        targetRaw,
        resolvedPath,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0) {
        return localErrorResult(
          400,
          "LOCAL_OPEN_FAILED",
          formatLocalShellMessage(result),
        );
      }
      return localSuccessResult(
        "LOCAL_OPEN_OK",
        formatLocalShellMessage(result),
        {
          command: "open",
          target: resolvedPath || targetRaw,
        },
      );
    }

    if (parsed.command === "top") {
      const result = await runLocalShellCommand("top -l 1 | head -n 60", {
        allowedRoots,
      });
      await appendLocalControlAudit("local_control_top", {
        requestId: context.requestId,
        userId: actor,
        exitCode: result.exitCode,
      });
      return localSuccessResult(
        "LOCAL_TOP_OK",
        formatLocalShellMessage(result),
        {
          command: "top",
        },
      );
    }

    if (parsed.command === "du") {
      const targetRaw = parsed.args[0] || ".";
      const targetPath = resolveLocalPath(
        targetRaw,
        ensureLocalCwd(allowedRoots),
      );
      if (!isAllowedLocalPath(targetPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta fuera de las carpetas permitidas.",
        );
      }
      const commandLine = `du -sh ${shellQuoteArg(targetPath)} 2>/dev/null; du -sh ${shellQuoteArg(targetPath)}/* 2>/dev/null | sort -hr | head -n 40`;
      const result = await runLocalShellCommand(commandLine, { allowedRoots });
      await appendLocalControlAudit("local_control_du", {
        requestId: context.requestId,
        userId: actor,
        targetPath,
        exitCode: result.exitCode,
      });
      return localSuccessResult(
        "LOCAL_DU_OK",
        formatLocalShellMessage(result),
        {
          command: "du",
          targetPath,
        },
      );
    }

    if (parsed.command === "which") {
      const binary = String(parsed.args[0] || "").trim();
      if (!binary) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local which <binario>",
        );
      }
      const result = await runLocalShellCommand(
        `which ${shellQuoteArg(binary)} || command -v ${shellQuoteArg(binary)}`,
        { allowedRoots },
      );
      await appendLocalControlAudit("local_control_which", {
        requestId: context.requestId,
        userId: actor,
        binary,
        exitCode: result.exitCode,
      });
      if (result.exitCode !== 0) {
        return localErrorResult(
          404,
          "LOCAL_WHICH_NOT_FOUND",
          `No se encontro el binario: ${binary}`,
        );
      }
      return localSuccessResult(
        "LOCAL_WHICH_OK",
        formatLocalShellMessage(result),
        {
          command: "which",
          binary,
        },
      );
    }

    if (parsed.command === "monitor") {
      const sampleSecondsRaw = Number.parseInt(parsed.args[0] || "1", 10);
      const sampleSeconds = Number.isFinite(sampleSecondsRaw)
        ? Math.max(1, Math.min(5, sampleSecondsRaw))
        : 1;
      const commandLine = [
        "echo '=== UPTIME ==='",
        "uptime",
        "echo '\n=== MEMORIA ==='",
        "vm_stat | head -n 10",
        "echo '\n=== DISCO ==='",
        "df -h | head -n 20",
        "echo '\n=== PROCESOS TOP ==='",
        "top -l 1 | head -n 35",
        "echo '\n=== PUERTOS LISTEN ==='",
        "lsof -nP -iTCP -sTCP:LISTEN | head -n 40",
        sampleSeconds > 1
          ? `echo '\n=== MUESTRA EXTRA (${sampleSeconds}s) ==='; sleep ${sampleSeconds}; top -l 1 | head -n 20`
          : "",
      ]
        .filter(Boolean)
        .join("; ");
      const result = await runLocalShellCommand(commandLine, {
        allowedRoots,
        timeoutMs: LOCAL_SHELL_TIMEOUT_MS + sampleSeconds * 2000,
        stdoutMaxChars: 32_000,
      });
      await appendLocalControlAudit("local_control_monitor", {
        requestId: context.requestId,
        userId: actor,
        sampleSeconds,
        exitCode: result.exitCode,
      });
      return localSuccessResult(
        "LOCAL_MONITOR_OK",
        formatLocalShellMessage(result),
        {
          command: "monitor",
          sampleSeconds,
        },
      );
    }

    // ── cp: copy file or directory ──
    if (parsed.command === "cp") {
      const sourceRaw = parsed.args[0];
      const destinationRaw = parsed.args[1];
      if (!sourceRaw || !destinationRaw) {
        return localErrorResult(
          400,
          "LOCAL_MISSING_ARG",
          "Uso: /local cp <origen> <destino>\nEjemplo: /local cp desktop:archivo.txt desktop:copia.txt",
        );
      }
      const sourcePath = resolveLocalPath(
        sourceRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );
      const destinationPath = resolveLocalPath(
        destinationRaw,
        LOCAL_ACTIONS_DEFAULT_ROOT,
      );

      if (!isAllowedLocalPath(sourcePath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta de origen fuera de las carpetas permitidas.",
        );
      }
      if (!isAllowedLocalPath(destinationPath, allowedRoots)) {
        return localErrorResult(
          403,
          "LOCAL_PATH_NOT_ALLOWED",
          "Ruta de destino fuera de las carpetas permitidas.",
        );
      }

      await fs.stat(sourcePath); // throws if not exists
      const destParent = path.dirname(destinationPath);
      await fs.mkdir(destParent, { recursive: true });
      await fs.cp(sourcePath, destinationPath, { recursive: true });

      await appendLocalControlAudit("local_control_cp", {
        requestId: context.requestId,
        userId: actor,
        sourcePath,
        destinationPath,
      });
      return localSuccessResult(
        "LOCAL_CP_OK",
        `Copiado: ${sourcePath} -> ${destinationPath}`,
        {
          command: "cp",
          sourcePath,
          destinationPath,
        },
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    //  macOS Native Commands
    // ═══════════════════════════════════════════════════════════════════

    if (parsed.command === "volume") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "get" || arg0 === "status") {
        const vol = await macos.getVolume();
        const muted = await macos.isMuted();
        return localSuccessResult(
          "MACOS_VOLUME",
          `🔊 Volumen: ${vol}%${muted ? " (silenciado)" : ""}`,
          { volume: vol, muted },
        );
      }
      if (arg0 === "mute") {
        await macos.muteVolume(true);
        return localSuccessResult(
          "MACOS_VOLUME_MUTED",
          "🔇 Volumen silenciado.",
        );
      }
      if (arg0 === "unmute") {
        await macos.muteVolume(false);
        return localSuccessResult(
          "MACOS_VOLUME_UNMUTED",
          "🔊 Volumen desilenciado.",
        );
      }
      const level = parseInt(arg0, 10);
      if (!isNaN(level)) {
        await macos.setVolume(level);
        return localSuccessResult(
          "MACOS_VOLUME_SET",
          `🔊 Volumen ajustado a ${Math.min(100, Math.max(0, level))}%.`,
        );
      }
      return localErrorResult(
        400,
        "MACOS_VOLUME_USAGE",
        "Uso: volume [get|mute|unmute|0-100]",
      );
    }

    if (parsed.command === "brightness") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "get") {
        const b = await macos.getBrightness();
        return localSuccessResult(
          "MACOS_BRIGHTNESS",
          `🔆 Brillo: ${Math.round(b * 100)}%`,
          { brightness: b },
        );
      }
      const level = parseFloat(arg0);
      if (!isNaN(level)) {
        const normalized = level > 1 ? level / 100 : level;
        await macos.setBrightness(normalized);
        return localSuccessResult(
          "MACOS_BRIGHTNESS_SET",
          `🔆 Brillo ajustado a ${Math.round(normalized * 100)}%.`,
        );
      }
      return localErrorResult(
        400,
        "MACOS_BRIGHTNESS_USAGE",
        "Uso: brightness [get|0-100|0.0-1.0]",
      );
    }

    if (parsed.command === "darkmode") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "get" || arg0 === "status") {
        const dark = await macos.isDarkMode();
        return localSuccessResult(
          "MACOS_DARKMODE",
          `${dark ? "🌙 Dark mode activado" : "☀️ Light mode activado"}`,
          { darkMode: dark },
        );
      }
      if (["on", "true", "dark", "activar", "enable"].includes(arg0)) {
        await macos.setDarkMode(true);
        return localSuccessResult(
          "MACOS_DARKMODE_ON",
          "🌙 Dark mode activado.",
        );
      }
      if (["off", "false", "light", "desactivar", "disable"].includes(arg0)) {
        await macos.setDarkMode(false);
        return localSuccessResult(
          "MACOS_DARKMODE_OFF",
          "☀️ Light mode activado.",
        );
      }
      const current = await macos.isDarkMode();
      await macos.setDarkMode(!current);
      return localSuccessResult(
        "MACOS_DARKMODE_TOGGLE",
        `${!current ? "🌙 Dark mode" : "☀️ Light mode"} activado.`,
      );
    }

    if (parsed.command === "wifi") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "status" || arg0 === "get") {
        const status = await macos.getWiFiStatus();
        return localSuccessResult(
          "MACOS_WIFI",
          `📶 WiFi: ${status.power ? "encendido" : "apagado"}${status.ssid ? ` — Red: ${status.ssid}` : ""}`,
          status,
        );
      }
      if (["on", "enable", "encender"].includes(arg0)) {
        await macos.setWiFi(true);
        return localSuccessResult("MACOS_WIFI_ON", "📶 WiFi encendido.");
      }
      if (["off", "disable", "apagar"].includes(arg0)) {
        await macos.setWiFi(false);
        return localSuccessResult("MACOS_WIFI_OFF", "📶 WiFi apagado.");
      }
      return localErrorResult(
        400,
        "MACOS_WIFI_USAGE",
        "Uso: wifi [status|on|off]",
      );
    }

    if (parsed.command === "bluetooth") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "status") {
        const on = await macos.getBluetoothStatus();
        return localSuccessResult(
          "MACOS_BT",
          `${on ? "🔵 Bluetooth encendido" : "⚪ Bluetooth apagado"}`,
          { power: on },
        );
      }
      if (["on", "enable"].includes(arg0)) {
        const r = await macos.setBluetooth(true);
        return localSuccessResult(
          "MACOS_BT_ON",
          r.success ? "🔵 Bluetooth encendido." : `Error: ${r.error}`,
        );
      }
      if (["off", "disable"].includes(arg0)) {
        const r = await macos.setBluetooth(false);
        return localSuccessResult(
          "MACOS_BT_OFF",
          r.success ? "⚪ Bluetooth apagado." : `Error: ${r.error}`,
        );
      }
      return localErrorResult(
        400,
        "MACOS_BT_USAGE",
        "Uso: bluetooth [status|on|off]",
      );
    }

    if (parsed.command === "battery") {
      const info = await macos.getBatteryInfo();
      return localSuccessResult(
        "MACOS_BATTERY",
        `🔋 Batería: ${info.percent}%${info.charging ? " ⚡ Cargando" : ""} — ${info.timeRemaining}`,
        info,
      );
    }

    if (parsed.command === "lock") {
      await macos.lockScreen();
      return localSuccessResult("MACOS_LOCK", "🔒 Pantalla bloqueada.");
    }

    if (parsed.command === "windowshot") {
      const appNameRaw = String(parsed.args[0] || "").trim();
      if (!appNameRaw) {
        return localErrorResult(
          400,
          "MACOS_WINDOWSHOT_USAGE",
          "Uso: /local windowshot <app> [indice_ventana]",
        );
      }
      const appName = normalizeLocalAppName(appNameRaw);
      const requestedIndex = Number.parseInt(String(parsed.args[1] || "1"), 10);
      const windowIndex = Number.isFinite(requestedIndex)
        ? Math.max(1, Math.min(20, requestedIndex))
        : 1;

      const result = await macos.takeWindowScreenshot(appName, windowIndex - 1);
      if (!result.success) {
        return localErrorResult(
          500,
          "MACOS_WINDOWSHOT_FAIL",
          result.error || `No pude capturar la ventana de ${appName}.`,
        );
      }

      return localSuccessResult(
        "MACOS_WINDOWSHOT_OK",
        `📸 Captura de ${appName} guardada: ${result.path}`,
        {
          appName,
          windowIndex,
          path: result.path,
          fileName: path.basename(result.path),
          mimeType: inferLocalMimeTypeFromPath(result.path),
          hasBase64: !!result.base64,
        },
      );
    }

    if (parsed.command === "screenshot") {
      const r = await macos.takeScreenshot({ shadow: false });
      if (!r.success)
        return localErrorResult(
          500,
          "MACOS_SCREENSHOT_FAIL",
          r.error || "Error al tomar screenshot",
        );
      let screenshotBytes: number | undefined;
      try {
        const stat = await fs.stat(r.path);
        if (stat.isFile()) {
          screenshotBytes = stat.size;
        }
      } catch {
        screenshotBytes = undefined;
      }
      return localSuccessResult(
        "MACOS_SCREENSHOT",
        `📸 Screenshot guardado: ${r.path}`,
        {
          path: r.path,
          fileName: path.basename(r.path),
          mimeType: inferLocalMimeTypeFromPath(r.path),
          bytes: screenshotBytes,
          hasBase64: !!r.base64,
        },
      );
    }

    if (parsed.command === "webshot") {
      const urlInput = String(parsed.args[0] || "").trim();
      if (!urlInput) {
        return localErrorResult(
          400,
          "MACOS_WEBSHOT_USAGE",
          "Uso: /local webshot <url>",
        );
      }

      const normalizedUrl = /^https?:\/\//i.test(urlInput)
        ? urlInput
        : `https://${urlInput}`;
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(normalizedUrl);
      } catch {
        return localErrorResult(
          400,
          "MACOS_WEBSHOT_INVALID_URL",
          "URL inválida para captura web.",
        );
      }

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return localErrorResult(
          400,
          "MACOS_WEBSHOT_INVALID_URL",
          "Solo se permiten URLs http/https.",
        );
      }

      if (isBlockedWebshotHostname(parsedUrl.hostname)) {
        return localErrorResult(
          403,
          "MACOS_WEBSHOT_BLOCKED",
          "Host bloqueado por seguridad (loopback/red privada).",
        );
      }

      let captureMode: "sandbox" | "direct" = "sandbox";
      let captureFinalUrl: string | undefined;
      let captureTitle: string | undefined;
      let screenshotBuffer: Buffer | null = null;

      if (browserAdapter.isUrlAllowed(parsedUrl.toString())) {
        screenshotBuffer = await browserAdapter.screenshot(
          parsedUrl.toString(),
        );
      }

      if (!screenshotBuffer) {
        captureMode = "direct";
        const fallbackCapture = await captureWebshotWithoutSandbox(
          parsedUrl.toString(),
        );
        screenshotBuffer = fallbackCapture.buffer;
        captureFinalUrl = fallbackCapture.finalUrl;
        captureTitle = fallbackCapture.title;

        if (!screenshotBuffer) {
          return localErrorResult(
            500,
            "MACOS_WEBSHOT_FAIL",
            `No se pudo capturar el sitio web. ${fallbackCapture.error || "Error desconocido."}`,
          );
        }
      }

      if (!screenshotBuffer || screenshotBuffer.length === 0) {
        return localErrorResult(
          500,
          "MACOS_WEBSHOT_FAIL",
          "No se pudo capturar el sitio web.",
        );
      }

      const safeHost =
        parsedUrl.hostname.replace(/[^a-zA-Z0-9.-]/g, "_").slice(0, 80) ||
        "site";
      const fileName = `webshot-${safeHost}-${Date.now()}.png`;
      const outputDir = path.join(os.tmpdir(), "iliagpt-webshots");
      await fs.mkdir(outputDir, { recursive: true });
      const filePath = path.join(outputDir, fileName);
      await fs.writeFile(filePath, screenshotBuffer);

      await appendLocalControlAudit("local_control_webshot", {
        requestId: context.requestId,
        userId: actor,
        url: parsedUrl.toString(),
        filePath,
        bytes: screenshotBuffer.length,
        captureMode,
        captureFinalUrl,
      });

      return localSuccessResult(
        "MACOS_WEBSHOT_OK",
        `🌐📸 Screenshot web guardado: ${filePath}`,
        {
          url: parsedUrl.toString(),
          finalUrl: captureFinalUrl || parsedUrl.toString(),
          title: captureTitle,
          path: filePath,
          fileName,
          mimeType: "image/png",
          bytes: screenshotBuffer.length,
          captureMode,
        },
      );
    }

    if (parsed.command === "clipboard") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "get" || arg0 === "read" || arg0 === "paste") {
        const content = await macos.getClipboard();
        return localSuccessResult(
          "MACOS_CLIPBOARD",
          `📋 Clipboard (${content.length} chars):\n${content.slice(0, 2000)}${content.length > 2000 ? "\n...[truncado]" : ""}`,
          { length: content.length },
        );
      }
      if (arg0 === "set" || arg0 === "copy") {
        const text = parsed.args.slice(1).join(" ");
        if (!text)
          return localErrorResult(
            400,
            "MACOS_CLIPBOARD_USAGE",
            "Uso: clipboard copy <texto>",
          );
        await macos.setClipboard(text);
        return localSuccessResult(
          "MACOS_CLIPBOARD_SET",
          `📋 Texto copiado al clipboard (${text.length} chars).`,
        );
      }
      if (arg0 === "clear") {
        await macos.clearClipboard();
        return localSuccessResult(
          "MACOS_CLIPBOARD_CLEAR",
          "📋 Clipboard limpiado.",
        );
      }
      return localErrorResult(
        400,
        "MACOS_CLIPBOARD_USAGE",
        "Uso: clipboard [get|copy <texto>|clear]",
      );
    }

    if (parsed.command === "notify") {
      const message = parsed.args.join(" ");
      if (!message)
        return localErrorResult(
          400,
          "MACOS_NOTIFY_USAGE",
          "Uso: notify <mensaje>",
        );
      await macos.showNotification(message, { title: "ILIAGPT" });
      return localSuccessResult(
        "MACOS_NOTIFY",
        `🔔 Notificación enviada: "${message}"`,
      );
    }

    if (parsed.command === "say") {
      const text = parsed.args.join(" ");
      if (!text)
        return localErrorResult(400, "MACOS_SAY_USAGE", "Uso: say <texto>");
      await macos.sayText(text);
      return localSuccessResult("MACOS_SAY", `🗣️ Dicho: "${text}"`);
    }

    if (parsed.command === "calendar") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "events" || arg0 === "list") {
        const days = parseInt(parsed.args[1] || "7", 10);
        const events = await macos.getCalendarEvents(days);
        if (events.length === 0)
          return localSuccessResult(
            "MACOS_CALENDAR",
            `📅 No hay eventos en los próximos ${days} días.`,
          );
        const formatted = events
          .map(
            (e) =>
              `• ${e.title} — ${new Date(e.startDate).toLocaleString("es")}${e.location ? ` 📍 ${e.location}` : ""}`,
          )
          .join("\n");
        return localSuccessResult(
          "MACOS_CALENDAR",
          `📅 Próximos eventos (${events.length}):\n${formatted}`,
          { events },
        );
      }
      if (arg0 === "calendars") {
        const cals = await macos.listCalendars();
        return localSuccessResult(
          "MACOS_CALENDARS",
          `📅 Calendarios: ${cals.join(", ")}`,
          { calendars: cals },
        );
      }
      return localErrorResult(
        400,
        "MACOS_CALENDAR_USAGE",
        "Uso: calendar [events [días]|calendars]",
      );
    }

    if (parsed.command === "contacts") {
      const query = parsed.args.join(" ");
      if (!query)
        return localErrorResult(
          400,
          "MACOS_CONTACTS_USAGE",
          "Uso: contacts <nombre>",
        );
      const contacts = await macos.searchContacts(query);
      if (contacts.length === 0)
        return localSuccessResult(
          "MACOS_CONTACTS",
          `👤 No se encontraron contactos para "${query}".`,
        );
      const formatted = contacts
        .map(
          (c) =>
            `• ${c.name}${c.organization ? ` (${c.organization})` : ""}${c.email.length ? ` ✉️ ${c.email[0]}` : ""}${c.phone.length ? ` 📱 ${c.phone[0]}` : ""}`,
        )
        .join("\n");
      return localSuccessResult(
        "MACOS_CONTACTS",
        `👤 Contactos encontrados (${contacts.length}):\n${formatted}`,
        { contacts },
      );
    }

    if (parsed.command === "reminders") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "list" || arg0 === "get") {
        const listName = parsed.args[1] || undefined;
        const reminders = await macos.getReminders(listName);
        if (reminders.length === 0)
          return localSuccessResult(
            "MACOS_REMINDERS",
            "✅ No hay recordatorios pendientes.",
          );
        const formatted = reminders
          .map(
            (r) =>
              `• ${r.name}${r.dueDate ? ` — ${new Date(r.dueDate).toLocaleString("es")}` : ""}${r.list ? ` [${r.list}]` : ""}`,
          )
          .join("\n");
        return localSuccessResult(
          "MACOS_REMINDERS",
          `📝 Recordatorios (${reminders.length}):\n${formatted}`,
          { reminders },
        );
      }
      if (arg0 === "add" || arg0 === "create" || arg0 === "new") {
        const name = parsed.args.slice(1).join(" ");
        if (!name)
          return localErrorResult(
            400,
            "MACOS_REMINDER_USAGE",
            "Uso: reminders add <nombre>",
          );
        await macos.createReminder(name);
        return localSuccessResult(
          "MACOS_REMINDER_CREATED",
          `✅ Recordatorio creado: "${name}"`,
        );
      }
      if (arg0 === "complete" || arg0 === "done") {
        const name = parsed.args.slice(1).join(" ");
        if (!name)
          return localErrorResult(
            400,
            "MACOS_REMINDER_USAGE",
            "Uso: reminders complete <nombre>",
          );
        await macos.completeReminder(name);
        return localSuccessResult(
          "MACOS_REMINDER_COMPLETED",
          `✅ Recordatorio completado: "${name}"`,
        );
      }
      return localErrorResult(
        400,
        "MACOS_REMINDERS_USAGE",
        "Uso: reminders [list|add <nombre>|complete <nombre>]",
      );
    }

    if (parsed.command === "spotlight") {
      const query = parsed.args.join(" ");
      if (!query)
        return localErrorResult(
          400,
          "MACOS_SPOTLIGHT_USAGE",
          "Uso: spotlight <búsqueda>",
        );
      const results = await macos.spotlightSearch(query, { limit: 15 });
      if (results.length === 0)
        return localSuccessResult(
          "MACOS_SPOTLIGHT",
          `🔎 Sin resultados para "${query}".`,
        );
      const formatted = results
        .map((r) => `• [${r.kind}] ${r.name}\n  ${r.path}`)
        .join("\n");
      return localSuccessResult(
        "MACOS_SPOTLIGHT",
        `🔎 Resultados (${results.length}):\n${formatted}`,
        { results },
      );
    }

    if (parsed.command === "shortcut") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "list") {
        const shortcuts = await macos.listShortcuts();
        return localSuccessResult(
          "MACOS_SHORTCUTS",
          `⚡ Shortcuts (${shortcuts.length}):\n${shortcuts.map((s) => `• ${s}`).join("\n")}`,
          { shortcuts },
        );
      }
      if (arg0 === "run") {
        const name = parsed.args.slice(1).join(" ");
        if (!name)
          return localErrorResult(
            400,
            "MACOS_SHORTCUT_USAGE",
            "Uso: shortcut run <nombre>",
          );
        const r = await macos.runShortcut(name);
        return localSuccessResult(
          "MACOS_SHORTCUT_RUN",
          r.success
            ? `⚡ Shortcut "${name}" ejecutado: ${r.output}`
            : `Error: ${r.error}`,
        );
      }
      return localErrorResult(
        400,
        "MACOS_SHORTCUT_USAGE",
        "Uso: shortcut [list|run <nombre>]",
      );
    }

    if (parsed.command === "music") {
      const action = (parsed.args[0] || "status").toLowerCase() as
        | "play"
        | "pause"
        | "next"
        | "previous"
        | "status";
      const app = (parsed.args[1] || "Music") as "Music" | "Spotify";
      const r = await macos.musicControl(action, app);
      const emoji =
        { play: "▶️", pause: "⏸️", next: "⏭️", previous: "⏮️", status: "🎵" }[
          action
        ] || "🎵";
      return localSuccessResult(
        "MACOS_MUSIC",
        r.success ? `${emoji} ${r.output || action}` : `Error: ${r.error}`,
      );
    }

    if (parsed.command === "apps") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "list" || arg0 === "running") {
        const apps = await macos.listRunningApps();
        const formatted = apps
          .map(
            (a) =>
              `• ${a.name}${a.isFrontmost ? " ★" : ""}${a.isHidden ? " (oculto)" : ""}`,
          )
          .join("\n");
        return localSuccessResult(
          "MACOS_APPS",
          `📱 Apps en ejecución (${apps.length}):\n${formatted}`,
          { apps },
        );
      }
      if (arg0 === "front" || arg0 === "active") {
        const app = await macos.getFrontmostApp();
        return localSuccessResult(
          "MACOS_APP_FRONT",
          app ? `📱 App activa: ${app.name}` : "No se pudo determinar.",
          { app },
        );
      }
      return localErrorResult(
        400,
        "MACOS_APPS_USAGE",
        "Uso: apps [list|front]",
      );
    }

    if (parsed.command === "windows") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (!arg0 || arg0 === "list") {
        const appFilter = parsed.args[1] || undefined;
        const windows = await macos.listWindows(appFilter);
        const formatted = windows
          .map(
            (w) =>
              `• [${w.appName}] "${w.windowName}" — ${w.size.width}x${w.size.height} @ (${w.position.x},${w.position.y})${w.minimized ? " 📥" : ""}`,
          )
          .join("\n");
        return localSuccessResult(
          "MACOS_WINDOWS",
          `🪟 Ventanas (${windows.length}):\n${formatted}`,
          { windows },
        );
      }
      return localErrorResult(
        400,
        "MACOS_WINDOWS_USAGE",
        "Uso: windows [list [app]]",
      );
    }

    if (parsed.command === "finder") {
      const arg0 = (parsed.args[0] || "").toLowerCase();
      if (arg0 === "reveal" || arg0 === "show") {
        const filePath = parsed.args.slice(1).join(" ");
        if (!filePath)
          return localErrorResult(
            400,
            "MACOS_FINDER_USAGE",
            "Uso: finder reveal <ruta>",
          );
        await macos.revealInFinder(filePath);
        return localSuccessResult(
          "MACOS_FINDER_REVEAL",
          `📁 Mostrando en Finder: ${filePath}`,
        );
      }
      if (arg0 === "selection") {
        const files = await macos.getFinderSelection();
        return localSuccessResult(
          "MACOS_FINDER_SEL",
          files.length
            ? `📁 Seleccionado:\n${files.map((f) => `• ${f}`).join("\n")}`
            : "📁 Nada seleccionado en Finder.",
          { files },
        );
      }
      return localErrorResult(
        400,
        "MACOS_FINDER_USAGE",
        "Uso: finder [reveal <ruta>|selection]",
      );
    }

    if (parsed.command === "osascript") {
      const script = parsed.args.join(" ");
      if (!script)
        return localErrorResult(
          400,
          "MACOS_OSASCRIPT_USAGE",
          "Uso: osascript <script AppleScript>",
        );
      const r = await macos.runOsascript(script);
      return localSuccessResult(
        "MACOS_OSASCRIPT",
        r.success ? `🍏 Resultado: ${r.output}` : `Error: ${r.error}`,
        { duration: r.duration },
      );
    }

    return localErrorResult(
      400,
      "LOCAL_UNSUPPORTED_COMMAND",
      "Comando no soportado. Usa /local help.",
    );
  } catch (error) {
    const errorMessage =
      (error as Error)?.message || "Fallo al ejecutar accion local.";
    await appendLocalControlAudit("local_control_failed", {
      requestId: context.requestId,
      userId: actor,
      command: parsed.command,
      error: errorMessage,
    });
    return localErrorResult(500, "LOCAL_ACTION_FAILED", errorMessage);
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
    .replace(
      /\b(?:ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?)/gi,
      "[filtered]",
    )
    .replace(
      /\b(?:you\s+are\s+now|act\s+as\s+if|pretend\s+(?:you|that)|system\s*:\s*)/gi,
      "[filtered]",
    )
    .replace(
      /\b(?:disregard|forget|override)\s+(?:all\s+)?(?:previous|above|prior|your)\s+(?:instructions?|rules?|guidelines?|prompt)/gi,
      "[filtered]",
    )
    .replace(
      /\b(?:new\s+instructions?|updated?\s+instructions?|real\s+instructions?):/gi,
      "[filtered]",
    )
    .replace(repeatedPromptPattern, "[filtered]")
    .replace(/\[(?:system|SYSTEM)\]/g, "[filtered]")
    .replace(
      /<\/?(?:system|prompt|instruction|rules?|override)>/gi,
      "[filtered]",
    )
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\/\/\]:\s*#\s*\([\s\S]*?\)/g, "")
    .replace(/\b(?:javascript|vbscript|data)\s*:/gi, "[filtered]:")
    .slice(0, maxLen);
}

function sanitizeStreamIdentifier(
  raw: unknown,
  fallbackPrefix = "stream_req",
): string {
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

function isGoogleGeminiCliProvider(
  provider: unknown,
): provider is typeof GOOGLE_GEMINI_CLI_PROVIDER {
  return (
    sanitizeStreamText(provider, 80).toLowerCase() ===
    GOOGLE_GEMINI_CLI_PROVIDER
  );
}

function isOpenAICodexProvider(
  provider: unknown,
): provider is typeof OPENAI_CODEX_PROVIDER {
  return (
    sanitizeStreamText(provider, 80).toLowerCase() === OPENAI_CODEX_PROVIDER
  );
}

function sanitizeOpenClawSessionSegment(
  value: unknown,
  fallbackPrefix = "openclaw",
): string {
  const normalized = sanitizeStreamText(value, 140)
    .replace(/[^a-zA-Z0-9._:-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_:. -]+|[_:. -]+$/g, "");
  if (normalized) {
    return normalized.slice(0, 120);
  }
  return `${fallbackPrefix}_${uuidv4().replace(/-/g, "").slice(0, 12)}`;
}

function buildOpenClawChatPrompt(
  messages: Array<{ role?: unknown; content?: unknown }>,
  options?: { includeHistory?: boolean },
): { prompt: string; extraSystemPrompt?: string } {
  const normalized = messages
    .map((message) => ({
      role:
        message?.role === "system"
          ? "system"
          : message?.role === "assistant"
            ? "assistant"
            : "user",
      content: extractUserText(message?.content),
    }))
    .filter((message) => message.content.length > 0);

  const latestUserIndex = [...normalized]
    .reverse()
    .findIndex((message) => message.role === "user");
  const resolvedLatestUserIndex =
    latestUserIndex >= 0
      ? normalized.length - 1 - latestUserIndex
      : normalized.length - 1;

  const latestUserMessage = normalized[resolvedLatestUserIndex];
  const prompt =
    latestUserMessage?.content ||
    normalized[normalized.length - 1]?.content ||
    "Ayudame con esta solicitud.";

  const systemContext = sanitizeStreamText(
    normalized
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n"),
    12_000,
  );

  const includeHistory = options?.includeHistory ?? true;
  const conversationHistory = includeHistory
    ? sanitizeStreamText(
        normalized
          .slice(0, Math.max(0, resolvedLatestUserIndex))
          .filter((message) => message.role !== "system")
          .slice(-12)
          .map(
            (message) =>
              `${message.role === "assistant" ? "Asistente" : "Usuario"}: ${message.content}`,
          )
          .join("\n\n"),
        16_000,
      )
    : "";

  const extraSystemPrompt = [
    systemContext,
    conversationHistory ? `Contexto previo:\n${conversationHistory}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    prompt,
    extraSystemPrompt: extraSystemPrompt || undefined,
  };
}

async function runOpenClawOAuthCompletion(params: {
  messages: Array<{ role?: unknown; content?: unknown }>;
  requestId: string;
  model: string;
  provider: typeof GOOGLE_GEMINI_CLI_PROVIDER | typeof OPENAI_CODEX_PROVIDER;
  userId?: string | null;
  chatId?: string | null;
  conversationId?: string | null;
  timeoutMs?: number;
}): Promise<{
  content: string;
  provider: typeof GOOGLE_GEMINI_CLI_PROVIDER | typeof OPENAI_CODEX_PROVIDER;
  model: string;
}> {
  const normalizedUserId = params.userId?.trim();
  if (!normalizedUserId) {
    throw new Error(
      `Debes iniciar sesion en ILIAGPT para usar ${params.provider}.`,
    );
  }

  if (params.provider === GOOGLE_GEMINI_CLI_PROVIDER) {
    const status = await getGoogleGeminiCliOAuthStatus(normalizedUserId);
    if (!status.connected) {
      throw new Error(
        "Primero conecta tu cuenta de Gemini desde el boton + para usar este modelo.",
      );
    }
  } else {
    const status = await getOpenAICodexOAuthStatus(normalizedUserId);
    if (!status.connected) {
      throw new Error(
        "Primero conecta tu cuenta de ChatGPT desde el boton + para usar este modelo.",
      );
    }
  }

  const conversationSeed = sanitizeOpenClawSessionSegment(
    params.chatId || params.conversationId || params.requestId,
    "chat",
  );
  const userSeed = sanitizeOpenClawSessionSegment(normalizedUserId, "user");
  const providerSeed = sanitizeOpenClawSessionSegment(params.provider, "provider");
  const sessionKey = `iliagpt:web:${providerSeed}:${userSeed}:${conversationSeed}`.slice(
    0,
    180,
  );
  const sessionId = `iliagpt-${providerSeed}-${conversationSeed}`.slice(0, 180);
  const sessionDir = path.join(os.tmpdir(), OPENCLAW_WEBCHAT_SESSION_DIR);
  const sessionFile = path.join(sessionDir, `${providerSeed}-${conversationSeed}.jsonl`);
  const workspaceDir = process.env.OPENCLAW_WORKSPACE_ROOT || process.cwd();
  const agentDir = resolveUserScopedAgentDir(normalizedUserId);

  if (!agentDir) {
    throw new Error("No se pudo preparar el contexto OAuth del usuario.");
  }

  await fs.mkdir(sessionDir, { recursive: true });

  let sessionExists = true;
  try {
    await fs.access(sessionFile);
  } catch {
    sessionExists = false;
  }

  const { prompt, extraSystemPrompt } = buildOpenClawChatPrompt(
    params.messages,
    {
      includeHistory: !sessionExists,
    },
  );

  const result = await runEmbeddedPiAgent({
    sessionId,
    sessionKey,
    sessionFile,
    agentDir,
    workspaceDir,
    prompt,
    extraSystemPrompt,
    provider: params.provider,
    model:
      params.model ||
      (params.provider === GOOGLE_GEMINI_CLI_PROVIDER
        ? "gemini-3.1-pro-preview"
        : "gpt-5.3-codex"),
    timeoutMs: params.timeoutMs ?? OPENCLAW_WEBCHAT_TIMEOUT_MS,
    runId: params.requestId,
    disableTools: true,
    messageChannel: "webchat",
    messageProvider: "iliagpt-webchat",
  });

  const content = result.payloads
    ?.map((payload) =>
      typeof payload?.text === "string" ? payload.text.trim() : "",
    )
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!content) {
    throw new Error(
      result.meta?.error?.message ||
        `${params.provider} no devolvio contenido util para esta solicitud.`,
    );
  }

  return {
    content,
    provider: params.provider,
    model:
      params.model ||
      (params.provider === GOOGLE_GEMINI_CLI_PROVIDER
        ? "gemini-3.1-pro-preview"
        : "gpt-5.3-codex"),
  };
}

async function runGoogleGeminiCliCompletion(params: {
  messages: Array<{ role?: unknown; content?: unknown }>;
  requestId: string;
  model: string;
  userId?: string | null;
  chatId?: string | null;
  conversationId?: string | null;
  timeoutMs?: number;
}): Promise<{
  content: string;
  provider: typeof GOOGLE_GEMINI_CLI_PROVIDER;
  model: string;
}> {
  return await runOpenClawOAuthCompletion({
    ...params,
    provider: GOOGLE_GEMINI_CLI_PROVIDER,
  });
}

async function* streamGoogleGeminiCliCompletion(params: {
  messages: Array<{ role?: unknown; content?: unknown }>;
  requestId: string;
  model: string;
  userId?: string | null;
  chatId?: string | null;
  conversationId?: string | null;
}): AsyncGenerator<{
  content: string;
  sequenceId: number;
  done: boolean;
  requestId: string;
  provider: typeof GOOGLE_GEMINI_CLI_PROVIDER;
}> {
  const completion = await runGoogleGeminiCliCompletion(params);

  if (completion.content) {
    yield {
      content: completion.content,
      sequenceId: 1,
      done: false,
      requestId: params.requestId,
      provider: completion.provider,
    };
  }

  yield {
    content: "",
    sequenceId: completion.content ? 2 : 1,
    done: true,
    requestId: params.requestId,
    provider: completion.provider,
  };
}

async function* streamOpenAICodexCompletion(params: {
  messages: Array<{ role?: unknown; content?: unknown }>;
  requestId: string;
  model: string;
  userId?: string | null;
  chatId?: string | null;
  conversationId?: string | null;
}): AsyncGenerator<{
  content: string;
  sequenceId: number;
  done: boolean;
  requestId: string;
  provider: typeof OPENAI_CODEX_PROVIDER;
}> {
  const completion = await runOpenClawOAuthCompletion({
    ...params,
    provider: OPENAI_CODEX_PROVIDER,
  });

  if (completion.content) {
    yield {
      content: completion.content,
      sequenceId: 1,
      done: false,
      requestId: params.requestId,
      provider: OPENAI_CODEX_PROVIDER,
    };
  }

  yield {
    content: "",
    sequenceId: completion.content ? 2 : 1,
    done: true,
    requestId: params.requestId,
    provider: OPENAI_CODEX_PROVIDER,
  };
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
    MAX_STREAM_ATTACHMENT_MIME_LEN,
  );
  if (mimeType && !STREAM_MIME_RE.test(mimeType)) return null;
  const sizeValue = Number(source.size);
  const size =
    Number.isFinite(sizeValue) &&
    sizeValue >= 0 &&
    sizeValue <= MAX_STREAM_ATTACHMENT_SIZE
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

function clampSsePayload<T>(
  payload: T,
  maxBytes: number = MAX_STREAM_EVENT_PAYLOAD_BYTES,
): T {
  const text = JSON.stringify(payload);
  if (text.length <= maxBytes) return payload;
  const candidate: Record<string, unknown> = {
    ...(payload as Record<string, unknown>),
    truncated: true,
  };
  if (candidate.content && typeof candidate.content === "string") {
    candidate.content = sanitizeStreamText(
      candidate.content,
      Math.max(256, maxBytes - 120),
    );
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
        clampSsePayload(
          {
            ...(payload as Record<string, unknown>),
            serializationError: sanitizeStreamText(
              String(serializationError),
              120,
            ),
            truncated: true,
          },
          MAX_STREAM_EVENT_PAYLOAD_BYTES,
        ),
      );
    }
    const chunk = `event: ${sanitizeStreamText(event, 120)}\ndata: ${
      serialized.length > MAX_STREAM_EVENT_PAYLOAD_BYTES
        ? JSON.stringify(
            clampSsePayload(payload, MAX_STREAM_EVENT_PAYLOAD_BYTES),
          )
        : serialized
    }\n\n`;
    res.write(chunk);
    if (typeof (res as unknown as { flush: Function }).flush === "function") {
      (res as unknown as { flush: Function }).flush();
    } else if (res.socket && typeof res.socket.write === "function") {
      res.socket.write("");
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
    console.error("[SSE] Write failed:", err);
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
  const errorMessage = error?.message?.toLowerCase() || "";
  const errorCode = error?.code || error?.statusCode;

  if (
    errorMessage.includes("rate limit") ||
    errorMessage.includes("too many requests") ||
    errorCode === 429
  ) {
    return {
      category: "rate_limit",
      userMessage:
        "Has excedido el límite de solicitudes. Por favor espera unos segundos e intenta de nuevo.",
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 429,
    };
  }

  if (
    errorMessage.includes("timeout") ||
    errorMessage.includes("timed out") ||
    errorCode === "ETIMEDOUT"
  ) {
    return {
      category: "timeout",
      userMessage:
        "La solicitud tardó demasiado tiempo. Por favor intenta de nuevo.",
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 504,
    };
  }

  if (
    errorMessage.includes("network") ||
    errorMessage.includes("econnrefused") ||
    errorMessage.includes("enotfound") ||
    errorCode === "ECONNREFUSED"
  ) {
    return {
      category: "network",
      userMessage:
        "Error de conexión. Verifica tu conexión a internet e intenta de nuevo.",
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 503,
    };
  }

  if (
    errorMessage.includes("unauthorized") ||
    errorMessage.includes("authentication") ||
    errorCode === 401 ||
    errorCode === 403
  ) {
    return {
      category: "auth",
      userMessage: "Error de autenticación. Por favor inicia sesión de nuevo.",
      technicalDetails: error.message,
      requestId,
      retryable: false,
      statusCode: 401,
    };
  }

  if (
    errorMessage.includes("invalid") ||
    errorMessage.includes("validation") ||
    errorCode === 400
  ) {
    return {
      category: "validation",
      userMessage:
        "Los datos enviados no son válidos. Por favor verifica tu solicitud.",
      technicalDetails: error.message,
      requestId,
      retryable: false,
      statusCode: 400,
    };
  }

  if (
    error?.response?.status >= 500 ||
    errorMessage.includes("internal") ||
    errorMessage.includes("server error")
  ) {
    return {
      category: "api_error",
      userMessage:
        "El servicio de IA está experimentando problemas. Por favor intenta de nuevo en unos minutos.",
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 502,
    };
  }

  return {
    category: "unknown",
    userMessage: "Ocurrió un error inesperado. Por favor intenta de nuevo.",
    technicalDetails: error.message || "Unknown error",
    requestId,
    retryable: true,
    statusCode: 500,
  };
}

export function createChatAiRouter(
  broadcastAgentUpdate: (runId: string, update: any) => void,
) {
  const router = Router();

  router.get("/models", (req, res) => {
    res.json(AVAILABLE_MODELS);
  });

  // ── Admin: Prompt Integrity Stats ──
  router.get("/admin/prompt-integrity/stats", async (req, res) => {
    try {
      const stats = await promptAuditStore.getStats();
      res.json(stats);
    } catch (err: any) {
      console.error("[Admin] Prompt integrity stats error:", err?.message);
      res.status(500).json({ error: "Failed to retrieve stats" });
    }
  });

  // Helper function to detect if a file is a document (not an image)
  // Uses mimeType AND file extension for reliable detection
  const isDocumentAttachment = (
    mimeType: string,
    fileName: string,
    type?: string,
  ): boolean => {
    const lowerMime = (mimeType || "").toLowerCase();
    const lowerName = (fileName || "").toLowerCase();
    const lowerType = (type || "").toLowerCase();

    // Check for explicit image type/MIME first
    if (lowerType === "image" || lowerMime.startsWith("image/")) return false;

    // Document MIME patterns
    const docMimePatterns = [
      "pdf",
      "word",
      "document",
      "sheet",
      "excel",
      "spreadsheet",
      "presentation",
      "powerpoint",
      "csv",
      "text/plain",
      "text/csv",
      "application/json",
    ];
    if (docMimePatterns.some((p) => lowerMime.includes(p))) return true;

    // Document file extensions
    const docExtensions = [
      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".ppt",
      ".pptx",
      ".csv",
      ".txt",
      ".json",
      ".rtf",
      ".odt",
      ".ods",
      ".odp",
    ];
    if (docExtensions.some((ext) => lowerName.endsWith(ext))) return true;

    // If type is explicitly a document type
    if (["pdf", "word", "excel", "ppt", "document"].includes(lowerType))
      return true;

    // If mimeType is empty/unknown, check extension before treating as document
    if (!lowerMime || lowerMime === "application/octet-stream") {
      const hasImageExt = [
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".svg",
        ".bmp",
      ].some((ext) => lowerName.endsWith(ext));
      return !hasImageExt; // If not an image extension, treat as document
    }

    return false;
  };

  router.post("/chat", async (req, res) => {
    try {
      const {
        messages: clientMessages,
        useRag = true,
        conversationId,
        images,
        gptConfig,
        gptId: rawGptId,
        documentMode,
        figmaMode,
        provider: rawProvider = DEFAULT_PROVIDER,
        model = DEFAULT_MODEL,
        attachments,
        lastImageBase64,
        lastImageId,
        session_id: rawSessionId,
        skillId,
        skill,
      } = req.body;
      const provider =
        normalizeChatRequestProvider(rawProvider) ?? DEFAULT_PROVIDER;

      if (!clientMessages || !Array.isArray(clientMessages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      // `getUserId` returns an authenticated user (if present). For anonymous users,
      // fall back to a stable, secure cookie-based ID so we can load settings and
      // persist conversation state.
      const effectiveUserId = getUserId(req) || getOrCreateSecureUserId(req);
      const userId = effectiveUserId;

      // Local control commands (safe mode): /local ..., DETENEROFF/DETENERON, and desktop-folder shortcut.
      const latestUserMessage = [...clientMessages]
        .reverse()
        .find((m: any) => m?.role === "user");
      const latestUserText = extractUserText(latestUserMessage?.content);
      const localControlResult = await executeLocalControlRequest(
        latestUserText,
        {
          requestId: `chat_${uuidv4().replace(/-/g, "").slice(0, 16)}`,
          userId,
        },
      );
      if (localControlResult.handled) {
        const localActionArtifact = buildLocalActionArtifact(
          localControlResult.payload || {},
        );
        if (!localControlResult.ok) {
          return res.status(localControlResult.statusCode).json({
            error: localControlResult.message,
            code: localControlResult.code,
            localAction: localControlResult.payload || null,
            artifact: localActionArtifact || null,
          });
        }
        return res.status(200).json({
          content: localControlResult.message,
          provider: "local-system",
          model: "local-system",
          usage: null,
          files: [],
          localAction: {
            code: localControlResult.code,
            ...(localControlResult.payload || {}),
          },
          artifact: localActionArtifact || null,
        });
      }

      // CONTEXT FIX: Augment client messages with server-side history
      const messages = await conversationMemoryManager.augmentWithHistory(
        conversationId,
        clientMessages,
        8000, // token budget
      );
      console.log(
        `[Chat API] Context augmented: ${clientMessages.length} client msgs -> ${messages.length} total`,
      );

      // userId already extracted above

      if (userId) {
        // Anonymous users (anon_*) won't have a `users` row yet. Ensure one exists so
        // quota checks and FK-backed features work instead of hard-failing.
        await ensureUserRowExists(userId);

        // 1. Token Quota Check (Read-only)
        const hasTokenQuota = await usageQuotaService.hasTokenQuota(userId);
        if (!hasTokenQuota) {
          return res.status(402).json({
            error:
              "Has excedido tu límite de tokens. Actualiza tu plan o agrega créditos para continuar.",
            code: "TOKEN_QUOTA_EXCEEDED",
          });
        }

        // 2. Daily Request Limit Check (Increments)
        const usageCheck =
          await usageQuotaService.checkAndIncrementUsage(userId);
        if (!usageCheck.allowed) {
          return res.status(402).json({
            error: usageCheck.message || "Límite de solicitudes alcanzado",
            code: "QUOTA_EXCEEDED",
            quota: {
              remaining: usageCheck.remaining,
              limit: usageCheck.limit,
              resetAt: usageCheck.resetAt,
              plan: usageCheck.plan,
            },
          });
        }
      }

      // GPT Session Contract Resolution
      // Priority: session_id (reuse existing) > gptId (create new) > gptConfig (legacy)
      let gptSessionContract: GptSessionContract | null = null;
      let effectiveModel = model;
      let serverSessionId: string | null = null;
      let effectiveSessionId =
        typeof rawSessionId === "string" ? rawSessionId.trim() : "";
      if (!effectiveSessionId) {
        effectiveSessionId = "";
      }
      let effectiveGptId = typeof rawGptId === "string" ? rawGptId.trim() : "";
      if (effectiveGptId === "default") {
        effectiveGptId = "";
      }

      // Helper to determine if conversationId is valid for session lookup
      const isValidConversationId = (id?: string): boolean => {
        if (!id) return false;
        if (id.startsWith("pending-")) return false;
        if (id.trim() === "") return false;
        return true;
      };

      // If gptId wasn't provided by the client, recover it from chat metadata.
      // This keeps GPT behavior stable on reloads and in partial client states.
      if (!effectiveGptId && isValidConversationId(conversationId)) {
        try {
          const existingChat = await storage.getChat(conversationId);
          const chatGptId =
            typeof existingChat?.gptId === "string"
              ? existingChat.gptId.trim()
              : "";
          if (chatGptId) {
            effectiveGptId = chatGptId;
          }
        } catch (chatLookupError) {
          console.warn(
            "[Chat API] Failed to recover gptId from chat metadata:",
            chatLookupError,
          );
        }
      }

      // Recover session from existing chat if client didn't send session_id.
      if (!effectiveSessionId && isValidConversationId(conversationId)) {
        try {
          const chatSession = await getSessionByChatId(conversationId);
          if (chatSession?.id) {
            effectiveSessionId = chatSession.id;
          }
        } catch (chatSessionError) {
          console.warn(
            "[Chat API] Failed to recover session from chat metadata:",
            chatSessionError,
          );
        }
      }

      // First, try to retrieve existing session by session_id
      if (effectiveSessionId) {
        try {
          gptSessionContract = await getSessionById(effectiveSessionId);
          if (gptSessionContract) {
            const requestedGptId =
              typeof effectiveGptId === "string" ? effectiveGptId.trim() : "";
            if (requestedGptId && requestedGptId !== gptSessionContract.gptId) {
              console.warn(
                `[Chat API] session_id ${effectiveSessionId} belongs to gptId=${gptSessionContract.gptId}, but request asked for gptId=${requestedGptId}. Creating a new matching session.`,
              );
              gptSessionContract = null;
              serverSessionId = null;
            } else {
              serverSessionId = gptSessionContract.sessionId;
              effectiveModel = getEnforcedModel(gptSessionContract, model);
              effectiveGptId = gptSessionContract.gptId;
              console.log(
                `[Chat API] Reusing existing session: session_id=${effectiveSessionId}, gptId=${gptSessionContract.gptId}, configVersion=${gptSessionContract.configVersion}`,
              );
            }
          } else {
            console.log(
              `[Chat API] Session not found: session_id=${effectiveSessionId}, will create new if gptId provided`,
            );
          }
        } catch (sessionError) {
          console.error(
            `[Chat API] Error retrieving session ${effectiveSessionId}:`,
            sessionError,
          );
        }
      }

      // If no session from session_id, try to create/get one via gptId
      if (!gptSessionContract && effectiveGptId) {
        try {
          if (isValidConversationId(conversationId)) {
            // Valid conversationId - use it for session lookup
            gptSessionContract = await getOrCreateSession(
              conversationId,
              effectiveGptId,
            );
            console.log(
              `[Chat API] GPT Session created/retrieved: gptId=${effectiveGptId}, configVersion=${gptSessionContract.configVersion}`,
            );
          } else {
            // No valid conversationId - create session with null chatId (still persisted)
            gptSessionContract = await getOrCreateSession("", effectiveGptId);
            console.log(
              `[Chat API] New GPT Session created: gptId=${effectiveGptId}, sessionId=${gptSessionContract.sessionId}, configVersion=${gptSessionContract.configVersion}`,
            );
          }
          serverSessionId = gptSessionContract.sessionId;
          effectiveModel = getEnforcedModel(gptSessionContract, model);
          effectiveGptId = gptSessionContract.gptId;
        } catch (sessionError) {
          console.error(
            `[Chat API] Error creating GPT session for gptId=${effectiveGptId}:`,
            sessionError,
          );
          // Fall back to legacy gptConfig if session creation fails
        }
      }

      // If the request explicitly targets a GPT, never continue without a valid session contract.
      if (effectiveGptId && !gptSessionContract) {
        return res.status(424).json({
          error: `No se pudo cargar la configuracion del GPT (${effectiveGptId}).`,
          code: "GPT_SESSION_UNAVAILABLE",
        });
      }

      // Track GPT Usage (Fire-and-forget)
      const usageGptId = gptSessionContract?.gptId || effectiveGptId;
      if (usageGptId) {
        storage
          .incrementGptUsage(usageGptId)
          .catch((e) =>
            console.error(
              `[Chat API] Failed to increment GPT usage for ${usageGptId}:`,
              e,
            ),
          );
      }
      if (gptSessionContract && isValidConversationId(conversationId)) {
        storage
          .updateChat(conversationId, { gptId: gptSessionContract.gptId })
          .catch((e) => {
            console.warn(
              `[Chat API] Failed to persist chat.gptId for ${conversationId}:`,
              e,
            );
          });
      }

      // DATA_MODE ENFORCEMENT: Reject document attachments - must use /analyze endpoint
      const normalizedChatAttachments = Array.isArray(attachments)
        ? attachments
            .slice(0, MAX_STREAM_SKILL_ATTACHMENTS)
            .map(sanitizeStreamAttachment)
            .filter(
              (
                att,
              ): att is NonNullable<
                ReturnType<typeof sanitizeStreamAttachment>
              > => !!att,
            )
        : [];
      const hasDocumentAttachments =
        normalizedChatAttachments.length > 0
          ? normalizedChatAttachments.some((a) =>
              isDocumentAttachment(
                a.mimeType || a.type || "",
                a.name || "",
                a.type || a.mimeType || "",
              ),
            )
          : false;

      // Document attachments are now processed inline via the attachment extraction pipeline.
      // The /api/chat/analyze endpoint remains available for dedicated document analysis.

      let attachmentContext = "";
      const hasAttachments = normalizedChatAttachments.length > 0;

      if (hasAttachments) {
        console.log(
          `[Chat API] Processing ${normalizedChatAttachments.length} attachment(s)`,
        );
        try {
          const extractedContents: {
            extracted: Awaited<ReturnType<typeof extractAttachmentContent>>;
            attachment: Attachment;
          }[] = [];
          for (const attachment of normalizedChatAttachments as Attachment[]) {
            const extracted = await extractAttachmentContent(attachment);
            extractedContents.push({ extracted, attachment });
          }

          const failedExtractions = extractedContents.filter(
            (e) => e.extracted === null,
          );
          if (failedExtractions.length > 0) {
            console.warn(
              `[Chat API] Failed to extract content from ${failedExtractions.length} attachment(s):`,
              failedExtractions.map((e) => e.attachment.name).join(", "),
            );
          }
          const successfulExtractions = extractedContents
            .filter((e) => e.extracted !== null)
            .map((e) => e.extracted!);
          if (successfulExtractions.length > 0) {
            attachmentContext = formatAttachmentsAsContext(
              successfulExtractions,
            );
            console.log(
              `[Chat API] Extracted content from ${successfulExtractions.length} attachment(s), context length: ${attachmentContext.length}`,
            );
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
                    metadata: { fileId: attachment.fileId },
                  });
                  console.log(
                    `[Chat API] Persisted document: ${extracted.fileName} to conversation ${conversationId}`,
                  );
                } catch (persistError) {
                  console.error(
                    `[Chat API] Error persisting document ${extracted.fileName}:`,
                    persistError,
                  );
                }
              }
            }
          }
        } catch (attachmentError) {
          console.error(
            "[Chat API] Error extracting attachment content:",
            attachmentError,
          );
        }
      }

      const resolvedSkillContext = await resolveSkillContextFromRequest(
        drizzleSkillStore,
        {
          userId,
          skillId,
          skill,
        },
      );
      const skillSystemSection =
        buildSkillSystemPromptSection(resolvedSkillContext);
      if (skillSystemSection) {
        console.info("[SkillContext] Applied to /api/chat", {
          userId,
          source: resolvedSkillContext?.source,
          skillId: resolvedSkillContext?.id || null,
          skillName: resolvedSkillContext?.name,
        });
      }

      const formattedMessages = messages.map(
        (msg: { role: string; content: string }) => ({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        }),
      );

      const messagesWithSkill = skillSystemSection
        ? [
            { role: "system" as const, content: skillSystemSection },
            ...formattedMessages,
          ]
        : formattedMessages;

      // Build gptSession info - prefer contract-based session over legacy gptConfig
      const gptSession = gptSessionContract
        ? {
            contract: gptSessionContract,
          }
        : gptConfig
          ? {
              contract: null,
              legacyConfig: gptConfig,
            }
          : undefined;

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
        onAgentProgress: (update) => broadcastAgentUpdate(update.runId, update),
      });

      // Token Usage Accounting
      if (userId && response.usage?.totalTokens) {
        usageQuotaService
          .recordTokenUsage(userId, response.usage.totalTokens)
          .catch((err) => {
            console.error(
              `[Chat API] Failed to record token usage for user ${userId}:`,
              err,
            );
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
              tokens: response.usage?.totalTokens || 0,
            },
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
      }

      // Add GPT session metadata to response if contract-based session is active
      const responseWithMetadata = gptSessionContract
        ? {
            ...response,
            gpt_id: gptSessionContract.gptId,
            config_version: gptSessionContract.configVersion,
            tool_permissions: gptSessionContract.toolPermissions,
            session_id: serverSessionId || gptSessionContract.sessionId,
          }
        : response;

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
        retryable: categorized.retryable,
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
          recordingHistoryEnabled:
            userSettings?.featureFlags?.recordingHistoryEnabled ?? false,
        };
        responseStyle =
          userSettings?.responsePreferences?.responseStyle || "default";
        customInstructions =
          userSettings?.responsePreferences?.customInstructions || "";
        userProfile = userSettings?.userProfile || null;
      } catch (e) {
        console.warn(
          "[VoiceChat] Failed to load user settings:",
          (e as any)?.message || e,
        );
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

      const result = await llmGateway.chat(
        [
          {
            role: "system",
            content: `Eres Sira, un asistente de voz amigable y conversacional. 
Responde de manera natural y concisa, como si estuvieras hablando directamente con el usuario.
${featureFlags.voiceAdvanced ? "Puedes dar respuestas un poco más completas (hasta 5 oraciones) cuando haga falta." : "Mantén las respuestas cortas (2-3 oraciones máximo) para que sean fáciles de escuchar."}
Usa un tono cálido y conversacional en español. ${voiceStyleLine}
No uses markdown, emojis ni formatos especiales ya que tu respuesta será leída en voz alta.${userProfileLine ? `\n${userProfileLine}` : ""}${customInstructions ? `\n\nInstrucciones personalizadas del usuario:\n${customInstructions}` : ""}`,
          },
          {
            role: "user",
            content: message,
          },
        ],
        {
          model: featureFlags.voiceAdvanced
            ? "grok-4-fast-non-reasoning"
            : "grok-3-fast",
          temperature: 0.7,
          maxTokens: featureFlags.voiceAdvanced ? 250 : 150,
        },
      );

      // Best-effort: store voice interactions depending on user settings.
      if (
        userId &&
        (featureFlags.memoryEnabled || featureFlags.recordingHistoryEnabled)
      ) {
        void (async () => {
          try {
            await ensureUserRowExists(userId);
            await semanticMemoryStore.initialize();

            if (featureFlags.recordingHistoryEnabled) {
              const stamp = new Date().toISOString();
              const convo = `(${stamp}) Voz: Usuario dijo: "${message}". Asistente respondió: "${result.content}".`;
              await semanticMemoryStore.remember(
                userId,
                convo,
                "conversation",
                {
                  source: "voice_chat",
                  confidence: 0.7,
                },
              );
            }

            if (featureFlags.memoryEnabled) {
              await semanticMemoryStore.extractFromConversation(userId, [
                { role: "user", content: message },
              ]);
            }
          } catch (e) {
            console.warn(
              "[VoiceChat] Failed to store memory:",
              (e as any)?.message || e,
            );
          }
        })();
      }

      res.json({
        success: true,
        response: result.content,
        latencyMs: result.latencyMs,
      });
    } catch (error: any) {
      console.error("Voice chat error:", error);
      res.status(500).json({
        error: "Failed to process voice message",
        details: error.message,
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
        prompt: result.prompt,
      });
    } catch (error: any) {
      console.error("Image generation error:", error);
      res.status(500).json({
        error: "Failed to generate image",
        details: error.message,
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
        indicators: getAvailableIndicators(),
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
        endDate,
      });

      if (result.success && result.workbookBuffer) {
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${result.filename}"`,
        );
        res.send(result.workbookBuffer);
      } else {
        res.status(result.success ? 200 : 500).json({
          success: result.success,
          message: result.message,
          summary: result.summary,
          errors: result.errors,
        });
      }
    } catch (error: any) {
      console.error("ETL API error:", error);
      res.status(500).json({
        error: "ETL pipeline failed",
        details: error.message,
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

  router.post(
    "/chat/stream",
    validate({ body: streamChatRequestSchema }),
    async (req, res) => {
      const requestId = sanitizeStreamIdentifier(
        req.headers["x-request-id"],
        `stream_${Date.now()}`,
      );
      const streamStartMs = performance.now();
      const stageTimings: Record<string, number> = {};
      let firstTokenAtMs: number | null = null;
      let timingReported = false;
      const roundMs = (value: number): number =>
        Number(Math.max(0, value).toFixed(1));
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
          firstTokenAtMs === null ? 0 : roundMs(now - firstTokenAtMs);

        return {
          ...stageTimings,
          totalMs,
          processingMs,
          firstTokenMs:
            firstTokenAtMs === null
              ? null
              : roundMs(firstTokenAtMs - streamStartMs),
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
            `Stream closed after ${STREAM_IDLE_TIMEOUT_MS}ms without SSE activity`,
          );
        }, STREAM_IDLE_TIMEOUT_MS);
      };

      const skipRunStreamDedup = new Map<
        string,
        { requestId: string; startedAt: number }
      >();
      const SKIPRUN_STREAM_DEDUP_TTL_MS = 20_000;

      const buildSkipRunStreamKey = (
        chatId: string | undefined,
        clientRequestId?: string,
        userRequestId?: string,
      ): string | null => {
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
          gptId: rawGptId,
          model,
          provider: rawProvider,
          session_id: rawSessionId,
          docTool: rawDocTool,
          forceWebSearch,
          webSearchAuto,
          latencyMode: rawLatencyMode,
          workspaceContext: rawWorkspaceContext,
          lastImageBase64,
          lastImageId,
          skillId,
          skill,
          skillScopes,
        } = req.body;
        let latencyMode: LatencyMode = ["fast", "deep", "auto"].includes(
          rawLatencyMode,
        )
          ? rawLatencyMode
          : "auto";
        const workspaceContext = normalizeWorkspaceContext(rawWorkspaceContext);
        const effectiveUserId = getOrCreateSecureUserId(req);
        const streamConversationId = sanitizeStreamIdentifier(
          typeof conversationId === "string" && conversationId.trim().length > 0
            ? conversationId
            : typeof chatId === "string" && chatId.trim().length > 0
              ? chatId
              : `chat_${requestId}`,
          "chat_stream",
        );
        let effectiveSessionId =
          typeof rawSessionId === "string" ? rawSessionId.trim() : "";
        if (!effectiveSessionId) {
          effectiveSessionId = "";
        }
        let effectiveGptId =
          typeof rawGptId === "string" ? rawGptId.trim() : "";
        if (effectiveGptId === "default") {
          effectiveGptId = "";
        }

        if (!effectiveGptId) {
          const lookupChatId =
            (typeof chatId === "string" && chatId.trim().length > 0
              ? chatId.trim()
              : "") ||
            (typeof conversationId === "string" &&
            conversationId.trim().length > 0
              ? conversationId.trim()
              : "");
          if (lookupChatId) {
            try {
              const existingChat = await storage.getChat(lookupChatId);
              const chatGptId =
                typeof existingChat?.gptId === "string"
                  ? existingChat.gptId.trim()
                  : "";
              if (chatGptId) {
                effectiveGptId = chatGptId;
              }
            } catch (chatLookupError) {
              console.warn(
                "[Stream] Failed to recover gptId from chat metadata:",
                chatLookupError,
              );
            }
          }
        }

        if (!effectiveSessionId) {
          const lookupChatId =
            (typeof chatId === "string" && chatId.trim().length > 0
              ? chatId.trim()
              : "") ||
            (typeof conversationId === "string" &&
            conversationId.trim().length > 0
              ? conversationId.trim()
              : "");
          if (lookupChatId) {
            try {
              const chatSession = await getSessionByChatId(lookupChatId);
              if (chatSession?.id) {
                effectiveSessionId = chatSession.id;
              }
            } catch (chatSessionError) {
              console.warn(
                "[Stream] Failed to recover session from chat metadata:",
                chatSessionError,
              );
            }
          }
        }

        cleanConversationStreamLocks();
        const queueMode =
          (req.body as any)?.queueMode === "reject" ? "reject" : "replace";
        const existingConversationLock =
          CONVERSATION_STREAM_LOCKS.get(streamConversationId);
        if (
          existingConversationLock &&
          existingConversationLock.requestId !== requestId
        ) {
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
              `Stream exceeded maximum duration of ${STREAM_HARD_TIMEOUT_MS}ms`,
            );
          }, STREAM_HARD_TIMEOUT_MS);
        }
        resetIdleTimeout();

        const parsedSkillScopes = normalizeStreamSkillScopes(skillScopes);
        let docTool: "word" | "excel" | "ppt" | "figma" | null = null;
        if (typeof rawDocTool === "string") {
          const normalizedDocTool = rawDocTool.trim().toLowerCase();
          if (
            normalizedDocTool === "word" ||
            normalizedDocTool === "excel" ||
            normalizedDocTool === "ppt" ||
            normalizedDocTool === "figma"
          ) {
            docTool = normalizedDocTool;
          }
        }

        if (isDebugLogEnabled) {
          // DEBUG: Log attachments received from frontend
          if (
            attachments &&
            Array.isArray(attachments) &&
            attachments.length > 0
          ) {
            console.log(
              `[Stream] INCOMING ATTACHMENTS (${attachments.length}):`,
              JSON.stringify(
                attachments.map((a: any) => ({
                  type: a.type,
                  name: a.name,
                  mimeType: a.mimeType,
                  storagePath: a.storagePath,
                  fileId: a.fileId,
                  hasContent: !!a.content,
                })),
              ),
            );
          } else {
            console.log(
              `[Stream] NO ATTACHMENTS in request body. Keys: ${Object.keys(req.body).join(", ")}`,
            );
          }
          if (lastImageBase64) {
            console.log(
              `[Stream] lastImageBase64 present: ${typeof lastImageBase64 === "string" ? `${lastImageBase64.substring(0, 50)}... (${lastImageBase64.length} chars)` : typeof lastImageBase64}`,
            );
          }

          // DEBUG: Log all incoming request parameters for docTool verification
          // Avoid externally-controlled format strings: don't interpolate user-controlled values into
          // the first console argument (console uses util.format semantics).
          console.log("[Stream] REQUEST RECEIVED", {
            docTool,
            chatId,
            runId,
            forceWebSearch,
          });
          if (workspaceContext) {
            console.log("[Stream] Workspace context", {
              repositoryPath: workspaceContext.repositoryPath,
              selectedFolder: workspaceContext.selectedFolder,
              branch: workspaceContext.branch,
              codingAgents: workspaceContext.codingAgents,
            });
          }
        }

        if (!clientMessages || !Array.isArray(clientMessages)) {
          return res.status(400).json({ error: "Messages array is required" });
        }

        // ── Prompt Integrity Check ──
        // Verify the latest user message was not altered/truncated in transit.
        const clientPromptLen = (req.body as any).clientPromptLen;
        const clientPromptHash = (req.body as any).clientPromptHash;
        if (clientPromptLen != null || clientPromptHash != null) {
          const latestUserForIntegrity = [...clientMessages]
            .reverse()
            .find((m: any) => m?.role === "user");
          if (latestUserForIntegrity?.content) {
            const integrityResult = checkPromptIntegrity(
              latestUserForIntegrity.content,
              clientPromptLen,
              clientPromptHash,
            );

            // Record prompt token estimate
            const promptTokenEst = Math.ceil(
              latestUserForIntegrity.content.length / 4,
            );
            recordPromptTokens(promptTokenEst);
            recordDroppedChars(0); // Invariant: no chars dropped at this stage

            if (!integrityResult.valid) {
              recordIntegrityCheck("fail");
              console.error("[PromptIntegrity] MISMATCH detected", {
                requestId,
                mismatchType: integrityResult.mismatchType,
                clientLen: integrityResult.clientPromptLen,
                serverLen: integrityResult.serverPromptLen,
                lenDelta: integrityResult.lenDelta,
              });
              return res.status(422).json({
                error: "PROMPT_INTEGRITY_MISMATCH",
                message:
                  "The prompt content was altered during transmission. Please retry.",
                details: {
                  mismatchType: integrityResult.mismatchType,
                  serverLen: integrityResult.serverPromptLen,
                  clientLen: integrityResult.clientPromptLen,
                  lenDelta: integrityResult.lenDelta,
                },
              });
            }
            recordIntegrityCheck("pass");
            // Attach integrity metadata to res.locals for downstream logging
            (res as any).locals.promptIntegrity = {
              serverPromptLen: integrityResult.serverPromptLen,
              serverPromptHash: integrityResult.serverPromptHash,
              verified: true,
            };
          }
        } else {
          recordIntegrityCheck("skipped");
        }

        // ── Prompt Pre-Processing Pipeline ──
        // NFC normalization, language detection, structure analysis, dedup, whitespace cleanup.
        const latestUserForPreProcess = [...clientMessages]
          .reverse()
          .find((m: any) => m?.role === "user");
        if (
          latestUserForPreProcess?.content &&
          typeof latestUserForPreProcess.content === "string"
        ) {
          try {
            const preProcessResult = promptPreProcessor.process(
              latestUserForPreProcess.content,
            );
            recordPreprocessDuration(preProcessResult.processingTimeMs);
            if (preProcessResult.nfcApplied) recordNfcNormalization();
            if (preProcessResult.isDuplicate) recordDuplicateDetected();
            recordLanguageDetected(preProcessResult.language.primaryLanguage);

            // Attach to res.locals for downstream use
            (res as any).locals.preProcessResult = preProcessResult;

            // Persist pre-processing transformation to audit trail
            promptAuditStore.logTransformation({
              chatId: chatId || undefined,
              runId: runId || undefined,
              requestId,
              stage: "normalize",
              inputTokens: Math.ceil(preProcessResult.originalText.length / 4),
              outputTokens: Math.ceil(preProcessResult.text.length / 4),
              droppedChars:
                preProcessResult.whitespace.originalLen -
                preProcessResult.whitespace.normalizedLen,
              transformationDetails: {
                nfcApplied: preProcessResult.nfcApplied,
                language: preProcessResult.language.primaryLanguage,
                isMultiLingual: preProcessResult.language.isMultiLingual,
                structureType: preProcessResult.structure.type,
                isDuplicate: preProcessResult.isDuplicate,
                whitespace: preProcessResult.whitespace,
              },
            });
          } catch (ppErr) {
            // Pre-processing is non-critical — log and continue
            console.warn("[PromptPreProcessor] Failed (non-blocking):", ppErr);
          }
        }

        // ── Persist integrity check to audit trail ──
        if (clientPromptLen != null || clientPromptHash != null) {
          const integrityForAudit = (res as any).locals.promptIntegrity;
          if (integrityForAudit) {
            promptAuditStore.saveIntegrityCheck({
              chatId: chatId || undefined,
              runId: runId || undefined,
              messageRole: "user",
              clientPromptLen,
              clientPromptHash,
              serverPromptLen: integrityForAudit.serverPromptLen,
              serverPromptHash: integrityForAudit.serverPromptHash,
              valid: integrityForAudit.verified,
              requestId,
            });
          }
        }

        // Fast local-control path: avoid expensive run-claim/skill-resolution before emitting SSE.
        const latestUserForLocalControl = [...clientMessages]
          .reverse()
          .find((m: any) => m?.role === "user");
        const latestUserTextForLocalControl = extractUserText(
          latestUserForLocalControl?.content,
        );
        console.log(
          "[LocalControl] Stream interception check:",
          JSON.stringify(latestUserTextForLocalControl?.slice(0, 120)),
        );
        const earlyLocalControlResult = await executeLocalControlRequest(
          latestUserTextForLocalControl,
          {
            requestId,
            userId: effectiveUserId,
          },
        );
        console.log(
          "[LocalControl] Stream interception result:",
          earlyLocalControlResult.handled
            ? `HANDLED (${(earlyLocalControlResult as any).code})`
            : "NOT handled — passing to LLM",
        );
        if (earlyLocalControlResult.handled) {
          const localActionPayload = earlyLocalControlResult.payload || {};
          const localActionArtifact =
            buildLocalActionArtifact(localActionPayload);
          if (!res.headersSent) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader(
              "Cache-Control",
              "no-cache, no-store, must-revalidate",
            );
            res.setHeader("Connection", "keep-alive");
            res.setHeader("Transfer-Encoding", "chunked");
            res.setHeader("X-Accel-Buffering", "no");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.setHeader("X-Request-Id", requestId);
            res.setHeader("X-Trace-Id", requestId);
            res.flushHeaders();
            writeSse(res, "start", {
              requestId,
              latencyMode,
              timestamp: Date.now(),
            });
          }

          if (earlyLocalControlResult.ok) {
            writeSse(res, "chunk", {
              content: earlyLocalControlResult.message,
              requestId,
              timestamp: Date.now(),
              localAction: {
                code: earlyLocalControlResult.code,
                ...localActionPayload,
              },
              ...(localActionArtifact ? { artifact: localActionArtifact } : {}),
            });
            writeSse(res, "done", {
              requestId,
              timestamp: Date.now(),
              ...(localActionArtifact ? { artifact: localActionArtifact } : {}),
            });
            return res.end();
          }

          writeSse(res, "error", {
            code: earlyLocalControlResult.code,
            error: earlyLocalControlResult.message,
            requestId,
            timestamp: Date.now(),
            localAction: earlyLocalControlResult.payload || null,
          });
          writeSse(res, "done", { requestId, timestamp: Date.now() });
          return res.end();
        }

        const resolvedSkillContext = await resolveSkillContextFromRequest(
          drizzleSkillStore,
          {
            userId: effectiveUserId,
            skillId,
            skill,
          },
        );
        const skillSystemSection =
          buildSkillSystemPromptSection(resolvedSkillContext);
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
          typeof rawClientRequestId === "string" &&
          rawClientRequestId.trim().length > 0
            ? sanitizeStreamText(rawClientRequestId, MAX_STREAM_REQUEST_ID_LEN)
            : undefined;
        const userRequestId =
          typeof rawUserRequestId === "string" &&
          rawUserRequestId.trim().length > 0
            ? sanitizeStreamText(rawUserRequestId, MAX_STREAM_REQUEST_ID_LEN)
            : undefined;
        const latestUserForRun = [...clientMessages]
          .reverse()
          .find((m: any) => m?.role === "user");
        const latestUserTextForRun = extractUserText(latestUserForRun?.content);
        const sanitizedRunAttachments =
          attachments && Array.isArray(attachments)
            ? attachments
                .slice(0, MAX_STREAM_SKILL_ATTACHMENTS)
                .map(sanitizeStreamAttachment)
                .filter(
                  (
                    att,
                  ): att is NonNullable<
                    ReturnType<typeof sanitizeStreamAttachment>
                  > => !!att?.name,
                )
            : null;

        // Claim run as early as possible (before any expensive routing/search work).
        // This avoids duplicate processing and ensures idempotency responses are true JSON
        // (before SSE headers are sent).
        if (chatId && !claimedRun && (runId || clientRequestId)) {
          const claimStageStart = performance.now();

          let existingRun = runId
            ? await storage.getChatRun(runId)
            : await storage.getChatRunByClientRequestId(
                chatId,
                clientRequestId!,
              );

          // If caller did not provide runId but did provide clientRequestId,
          // create a lightweight run here so streaming can start.
          if (
            !existingRun &&
            !runId &&
            clientRequestId &&
            latestUserTextForRun
          ) {
            const runPrepStart = performance.now();
            try {
              // 1) Prefer linking the run to an already-persisted user message
              // when /chats/:id/messages used skipRun mode.
              const runMessageIdStart = performance.now();
              const runMessageId = userRequestId
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
                      gptId: effectiveGptId || undefined,
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
                  clientRequestId,
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
              existingRun = await storage.getChatRunByClientRequestId(
                chatId,
                clientRequestId,
              );
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
              const runStartedAt = existingRun.startedAt
                ? new Date(existingRun.startedAt).getTime()
                : 0;
              const runAge = Date.now() - runStartedAt;

              // Allow run replacement in two cases:
              // 1. queueMode "replace" (default) — client explicitly wants to supersede
              // 2. Stale run (processing > 5 min) — abandoned connection safety net
              if (queueMode === "replace" || runAge > STALE_RUN_THRESHOLD_MS) {
                const reason =
                  runAge > STALE_RUN_THRESHOLD_MS
                    ? "stale_run_recovered"
                    : "run_replaced";
                console.log(
                  `[Run] Resetting run ${existingRun.id} to pending (${reason}, age=${Math.round(runAge / 1000)}s)`,
                );
                await storage.updateChatRunStatus(
                  existingRun.id,
                  "pending",
                  reason,
                );
                existingRun = { ...existingRun, status: "pending" };
                // Fall through to claim the reset run below
              } else {
                recordStage("run_claim_ms", claimStageStart);
                console.log(
                  `[Run] Run ${existingRun.id} is already being processed (${Math.round(runAge / 1000)}s), returning status`,
                );
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
              console.log(
                `[Run] Run ${existingRun.id} previously failed — resetting to pending for retry`,
              );
              await storage.updateChatRunStatus(existingRun.id, "pending");
              existingRun = { ...existingRun, status: "pending" };
            }

            const claimKey = existingRun.clientRequestId || clientRequestId;
            claimedRun = await storage.claimPendingRun(
              chatId,
              claimKey || undefined,
            );
            recordStage("run_claim_ms", claimStageStart);
            if (!claimedRun) {
              const refreshedRun = runId
                ? await storage.getChatRun(runId)
                : claimKey
                  ? await storage.getChatRunByClientRequestId(chatId, claimKey)
                  : null;
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
              console.log(
                `[Run] Failed to claim run ${existingRun.id} - may have been claimed by another request`,
              );
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

        const provider = normalizeChatRequestProvider(rawProvider);

        const hasAnyAttachments =
          sanitizedRunAttachments && sanitizedRunAttachments.length > 0;
        const lastUserMsg = [...clientMessages]
          .reverse()
          .find((m: any) => m.role === "user");
        const userQuery = extractUserText(lastUserMsg?.content);
        const earlyQuestionClassification = questionClassifier.classifyQuestion(
          userQuery || "",
        );

        // Auto: decide based on complexity signals (simple vs complex).
        if (latencyMode === "auto") {
          if (
            earlyQuestionClassification.type === "greeting" ||
            earlyQuestionClassification.type === "factual_simple" ||
            earlyQuestionClassification.type === "yes_no"
          ) {
            latencyMode = "fast";
          } else if (
            earlyQuestionClassification.type === "analysis" ||
            earlyQuestionClassification.type === "summary" ||
            earlyQuestionClassification.type === "comparison" ||
            earlyQuestionClassification.type === "extraction" ||
            earlyQuestionClassification.type === "action"
          ) {
            latencyMode = "deep";
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
          writeSse(res, "start", {
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
            console.log("[SSE] Connection closed (early handler)", {
              requestId,
            });
          });
        }

        let fullContent = "";
        let lastAckSequence = -1;
        let agentLoopHandled = false;
        let shouldRunModel = true;
        let skillSeedForModel = "";
        // NOTE: doneSent is attached to `res` so that the bundler cannot
        // rename or tree-shake it across try/catch/finally boundaries.
        // Previous attempts with local variables (`let doneSent`, `const streamFlags`)
        // were broken by the bundler renaming the variable in try but not catch/finally.
        (res as any).__doneSent = false;
        let skillExecutionResult: SkillExecutionResult | null = null;

        const effectiveSkillRunId =
          claimedRun?.id ||
          sanitizeStreamText(runId, MAX_STREAM_REQUEST_ID_LEN) ||
          requestId;
        const emitSkillTrace = (trace: {
          stage: string;
          status: string;
          message: string;
          details?: Record<string, unknown>;
        }) => {
          if (isConnectionClosed) {
            return;
          }
          writeSse(res, "skill_trace", {
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
            content: sanitizeStreamText(
              payload.content,
              MAX_STREAM_EVENT_PAYLOAD_BYTES - 1200,
            ),
          };
          lastAckSequence += 1;
          writeSse(res, "skill_chunk", {
            requestId,
            runId: effectiveSkillRunId,
            sequenceId: lastAckSequence,
            timestamp: Date.now(),
            ...safePayload,
          });
        };

        const skillTimeoutMs = 12000;
        const normalizedUserQuery =
          typeof userQuery === "string" ? userQuery.trim() : "";
        if (normalizedUserQuery && !isConnectionClosed) {
          emitSkillTrace({
            stage: "planner",
            status: "ok",
            message: "skill_router_started",
            details: { hasAttachments: hasAnyAttachments },
          });
          try {
            const executeSkillPromise =
              getSkillPlatformService().executeFromMessage({
                requestId,
                conversationId: streamConversationId,
                runId: effectiveSkillRunId,
                userId: effectiveUserId,
                userMessage: normalizedUserQuery,
                attachments: Array.isArray(sanitizedRunAttachments)
                  ? sanitizedRunAttachments
                  : [],
                allowedScopes: parsedSkillScopes,
                autoCreate: true,
                maxRetries: 1,
                emitTrace: emitSkillTrace,
                now: new Date(),
              });
            let skillTimeoutId: NodeJS.Timeout | null = null;
            const timeoutPromise = new Promise<never>((_, reject) => {
              skillTimeoutId = setTimeout(
                () =>
                  reject(
                    new Error(
                      `Skill execution timeout after ${skillTimeoutMs}ms`,
                    ),
                  ),
                skillTimeoutMs,
              );
            });

            try {
              skillExecutionResult = await Promise.race([
                executeSkillPromise,
                timeoutPromise,
              ]);
            } finally {
              if (skillTimeoutId) {
                clearTimeout(skillTimeoutId);
              }
            }
            emitSkillTrace({
              stage: "planner",
              status: "ok",
              message: "skill_router_finished",
              details: {
                status: skillExecutionResult.status,
                continueWithModel: skillExecutionResult.continueWithModel,
              },
            });

            const seed =
              typeof skillExecutionResult.outputText === "string"
                ? skillExecutionResult.outputText.trim()
                : "";
            if (seed) {
              fullContent = seed;
              markFirstToken();
              emitSkillChunk({
                stage: "execution",
                status: skillExecutionResult.status,
                source: skillExecutionResult.autoCreated ? "auto" : "catalog",
                skill: skillExecutionResult.selectedSkill?.slug || null,
                content: seed,
              });
            }

            if (
              skillExecutionResult.status === "partial" &&
              skillExecutionResult.continueWithModel
            ) {
              shouldRunModel = true;
              skillSeedForModel = seed;
            } else {
              shouldRunModel = skillExecutionResult.continueWithModel !== false;
            }

            if (
              skillExecutionResult.status === "blocked" ||
              skillExecutionResult.status === "failed"
            ) {
              writeSse(res, "skill_blocked", {
                requestId,
                runId: effectiveSkillRunId,
                status: skillExecutionResult.status,
                code: skillExecutionResult.error?.code || "SKILL_BLOCKED",
                message:
                  skillExecutionResult.error?.message ||
                  skillExecutionResult.fallbackText ||
                  "Skill no disponible en este momento",
                requiresConfirmation: skillExecutionResult.requiresConfirmation,
                blockedScopes:
                  skillExecutionResult.policyBreached?.blockedScopes || [],
                timestamp: Date.now(),
              });
            }

            if (!seed && skillExecutionResult.fallbackText) {
              fullContent = skillExecutionResult.fallbackText;
              emitSkillChunk({
                stage: "fallback",
                status: skillExecutionResult.status,
                source: "fallback",
                content: skillExecutionResult.fallbackText,
                isFallback: true,
              });
              if (skillExecutionResult.continueWithModel) {
                skillSeedForModel = skillExecutionResult.fallbackText;
              }
              markFirstToken();
            }
          } catch (skillError: any) {
            emitSkillTrace({
              stage: "factory",
              status: "error",
              message: "skill_router_error",
              details: { error: skillError?.message || String(skillError) },
            });
            writeSse(res, "skill_blocked", {
              requestId,
              runId: effectiveSkillRunId,
              status: "failed",
              code: "SKILL_ROUTER_ERROR",
              message:
                "No fue posible usar el enrutador de Skills, se usa fallback al modelo.",
              timestamp: Date.now(),
            });
            skillExecutionResult = {
              status: "failed",
              continueWithModel: true,
              outputText: "",
              autoCreated: false,
              requiresConfirmation: false,
              traces: [],
              fallbackText:
                "No fue posible usar el enrutador de Skills, se usa fallback al modelo.",
              error: {
                code: "SKILL_ROUTER_ERROR",
                message:
                  skillError?.message ||
                  "No se pudo ejecutar el router de Skills",
                retryable: true,
              },
              output: undefined,
              policyBreached: undefined,
              selectedSkill: undefined,
            };
          }
        }

        const skipSkillShortcuts =
          !!skillExecutionResult && skillExecutionResult.status !== "skipped";

        // Ultra-fast path for greetings: avoid expensive intent routing, context hydration,
        // and LLM calls entirely.
        if (
          earlyQuestionClassification.type === "greeting" &&
          !hasAnyAttachments &&
          !docTool &&
          !forceWebSearch &&
          !webSearchAuto &&
          !isConnectionClosed &&
          !skipSkillShortcuts
        ) {
          const isThanks =
            /\b(gracias|muchas\s+gracias|te\s+agradezco)\b/i.test(userQuery);
          const content = isThanks
            ? "De nada. ¿Necesitas algo más?"
            : "Hola. ¿En qué puedo ayudarte?";

          markFirstToken();
          writeSse(res, "chunk", {
            content,
            sequence: 1,
            runId: runId || requestId,
            timestamp: Date.now(),
          });
          writeSse(res, "done", {
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
          latencyMode === "fast" &&
          (earlyQuestionClassification.type === "factual_simple" ||
            earlyQuestionClassification.type === "yes_no") &&
          !hasAnyAttachments &&
          !docTool &&
          !forceWebSearch &&
          !webSearchAuto &&
          !runId &&
          !effectiveGptId &&
          !effectiveSessionId &&
          clientMessages.length <= 2 &&
          !isConnectionClosed &&
          !skipSkillShortcuts
        ) {
          try {
            const answerFirstPrompt =
              answerFirstEnforcer.generateAnswerFirstSystemPrompt(
                userQuery,
                false,
              );
            const fastPathSystemPrompt = `${answerFirstPrompt.fullPrompt}${skillSystemSection}`;
            const llmMessages = [
              { role: "system" as const, content: fastPathSystemPrompt },
              ...clientMessages.map((m: any) => ({
                role: m.role as "user" | "assistant" | "system",
                content: String(m.content ?? ""),
              })),
            ];

            const quick = isGoogleGeminiCliProvider(provider)
              ? await runGoogleGeminiCliCompletion({
                  messages: llmMessages as any,
                  requestId,
                  model: model || "gemini-3.1-pro-preview",
                  userId:
                    effectiveUserId || streamConversationId || "anonymous",
                  chatId: chatId || null,
                  conversationId:
                    conversationId || streamConversationId || null,
                  timeoutMs: OPENCLAW_WEBCHAT_TIMEOUT_MS,
                })
              : isOpenAICodexProvider(provider)
                ? await runOpenClawOAuthCompletion({
                    messages: llmMessages as any,
                    requestId,
                    model: model || "gpt-5.3-codex",
                    provider: OPENAI_CODEX_PROVIDER,
                    userId:
                      effectiveUserId || streamConversationId || "anonymous",
                    chatId: chatId || null,
                    conversationId:
                      conversationId || streamConversationId || null,
                    timeoutMs: OPENCLAW_WEBCHAT_TIMEOUT_MS,
                  })
              : await llmGateway.chat(llmMessages as any, {
                  userId:
                    effectiveUserId || streamConversationId || "anonymous",
                  requestId,
                  model: model || DEFAULT_MODEL,
                  provider,
                  maxTokens: Math.min(answerFirstPrompt.maxTokens || 300, 600), // Was 200 cap — caused mid-sentence truncation on simple questions
                  temperature: 0.2,
                  timeout: 12000,
                  enableFallback: true,
                });

            markFirstToken();
            writeSse(res, "chunk", {
              content: quick.content || "",
              sequence: 1,
              runId: runId || requestId,
              timestamp: Date.now(),
              provider: quick.provider,
            });
            writeSse(res, "done", {
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
            console.warn(
              "[Stream] Simple fast-path failed, falling back to full pipeline:",
              e?.message || e,
            );
          }
        }

        // Load user settings after the stream is already open to reduce perceived latency.
        let userSettings: Awaited<ReturnType<typeof storage.getUserSettings>> =
          null;
        const userSettingsStageStart = performance.now();
        try {
          userSettings = await storage.getUserSettings(effectiveUserId);
        } catch (e) {
          console.warn(
            "[Stream] Failed to load user settings:",
            (e as any)?.message || e,
          );
        } finally {
          recordStage("user_settings_ms", userSettingsStageStart);
        }

        const featureFlags = {
          memoryEnabled: userSettings?.featureFlags?.memoryEnabled ?? false,
          recordingHistoryEnabled:
            userSettings?.featureFlags?.recordingHistoryEnabled ?? false,
          webSearchAuto: userSettings?.featureFlags?.webSearchAuto ?? true,
          codeInterpreterEnabled:
            userSettings?.featureFlags?.codeInterpreterEnabled ?? true,
          canvasEnabled: userSettings?.featureFlags?.canvasEnabled ?? true,
          voiceEnabled: userSettings?.featureFlags?.voiceEnabled ?? true,
          voiceAdvanced: userSettings?.featureFlags?.voiceAdvanced ?? false,
          connectorSearchAuto:
            userSettings?.featureFlags?.connectorSearchAuto ?? false,
        };

        const userId = effectiveUserId;

        // GPT Session Contract Resolution for streaming
        // Priority: session_id (reuse existing) > gptId (create new)
        let gptSessionContract: GptSessionContract | null = null;
        let effectiveModel = model || DEFAULT_MODEL;
        let serverSessionId: string | null = null;
        const effectiveProvider = provider || DEFAULT_PROVIDER;

        const isValidConversationIdForStream = (id?: string): boolean => {
          if (!id) return false;
          if (id.startsWith("pending-")) return false;
          if (id.trim() === "") return false;
          return true;
        };

        // First, try to retrieve existing session by session_id
        if (effectiveSessionId) {
          try {
            gptSessionContract = await getSessionById(effectiveSessionId);
            if (gptSessionContract) {
              const requestedGptId =
                typeof effectiveGptId === "string" ? effectiveGptId.trim() : "";
              if (
                requestedGptId &&
                requestedGptId !== gptSessionContract.gptId
              ) {
                console.warn(
                  `[Stream] session_id ${effectiveSessionId} belongs to gptId=${gptSessionContract.gptId}, but request asked for gptId=${requestedGptId}. Creating a new matching session.`,
                );
                gptSessionContract = null;
                serverSessionId = null;
              } else {
                serverSessionId = gptSessionContract.sessionId;
                effectiveModel = getEnforcedModel(gptSessionContract, model);
                effectiveGptId = gptSessionContract.gptId;
                console.log(
                  `[Stream] Reusing existing session: session_id=${effectiveSessionId}, gptId=${gptSessionContract.gptId}, configVersion=${gptSessionContract.configVersion}`,
                );
              }
            } else {
              console.log(
                `[Stream] Session not found: session_id=${effectiveSessionId}, will create new if gptId provided`,
              );
            }
          } catch (sessionError) {
            console.error(
              `[Stream] Error retrieving session ${effectiveSessionId}:`,
              sessionError,
            );
          }
        }

        // If no session from session_id, try to create/get one via gptId
        if (!gptSessionContract && effectiveGptId) {
          try {
            const effectiveChatIdForSession =
              chatId || conversationId || streamConversationId;
            if (isValidConversationIdForStream(effectiveChatIdForSession)) {
              gptSessionContract = await getOrCreateSession(
                effectiveChatIdForSession,
                effectiveGptId,
              );
              console.log(
                `[Stream] GPT Session created/retrieved: gptId=${effectiveGptId}, configVersion=${gptSessionContract.configVersion}`,
              );
            } else {
              gptSessionContract = await getOrCreateSession("", effectiveGptId);
              console.log(
                `[Stream] New GPT Session created: gptId=${effectiveGptId}, sessionId=${gptSessionContract.sessionId}`,
              );
            }
            serverSessionId = gptSessionContract.sessionId;
            effectiveModel = getEnforcedModel(gptSessionContract, model);
            effectiveGptId = gptSessionContract.gptId;
          } catch (sessionError) {
            console.error(
              `[Stream] Error creating GPT session for gptId=${effectiveGptId}:`,
              sessionError,
            );
          }
        }

        // If the stream explicitly targets a GPT and session resolution fails,
        // build a direct fallback contract from GPT storage to avoid hard UI failure.
        if (effectiveGptId && !gptSessionContract) {
          try {
            const fallbackGpt =
              (await storage.getGpt(effectiveGptId)) ||
              (await storage.getGptBySlug(effectiveGptId));
            if (fallbackGpt) {
              const fallbackKnowledgeItems = await storage
                .getGptKnowledge(fallbackGpt.id)
                .catch(() => []);
              const fallbackKnowledgeContext = buildFallbackKnowledgeContext(
                fallbackKnowledgeItems as any[],
              );
              gptSessionContract = buildFallbackGptSessionContract(
                fallbackGpt,
                requestId,
                fallbackKnowledgeContext,
              );
              effectiveModel = getEnforcedModel(gptSessionContract, model);
              effectiveGptId = gptSessionContract.gptId;
              serverSessionId = gptSessionContract.sessionId;
              writeSse(res, "notice", {
                type: "gpt_session_fallback",
                gptId: gptSessionContract.gptId,
                message:
                  "Se activó recuperación de sesión GPT con configuración persistida.",
                requestId,
                timestamp: Date.now(),
              });
              console.warn(
                `[Stream] GPT fallback contract activated for gptId=${gptSessionContract.gptId}`,
              );
            }
          } catch (fallbackError) {
            console.error(
              `[Stream] GPT fallback contract failed for gptId=${effectiveGptId}:`,
              fallbackError,
            );
          }
        }

        if (effectiveGptId && !gptSessionContract) {
          return res.status(424).json({
            error: `No se pudo cargar la configuracion del GPT (${effectiveGptId}).`,
            code: "GPT_SESSION_UNAVAILABLE",
          });
        }

        // Track GPT Usage (Fire-and-forget)
        const streamUsageGptId = gptSessionContract?.gptId || effectiveGptId;
        if (streamUsageGptId) {
          storage
            .incrementGptUsage(streamUsageGptId)
            .catch((e) =>
              console.error(
                `[Stream] Failed to increment GPT usage for ${streamUsageGptId}:`,
                e,
              ),
            );
        }

        // Session metadata for SSE events
        const sessionMetadata = gptSessionContract
          ? {
              gpt_id: gptSessionContract.gptId,
              config_version: gptSessionContract.configVersion,
              tool_permissions: gptSessionContract.toolPermissions,
              session_id: serverSessionId || gptSessionContract.sessionId,
            }
          : null;

        const gptCapabilityFlags = {
          webBrowsing: gptSessionContract
            ? (gptSessionContract.capabilities.webBrowsing ?? false)
            : true,
          codeInterpreter: gptSessionContract
            ? (gptSessionContract.capabilities.codeInterpreter ?? false)
            : true,
          imageGeneration: gptSessionContract
            ? (gptSessionContract.capabilities.imageGeneration ?? false)
            : true,
          canvas: gptSessionContract
            ? (gptSessionContract.capabilities.canvas ?? false)
            : true,
          wordCreation: gptSessionContract
            ? (gptSessionContract.capabilities.wordCreation ?? false)
            : true,
          excelCreation: gptSessionContract
            ? (gptSessionContract.capabilities.excelCreation ?? false)
            : true,
          pptCreation: gptSessionContract
            ? (gptSessionContract.capabilities.pptCreation ?? false)
            : true,
        };

        if (!docTool) {
          const inferredDocTool = inferDocToolFromPrompt(userQuery || "");
          if (inferredDocTool) {
            const inferredAllowed =
              inferredDocTool === "word"
                ? gptCapabilityFlags.canvas && gptCapabilityFlags.wordCreation
                : inferredDocTool === "excel"
                  ? gptCapabilityFlags.canvas &&
                    gptCapabilityFlags.excelCreation
                  : gptCapabilityFlags.canvas && gptCapabilityFlags.pptCreation;
            if (inferredAllowed) {
              docTool = inferredDocTool;
              writeSse(res, "notice", {
                type: "doc_tool_inferred",
                docTool,
                message: `Se activó automáticamente ${docTool.toUpperCase()} según tu solicitud.`,
                requestId,
                timestamp: Date.now(),
              });
            }
          }
        }

        if (docTool) {
          const docToolAllowed =
            docTool === "word"
              ? gptCapabilityFlags.canvas && gptCapabilityFlags.wordCreation
              : docTool === "excel"
                ? gptCapabilityFlags.canvas && gptCapabilityFlags.excelCreation
                : docTool === "ppt"
                  ? gptCapabilityFlags.canvas && gptCapabilityFlags.pptCreation
                  : gptCapabilityFlags.canvas;

          if (!docToolAllowed) {
            writeSse(res, "notice", {
              type: "capability_disabled",
              capability: docTool,
              message: `La capacidad ${docTool} no está habilitada para este GPT.`,
              requestId,
              timestamp: Date.now(),
            });
            docTool = null;
          }
        }

        const canvasEnabledForRun = gptSessionContract
          ? gptCapabilityFlags.canvas
          : featureFlags.canvasEnabled;
        const webSearchAutoEnabledForRun = gptSessionContract
          ? gptCapabilityFlags.webBrowsing
          : featureFlags.webSearchAuto;
        const codeInterpreterEnabledForRun = gptSessionContract
          ? gptCapabilityFlags.codeInterpreter
          : featureFlags.codeInterpreterEnabled;

        const responseStyle =
          userSettings?.responsePreferences?.responseStyle || "default";
        const customInstructions =
          userSettings?.responsePreferences?.customInstructions || "";
        const userProfile = userSettings?.userProfile || null;

        let detectedWebSources: any[] = [];
        let webSearchContextForLLM = ""; // Will be injected into system prompt

        const requestedWebSearch =
          gptCapabilityFlags.webBrowsing && !!forceWebSearch;
        const autoSearchRequestedByClient =
          gptCapabilityFlags.webBrowsing && !!webSearchAuto;
        const allowAutoSearch =
          gptCapabilityFlags.webBrowsing &&
          (webSearchAutoEnabledForRun || autoSearchRequestedByClient) &&
          !requestedWebSearch &&
          !hasAnyAttachments;
        // Allow web search in ALL latency lanes when auto-search is enabled
        // Previously fast lane blocked auto-search, but this prevented news/current-event queries from working
        const shouldSearch = requestedWebSearch || allowAutoSearch;

        if (shouldSearch && userQuery && !isConnectionClosed) {
          // Emit thinking event so the user sees progress while search runs
          if (!isConnectionClosed) {
            writeSse(res, "thinking", {
              step: "searching",
              message: "Buscando fuentes relevantes...",
              requestId,
              timestamp: Date.now(),
            });
          }
          try {
            const { needsAcademicSearch, needsWebSearch, searchWeb } =
              await import("../services/webSearch");
            const { academicEngineV3, generateAPACitation } =
              await import("../services/academicResearchEngineV3");

            const doAcademic = needsAcademicSearch(userQuery);
            // If a custom GPT explicitly has web browsing enabled, treat auto-search
            // as a strong signal instead of relying only on regex heuristics.
            const forceWebByCapability =
              !requestedWebSearch && !!gptSessionContract && allowAutoSearch;
            const doWeb = requestedWebSearch
              ? !doAcademic
              : forceWebByCapability
                ? !doAcademic
                : needsWebSearch(userQuery);

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
                  sources: [
                    "scielo",
                    "openalex",
                    "semantic_scholar",
                    "crossref",
                    "core",
                    "pubmed",
                    "arxiv",
                    "doaj",
                  ],
                });

                if (engineResult.papers.length > 0) {
                  const academicContext = engineResult.papers
                    .slice(0, 10)
                    .map(
                      (paper, i) =>
                        `[${i + 1}] ${paper.title}\nAutores: ${paper.authors.map((a) => a.name).join(", ") || "No disponible"}\nAño: ${paper.year || "N/A"}\nJournal: ${paper.journal || "N/A"}\nDOI: ${paper.doi || "N/A"}\nURL: ${paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : "N/A")}\nResumen: ${(paper.abstract || "").substring(0, 300)}...\nCita APA: ${generateAPACitation(paper)}`,
                    )
                    .join("\n\n");

                  clientMessages.unshift({
                    role: "system",
                    content: `ARTÍCULOS ACADÉMICOS ENCONTRADOS (${engineResult.papers.length} resultados de ${engineResult.sources.map((s) => s.name).join(", ")}):\n\n${academicContext}\n\nUSA ESTOS ARTÍCULOS para responder al usuario. Incluye citas APA y URLs para cada referencia.`,
                  });

                  detectedWebSources = engineResult.papers
                    .slice(0, 10)
                    .map((paper) => ({
                      url:
                        paper.url ||
                        (paper.doi ? `https://doi.org/${paper.doi}` : ""),
                      title: paper.title,
                      snippet: paper.abstract?.substring(0, 200) || "",
                      domain: paper.journal || "Academic",
                      favicon: null,
                      imageUrl: null,
                      siteName:
                        paper.journal ||
                        engineResult.sources[0]?.name ||
                        "Academic Source",
                      publishedDate: paper.year ? `${paper.year}` : null,
                    }));

                  console.log("[Stream] Academic search complete", {
                    papers: engineResult.papers.length,
                  });
                }
              } catch (academicError) {
                console.error("[Stream] Academic search error:", academicError);
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
                  if (
                    searchResults.contents &&
                    searchResults.contents.length > 0
                  ) {
                    searchContext = searchResults.contents
                      .map(
                        (c: any, i: number) =>
                          `[${i + 1}] ${c.title} (${c.url}):\n${c.content}`,
                      )
                      .join("\n\n");
                    // Add remaining results that only have snippets
                    const contentUrls = new Set(
                      searchResults.contents.map((c: any) => c.url),
                    );
                    const extraResults = searchResults.results
                      .filter((r: any) => !contentUrls.has(r.url))
                      .slice(0, 5);
                    if (extraResults.length > 0) {
                      const startIdx = searchResults.contents.length + 1;
                      searchContext +=
                        "\n\n" +
                        extraResults
                          .map(
                            (r: any, i: number) =>
                              `[${startIdx + i}] ${r.title}: ${r.snippet} (${r.url})`,
                          )
                          .join("\n");
                    }
                  } else {
                    searchContext = searchResults.results
                      .map(
                        (r: any, i: number) =>
                          `[${i + 1}] ${r.title}\n${r.snippet}\nFuente: ${r.url}`,
                      )
                      .join("\n\n");
                  }

                  // Store for injection into system prompt (most reliable path)
                  webSearchContextForLLM = `\n\n---\nBÚSQUEDA WEB REALIZADA - RESULTADOS ACTUALIZADOS:\n${searchContext}\n\nINSTRUCCIÓN CRÍTICA SOBRE LA BÚSQUEDA WEB:\n- Usa TODA la información de los resultados de búsqueda anteriores para dar una respuesta COMPLETA y DETALLADA.\n- NO digas que no tienes acceso a internet, noticias o información actualizada.\n- Los datos anteriores son reales y actuales, obtenidos en tiempo real.\n- Cita las fuentes con [número] al final de cada punto.\n- IGNORA cualquier límite de caracteres o instrucción de brevedad anterior: esta respuesta debe ser EXTENSA y cubrir todos los resultados relevantes.\n- Presenta la información en formato de lista con bullets o numerada, con detalles de cada noticia/resultado.`;

                  detectedWebSources = searchResults.results.map((r: any) => ({
                    url: r.url,
                    title: r.title,
                    snippet: r.snippet,
                    domain: new URL(r.url).hostname.replace("www.", ""),
                    favicon: r.favicon || null,
                    imageUrl: r.imageUrl || null,
                    siteName:
                      r.siteName || new URL(r.url).hostname.replace("www.", ""),
                    publishedDate: r.publishedDate || null,
                  }));

                  console.log("[Stream] Web search complete", {
                    results: searchResults.results.length,
                    contentsCount: searchResults.contents?.length || 0,
                  });
                }
              } catch (webError) {
                console.error("[Stream] Web search error:", webError);
              }
            }
          } catch (importError) {
            console.error(
              "[Stream] Failed to import search modules:",
              importError,
            );
          }
        }

        // CONTEXT FIX: Augment client messages with server-side history
        const effectiveChatId =
          chatId || conversationId || streamConversationId;
        const messages = await conversationMemoryManager.augmentWithHistory(
          effectiveChatId,
          clientMessages,
          8000, // token budget
        );
        console.log(
          `[Stream API] Context augmented: ${clientMessages.length} client msgs -> ${messages.length} total`,
        );

        // DOC TOOL: Stream content directly to client editor (real-time rendering)
        // Previously this routed through handleProductionRequest which generates binary files.
        // Now we let the normal streaming path handle it — content streams to TipTap/Handsontable/PPT editors.
        if (docTool && ["word", "excel", "ppt"].includes(docTool)) {
          console.log(
            `[Stream] 📝 DOC TOOL STREAMING: docTool=${docTool} - using real-time editor streaming`,
          );
        }

        // DATA_MODE ENFORCEMENT: Reject document attachments - must use /analyze endpoint
        const hasDocumentAttachments =
          sanitizedRunAttachments && sanitizedRunAttachments.length > 0
            ? sanitizedRunAttachments.some(
                (a) =>
                  a &&
                  isDocumentAttachment(
                    a.mimeType || a.type || "",
                    a.name || "",
                    a.type || a.mimeType || "",
                  ),
              )
            : false;

        // Document attachments are now processed inline via the attachment extraction pipeline.

        // Get the last user message for PARE routing
        const lastUserMessage = [...messages]
          .reverse()
          .find((m: any) => m.role === "user");
        const userMessageText = lastUserMessage?.content || "";

        // Run Intent Router FIRST for NLU-based intent classification
        let intentResult: IntentResult | null = null;
        if (userMessageText) {
          try {
            intentResult = await routeIntent(userMessageText);
            console.log(
              `[Stream] IntentRouter: intent=${intentResult.intent}, confidence=${intentResult.confidence.toFixed(2)}, format=${intentResult.output_format || "none"}`,
            );

            // PRODUCTION MODE INTERCEPT - Check immediately after intent detection
            // Pass userMessageText to detect if user wants to search for articles first
            if (
              !docTool &&
              canvasEnabledForRun &&
              isProductionIntent(intentResult, userMessageText) &&
              intentResult.confidence >= 0.5
            ) {
              console.log(
                `[Stream] 🚀 PRODUCTION MODE ACTIVATED: intent=${intentResult.intent}, topic=${intentResult.slots.topic}`,
              );

              try {
                const effectiveChatId =
                  chatId || conversationId || streamConversationId;

                await handleProductionRequest(
                  {
                    message: userMessageText,
                    userId: userId,
                    chatId: effectiveChatId,
                    conversationId: streamConversationId,
                    requestId,
                    assistantMessageId,
                    intentResult,
                    locale: intentResult.language_detected || "es",
                  },
                  res,
                );

                // Production handler completed, exit early
                return;
              } catch (productionError: any) {
                console.error(
                  "[Stream] ❌ Production handler error (first intercept), falling back to chat:",
                  productionError?.message || productionError,
                );
                console.error(
                  "[Stream] ❌ Production error stack:",
                  productionError?.stack,
                );
                // Continue to normal chat flow if production fails
              }
            }
          } catch (intentError) {
            console.error("[Stream] IntentRouter error:", intentError);
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
                console.log(
                  `[Stream] Pre-resolved storagePath for ${String(resolved.name || "unknown")}: ${resolved.storagePath}`,
                );
              }
            }
            resolvedAttachments.push(resolved);
          }
        } else if (attachments && Array.isArray(attachments)) {
          for (const att of attachments.slice(
            0,
            MAX_STREAM_SKILL_ATTACHMENTS,
          )) {
            const normalized = sanitizeStreamAttachment(att);
            if (!normalized || !normalized.name) continue;
            const resolved = { ...normalized } as Record<string, unknown>;
            if (!resolved.storagePath && resolved.fileId) {
              const fileRecord = await storage.getFile(String(resolved.fileId));
              if (fileRecord && fileRecord.storagePath) {
                resolved.storagePath = fileRecord.storagePath;
                console.log(
                  `[Stream] Pre-resolved storagePath for ${String(resolved.name || "unknown")}: ${resolved.storagePath}`,
                );
              }
            }
            resolvedAttachments.push(resolved);
          }
        }

        // Convert attachments to PARE format using resolved paths
        const pareAttachments: SimpleAttachment[] = resolvedAttachments.map(
          (att: any) => ({
            name: att.name,
            type: att.type || att.mimeType,
            path: att.storagePath || "",
          }),
        );

        // Use PARE for intelligent routing when attachments are present
        let routeDecision: RobustRouteResult | null = null;
        if (pareOrchestrator.isEnabled() && userMessageText) {
          try {
            routeDecision = pareOrchestrator.robustRoute(
              userMessageText,
              pareAttachments,
            );
            console.log(
              `[Stream] PARE routing: route=${routeDecision.route}, intent=${routeDecision.intent}, confidence=${routeDecision.confidence.toFixed(2)}, tools=${routeDecision.tools.slice(0, 3).join(",")}`,
            );
          } catch (routeError) {
            console.error(
              "[Stream] PARE routing error, falling back to chat:",
              routeError,
            );
          }
        }

        // Create UnifiedChatContext for RequestSpec-driven execution
        const attachmentSpecs: AttachmentSpec[] = resolvedAttachments.map(
          (att: any) => ({
            id: att.fileId || `att_${Date.now()}`,
            name: att.name || "document",
            mimeType: att.mimeType || att.type || "application/octet-stream",
            size: att.size || 0,
            storagePath: att.storagePath,
          }),
        );

        let unifiedContext: UnifiedChatContext | null = null;
        try {
          const effectiveChatId =
            chatId || conversationId || streamConversationId;
          unifiedContext = await createUnifiedRun({
            messages: messages as Array<{ role: string; content: string }>,
            chatId: effectiveChatId,
            userId: userId || "anonymous",
            runId: runId,
            messageId: `msg_${Date.now()}`,
            attachments: attachmentSpecs,
            latencyMode,
            workspaceContext,
          });
          console.log(
            `[Stream] UnifiedContext created - intent: ${unifiedContext.requestSpec.intent}, confidence: ${unifiedContext.requestSpec.intentConfidence.toFixed(2)}, lane: ${unifiedContext.resolvedLane}, primaryAgent: ${unifiedContext.requestSpec.primaryAgent}`,
          );
        } catch (contextError) {
          console.error(
            "[Stream] Failed to create unified context:",
            contextError,
          );
        }

        // If runId provided, claim the pending run (idempotent processing)
        if (runId && chatId && !claimedRun) {
          const existingRun = await storage.getChatRun(runId);
          if (!existingRun) {
            return res.status(404).json({ error: "Run not found" });
          }

          // If run is already processing or done, don't re-process
          if (existingRun.status === "processing") {
            const runStartedAt = existingRun.startedAt
              ? new Date(existingRun.startedAt).getTime()
              : 0;
            const runAge = Date.now() - runStartedAt;
            if (queueMode === "replace" || runAge > 5 * 60 * 1000) {
              const reason =
                runAge > 5 * 60 * 1000 ? "stale_run_recovered" : "run_replaced";
              console.log(
                `[Run] Resetting run ${runId} to pending (${reason}, age=${Math.round(runAge / 1000)}s)`,
              );
              await storage.updateChatRunStatus(
                existingRun.id,
                "pending",
                reason,
              );
              // Fall through to claim below
            } else {
              console.log(
                `[Run] Run ${runId} is already being processed, returning status`,
              );
              return res.json({
                status: "already_processing",
                run: existingRun,
              });
            }
          }
          if (existingRun.status === "done") {
            console.log(`[Run] Run ${runId} already completed`);
            return res.json({ status: "already_done", run: existingRun });
          }
          if (existingRun.status === "failed") {
            console.log(
              `[Run] Run ${runId} previously failed — resetting to pending for retry`,
            );
            await storage.updateChatRunStatus(existingRun.id, "pending");
          }

          // Atomically claim the pending run using clientRequestId for specificity
          claimedRun = await storage.claimPendingRun(
            chatId,
            existingRun.clientRequestId,
          );
          if (!claimedRun || claimedRun.id !== runId) {
            console.log(
              `[Run] Failed to claim run ${runId} - may have been claimed by another request`,
            );
            return res.json({
              status: "claim_failed",
              message: "Run already claimed or not pending",
            });
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
            matched_patterns: intentResult.matched_patterns,
          });

          // If clarification needed, emit immediately so UI can prompt user
          if (
            intentResult.intent === "NEED_CLARIFICATION" &&
            intentResult.clarification_question
          ) {
            writeSse(res, "clarification", {
              question: intentResult.clarification_question,
              confidence: intentResult.confidence,
            });
            console.log(
              `[Stream] Emitted clarification request: "${intentResult.clarification_question}"`,
            );
          }

          // ── Prompt Understanding (sync/heuristic + async deep analysis) ──
          // Extract structured spec from the user's prompt for observability.
          // Sync analysis: always for non-fast mode and prompts > 50 chars.
          // Async analysis: for deep mode or prompts > 500 chars.
          if (
            latencyMode !== "fast" &&
            latestUserTextForRun &&
            latestUserTextForRun.length > 50
          ) {
            try {
              // Sync analysis (< 5ms)
              const syncResult =
                promptAnalysisService.analyzeSync(latestUserTextForRun);
              recordAnalysisDuration(syncResult.processingTimeMs, "sync");

              console.log("[PromptUnderstanding] Sync extraction complete", {
                requestId,
                confidence: syncResult.confidence,
                needsClarification: syncResult.needsClarification,
                processingTimeMs: syncResult.processingTimeMs,
              });

              // Persist sync analysis to audit trail
              promptAuditStore.saveAnalysisResult({
                chatId: chatId || undefined,
                runId: runId || undefined,
                requestId,
                confidence: syncResult.confidence,
                needsClarification: syncResult.needsClarification,
                clarificationQuestions: syncResult.clarificationQuestions,
                extractedSpec: syncResult.spec,
                usedLLM: false,
                processingTimeMs: syncResult.processingTimeMs,
              });

              // Emit spec_extracted notice with analysis results
              if (syncResult.confidence > 0) {
                writeSse(res, "notice", {
                  type: "spec_extracted",
                  spec: syncResult.spec,
                  confidence: syncResult.confidence,
                  requestId,
                  timestamp: Date.now(),
                });
              }

              // Emit low-confidence notice so frontend can display clarification suggestions
              if (
                syncResult.needsClarification &&
                syncResult.confidence < 0.5 &&
                syncResult.clarificationQuestions.length > 0
              ) {
                writeSse(res, "notice", {
                  type: "clarification_needed",
                  confidence: syncResult.confidence,
                  questions: syncResult.clarificationQuestions.slice(0, 5),
                  spec: syncResult.spec,
                  requestId,
                  timestamp: Date.now(),
                });
              }

              // Async deep analysis for complex prompts (non-blocking)
              if (
                (latencyMode === "deep" || latestUserTextForRun.length > 500) &&
                !syncResult.cached
              ) {
                writeSse(res, "notice", {
                  type: "analysis_started",
                  requestId,
                  timestamp: Date.now(),
                });
                // Fire-and-forget: results will be available via cache for future requests
                promptAnalysisService
                  .analyzeAsync(
                    latestUserTextForRun,
                    chatId || undefined,
                    runId || undefined,
                    requestId,
                  )
                  .catch((asyncErr) => {
                    console.warn(
                      "[PromptAnalysis] Async analysis failed (non-blocking):",
                      asyncErr,
                    );
                  });
              }
            } catch (puErr) {
              // PromptUnderstanding is non-critical — log and continue
              console.warn(
                "[PromptUnderstanding] Failed (non-blocking):",
                puErr,
              );
            }
          }

          // PRODUCTION MODE INTERCEPT: Handle document creation requests
          // Debug log to trace production mode evaluation
          console.log(`\n\n🔥🔥🔥 [Stream] PRODUCTION CHECK START 🔥🔥🔥`);
          console.log(
            `[Stream] PRODUCTION CHECK: intent=${intentResult.intent}, confidence=${intentResult.confidence.toFixed(2)}, isProductionIntent=${isProductionIntent(intentResult, userMessageText)}`,
          );
          console.log(`🔥🔥🔥 [Stream] PRODUCTION CHECK END 🔥🔥🔥\n\n`);

          // Pass userMessageText to detect if user wants to search for articles first
          if (
            !docTool &&
            canvasEnabledForRun &&
            isProductionIntent(intentResult, userMessageText) &&
            intentResult.confidence >= 0.5
          ) {
            const effectiveChatId =
              chatId || conversationId || streamConversationId;

            console.log(
              `[Stream] 🚀 PRODUCTION MODE ACTIVATED: intent=${intentResult.intent}, topic=${intentResult.slots.topic}`,
            );

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
                  locale: intentResult.language_detected || "es",
                },
                res,
              );

              // Production handler takes over response, we're done
              if (heartbeatInterval) clearInterval(heartbeatInterval);
              return;
            } catch (productionError: any) {
              console.error(
                "[Stream] ❌ Production handler error (second intercept), falling back to chat:",
                productionError?.message || productionError,
              );
              console.error(
                "[Stream] ❌ Production error stack:",
                productionError?.stack,
              );
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
              if (
                typeof (res as unknown as { flush?: Function }).flush ===
                "function"
              ) {
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
        let persistentConversationDocumentContext = "";
        let batchResult: BatchProcessingResult | null = null;
        const hasAttachments = resolvedAttachments.length > 0;
        const attachmentsCount = hasAttachments
          ? resolvedAttachments.length
          : 0;

        // GUARD: Detect if user requests "analyze all" - requires full coverage
        const userMessage = messages[messages.length - 1]?.content || "";
        const requiresFullCoverage =
          /\b(todos|all|completo|complete|cada|every)\b/i.test(userMessage);

        if (hasAttachments) {
          console.log(
            `[Stream] Processing ${attachmentsCount} attachment(s) as atomic batch:`,
            resolvedAttachments.map((a: any) => ({
              name: a.name,
              type: a.type,
              storagePath: a.storagePath,
              fileId: a.fileId,
            })),
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
                name: att.name || "document",
                mimeType:
                  att.mimeType || att.type || "application/octet-stream",
                storagePath: att.storagePath || "",
                content: att.content,
              }));

            // Skip batch processing if all attachments were images (handled by Vision pipeline)
            if (batchAttachments.length === 0) {
              console.log(
                `[Stream] All attachments are images — skipping DocumentBatchProcessor`,
              );
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
                totalTokens: batchResult.totalTokens,
              });

              // Log per-file stats
              for (const stat of batchResult.stats) {
                console.log(`[Stream] File stats: ${stat.filename}`, {
                  bytesRead: stat.bytesRead,
                  pagesProcessed: stat.pagesProcessed,
                  tokensExtracted: stat.tokensExtracted,
                  parseTimeMs: stat.parseTimeMs,
                  chunkCount: stat.chunkCount,
                  status: stat.status,
                });
              }

              // COVERAGE CHECK: If user asked to analyze "all" files, verify complete coverage
              if (
                requiresFullCoverage &&
                batchResult.processedFiles !== batchResult.attachmentsCount
              ) {
                const failedList = batchResult.failedFiles
                  .map((f) => `${f.filename}: ${f.error}`)
                  .join(", ");
                const errorMsg = `Coverage check failed: processed ${batchResult.processedFiles}/${batchResult.attachmentsCount} files. Failed: ${failedList}`;
                console.error(`[Stream] ${errorMsg}`);

                writeSse(res, "error", {
                  type: "coverage_failure",
                  message:
                    "No se pudieron procesar todos los archivos solicitados",
                  details: {
                    requested: batchResult.attachmentsCount,
                    processed: batchResult.processedFiles,
                    failedFiles: batchResult.failedFiles,
                  },
                  requestId,
                  timestamp: Date.now(),
                });

                clearInterval(heartbeatInterval);
                clearStreamTimeouts();
                return res.end();
              }

              // Use unified context from batch processor
              if (batchResult.unifiedContext) {
                attachmentContext = batchResult.unifiedContext;
                console.log(
                  `[Stream] Unified context from ${batchResult.processedFiles} files, length: ${attachmentContext.length} chars`,
                );
              }
            }
          } catch (batchError: any) {
            console.error("[Stream] Batch processing error:", batchError);

            writeSse(res, "error", {
              type: "batch_processing_error",
              message: "Error al procesar los archivos adjuntos",
              details: batchError.message,
              requestId,
              timestamp: Date.now(),
            });

            clearInterval(heartbeatInterval);
            clearStreamTimeouts();
            return res.end();
          }
        }

        const persistentDocumentChatId = (
          chatId ||
          conversationId ||
          streamConversationId ||
          ""
        ).trim();
        if (!hasAttachments && persistentDocumentChatId) {
          try {
            const conversationDocs =
              await storage.getConversationDocuments(persistentDocumentChatId);
            persistentConversationDocumentContext =
              buildPersistentConversationDocumentContext(conversationDocs);

            if (persistentConversationDocumentContext) {
              console.log("[Stream] Loaded persistent conversation documents", {
                chatId: persistentDocumentChatId,
                documents: conversationDocs.length,
                contextChars: persistentConversationDocumentContext.length,
              });
            }
          } catch (persistentDocError) {
            console.warn(
              "[Stream] Failed to load persistent conversation documents:",
              (persistentDocError as any)?.message || persistentDocError,
            );
          }
        }

        const formattedMessages = messages.map(
          (msg: { role: string; content: string }) => ({
            role: msg.role as "user" | "assistant" | "system",
            content: msg.content,
          }),
        );

        // ── IMAGE VISION SUPPORT ──────────────────────────────────────
        // Collect image data to inject as multimodal content into the last user message.
        // Sources: (1) lastImageBase64 from image-edit flow, (2) image attachments uploaded by user.
        const imagePartsForVision: Array<{
          type: "image_url";
          image_url: { url: string };
        }> = [];

        console.log(
          `[Stream] Vision pipeline: resolvedAttachments=${resolvedAttachments.length}, lastImageBase64=${!!lastImageBase64}, lastImageId=${lastImageId || "none"}`,
        );
        if (resolvedAttachments.length > 0) {
          console.log(
            `[Stream] Vision pipeline: attachments detail:`,
            resolvedAttachments.map((a: any) => ({
              name: a.name,
              type: a.type,
              mimeType: a.mimeType,
              storagePath: a.storagePath,
              fileId: a.fileId,
              hasContent: !!a.content,
            })),
          );
        }

        // Source 1: Image edit context (lastImageBase64 from frontend)
        if (lastImageBase64 && typeof lastImageBase64 === "string") {
          const dataUrl = lastImageBase64.startsWith("data:")
            ? lastImageBase64
            : `data:image/png;base64,${lastImageBase64}`;
          imagePartsForVision.push({
            type: "image_url",
            image_url: { url: dataUrl },
          });
          console.log(
            `[Stream] Vision: injecting lastImageBase64 (${Math.round(lastImageBase64.length / 1024)}KB)`,
          );
        }

        // Source 2: Image attachments (uploaded files with image/* mimeType)
        if (resolvedAttachments.length > 0) {
          for (const att of resolvedAttachments) {
            const mime = (att.mimeType || att.type || "").toLowerCase();
            console.log(
              `[Stream] Vision: checking att "${att.name}" mime="${mime}" isImage=${mime.startsWith("image/")}`,
            );
            if (!mime.startsWith("image/")) continue;

            const storagePath = att.storagePath || "";
            let imageBuffer: Buffer | null = null;

            // Try GCS (object storage) first — production stores files there
            try {
              const objStore = new ObjectStorageService();
              imageBuffer = await objStore.getObjectEntityBuffer(storagePath);
              console.log(
                `[Stream] Vision: loaded image from GCS "${att.name}" (${imageBuffer.length} bytes)`,
              );
            } catch (gcsErr: any) {
              console.log(
                `[Stream] Vision: GCS failed for "${att.name}": ${gcsErr?.message || gcsErr}`,
              );
            }

            // Local file fallback
            if (!imageBuffer) {
              try {
                const fs = await import("fs/promises");
                const path = await import("path");
                let filePath = storagePath;
                const cwd = process.cwd();
                console.log(
                  `[Stream] Vision: local fallback for "${att.name}", storagePath="${storagePath}", cwd="${cwd}"`,
                );
                if (filePath.startsWith("/objects/uploads/")) {
                  filePath = path.default.join(
                    cwd,
                    filePath.replace("/objects/", ""),
                  );
                } else if (filePath.startsWith("/objects/")) {
                  filePath = path.default.join(
                    cwd,
                    filePath.replace("/objects/", ""),
                  );
                } else if (!path.default.isAbsolute(filePath)) {
                  filePath = path.default.join(cwd, "uploads", filePath);
                }
                console.log(`[Stream] Vision: resolved filePath="${filePath}"`);
                // Check if file exists before reading
                try {
                  const stat = await fs.stat(filePath);
                  console.log(
                    `[Stream] Vision: file exists, size=${stat.size} bytes`,
                  );
                } catch {
                  console.warn(
                    `[Stream] Vision: file NOT found at "${filePath}"`,
                  );
                  // Try listing the uploads directory to see what's there
                  try {
                    const uploadsDir = path.default.join(cwd, "uploads");
                    const files = await fs.readdir(uploadsDir);
                    console.log(
                      `[Stream] Vision: uploads dir has ${files.length} files: ${files.slice(0, 10).join(", ")}${files.length > 10 ? "..." : ""}`,
                    );
                  } catch (dirErr: any) {
                    console.warn(
                      `[Stream] Vision: cannot list uploads dir: ${dirErr?.message}`,
                    );
                  }
                }
                imageBuffer = await fs.readFile(filePath);
                console.log(
                  `[Stream] Vision: loaded image from local "${att.name}" (${imageBuffer.length} bytes)`,
                );
              } catch (localErr: any) {
                console.warn(
                  `[Stream] Vision: failed to load image "${att.name}":`,
                  localErr?.message,
                );
              }
            }

            if (imageBuffer) {
              const base64 = imageBuffer.toString("base64");
              const dataUrl = `data:${mime};base64,${base64}`;
              imagePartsForVision.push({
                type: "image_url",
                image_url: { url: dataUrl },
              });
              console.log(
                `[Stream] Vision: added image "${att.name}" to multimodal parts (${Math.round(base64.length / 1024)}KB base64)`,
              );
            } else {
              console.error(
                `[Stream] Vision: FAILED to load image "${att.name}" from ANY source — image will NOT be sent to LLM`,
              );
            }
          }
        }

        console.log(
          `[Stream] Vision: total imagePartsForVision=${imagePartsForVision.length}`,
        );

        // If we have images, convert the last user message to multimodal format
        if (imagePartsForVision.length > 0) {
          for (let i = formattedMessages.length - 1; i >= 0; i--) {
            if (formattedMessages[i].role === "user") {
              const textContent =
                typeof formattedMessages[i].content === "string"
                  ? formattedMessages[i].content
                  : JSON.stringify(formattedMessages[i].content);
              formattedMessages[i] = {
                role: "user",
                content: [
                  ...imagePartsForVision,
                  { type: "text", text: textContent },
                ] as any,
              };
              console.log(
                `[Stream] Vision: converted user message[${i}] to multimodal (${imagePartsForVision.length} images, text="${textContent.substring(0, 100)}")`,
              );
              break;
            }
          }

          // Force deep lane for vision requests (images need more tokens)
          if (latencyMode === "fast") {
            latencyMode = "deep" as LatencyMode;
            console.log(
              `[Stream] Vision: upgraded latency mode to 'deep' for image analysis`,
            );
          }
        } else {
          console.log(
            `[Stream] Vision: NO images found — proceeding with text-only`,
          );
        }

        // GUARD: Block image generation when attachments are present
        if (hasAttachments && attachmentsCount > 0) {
          console.log(
            `[Stream] GUARD: Image generation BLOCKED - ${attachmentsCount} attachments present`,
          );
          // Ensure route decision does not include image generation tools
          if (routeDecision) {
            routeDecision.tools = routeDecision.tools.filter(
              (t) => !["generate_image", "image_gen", "dall_e"].includes(t),
            );
            // Force agent mode for document analysis when attachments present
            if (routeDecision.route === "chat") {
              routeDecision.route = "agent";
              routeDecision.intent = "analysis";
            }
          }
        }

        // Classify the question to set token limits (simple vs complex).
        const questionClassification = questionClassifier.classifyQuestion(
          userMessageText || "",
        );

        // Build Answer-First system prompt based on question type
        const answerFirstPrompt =
          answerFirstEnforcer.generateAnswerFirstSystemPrompt(
            userMessageText,
            hasAttachments,
            attachmentContext,
          );

        const gptSystemContext = gptSessionContract
          ? buildSystemPromptWithContext(gptSessionContract).trim()
          : "";
        let systemContent = gptSystemContext || answerFirstPrompt.fullPrompt;
        if (gptSystemContext) {
          // Keep a light "answer first" nudge, but GPT style instructions must remain dominant.
          systemContent +=
            "\n\n[PREFERENCIA DE RESPUESTA]\nResponde de forma directa sin romper el formato, tono y estructura definidos por este GPT.";
        }

        if (shouldRunModel && skillSeedForModel) {
          systemContent +=
            `\n\n[CONTEXTO SKILL] Ya existe una respuesta parcial: "${skillSeedForModel.slice(0, 2200)}".\n` +
            "Continúa desde ese punto, evitando repetir contenido ya emitido por la Skill, y completa sólo lo faltante con precisión.";
        }

        if (hasAttachments && attachmentContext && batchResult) {
          // Build citation format instructions based on document types
          const citationFormats = batchResult.stats
            .filter((s) => s.status === "success")
            .map((s) => {
              const ext = s.filename.split(".").pop()?.toLowerCase();
              switch (ext) {
                case "pdf":
                  return `- ${s.filename}: [doc:${s.filename} p#]`;
                case "xlsx":
                case "xls":
                  return `- ${s.filename}: [doc:${s.filename} sheet:NombreHoja cell:A1]`;
                case "docx":
                case "doc":
                  return `- ${s.filename}: [doc:${s.filename} p#]`;
                case "pptx":
                case "ppt":
                  return `- ${s.filename}: [doc:${s.filename} slide:#]`;
                case "csv":
                  return `- ${s.filename}: [doc:${s.filename} row:#]`;
                default:
                  return `- ${s.filename}: [doc:${s.filename}]`;
              }
            })
            .join("\n");

          // Add document context to Answer-First prompt
          systemContent += `\n\nDOCUMENTOS PROCESADOS (${batchResult.processedFiles}/${batchResult.attachmentsCount}):
${batchResult.stats.map((s) => `- ${s.filename}: ${s.status === "success" ? `${s.tokensExtracted} tokens` : `ERROR: ${s.error}`}`).join("\n")}

FORMATO DE CITAS REQUERIDO:
${citationFormats}

CONTENIDO DE LOS DOCUMENTOS:
${attachmentContext}`;
        }

        if (!hasAttachments && persistentConversationDocumentContext) {
          systemContent += `\n\nDOCUMENTOS PREVIOS DE ESTA CONVERSACION:\n${persistentConversationDocumentContext}`;
        }

        // Apply user personalization (style, custom instructions, profile) and semantic memory.
        const userProfileContext =
          userProfile &&
          (userProfile.nickname || userProfile.occupation || userProfile.bio)
            ? `\n\nInformación del usuario:${userProfile.nickname ? `\n- Nombre/Apodo: ${userProfile.nickname}` : ""}${userProfile.occupation ? `\n- Ocupación: ${userProfile.occupation}` : ""}${userProfile.bio ? `\n- Bio: ${userProfile.bio}` : ""}`
            : "";

        const customInstructionsSection = customInstructions
          ? `\n\nInstrucciones personalizadas del usuario:\n${customInstructions}`
          : "";

        const responseStyleModifier =
          responseStyle !== "default"
            ? `\n\nEstilo de respuesta preferido: ${
                responseStyle === "formal"
                  ? "formal y profesional"
                  : responseStyle === "casual"
                    ? "casual y amigable"
                    : responseStyle === "concise"
                      ? "muy conciso y breve"
                      : ""
              }`
            : "";

        let semanticMemoryContext: string | null = null;
        if (
          (featureFlags.memoryEnabled ||
            featureFlags.recordingHistoryEnabled) &&
          userId &&
          userMessageText
        ) {
          try {
            await semanticMemoryStore.initialize();
            const types: Array<
              "fact" | "preference" | "conversation" | "instruction" | "note"
            > = [];
            if (featureFlags.memoryEnabled) {
              types.push("fact", "preference", "instruction", "note");
            }
            if (featureFlags.recordingHistoryEnabled) {
              types.push("conversation");
            }

            if (types.length > 0) {
              const results = await semanticMemoryStore.search(
                userId,
                userMessageText,
                {
                  limit: 10,
                  minScore: 0.4,
                  types,
                  hybridSearch: true,
                },
              );

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
                semanticMemoryContext =
                  lines.length > 1 ? lines.join("\n") : null;
              }
            }
          } catch (e) {
            console.warn(
              "[Stream] Failed to load semantic memory:",
              (e as any)?.message || e,
            );
          }
        }

        // If code interpreter is enabled and the user is asking for a chart, force python output.
        const wantsChart =
          /\b(gr[aá]fic[oa]|chart|plot|visualiz|histograma|diagrama de barras|pie chart|scatter|l[ií]nea|barras)\b/i.test(
            userMessageText || "",
          );
        const codeInterpreterPrompt =
          wantsChart &&
          codeInterpreterEnabledForRun &&
          gptCapabilityFlags.codeInterpreter
            ? `\n\n⚠️ CODE INTERPRETER ACTIVO ⚠️\nEl usuario ha solicitado una gráfica/visualización. Responde con un bloque \`\`\`python\`\`\` ejecutable (matplotlib) y NO con una descripción en texto.`
            : "";

        // Current date/time context for real-time awareness
        const now = new Date();
        const currentDateTimeContext = `\n\nFECHA Y HORA ACTUAL:\n- ISO: ${now.toISOString()}`;

        // ── LOCAL CONTROL: inject full local-control context only when relevant ──
        // Avoid overshadowing GPT-specific writing instructions on regular chats.
        const includeLocalControlPrompt =
          isLocalDesktopActionsEnabled() &&
          shouldInjectLocalControlPrompt(userMessageText || "");
        const localControlSystemPrompt = includeLocalControlPrompt
          ? `

[CAPACIDADES DE CONTROL LOCAL — IMPORTANTES]
Tienes acceso COMPLETO a la computadora del usuario a través del sistema de control local. Esto incluye:

🖥️ TERMINAL Y SHELL:
- Ejecutar cualquier comando en la terminal (bash, zsh)
- Persistencia de directorio de trabajo entre comandos
- Historial de comandos ejecutados

📂 ARCHIVOS Y CARPETAS:
- Crear, leer, escribir, editar, copiar, mover, eliminar archivos y carpetas
- Buscar archivos por patrón (find), buscar contenido dentro de archivos (grep)
- Ver árbol de directorios (tree), permisos (chmod), tamaño (du)
- Comparar archivos (diff), ver metadata (stat)

💻 CÓDIGO Y SCRIPTS:
- Ejecutar código Python en línea o archivos .py
- Ejecutar código Node.js/JavaScript en línea o archivos .js
- Ejecutar cualquier script (bash, ruby, etc.) detectando el lenguaje por extensión

📊 SISTEMA:
- Ver procesos activos (ps), matar procesos (kill), ver puertos en uso (ports)
- Monitor del sistema: CPU, RAM, disco, uptime
- Información detallada del sistema (sysinfo)

📦 PAQUETES Y HERRAMIENTAS:
- npm, pip, brew: instalar, listar, actualizar paquetes
- git: status, add, commit, push, pull, diff, log, branch
- docker: ps, images, run, stop, rm

🔧 OTROS:
- Abrir apps o archivos (open), ver variables de entorno (env)
- Buscar ubicación de binarios (which)

CÓMO FUNCIONA: Cuando el usuario pide algo relacionado con su computadora, archivos, terminal, o sistema — TÚ PUEDES HACERLO.
El sistema puede ejecutar acciones locales internamente cuando corresponda.
Responde con resultados concretos (salida, rutas, conteos o estado).
NUNCA le pidas al usuario ejecutar comandos y NUNCA respondas con instrucciones del tipo "/local ...".

IMPORTANTE: NUNCA digas que no tienes acceso a la terminal, archivos, o sistema del usuario. SÍ tienes acceso completo. Siempre intenta ejecutar lo que pide.
Si el usuario pregunta si tienes acceso a su terminal/computadora/archivos, confirma que SÍ y explica brevemente tus capacidades.
`
          : "";

        const workspaceSystemPrompt = workspaceContext
          ? `\n\n[WORKSPACE DE PROGRAMACION ACTIVO]
- Proyecto: ${workspaceContext.projectName || workspaceContext.projectId || "workspace"}
- Repositorio: ${workspaceContext.repositoryPath}
- Carpeta objetivo: ${workspaceContext.selectedFolder || "."}
- Rama activa: ${workspaceContext.branch || "main"}
- Perfiles de agente: ${(workspaceContext.codingAgents || ["coder"]).join(", ")}
- Runtime: ${workspaceContext.runtimeTarget || "Local"}
- Acceso: ${workspaceContext.executionAccess || "Full access"}
INSTRUCCION: cuando la tarea implique programar o editar archivos, opera directamente en esta carpeta objetivo usando herramientas nativas.`
          : "";

        // ── OpenClaw Native Agentic Fusion ──
        // Enrich system prompt with RAG memory, orchestration plans, skills, and channel catalog
        // when the user message contains agentic signals (planning, memory, skills, channels).
        let openclawFusionContext = "";
        if (userMessageText && hasNativeAgenticSignal(userMessageText)) {
          try {
            const fusionResult = await buildNativeAgenticFusion({
              userId: userId || effectiveUserId,
              chatId: chatId || streamConversationId,
              message: userMessageText,
            });
            if (fusionResult.promptAddendum) {
              openclawFusionContext = `\n\n${fusionResult.promptAddendum}`;
              console.log(
                `[Stream] OpenClaw fusion applied: ${fusionResult.appliedModules.join(", ")}`,
              );
            }
          } catch (fusionErr) {
            console.warn(
              "[Stream] OpenClaw fusion failed (non-blocking):",
              (fusionErr as any)?.message || fusionErr,
            );
          }
        }

        systemContent += `${currentDateTimeContext}${localControlSystemPrompt}${workspaceSystemPrompt}${userProfileContext}${customInstructionsSection}${responseStyleModifier}${semanticMemoryContext ? `\n\n${semanticMemoryContext}` : ""}${codeInterpreterPrompt}${webSearchContextForLLM}${skillSystemSection}${openclawFusionContext}`;

        // DOC TOOL: Add format-specific system prompt so the LLM outputs structured content
        // that the client-side editors can render (markdown for Word, CSV for Excel, JSON for PPT)
        if (docTool && ["word", "excel", "ppt"].includes(docTool)) {
          const docSystemPrompts: Record<string, string> = {
            word: "\n\nMODO DOCUMENTO WORD:\nGenera el contenido del documento en formato Markdown bien estructurado con títulos (#, ##, ###), párrafos, listas, tablas y formato de texto (negrita, cursiva). Escribe contenido completo y profesional. No incluyas bloques de código, instrucciones meta ni explicaciones sobre lo que estás haciendo — solo el contenido del documento.",
            excel:
              "\n\nMODO HOJA DE CÁLCULO:\nGenera los datos en formato CSV con cabeceras en la primera fila. Usa comas como separador de columnas y saltos de línea como separador de filas. No incluyas explicaciones ni texto adicional, solo los datos tabulares puros.",
            ppt: '\n\nMODO PRESENTACIÓN:\nGenera una presentación como JSON array de slides con esta estructura: [{"title":"Título de slide", "bullets":["Punto 1","Punto 2"]}, ...]. No incluyas explicaciones ni bloques de código, solo el JSON puro.',
          };
          systemContent += docSystemPrompts[docTool] || "";
          console.log(
            `[Stream] 📝 Added docTool system prompt for: ${docTool}`,
          );
        }

        // Debug: uncomment to trace web search injection
        // console.log(`[Stream:Debug] webSearchContextForLLM length: ${webSearchContextForLLM.length}, systemContent length: ${systemContent.length}`);

        const systemMessage = {
          role: "system" as const,
          content: systemContent,
        };

        // Ensure chat exists so we can persist messages (critical for memory)
        const effectiveChatIdForPersistence =
          chatId || conversationId || streamConversationId;
        const ensureChatStageStart = performance.now();
        try {
          const existingChat = await storage.getChat(
            effectiveChatIdForPersistence,
          );
          if (!existingChat) {
            await storage.createChat({
              id: effectiveChatIdForPersistence,
              title: "New Chat",
              userId: userId || undefined,
              gptId: gptSessionContract?.gptId || effectiveGptId || undefined,
            });
          }
        } catch (e) {
          // Best-effort: if chat creation fails, streaming can still proceed, but memory will degrade.
          console.warn(
            "[Stream] Failed to ensure chat exists for persistence:",
            e,
          );
        } finally {
          recordStage("ensure_chat_ms", ensureChatStageStart);
        }

        if (gptSessionContract) {
          storage
            .updateChat(effectiveChatIdForPersistence, {
              gptId: gptSessionContract.gptId,
            })
            .catch((e) => {
              console.warn(
                `[Stream] Failed to persist chat.gptId for ${effectiveChatIdForPersistence}:`,
                e,
              );
            });
        }

        // Persist the latest user message (best-effort). Without this, server-side memory is empty.
        // Skip if a run was claimed - the user message was already created atomically with the run
        // via createUserMessageAndRun in the /chats/:id/messages endpoint.
        let persistedUserMessageId: string | null =
          claimedRun?.userMessageId || null;
        const persistUserStageStart = performance.now();
        if (!claimedRun) {
          try {
            if (userMessageText && effectiveChatIdForPersistence) {
              // Sanitize attachments: strip large binary/text data, keep only metadata for JSONB storage.
              // The actual file content lives in object storage (storagePath) and conversationDocuments.
              const sanitizedAttachments =
                resolvedAttachments.length > 0
                  ? resolvedAttachments
                      .map((att: any) => {
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
                      })
                      .filter((att: any) => att.name)
                  : attachments &&
                      Array.isArray(attachments) &&
                      attachments.length > 0
                    ? attachments
                        .map((att: any) => ({
                          id: att.id || att.fileId,
                          fileId: att.fileId,
                          name: att.name,
                          type: att.type,
                          mimeType: att.mimeType || att.type,
                          size: att.size,
                          storagePath: att.storagePath,
                        }))
                        .filter((att: any) => att.name)
                    : null;

              const userMsg = await storage.createChatMessage({
                chatId: effectiveChatIdForPersistence,
                role: "user",
                content: userMessageText,
                status: "done",
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
                        (s: any) =>
                          s.filename === att.name && s.status === "success",
                      );
                      if (fileStat) {
                        // Find the matching chunk from batch result for this file's content
                        const fileChunks = batchResult.chunks.filter(
                          (c: any) => c.source === att.name,
                        );
                        if (fileChunks.length > 0) {
                          extractedText = fileChunks
                            .map((c: any) => c.content)
                            .join("\n");
                        }
                      }
                    }

                    await storage.createConversationDocument({
                      chatId: effectiveChatIdForPersistence,
                      messageId: userMsg.id,
                      fileName: att.name || "document",
                      storagePath: att.storagePath || null,
                      mimeType:
                        att.mimeType || att.type || "application/octet-stream",
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
                    console.error(
                      "[Stream] Failed to persist conversationDocument",
                      {
                        fileName: att.name,
                        chatId: effectiveChatIdForPersistence,
                        docError,
                      },
                    );
                  }
                }
              }

              // Also persist into Conversation State (separate store used by /api/memory/chats/:id/state)
              // Best-effort + idempotent (per-request) to avoid UI retry loops duplicating messages.
              await conversationStateService.appendMessage(
                effectiveChatIdForPersistence,
                "user",
                userMessageText,
                {
                  chatMessageId: userMsg.id,
                  requestId: `${requestId}:state:user`,
                },
              );
            }
          } catch (e) {
            console.warn(
              "[Stream] Failed to persist user message (best-effort):",
              e,
            );
          }
        }
        recordStage("persist_user_ms", persistUserStageStart);

        // For claimed runs (run-based flow), the user message was already persisted
        // via createUserMessageAndRun, but conversationDocuments were not created.
        // Persist them now so attachments survive reload.
        if (
          claimedRun &&
          resolvedAttachments.length > 0 &&
          effectiveChatIdForPersistence
        ) {
          for (const att of resolvedAttachments) {
            try {
              let extractedText = att.content || null;
              if (batchResult && batchResult.stats) {
                const fileStat = batchResult.stats.find(
                  (s: any) => s.filename === att.name && s.status === "success",
                );
                if (fileStat) {
                  const fileChunks = batchResult.chunks.filter(
                    (c: any) => c.source === att.name,
                  );
                  if (fileChunks.length > 0) {
                    extractedText = fileChunks
                      .map((c: any) => c.content)
                      .join("\n");
                  }
                }
              }
              await storage.createConversationDocument({
                chatId: effectiveChatIdForPersistence,
                messageId: claimedRun.userMessageId || null,
                fileName: att.name || "document",
                storagePath: att.storagePath || null,
                mimeType:
                  att.mimeType || att.type || "application/octet-stream",
                fileSize: att.size || null,
                extractedText,
                metadata: { fileId: att.fileId || att.id },
              });
              console.log("[Stream] Persisted conversationDocument (run)", {
                fileName: att.name,
                chatId: effectiveChatIdForPersistence,
              });
            } catch (docError) {
              console.error(
                "[Stream] Failed to persist conversationDocument (run)",
                {
                  fileName: att.name,
                  chatId: effectiveChatIdForPersistence,
                  docError,
                },
              );
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
                { role: "user", content: userMessageText },
              ]);
            } catch (e) {
              console.warn(
                "[Stream] Failed to extract/store semantic memory:",
                (e as any)?.message || e,
              );
            }
          })();
        }

        // Create an assistant message placeholder at the start (so we can stream-update and persist)
        const assistantPlaceholderStageStart = performance.now();
        try {
          const assistantMessage = await storage.createChatMessage({
            chatId: effectiveChatIdForPersistence,
            role: "assistant",
            content: "…", // Placeholder updated during streaming
            status: "pending",
            runId: claimedRun?.id,
            userMessageId:
              claimedRun?.userMessageId || persistedUserMessageId || undefined,
            // chat_messages has a global UNIQUE(request_id). The user message above uses requestId,
            // so the assistant placeholder must NOT reuse it.
            requestId: claimedRun ? undefined : `${requestId}:assistant`,
          });
          assistantMessageId = assistantMessage.id;

          if (claimedRun) {
            await storage.updateChatRunAssistantMessage(
              claimedRun.id,
              assistantMessageId,
            );
          }
        } catch (e) {
          console.warn(
            "[Stream] Failed to create assistant placeholder message (best-effort):",
            e,
          );
        } finally {
          recordStage(
            "assistant_placeholder_ms",
            assistantPlaceholderStageStart,
          );
        }

        const effectiveRunId =
          claimedRun?.id || unifiedContext?.runId || requestId;

        // Enriched context event — only emit when connection is alive.
        // Use nullish fallbacks so the frontend receives valid metadata even
        // if unifiedContext creation failed.
        if (!isConnectionClosed) {
          writeSse(res, "context", {
            requestId,
            runId: effectiveRunId,
            assistantMessageId,
            latencyMode,
            latencyLane: unifiedContext?.resolvedLane || "fast",
            intent: unifiedContext?.requestSpec?.intent ?? "chat",
            intentConfidence:
              unifiedContext?.requestSpec?.intentConfidence ?? 0,
            deliverableType:
              unifiedContext?.requestSpec?.deliverableType ?? null,
            primaryAgent: unifiedContext?.requestSpec?.primaryAgent ?? null,
            targetAgents: unifiedContext?.requestSpec?.targetAgents ?? [],
            isAgenticMode: unifiedContext?.isAgenticMode ?? false,
            workspaceContext: workspaceContext
              ? {
                  repositoryPath: workspaceContext.repositoryPath,
                  selectedFolder: workspaceContext.selectedFolder,
                  branch: workspaceContext.branch,
                  codingAgents: workspaceContext.codingAgents,
                }
              : undefined,
            webSources:
              detectedWebSources.length > 0 ? detectedWebSources : undefined,
            timestamp: Date.now(),
            ...sessionMetadata,
          });
        }

        emitTraceEvent(effectiveRunId, "task_start", {
          metadata: {
            chatId,
            userId,
            message:
              messages[messages.length - 1]?.content?.slice(0, 200) || "",
            intent: unifiedContext?.requestSpec.intent,
            intentConfidence: unifiedContext?.requestSpec.intentConfidence,
            deliverableType: unifiedContext?.requestSpec.deliverableType,
            attachmentsCount: attachmentsCount,
            isAgenticMode: unifiedContext?.isAgenticMode,
            workspaceRepository: workspaceContext?.repositoryPath,
            workspaceFolder: workspaceContext?.selectedFolder,
            workspaceBranch: workspaceContext?.branch,
          },
        }).catch(() => {});

        if (unifiedContext?.requestSpec.sessionState) {
          emitTraceEvent(effectiveRunId, "memory_loaded", {
            memory: {
              keys: unifiedContext.requestSpec.sessionState.memoryKeys,
              loaded: unifiedContext.requestSpec.sessionState.turnNumber,
            },
          }).catch(() => {});
        }

        if (unifiedContext?.isAgenticMode) {
          emitTraceEvent(effectiveRunId, "agent_delegated", {
            agent: {
              name: unifiedContext.requestSpec.primaryAgent,
              role: "primary",
              status: "active",
            },
          }).catch(() => {});
        }

        emitTraceEvent(effectiveRunId, "thinking", {
          content: `Analyzing request: ${unifiedContext?.requestSpec.intent || "chat"}`,
          phase: "planning",
        }).catch(() => {});

        // Apply dynamic token limit based on question type (Answer-First)
        const hasWebSearchContext = webSearchContextForLLM.length > 0;
        const effectiveMaxTokens = hasWebSearchContext
          ? 2500 // Web search responses need room to summarize results with citations
          : questionClassification.type === "summary" ||
              questionClassification.type === "analysis"
            ? 2000 // Allow longer responses for summaries/analysis
            : questionClassification.maxTokens * 4; // Apply stricter limit for factual questions

        console.log(
          `[Stream] Answer-First: type=${questionClassification.type}, maxTokens=${effectiveMaxTokens}, hasWebSearch=${hasWebSearchContext}`,
        );

        // Apply latency-lane-aware token limit:
        //  fast → hard cap to keep response short & snappy (but not when web search is active)
        //  deep → use the question-classification-derived limit
        const resolvedLane = unifiedContext?.resolvedLane || "fast";
        const safeMaxTokens =
          Number.isFinite(effectiveMaxTokens) && effectiveMaxTokens > 0
            ? effectiveMaxTokens
            : 1000; // safety floor
        const laneMaxTokens = hasWebSearchContext
          ? safeMaxTokens // Web search results need full token budget regardless of lane
          : resolvedLane === "fast"
            ? Math.min(safeMaxTokens, 1200) // Was 400 — too restrictive, caused mid-sentence truncation
            : safeMaxTokens;

        // Emit thinking event so user sees we're about to generate
        if (!isConnectionClosed) {
          writeSse(res, "thinking", {
            step: "generating",
            message:
              resolvedLane === "fast"
                ? "Generando respuesta..."
                : "Generando respuesta detallada...",
            requestId,
            timestamp: Date.now(),
          });
        }

        // ── AGENT LOOP INTERCEPT ──────────────────────────────────
        // Route agentic intents through executeAgentLoop so tools run natively
        // instead of falling back to plain text instructions.
        const localFsSignal =
          /\b(?:carpetas?|caprteas?|careptas?|carpteas?|folders?|directorios?|directories?|archivos?|files?)\b.*\b(?:mac|computadora|pc|laptop|sistema|escritorio|desktop|descargas|downloads|documentos|documents|home|disco)\b|\b(?:analiza|explora|listar|list|revisa|cuenta|count|cu[aá]ntas?)\b.*\b(?:mi\s+(?:mac|computadora|pc)|desktop|escritorio|home)\b/i.test(
            userMessageText || "",
          );
        const agentLoopIntents = new Set([
          "web_automation",
          "multi_step_task",
          "research",
          "data_analysis",
          "document_analysis",
          "code_generation",
          "document_generation",
        ]);
        const workspaceCodeIntent =
          Boolean(workspaceContext?.repositoryPath) &&
          (unifiedContext?.requestSpec.intent === "code_generation" ||
            /\b(c[oó]digo|code|refactor|implementa|fix|bug|archivo|file|repo|repositorio)\b/i.test(
              userMessageText || "",
            ));
        const shouldRouteThroughAgentLoop =
          shouldRunModel &&
          Boolean(unifiedContext?.isAgenticMode) &&
          (agentLoopIntents.has(unifiedContext!.requestSpec.intent) ||
            localFsSignal ||
            workspaceCodeIntent);

        if (shouldRouteThroughAgentLoop) {
          const activeIntent = unifiedContext?.requestSpec?.intent || "unknown";
          console.log(
            `[Stream] 🤖 AGENT LOOP: routing intent=${activeIntent} through executeAgentLoop`,
          );
          try {
            const agentMessages = [
              {
                role: "system",
                content:
                  typeof systemMessage.content === "string"
                    ? systemMessage.content
                    : "",
              },
              ...formattedMessages.map((m: any) => ({
                role: m.role as string,
                content:
                  typeof m.content === "string"
                    ? m.content
                    : JSON.stringify(m.content),
              })),
            ];

            const agentResponse = await executeAgentLoop(agentMessages, res, {
              runId: effectiveRunId,
              userId: userId || streamConversationId || "anonymous",
              chatId: effectiveChatIdForPersistence,
              requestSpec: unifiedContext.requestSpec,
              maxIterations: 10,
              workspaceContext,
            });

            // Use the real response from the agent loop (not a placeholder)
            // The agent loop already wrote chunk SSE events — fullContent is used for DB persistence
            fullContent =
              agentResponse ||
              "He procesado tu solicitud de automatización web.";
            if (fullContent.trim()) {
              markFirstToken();
            }
            agentLoopHandled = true;
            console.log(
              `[Stream] Agent loop completed, fullContent length: ${fullContent.length}`,
            );
          } catch (agentError: any) {
            console.error(
              `[Stream] Agent loop error:`,
              agentError?.message || agentError,
            );
            // If the agent already sent some chunks (e.g. browse_and_act ran but
            // the follow-up LLM failed), use whatever was sent as the final content
            // rather than falling back to a completely different LLM stream.
            if (fullContent.trim()) {
              agentLoopHandled = true;
            } else {
              // Provide a direct fallback message instead of falling through to
              // normal streaming which would ignore agentic execution context.
              const failedIntent =
                unifiedContext?.requestSpec?.intent || "agentic_task";
              fullContent =
                `Intenté ejecutar la solicitud (${failedIntent}) pero encontré un problema. ` +
                "Inténtalo de nuevo o reformula la petición.";
              agentLoopHandled = true;
              if (!isConnectionClosed) {
                writeSse(res, "chunk", {
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
            modelMessages.push({
              role: "assistant",
              content: skillSeedForModel,
            });
          }
          const streamLlmOptions = {
            userId: userId || streamConversationId || "anonymous",
            requestId,
            model: effectiveModel,
            provider: effectiveProvider,
            disableImageGeneration: hasAttachments,
            maxTokens: laneMaxTokens,
          };

          const streamGenerator = isGoogleGeminiCliProvider(effectiveProvider)
            ? streamGoogleGeminiCliCompletion({
                messages: modelMessages as any,
                requestId,
                model: effectiveModel || "gemini-3.1-pro-preview",
                userId: userId || streamConversationId || "anonymous",
                chatId: chatId || null,
                conversationId: conversationId || streamConversationId || null,
              })
            : isOpenAICodexProvider(effectiveProvider)
              ? streamOpenAICodexCompletion({
                  messages: modelMessages as any,
                  requestId,
                  model: effectiveModel || "gpt-5.3-codex",
                  userId: userId || streamConversationId || "anonymous",
                  chatId: chatId || null,
                  conversationId: conversationId || streamConversationId || null,
                })
              : llmGateway.streamChat(modelMessages, streamLlmOptions);

          // Emit SSE notice if context was truncated (non-blocking, before streaming tokens)
          const truncationInfo = (streamLlmOptions as any).__truncationResult;
          if (truncationInfo?.truncationApplied) {
            recordTruncation(
              truncationInfo.originalTokens,
              truncationInfo.finalTokens,
              truncationInfo.droppedMessages,
            );
            recordContextStrategy(
              truncationInfo.metadata?.strategy || "sliding_window",
            );
            if (truncationInfo.metadata?.mustKeepPreserved) {
              recordMustKeepSpans(truncationInfo.metadata.mustKeepPreserved);
            }
            writeSse(res, "notice", {
              type: "context_truncated",
              originalTokens: truncationInfo.originalTokens,
              finalTokens: truncationInfo.finalTokens,
              droppedMessages: truncationInfo.droppedMessages,
              truncatedMessageCount: truncationInfo.truncatedMessageCount,
              strategy: truncationInfo.metadata?.strategy,
              requestId,
              timestamp: Date.now(),
            });

            // Persist truncation to audit trail
            promptAuditStore.logTransformation({
              chatId: chatId || undefined,
              runId: runId || undefined,
              requestId,
              stage: "truncate",
              inputTokens: truncationInfo.originalTokens,
              outputTokens: truncationInfo.finalTokens,
              droppedMessages: truncationInfo.droppedMessages,
              droppedChars: 0,
              transformationDetails: {
                strategy: truncationInfo.metadata?.strategy,
                mustKeepPreserved: truncationInfo.metadata?.mustKeepPreserved,
                originalMessageCount:
                  truncationInfo.metadata?.originalMessageCount,
                keptMessageCount: truncationInfo.metadata?.keptMessageCount,
              },
            });
          }

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
              await storage.updateChatRunLastSeq(
                claimedRun.id,
                chunk.sequenceId,
              );
            }

            if (chunk.done) {
              // Flush remaining buffered content before done event
              writer.finalize();

              console.log(
                `[Stream] Sending 'done' event with ${detectedWebSources.length} webSources`,
              );
              (res as any).__doneSent = true;
              writeSse(res, "done", {
                sequenceId: chunk.sequenceId,
                requestId: chunk.requestId,
                runId: effectiveRunId,
                intent: unifiedContext?.requestSpec.intent,
                latencyLane: resolvedLane,
                webSources:
                  detectedWebSources.length > 0
                    ? detectedWebSources
                    : undefined,
                traceId: requestId,
                timings: buildTimingPayload(),
                timestamp: Date.now(),
                ...sessionMetadata,
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
            writeSse(res, "chunk", {
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
            // --- Persistent CoT Integration ---
            const traceHistory = agentEventBus.getHistory(effectiveRunId);
            const cotSteps = traceHistory
              .filter(
                (e) =>
                  e.event_type === "thinking" ||
                  e.event_type === "tool_call_started",
              )
              .map((e) => ({
                title:
                  e.event_type === "thinking"
                    ? (e as any).message ||
                      (e as any).payload?.content ||
                      "Analizando contexto..."
                    : `Sistema: ${(e as any).payload?.toolCall?.name || "Iniciando skill"}`,
                status: "complete",
              }));

            const metadata: Record<string, any> = {};
            if (detectedWebSources.length > 0)
              metadata.webSources = detectedWebSources;
            if (cotSteps.length > 0) metadata.steps = cotSteps;

            const finalMetadata =
              Object.keys(metadata).length > 0 ? metadata : undefined;

            await storage.updateChatMessageContent(
              assistantMessageId,
              fullContent,
              "done",
              finalMetadata,
            );

            // Also persist assistant into Conversation State so /api/memory/chats/:id/state reflects reality.
            // Best-effort + idempotent.
            await conversationStateService.appendMessage(
              effectiveChatIdForPersistence,
              "assistant",
              fullContent,
              {
                chatMessageId: assistantMessageId,
                requestId: `${requestId}:state:assistant`,
                metadata: finalMetadata || undefined,
              },
            );
          } catch (e) {
            console.warn(
              "[Stream] Failed to finalize assistant message (best-effort):",
              e,
            );
          }
        }
        recordStage("finalize_persistence_ms", finalizePersistenceStageStart);

        // Mark run as done if we claimed one
        if (claimedRun) {
          await storage.updateChatRunStatus(claimedRun.id, "done");
          runFinalized = true;
        }

        // Fire-and-forget: Generate an AI-powered descriptive title for this chat
        // based on the user's message and the assistant's response.
        if (
          effectiveChatIdForPersistence &&
          userMessageText &&
          fullContent.trim()
        ) {
          void generateAndPersistChatTitle(
            effectiveChatIdForPersistence,
            userMessageText,
            fullContent,
          ).catch((e) =>
            console.warn("[Stream] Async title generation failed:", e),
          );
        }

        const durationMs = unifiedContext
          ? Date.now() - unifiedContext.startTime
          : 0;
        const finalTimings = reportTimings("completed");
        const finalSequenceCount =
          fullContent.trim() && lastAckSequence < 0
            ? 1
            : Math.max(0, lastAckSequence + 1);

        if (!isConnectionClosed) {
          if (unifiedContext?.isAgenticMode) {
            emitTraceEvent(effectiveRunId, "agent_completed", {
              agent: {
                name: unifiedContext.requestSpec.primaryAgent,
                role: "primary",
                status: "completed",
              },
              durationMs,
            }).catch(() => {});
          }

          // Send done event with webSources for frontend NewsCards
          if (!(res as any).__doneSent) {
            (res as any).__doneSent = true;
            writeSse(res, "done", {
              requestId,
              runId: effectiveRunId,
              assistantMessageId,
              latencyLane: resolvedLane,
              webSources:
                detectedWebSources.length > 0 ? detectedWebSources : undefined,
              traceId: requestId,
              timings: finalTimings,
              timestamp: Date.now(),
            });
          }

          writeSse(res, "complete", {
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
            ...sessionMetadata,
          });

          emitTraceEvent(effectiveRunId, "done", {
            summary: fullContent.slice(0, 200),
            durationMs,
            phase: "completed",
            metadata: {
              contentLength: fullContent.length,
              sequences: finalSequenceCount,
            },
          }).catch(() => {});
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
            await storage.updateChatRunStatus(
              claimedRun.id,
              "failed",
              error.message,
            );
            runFinalized = true;
          } catch (updateError) {
            console.error(`[SSE] Failed to update run status:`, updateError);
          }
        }

        const errorRunId = claimedRun?.id || requestId;
        const errorTimings = reportTimings("error");
        if (!isConnectionClosed) {
          writeSse(res, "error", {
            error: error.message,
            requestId,
            runId: errorRunId,
            traceId: requestId,
            timings: errorTimings,
            timestamp: Date.now(),
          });

          // Always send a done event after error so the client can finalize.
          // Without this, the client relies on its own timeout to detect the stream
          // ended, which can leave the UI spinner stuck for up to 45s.
          if (!(res as any).__doneSent) {
            (res as any).__doneSent = true;
            writeSse(res, "done", {
              requestId,
              runId: errorRunId,
              traceId: requestId,
              timings: errorTimings,
              timestamp: Date.now(),
              error: true,
            });
          }

          emitTraceEvent(errorRunId, "error", {
            error: { message: error.message, code: error.code || "UNKNOWN" },
          }).catch(() => {});
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
            const ourStartedAt = claimedRun.startedAt
              ? new Date(claimedRun.startedAt).getTime()
              : 0;
            const currentStartedAt = currentRun?.startedAt
              ? new Date(currentRun.startedAt).getTime()
              : 0;
            if (
              currentRun?.status === "processing" &&
              currentStartedAt <= ourStartedAt
            ) {
              console.log(
                `[Run] Cleaning up orphaned run ${claimedRun.id} (connection_closed=${isConnectionClosed})`,
              );
              await storage.updateChatRunStatus(
                claimedRun.id,
                "failed",
                "stream_cleanup",
              );
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
        if (
          !(res as any).__doneSent &&
          !isConnectionClosed &&
          !(res as any).writableEnded
        ) {
          try {
            writeSse(res, "done", {
              requestId,
              runId: claimedRun?.id || requestId,
              traceId: requestId,
              timestamp: Date.now(),
              safety_net: true,
            });
          } catch {
            /* connection may have closed between our check and this write */
          }
        }

        if (!isConnectionClosed && !(res as any).writableEnded) {
          res.end();
        }
      }
    },
  );

  // 3. Handle DOCUMENT_ANALYSIS intent- POST /analyze
  // ============================================================================================
  // UNIVERSAL DOCUMENT ANALYZER - POST /analyze
  // DATA_MODE enforced: NO image generation, NO artifact creation, NO web search
  // Only deterministic text extraction and LLM analysis with per-document citations
  // PARE Phase 1: Request contract, rate limiting, and quota guard middlewares applied
  // ============================================================================================
  router.post(
    "/chat/analyze",
    pareRequestContract,
    pareAnalyzeSchemaValidator,
    pareRateLimiter(),
    pareQuotaGuard(),
    pareIdempotencyGuard,
    async (req, res) => {
      const pareContext = requirePareContext(req);
      const {
        requestId,
        isDataMode,
        attachmentsCount: pareAttachmentsCount,
        startTime,
      } = pareContext;
      const timestamp = new Date(startTime).toISOString();

      // Initialize observability infrastructure
      const logger = createPareLogger(requestId);
      logger.setContext({
        userId: pareContext.userId || undefined,
        clientIp: pareContext.clientIp,
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
        userAgent: req.headers["user-agent"],
      });

      try {
        const { messages, attachments, conversationId, userMessageId } = req.body;

        // GUARD: attachments are REQUIRED for /analyze endpoint
        if (
          !attachments ||
          !Array.isArray(attachments) ||
          attachments.length === 0
        ) {
          console.log(
            `[Analyze] REJECTED: No attachments provided (requestId: ${requestId})`,
          );
          return res.status(400).json({
            error: "ATTACHMENTS_REQUIRED",
            message:
              "El endpoint /analyze requiere al menos un documento adjunto.",
            requestId,
            isDocumentMode,
            productionWorkflowBlocked,
          });
        }

        const attachmentsCount = attachments.length;

        // Log detailed attachment metadata
        const attachmentMetadata = attachments.map((att: any, idx: number) => ({
          index: idx,
          filename: att.name || "unknown",
          mimeType: att.mimeType || att.type || "unknown",
          type: att.type || "unknown",
          hasStoragePath: !!att.storagePath,
          hasContent: !!att.content,
          fileId: att.fileId || null,
        }));

        console.log(`[Analyze] attachments_count: ${attachmentsCount}`);
        console.log(
          `[Analyze] filenames: ${attachmentMetadata.map((a) => a.filename).join(", ")}`,
        );
        console.log(
          `[Analyze] attachment_metadata:`,
          JSON.stringify(attachmentMetadata, null, 2),
        );
        console.log(
          `[Analyze] DATA_MODE ACTIVATED - image_generation: BLOCKED, artifact_creation: BLOCKED`,
        );

        // Get user message
        const lastUserMessage =
          messages && Array.isArray(messages)
            ? [...messages].reverse().find((m: any) => m.role === "user")
            : null;
        const userQuery =
          lastUserMessage?.content || "Analiza el contenido de los documentos.";

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
            clarification: intentResult.clarification_question,
          });

          // AGENTIC IMPROVEMENT #3: Clarification Loop when confidence is low
          if (
            intentResult.confidence < 0.7 &&
            intentResult.clarification_question
          ) {
            console.log(
              `[Analyze] LOW CONFIDENCE (${intentResult.confidence?.toFixed(2)}) - Returning clarification question`,
            );
            return res.status(200).json({
              needs_clarification: true,
              clarification_question: intentResult.clarification_question,
              detected_intent: intentResult.intent,
              confidence: intentResult.confidence,
              suggested_actions: [
                { label: "Resumir el documento", action: "dame un resumen" },
                { label: "Analizar datos", action: "analiza los datos" },
                {
                  label: "Extraer información",
                  action: "extrae la información principal",
                },
              ],
              requestId,
              answer_text: intentResult.clarification_question,
            });
          }
        } catch (intentError: any) {
          console.warn(
            `[Analyze] Intent routing failed, continuing with default analysis:`,
            intentError.message,
          );
          // Continue with default behavior if intent routing fails
        }

        // Detect coverage requirement
        const requiresFullCoverage =
          /\b(todos|all|completo|complete|cada|every|analiza\s+todos)\b/i.test(
            userQuery,
          );

        // Detect if user explicitly requests enrichment (summary/insights/questions)
        // AGENTIC: Also use intent result to determine enrichment
        const enrichmentPatterns =
          /\b(resumen|summary|insights|analiza|análisis|analisis|preguntas sugeridas|sugerencias|key findings|hallazgos|overview|resúmen|conclusiones)\b/i;
        const enrichmentFromIntent =
          intentResult?.intent === "SUMMARIZE" ||
          intentResult?.intent === "ANALYZE_DOCUMENT";
        const enrichmentEnabled =
          enrichmentPatterns.test(userQuery) || enrichmentFromIntent;
        console.log(
          `[Analyze] enrichmentEnabled: ${enrichmentEnabled} (query: "${userQuery.substring(0, 50)}...", intent: ${intentResult?.intent || "unknown"})`,
        );

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
          status: "success" | "error";
          bytesRead: number;
          pagesProcessed: number;
          tokensExtracted: number;
          parseTimeMs: number;
          chunkCount: number;
          error?: string;
        }> = [];
        const failedFiles: Array<{ filename: string; error: string }> = [];

        for (const att of resolvedAttachments) {
          const filename = att.name || "document";
          const parseStartTime = Date.now();

          try {
            let buffer: Buffer;

            // Download file from object storage using storagePath
            if (att.storagePath) {
              try {
                buffer = await objectStorageService.getObjectEntityBuffer(
                  att.storagePath,
                );
                console.log(
                  `[Analyze] Downloaded ${filename} from storage: ${buffer.length} bytes`,
                );
              } catch (downloadError: any) {
                // LOCAL FALLBACK: Try reading from local uploads/ directory
                // This handles development environments where Replit sidecar is unavailable
                if (att.storagePath.startsWith("/objects/uploads/")) {
                  const objectId = att.storagePath.replace(
                    "/objects/uploads/",
                    "",
                  );
                  const fs = await import("fs");
                  const path = await import("path");
                  const localFilePath = path.default.join(
                    process.cwd(),
                    "uploads",
                    objectId,
                  );

                  if (fs.default.existsSync(localFilePath)) {
                    buffer = await fs.promises.readFile(localFilePath);
                    console.log(
                      `[Analyze] LOCAL FALLBACK: Read ${filename} from ${localFilePath}: ${buffer.length} bytes`,
                    );
                  } else {
                    console.error(
                      `[Analyze] LOCAL FALLBACK: File not found at ${localFilePath}`,
                    );
                    throw new Error(
                      `Failed to download file from storage and local fallback also failed: ${downloadError.message}`,
                    );
                  }
                } else {
                  console.error(
                    `[Analyze] Failed to download ${filename} from ${att.storagePath}:`,
                    downloadError,
                  );
                  throw new Error(
                    `Failed to download file from storage: ${downloadError.message}`,
                  );
                }
              }
            } else if (att.content) {
              // Use inline content if provided (base64 or string)
              buffer = Buffer.isBuffer(att.content)
                ? att.content
                : Buffer.from(att.content, "base64");
            } else {
              throw new Error(
                "No storagePath or content provided for attachment",
              );
            }

            // Call normalizeDocument with a 30s timeout to prevent hanging on malformed documents
            const PARSE_TIMEOUT_MS = 30_000;
            const docModel = await Promise.race([
              normalizeDocument(buffer, filename, att.storagePath),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () =>
                    reject(
                      new Error(
                        `Document parsing timed out after ${PARSE_TIMEOUT_MS / 1000}s for ${filename}`,
                      ),
                    ),
                  PARSE_TIMEOUT_MS,
                ),
              ),
            ]);
            documentModels.push(docModel);

            const parseTimeMs = Date.now() - parseStartTime;
            const tokensEstimate = Math.ceil(buffer.length / 4); // Rough token estimate

            processingStats.push({
              filename,
              status: "success",
              bytesRead: buffer.length,
              pagesProcessed:
                docModel.documentMeta.pageCount ||
                docModel.documentMeta.sheetCount ||
                1,
              tokensExtracted: tokensEstimate,
              parseTimeMs,
              chunkCount: docModel.sections.length + docModel.tables.length,
            });

            console.log(
              `[Analyze] Processed ${filename}: ${docModel.documentMeta.documentType}, ${docModel.tables.length} tables, ${docModel.metrics.length} metrics, ${docModel.anomalies.length} anomalies`,
            );
          } catch (error: any) {
            const parseTimeMs = Date.now() - parseStartTime;
            const errorMessage =
              error.message || "Unknown error during document processing";

            processingStats.push({
              filename,
              status: "error",
              bytesRead: 0,
              pagesProcessed: 0,
              tokensExtracted: 0,
              parseTimeMs,
              chunkCount: 0,
              error: errorMessage,
            });

            failedFiles.push({ filename, error: errorMessage });
            console.error(
              `[Analyze] Failed to process ${filename}:`,
              errorMessage,
            );
          }
        }

        // Create combined batch-like result for compatibility
        const batchResult = {
          attachmentsCount: resolvedAttachments.length,
          processedFiles: documentModels.length,
          failedFiles,
          totalTokens: processingStats.reduce(
            (sum, s) => sum + s.tokensExtracted,
            0,
          ),
          chunks: documentModels.flatMap((doc) =>
            doc.sections.map((section) => ({
              docId: doc.documentMeta.fileName,
              filename: doc.documentMeta.fileName,
              content: section.content || "",
              location: section.sourceRef,
              offsets: { start: 0, end: section.content?.length || 0 },
              metadata: { sectionType: section.type },
            })),
          ),
          stats: processingStats,
          documentModels,
        };

        const persistedAnalysisChatId =
          typeof conversationId === "string" ? conversationId.trim() : "";
        const persistedAnalysisMessageId =
          typeof userMessageId === "string" && userMessageId.trim().length > 0
            ? userMessageId.trim()
            : null;

        if (
          persistedAnalysisChatId &&
          !persistedAnalysisChatId.startsWith("pending-") &&
          !persistedAnalysisChatId.startsWith("temp_")
        ) {
          await Promise.allSettled(
            resolvedAttachments.map(async (att) => {
              const matchingDoc = documentModels.find(
                (doc) => doc.documentMeta.fileName === (att.name || "document"),
              );
              if (!matchingDoc) return;

              const extractedText = matchingDoc.sections
                .map((section) => section.content || "")
                .filter((content) => content.trim().length > 0)
                .join("\n\n")
                .trim();

              await storage.upsertConversationDocument({
                chatId: persistedAnalysisChatId,
                messageId: persistedAnalysisMessageId,
                fileName:
                  att.name || matchingDoc.documentMeta.fileName || "document",
                storagePath: att.storagePath || null,
                mimeType:
                  att.mimeType ||
                  att.type ||
                  matchingDoc.documentMeta.mimeType ||
                  "application/octet-stream",
                fileSize:
                  typeof att.size === "number" && Number.isFinite(att.size)
                    ? att.size
                    : matchingDoc.documentMeta.fileSize,
                extractedText: extractedText || null,
                metadata: {
                  fileId: att.fileId || att.id || null,
                  documentType: matchingDoc.documentMeta.documentType,
                  source: "chat_analyze",
                },
              });
            }),
          );
        }

        // Determine parser used based on mimeType/extension
        const getParserInfo = (
          mimeType: string,
          filename: string,
        ): { mime_detect: string; parser_used: string } => {
          const ext = filename.split(".").pop()?.toLowerCase() || "";
          const mime = mimeType.toLowerCase();

          if (mime.includes("pdf") || ext === "pdf")
            return { mime_detect: "application/pdf", parser_used: "PdfParser" };
          if (
            mime.includes("word") ||
            mime.includes("document") ||
            ext === "docx" ||
            ext === "doc"
          )
            return {
              mime_detect:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              parser_used: "DocxParser",
            };
          if (
            mime.includes("sheet") ||
            mime.includes("excel") ||
            ext === "xlsx" ||
            ext === "xls"
          )
            return {
              mime_detect:
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              parser_used: "XlsxParser",
            };
          if (
            mime.includes("presentation") ||
            mime.includes("powerpoint") ||
            ext === "pptx" ||
            ext === "ppt"
          )
            return {
              mime_detect:
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              parser_used: "PptxParser",
            };
          if (mime.includes("csv") || ext === "csv")
            return { mime_detect: "text/csv", parser_used: "CsvParser" };
          if (mime.includes("text") || ext === "txt")
            return { mime_detect: "text/plain", parser_used: "TextParser" };
          return {
            mime_detect: mimeType || "application/octet-stream",
            parser_used: "TextParser",
          };
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
            const parserInfo = getParserInfo(
              originalAtt.mimeType || originalAtt.type || "",
              stat.filename,
            );
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
              error: stat.error || null,
            };
          }),
          coverageCheck: {
            required: requiresFullCoverage,
            passed:
              !requiresFullCoverage ||
              batchResult.processedFiles === batchResult.attachmentsCount,
          },
        };

        // Record metrics and create audit records for each processed file
        for (const stat of batchResult.stats) {
          const originalAtt =
            resolvedAttachments.find((a: any) => a.name === stat.filename) ||
            {};
          const parserInfo = getParserInfo(
            originalAtt.mimeType || originalAtt.type || "",
            stat.filename,
          );

          // Record parse duration metrics
          pareMetrics.recordParseDuration(stat.parseTimeMs);
          pareMetrics.recordFileProcessed(stat.status === "success");
          pareMetrics.recordParserExecution(
            parserInfo.parser_used,
            stat.parseTimeMs,
            stat.status === "success",
          );

          if (stat.status === "success") {
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
            success: stat.status === "success",
            error: stat.error,
          });

          // Create audit record
          auditCollector.addRecord(
            {
              filename: stat.filename,
              mimeType: parserInfo.mime_detect,
              sizeBytes: stat.bytesRead,
              content: "", // Content hash computed from buffer in real scenario
            },
            {
              success: stat.status === "success",
              parserUsed: parserInfo.parser_used,
              tokensExtracted: stat.tokensExtracted,
              chunksGenerated: stat.chunkCount,
              parseTimeMs: stat.parseTimeMs,
              error: stat.error,
            },
          );
        }

        // Store chunks with deduplication
        for (const chunk of batchResult.chunks) {
          chunkStore.addChunks(chunk.docId, chunk.filename, [
            {
              content: chunk.content,
              location: chunk.location,
              offsets: chunk.offsets,
            },
          ]);
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
          coverageRate: coverageReport.coverageRate,
        });

        // COVERAGE CHECK: If user asked to analyze "all", verify complete coverage
        if (
          requiresFullCoverage &&
          batchResult.processedFiles !== batchResult.attachmentsCount
        ) {
          const failedList = batchResult.failedFiles
            .map((f) => `${f.filename}: ${f.error}`)
            .join("; ");
          return res.status(422).json({
            error: "COVERAGE_CHECK_FAILED",
            message: `No se pudieron procesar todos los archivos. Procesados: ${batchResult.processedFiles}/${batchResult.attachmentsCount}`,
            failedFiles: failedList,
            progressReport,
            requestId,
          });
        }

        // TOKENS CHECK: Ensure we extracted something
        if (batchResult.totalTokens === 0) {
          return res.status(422).json({
            error: "PARSE_FAILED",
            message: "No se pudo extraer texto de los documentos adjuntos.",
            progressReport,
            requestId,
          });
        }

        // Build rich document context from DocumentSemanticModel
        // NOTE: Do NOT include fileName in LLM context to prevent model from repeating it
        const buildDocumentStructureSummary = (
          doc: DocumentSemanticModel,
          docIndex: number,
        ): string => {
          const meta = doc.documentMeta;
          const parts: string[] = [];
          const docLabel =
            documentModels.length === 1
              ? "El documento"
              : `Documento ${docIndex + 1}`;
          parts.push(`📄 ${docLabel} (${meta.documentType})`);
          if (doc.sheets && doc.sheets.length > 0) {
            parts.push(
              `  Sheets: ${doc.sheets.length} (${doc.sheets.map((s) => s.name).join(", ")})`,
            );
          }
          parts.push(
            `  Sections: ${doc.sections.length}, Tables: ${doc.tables.length}`,
          );
          if (meta.pageCount) parts.push(`  Pages: ${meta.pageCount}`);
          if (meta.wordCount) parts.push(`  Words: ${meta.wordCount}`);
          return parts.join("\n");
        };

        const buildMetricsSummary = (doc: DocumentSemanticModel): string => {
          if (doc.metrics.length === 0) return "";
          const metricsText = doc.metrics
            .slice(0, 10)
            .map((m) => {
              const trend = m.trend
                ? ` (${m.trend === "up" ? "↑" : m.trend === "down" ? "↓" : "→"})`
                : "";
              return `  • ${m.name}: ${m.value}${m.unit ? " " + m.unit : ""}${trend} [${m.sourceRef}]`;
            })
            .join("\n");
          return `\n📊 Key Metrics (${doc.metrics.length} total):\n${metricsText}`;
        };

        const buildAnomaliesSummary = (doc: DocumentSemanticModel): string => {
          if (doc.anomalies.length === 0) return "";
          const anomaliesText = doc.anomalies
            .slice(0, 5)
            .map(
              (a) =>
                `  ⚠️ [${a.severity.toUpperCase()}] ${a.type}: ${a.description} [${a.sourceRef}]`,
            )
            .join("\n");
          return `\n🔍 Detected Anomalies (${doc.anomalies.length} total):\n${anomaliesText}`;
        };

        const buildTablePreview = (
          table: Table,
          maxRows: number = 3,
        ): string => {
          const header = table.headers.join(" | ");
          const separator = table.headers.map(() => "---").join(" | ");
          const previewRows = (
            table.previewRows || table.rows.slice(0, maxRows)
          )
            .map((row) =>
              row.map((cell) => String(cell.value ?? "")).join(" | "),
            )
            .join("\n");
          return `${table.title || "Table"} [${table.sourceRef}]:\n| ${header} |\n| ${separator} |\n| ${previewRows.split("\n").join(" |\n| ")} |`;
        };

        const buildTablesSummary = (doc: DocumentSemanticModel): string => {
          if (doc.tables.length === 0) return "";
          const tablesPreview = doc.tables
            .slice(0, 3)
            .map((t) => buildTablePreview(t))
            .join("\n\n");
          return `\n📋 Tables Preview (${doc.tables.length} total):\n${tablesPreview}`;
        };

        const buildSheetsSummary = (doc: DocumentSemanticModel): string => {
          if (!doc.sheets || doc.sheets.length === 0) return "";
          const sheetsText = doc.sheets
            .map(
              (s) =>
                `  📑 ${s.name}: ${s.rowCount} rows × ${s.columnCount} cols, range: ${s.usedRange}\n` +
                `     Headers: ${s.headers.slice(0, 5).join(", ")}${s.headers.length > 5 ? "..." : ""}`,
            )
            .join("\n");
          return `\n📊 Sheets Overview:\n${sheetsText}`;
        };

        // Build comprehensive context for each document
        const documentContexts = documentModels.map((doc, idx) => {
          return [
            buildDocumentStructureSummary(doc, idx),
            buildSheetsSummary(doc),
            buildMetricsSummary(doc),
            buildAnomaliesSummary(doc),
            buildTablesSummary(doc),
          ]
            .filter(Boolean)
            .join("\n");
        });

        // Build citation format examples - use generic labels instead of filenames
        const citationFormats = documentModels.map((doc, idx) => {
          const meta = doc.documentMeta;
          const docRef =
            documentModels.length === 1 ? "documento" : `doc${idx + 1}`;
          switch (meta.documentType) {
            case "excel":
            case "csv":
              return `[${docRef} sheet:NombreHoja!A1:Z100]`;
            case "pdf":
              return `[${docRef} p:1]`;
            case "word":
              return `[${docRef} section:Título]`;
            default:
              return `[${docRef}]`;
          }
        });

        // Build the combined document text from sections - NO filename in LLM context
        const documentText = documentModels
          .map((doc, idx) => {
            const sectionContent = doc.sections
              .map((section) => {
                const content = section.content || "";
                return `[${section.type}${section.title ? ": " + section.title : ""}] ${content}`;
              })
              .join("\n");
            const docLabel =
              documentModels.length === 1
                ? "DOCUMENTO"
                : `DOCUMENTO ${idx + 1}`;
            return `--- ${docLabel} ---\n${sectionContent}`;
          })
          .join("\n\n");

        // ===================================================================================
        // AGENTIC IMPROVEMENT #2: Dynamic System Prompt based on detected intent
        // ===================================================================================
        const getIntentSpecificInstructions = (): string => {
          const detectedIntent = intentResult?.intent || "ANALYZE_DOCUMENT";
          const slots = intentResult?.slots || {};

          switch (detectedIntent) {
            case "SUMMARIZE":
              return `
OBJETIVO PRINCIPAL: CREAR UN RESUMEN EJECUTIVO

TU RESPUESTA DEBE INCLUIR:
1. **RESUMEN EJECUTIVO** (obligatorio): Síntesis concisa de 2-3 párrafos del contenido principal
2. **PUNTOS CLAVE**: Lista de 5-7 puntos más importantes
3. **CONCLUSIONES**: Principales conclusiones del documento
${slots.style ? `\nEstilo solicitado: ${slots.style}` : ""}`;

            case "TRANSLATE":
              const targetLang = slots.target_language || "inglés";
              return `
OBJETIVO PRINCIPAL: TRADUCIR EL CONTENIDO

Traduce todo el contenido del documento al ${targetLang}.
- Mantén el formato original
- Preserva tecnicismos cuando sea apropiado
- Incluye notas de traducción para términos ambiguos`;

            case "CREATE_DOCUMENT":
            case "CREATE_PRESENTATION":
            case "CREATE_SPREADSHEET":
              return `
OBJETIVO PRINCIPAL: CREAR CONTENIDO NUEVO BASADO EN EL DOCUMENTO

Genera contenido nuevo basándote en la información del documento.
- Organiza la información de manera estructurada
- Crea secciones claras y bien definidas
- Incluye citas del documento original para respaldar cada punto`;

            case "SEARCH_WEB":
              return `
OBJETIVO PRINCIPAL: EXTRAER INFORMACIÓN ESPECÍFICA

Busca y extrae la información específica solicitada:
${slots.topic ? `- Búsqueda: "${slots.topic}"` : ""}
- Indica claramente si la información no se encuentra en el documento`;

            case "ANALYZE_DOCUMENT":
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

INTENT DETECTADO: ${intentResult?.intent || "ANALYZE_DOCUMENT"} (confianza: ${intentResult?.confidence?.toFixed(2) || "N/A"})
${getIntentSpecificInstructions()}

FORMATOS DE CITAS (usa estos exactamente):
${citationFormats.join("\n")}

DOCUMENTOS PROCESADOS: ${documentModels.length}

ESTRUCTURA DE LOS DOCUMENTOS:
${documentContexts.join("\n\n")}

CONTENIDO DETALLADO:
${documentText}`;

        // Build messages for LLM
        const llmMessages = [
          { role: "system" as const, content: systemPrompt },
          { role: "user" as const, content: userQuery },
        ];

        // Call LLM with strict DATA_MODE (no tools, no image generation)
        const user = (req as AuthenticatedRequest).user;
        const userId = user?.claims?.sub;

        const streamGenerator = llmGateway.streamChat(llmMessages, {
          userId: userId || conversationId || "anonymous",
          requestId,
          disableImageGeneration: true, // HARD BLOCK
        });

        let answerText = "";
        for await (const chunk of streamGenerator) {
          answerText += chunk.content;
        }

        // POST-PROCESS: Remove any filename references the model might have included
        // Collect all filenames from processed documents
        const allFilenames = batchResult.stats
          .filter((s) => s.status === "success")
          .map((s) => s.filename);

        // Build regex patterns for filename sanitization
        const sanitizeFilenameReferences = (
          text: string,
          filenames: string[],
        ): string => {
          let sanitized = text;

          // For each filename, replace occurrences with "el documento"
          for (const filename of filenames) {
            // Escape special regex characters in filename
            const escapedFilename = filename.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            );

            // Match filename with or without quotes, with various prefixes
            const patterns = [
              // "filename.pdf" or 'filename.pdf'
              new RegExp(`["']${escapedFilename}["']`, "gi"),
              // Análisis del documento "filename.pdf":
              new RegExp(
                `(Análisis|Análisis del documento|Document analysis|RESPUESTA AL ANÁLISIS DEL DOCUMENTO)\\s*["']?${escapedFilename}["']?:?`,
                "gi",
              ),
              // [doc:filename.pdf] style citations
              new RegExp(`\\[doc:${escapedFilename}[^\\]]*\\]`, "gi"),
              // Just the filename
              new RegExp(`\\b${escapedFilename}\\b`, "gi"),
            ];

            for (const pattern of patterns) {
              sanitized = sanitized.replace(pattern, (match) => {
                // For citation-style matches, use generic citation
                if (match.startsWith("[doc:")) {
                  return documentModels.length === 1 ? "[documento]" : "[doc1]";
                }
                // For header-style matches, remove entirely
                if (match.match(/^(Análisis|Document|RESPUESTA)/i)) {
                  return "";
                }
                // Otherwise replace with "el documento"
                return "el documento";
              });
            }
          }

          // Also sanitize any remaining file extension patterns
          // Match patterns like ".pdf", ".docx", ".xlsx" not part of citations
          sanitized = sanitized.replace(
            /(?<![[\w])(\w+)\.(pdf|docx|xlsx|pptx|csv|txt|png|jpg|jpeg)(?![)\]])/gi,
            "el documento",
          );

          // Clean up any double spaces or trailing colons left after removal
          sanitized = sanitized
            .replace(/\s{2,}/g, " ")
            .replace(/^\s*:\s*/gm, "");

          return sanitized;
        };

        // Apply sanitization unless user explicitly asked for filename
        const userAskedForFilename =
          /\b(nombre|filename|archivo|file)\b.*\b(cual|cuál|which|what)\b|\b(cual|cuál|which|what)\b.*\b(nombre|filename|archivo|file)\b/i.test(
            userQuery,
          );
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
        for (const stat of batchResult.stats.filter(
          (s) => s.status === "success",
        )) {
          const docName = stat.filename;
          const findings: string[] = [];
          // Find sentences that reference this document
          const sentences = answerText.split(/[.!?]\s+/);
          for (const sentence of sentences) {
            if (
              sentence.toLowerCase().includes(docName.toLowerCase()) ||
              sentence.includes(`[doc:${docName}`)
            ) {
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
        const actionableInsights: Array<{
          id: string;
          type: "finding" | "risk" | "opportunity" | "recommendation";
          title: string;
          description: string;
          confidence: "low" | "medium" | "high";
          sourceRefs: string[];
        }> = [];

        let suggestedQuestionsOutput: Array<{
          id: string;
          question: string;
          category: "analysis" | "clarification" | "action" | "deep-dive";
          relatedSources: string[];
        }> = [];

        // Aggregate insights and questions only when enrichment is enabled
        let allInsights: Insight[] = [];
        let allSuggestedQuestions: SuggestedQuestion[] = [];

        if (enrichmentEnabled) {
          console.log(
            `[Analyze] Enrichment ENABLED - generating insights and suggested questions`,
          );

          // Aggregate insights from all document models
          allInsights = documentModels.flatMap((doc) => doc.insights || []);

          // Aggregate suggested questions from all document models
          allSuggestedQuestions = documentModels.flatMap(
            (doc) => doc.suggestedQuestions || [],
          );

          // Extract risks from anomalies
          documentModels.forEach((doc) => {
            doc.anomalies.forEach((anomaly) => {
              actionableInsights.push({
                id: anomaly.id,
                type: "risk",
                title: `${anomaly.type} detected`,
                description: anomaly.description,
                confidence:
                  anomaly.severity === "high"
                    ? "high"
                    : anomaly.severity === "medium"
                      ? "medium"
                      : "low",
                sourceRefs: [anomaly.sourceRef],
              });
            });
          });

          // Add insights from document models
          allInsights.forEach((insight) => {
            actionableInsights.push({
              id: insight.id,
              type: insight.type as
                | "finding"
                | "risk"
                | "opportunity"
                | "recommendation",
              title: insight.title,
              description: insight.description,
              confidence: insight.confidence,
              sourceRefs: insight.sourceRefs,
            });
          });

          // Generate suggested questions for further analysis
          suggestedQuestionsOutput = allSuggestedQuestions.map((q) => ({
            id: q.id,
            question: q.question,
            category: q.category,
            relatedSources: q.relatedSources,
          }));

          // Add default questions if none were extracted
          if (suggestedQuestionsOutput.length === 0) {
            const defaultQuestions = [
              {
                id: "q1",
                question:
                  "¿Cuáles son las tendencias principales en los datos?",
                category: "analysis" as const,
                relatedSources: documentModels.map(
                  (d) => d.documentMeta.fileName,
                ),
              },
              {
                id: "q2",
                question: "¿Existen valores atípicos o anomalías importantes?",
                category: "deep-dive" as const,
                relatedSources: documentModels.map(
                  (d) => d.documentMeta.fileName,
                ),
              },
              {
                id: "q3",
                question:
                  "¿Qué acciones se recomiendan basándose en estos datos?",
                category: "action" as const,
                relatedSources: documentModels.map(
                  (d) => d.documentMeta.fileName,
                ),
              },
            ];
            suggestedQuestionsOutput.push(...defaultQuestions);
          }
        } else {
          console.log(
            `[Analyze] Enrichment DISABLED - returning direct answer only`,
          );
        }

        // Build response payload with full DocumentSemanticModel and enhanced fields
        const responsePayload = {
          success: true,
          requestId,
          mode: "DATA_MODE",
          answer_text: answerText,
          documentModel:
            documentModels.length === 1
              ? documentModels[0]
              : {
                  version: "1.0" as const,
                  documentMeta: {
                    id: `batch_${requestId}`,
                    fileName: documentModels
                      .map((d) => d.documentMeta.fileName)
                      .join(", "),
                    fileSize: documentModels.reduce(
                      (sum, d) => sum + d.documentMeta.fileSize,
                      0,
                    ),
                    mimeType: "application/batch",
                    documentType: "unknown" as const,
                    title: `Batch Analysis: ${documentModels.length} documents`,
                  },
                  sections: documentModels.flatMap((d) => d.sections),
                  tables: documentModels.flatMap((d) => d.tables),
                  metrics: documentModels.flatMap((d) => d.metrics),
                  anomalies: documentModels.flatMap((d) => d.anomalies),
                  insights: allInsights,
                  sources: documentModels.flatMap((d) => d.sources),
                  sheets: documentModels.flatMap((d) => d.sheets || []),
                  suggestedQuestions: allSuggestedQuestions,
                  extractionDiagnostics: {
                    extractedAt: new Date().toISOString(),
                    durationMs: requestDurationMs,
                    parserUsed: "normalizeDocument",
                    mimeTypeDetected: "batch",
                    bytesProcessed: documentModels.reduce(
                      (sum, d) => sum + d.documentMeta.fileSize,
                      0,
                    ),
                  },
                },
          documentModels: documentModels,
          insights: actionableInsights,
          suggestedQuestions: suggestedQuestionsOutput,
          ui_components: enrichmentEnabled
            ? ["executive_summary", "suggested_questions", "insights_panel"]
            : [],
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
              totalParseTimeMs: auditSummary.totalParseTimeMs,
            },
            chunkCoverage: {
              totalDocuments: coverageReport.totalDocuments,
              uniqueChunks: coverageReport.uniqueChunks,
              duplicatesRemoved: coverageReport.duplicatesRemoved,
              coverageRate: coverageReport.coverageRate,
            },
          },
          metadata: {
            totalTokensExtracted: batchResult.totalTokens,
            totalChunks: batchResult.chunks.length,
            processingTimeMs: requestDurationMs,
            documentsProcessed: documentModels.length,
            totalTables: documentModels.reduce(
              (sum, d) => sum + d.tables.length,
              0,
            ),
            totalMetrics: documentModels.reduce(
              (sum, d) => sum + d.metrics.length,
              0,
            ),
            totalAnomalies: documentModels.reduce(
              (sum, d) => sum + d.anomalies.length,
              0,
            ),
          },
        };

        // Log response
        logger.logResponse({
          statusCode: 200,
          durationMs: requestDurationMs,
          chunksReturned: batchResult.chunks.length,
          totalTokens: batchResult.totalTokens,
          filesProcessed: batchResult.processedFiles,
          filesFailed: batchResult.failedFiles.length,
        });

        // Log audit trail
        logger.logAudit({
          action: "document_analysis",
          resource: "batch",
          resourceId: auditSummary.batchId,
          details: {
            filesCount: auditSummary.totalFiles,
            successCount: auditSummary.successCount,
            failureCount: auditSummary.failureCount,
          },
          outcome: auditSummary.failureCount === 0 ? "success" : "failure",
        });

        // KILL-SWITCH: Validate DATA_MODE response before sending
        // Phase 2: Enhanced validation with response contract
        const {
          validateDataModeResponseEnhanced,
          DataModeOutputViolationError,
        } = await import("../lib/dataModeValidator");
        const { validateResponseContract } =
          await import("../lib/pareResponseContract");

        // Extract attachment names for coverage validation
        const attachmentNames = batchResult.stats
          .filter((s) => s.status === "success")
          .map((s) => s.filename);

        // Phase 2: Response contract validation with coverage check
        const contractValidation = validateResponseContract(
          responsePayload,
          attachmentNames,
          {
            contentType: "application/json",
            requireFullCoverage: requiresFullCoverage,
          },
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
          documentsWithoutCitations:
            contractValidation.documentsWithoutCitations,
          violationCount: contractValidation.violations.length,
        });

        if (!contractValidation.valid) {
          console.error(
            `[Analyze] ========== RESPONSE_CONTRACT_VIOLATION ${requestId} ==========`,
          );
          contractValidation.violations.forEach((v, i) => {
            console.error(`[Analyze] [${i + 1}] ${v.code}: ${v.message}`);
          });

          res.setHeader("Content-Type", "application/json; charset=utf-8");
          return res.status(500).json({
            error: "RESPONSE_CONTRACT_VIOLATION",
            message:
              "La respuesta no cumple con el contrato de respuesta PARE Phase 2",
            violations: contractValidation.violations,
            coverageInfo: {
              documentsWithCitations: contractValidation.documentsWithCitations,
              documentsWithoutCitations:
                contractValidation.documentsWithoutCitations,
              coverageRatio: contractValidation.coverageRatio,
              meetsCoverageRequirement:
                contractValidation.meetsCoverageRequirement,
            },
            requestId,
            progressReport,
          });
        }

        // Enhanced DATA_MODE validation with all checks
        const validationResult = validateDataModeResponseEnhanced(
          responsePayload,
          requestId,
          {
            contentType: "application/json",
            attachmentNames,
            requireFullCoverage: requiresFullCoverage,
            userQuery,
          },
        );

        if (!validationResult.valid) {
          console.error(
            `[Analyze] ========== DATA_MODE_OUTPUT_VIOLATION ${requestId} ==========`,
          );
          console.error(
            `[Analyze] Violations: ${validationResult.violations.join("; ")}`,
          );
          console.error(`[Analyze] Stack: ${validationResult.stack}`);

          res.setHeader("Content-Type", "application/json; charset=utf-8");
          return res.status(500).json({
            error: "DATA_MODE_OUTPUT_VIOLATION",
            message:
              "La respuesta contiene elementos prohibidos en DATA_MODE (imágenes/artefactos)",
            violations: validationResult.violations,
            violationDetails: validationResult.violationDetails,
            requestId,
            progressReport,
          });
        }

        // Return structured response (progressReport key matches test expectations)
        console.log(`[Analyze] ========== SUCCESS ${requestId} ==========`);
        console.log(
          `[Analyze] Response includes isDocumentMode: ${progressReport.isDocumentMode}, productionWorkflowBlocked: ${progressReport.productionWorkflowBlocked}`,
        );
        console.log(
          `[Analyze] KILL-SWITCH: Payload validated, no image/artifact violations`,
        );
        console.log(
          `[Analyze] RESPONSE_CONTRACT: All ${attachmentNames.length} documents have citations`,
        );

        if (pareContext.idempotencyKey) {
          try {
            await completeIdempotencyKey(
              pareContext.idempotencyKey,
              responsePayload,
            );
          } catch (idempotencyError) {
            console.error(
              `[Analyze] Failed to complete idempotency key: ${idempotencyError}`,
            );
          }
        }

        // Set Content-Type header explicitly for PARE Phase 2 compliance
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.json(responsePayload);
      } catch (error: any) {
        // Mark idempotency key as failed
        if (pareContext.idempotencyKey) {
          try {
            await failIdempotencyKey(
              pareContext.idempotencyKey,
              error.message || "Unknown error",
            );
          } catch (idempotencyError) {
            console.error(
              `[Analyze] Failed to mark idempotency key as failed: ${idempotencyError}`,
            );
          }
        }

        // Log error using structured logger
        logger.logError({
          error,
          phase: "unknown",
          stack: error.stack,
        });

        // Record failed request in metrics
        pareMetrics.recordRequestDuration(Date.now() - startTime);

        // Check if it's a DATA_MODE violation error
        if (error.name === "DataModeOutputViolationError") {
          logger.logAudit({
            action: "document_analysis",
            resource: "batch",
            details: { errorType: "DATA_MODE_OUTPUT_VIOLATION" },
            outcome: "failure",
          });
          return res.status(500).json({
            error: "DATA_MODE_OUTPUT_VIOLATION",
            message: error.message,
            violations: error.violations,
            requestId,
          });
        }

        logger.logAudit({
          action: "document_analysis",
          resource: "batch",
          details: {
            errorType: "ANALYSIS_FAILED",
            errorMessage: error.message,
          },
          outcome: "failure",
        });

        res.status(500).json({
          error: "ANALYSIS_FAILED",
          message: error.message || "Error durante el análisis de documentos",
          requestId,
        });
      }
    },
  );

  return router;
}
