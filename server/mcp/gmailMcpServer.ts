import { Router, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { gmail_v1 } from 'googleapis';
import { z } from 'zod';
import { storage } from '../storage';
import {
  GMAIL_SCOPES,
  getGmailClient,
  gmailSearch,
  gmailFetchThread,
  gmailSend,
  gmailMarkRead,
  gmailLabels,
} from '../integrations/gmailApi';
import type { GmailOAuthToken } from '@shared/schema';
import { getUserId } from '../types/express';
import { aiLimiter } from '../middleware/rateLimiter';
import { sanitizeSearchQuery, sanitizePlainText } from '../lib/textSanitizers';
import { createLogger } from '../utils/logger';
import { sanitizeText } from '../lib/pythonToolsClient';
import { withRetry } from '../utils/retry';
import { isTransientError } from '../utils/errors';

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

type GmailToolName = 'gmail_search' | 'gmail_fetch' | 'gmail_send' | 'gmail_mark_read' | 'gmail_labels';

type GmailToolErrorCode =
  | 'validation'
  | 'scope'
  | 'backpressure'
  | 'circuit_open'
  | 'timeout'
  | 'unauthorized'
  | 'not_connected'
  | 'unsupported_method'
  | 'idempotency_conflict'
  | 'idempotency_in_progress'
  | 'transient'
  | 'internal';

type GmailToolError = Error & {
  code: GmailToolErrorCode;
  retryAfterSeconds?: number;
};

type GmailToolCircuitState = {
  failures: number;
  openedUntil: number;
};

type GmailToolIdempotencyRecord = {
  state: 'running' | 'done';
  fingerprint: string;
  expiresAtMs: number;
  promise: Promise<unknown>;
  result?: unknown;
};

type GmailToolConcurrencyState = {
  activeGlobal: number;
  activeByUser: Map<string, number>;
};

const logger = createLogger("gmail-mcp");

const mcpRequestSchema = z.object({
  jsonrpc: z.literal("2.0").or(z.string().transform(() => "2.0" as const)),
  id: z.union([z.string().min(1), z.number().int(), z.null()]).optional(),
  method: z.string().trim().min(1).max(64),
  params: z.record(z.unknown()).optional(),
}).strict();

const toolCallSchema = z.object({
  tool: z.string().trim().min(1).max(48).optional(),
  name: z.string().trim().min(1).max(48).optional(),
  arguments: z.record(z.unknown()).optional().default({}),
}).strict().refine((value) => Boolean(value.tool || value.name), {
  message: "tool or name is required",
}).transform((value) => ({
  tool: value.tool || value.name!,
  arguments: value.arguments || {},
}));

const gmailSearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  maxResults: z.coerce.number().int().min(1).max(100).optional(),
});

const gmailFetchSchema = z.object({
  threadId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

const gmailSendSchema = z.object({
  to: z.string().trim().min(1).max(500),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(30_000),
  threadId: z.string().trim().max(128).optional(),
});

const gmailMarkReadSchema = z.object({
  messageId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

const gmailLabelsSchema = z.object({}).strict();

const gmailToolSchemas: Record<GmailToolName, z.ZodTypeAny> = {
  gmail_search: gmailSearchSchema,
  gmail_fetch: gmailFetchSchema,
  gmail_send: gmailSendSchema,
  gmail_mark_read: gmailMarkReadSchema,
  gmail_labels: gmailLabelsSchema,
};

const GMAIL_TOOL_SCOPE_REQUIRED_MAP: Record<GmailToolName, readonly string[]> = {
  gmail_search: [GMAIL_SCOPES[0]],
  gmail_fetch: [GMAIL_SCOPES[0]],
  gmail_send: [GMAIL_SCOPES[1]],
  gmail_mark_read: [GMAIL_SCOPES[2]],
  gmail_labels: [GMAIL_SCOPES[0], GMAIL_SCOPES[3]],
};

const GMAIL_TOOL_IDEMPOTENT_TOOLS = new Set<GmailToolName>(['gmail_send', 'gmail_mark_read']);
const EMAIL_SAFE_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GMAIL_TOOL_DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const GMAIL_TOOL_CALL_TIMEOUT_MS = 8_000;
const GMAIL_TOOL_CIRCUIT_FAILURE_THRESHOLD = 5;
const GMAIL_TOOL_CIRCUIT_RESET_MS = 25_000;
const GMAIL_TOOL_MAX_PAYLOAD_BYTES = 16 * 1024;
const GMAIL_TOOL_MAX_RETRIES = 2;
const GMAIL_TOOL_MAX_CONCURRENT_GLOBAL = 16;
const GMAIL_TOOL_MAX_CONCURRENT_PER_USER = 4;
const GMAIL_TOOL_MAX_PAYLOAD_OBJECT_KEYS = 60;
const GMAIL_TOOL_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const GMAIL_TOOL_IDEMPOTENCY_KEY_MIN_LEN = 8;
const GMAIL_TOOL_IDEMPOTENCY_KEY_MAX_LEN = 128;
const GMAIL_TOOL_IDEMPOTENCY_REGEX = /^[A-Za-z0-9._-]{8,128}$/;

const gmailToolCircuitStore = new Map<string, GmailToolCircuitState>();
const gmailToolIdempotencyStore = new Map<string, GmailToolIdempotencyRecord>();
const gmailToolConcurrency: GmailToolConcurrencyState = {
  activeGlobal: 0,
  activeByUser: new Map<string, number>(),
};

function getGmailToolCircuitState(toolName: string): GmailToolCircuitState {
  let state = gmailToolCircuitStore.get(toolName);
  if (!state) {
    state = { failures: 0, openedUntil: 0 };
    gmailToolCircuitStore.set(toolName, state);
  }
  return state;
}

function markGmailToolFailure(toolName: string): void {
  const state = getGmailToolCircuitState(toolName);
  state.failures += 1;
  if (state.failures >= GMAIL_TOOL_CIRCUIT_FAILURE_THRESHOLD) {
    state.openedUntil = Date.now() + GMAIL_TOOL_CIRCUIT_RESET_MS;
    state.failures = 0;
  }
}

function markGmailToolSuccess(toolName: string): void {
  const state = getGmailToolCircuitState(toolName);
  state.failures = 0;
  state.openedUntil = 0;
}

function isGmailToolCircuitOpen(toolName: string): boolean {
  const state = getGmailToolCircuitState(toolName);
  if (state.openedUntil === 0) {
    return false;
  }
  if (Date.now() >= state.openedUntil) {
    state.openedUntil = 0;
    state.failures = 0;
    return false;
  }
  return true;
}

function createToolError(
  code: GmailToolErrorCode,
  message: string,
  options: { retryAfterSeconds?: number } = {}
): GmailToolError {
  const error = new Error(sanitizeText(message)) as GmailToolError;
  error.code = code;
  if (typeof options.retryAfterSeconds === "number") {
    error.retryAfterSeconds = options.retryAfterSeconds;
  }
  return error;
}

function isKnownGmailToolName(value: string): value is GmailToolName {
  return Object.prototype.hasOwnProperty.call(gmailToolSchemas, value);
}

function isGmailToolError(error: unknown): error is GmailToolError {
  return error instanceof Error && typeof (error as GmailToolError).code === "string";
}

function normalizeTokenScopes(rawScopes: GmailOAuthToken['scopes'] | undefined): string[] {
  if (!Array.isArray(rawScopes)) {
    return [];
  }
  return rawScopes
    .filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0)
    .map((scope) => sanitizeText(scope.trim()));
}

function hasRequiredScopes(rawScopes: GmailOAuthToken['scopes'] | undefined, toolName: string): boolean {
  const normalizedScopes = new Set(normalizeTokenScopes(rawScopes));
  const requiredScopes = isKnownGmailToolName(toolName) ? GMAIL_TOOL_SCOPE_REQUIRED_MAP[toolName] : undefined;
  if (!requiredScopes) {
    return false;
  }
  return requiredScopes.every((requiredScope) => normalizedScopes.has(requiredScope));
}

function acquireToolExecutionSlot(userId: string): (() => void) | null {
  if (gmailToolConcurrency.activeGlobal >= GMAIL_TOOL_MAX_CONCURRENT_GLOBAL) {
    return null;
  }

  const userActive = gmailToolConcurrency.activeByUser.get(userId) ?? 0;
  if (userActive >= GMAIL_TOOL_MAX_CONCURRENT_PER_USER) {
    return null;
  }

  gmailToolConcurrency.activeGlobal += 1;
  gmailToolConcurrency.activeByUser.set(userId, userActive + 1);

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;

    const nextGlobal = Math.max(0, gmailToolConcurrency.activeGlobal - 1);
    gmailToolConcurrency.activeGlobal = nextGlobal;

    const nextUser = Math.max(0, (gmailToolConcurrency.activeByUser.get(userId) ?? 1) - 1);
    if (nextUser <= 0) {
      gmailToolConcurrency.activeByUser.delete(userId);
    } else {
      gmailToolConcurrency.activeByUser.set(userId, nextUser);
    }
  };
}

function readCorrelationId(req: Request): string {
  return sanitizeText((req.headers["x-request-id"] as string) || (req.headers["x-correlation-id"] as string) || "");
}

function isJsonRequest(req: Request): boolean {
  const contentType = sanitizeText(req.get("content-type") || "").toLowerCase();
  if (!contentType) {
    return true;
  }
  return contentType.includes("application/json");
}

function isToolCallPayloadTooLarge(req: Request): boolean {
  const contentLengthHeader = req.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > GMAIL_TOOL_MAX_PAYLOAD_BYTES) {
      return true;
    }
  }
  try {
    const requestByteLength = Buffer.byteLength(
      typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {})
    );
    return requestByteLength > GMAIL_TOOL_MAX_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

function sanitizeIdempotencyKey(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const normalized = sanitizeText(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  if (
    normalized.length < GMAIL_TOOL_IDEMPOTENCY_KEY_MIN_LEN ||
    normalized.length > GMAIL_TOOL_IDEMPOTENCY_KEY_MAX_LEN
  ) {
    throw createToolError("validation", "Idempotency key must be between 8 and 128 characters");
  }

  if (!GMAIL_TOOL_IDEMPOTENCY_REGEX.test(normalized)) {
    throw createToolError("validation", "Idempotency key contains invalid characters");
  }

  return normalized;
}

function getToolIdempotencyCacheKey(
  userId: string,
  toolName: GmailToolName,
  idempotencyKey: string,
): string {
  return `${userId}:${toolName}:${idempotencyKey}`;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = (value as Record<string, unknown>)[key];
  }
  return JSON.stringify(normalized);
}

function buildToolFingerprint(toolName: GmailToolName, args: Record<string, unknown>): string {
  return createHash('sha256').update(`${toolName}|${stableStringify(args)}`).digest('hex');
}

function pruneExpiredIdempotencyEntries(): void {
  const now = Date.now();
  for (const [cacheKey, record] of gmailToolIdempotencyStore) {
    if (record.expiresAtMs <= now) {
      gmailToolIdempotencyStore.delete(cacheKey);
    }
  }
}

async function withToolIdempotency<T>(
  userId: string,
  toolName: GmailToolName,
  idempotencyKey: string | null,
  args: Record<string, unknown>,
  operation: () => Promise<T>
): Promise<T> {
  if (!idempotencyKey || !GMAIL_TOOL_IDEMPOTENT_TOOLS.has(toolName)) {
    return operation();
  }

  const cacheKey = getToolIdempotencyCacheKey(userId, toolName, idempotencyKey);
  const now = Date.now();
  const fingerprint = buildToolFingerprint(toolName, args);
  const existing = gmailToolIdempotencyStore.get(cacheKey);

  if (existing) {
    if (existing.expiresAtMs <= now) {
      gmailToolIdempotencyStore.delete(cacheKey);
    } else if (existing.fingerprint !== fingerprint) {
      throw createToolError("idempotency_conflict", "Idempotency key is reused with a different payload");
    } else if (existing.state === 'done') {
      logger.info('[MCP Gmail] Idempotency replay', {
        userId: sanitizeText(String(userId)),
        tool: toolName,
      });
      return existing.result as T;
    } else {
      throw createToolError("idempotency_in_progress", "Idempotent request already in progress");
    }
  }

  const record: GmailToolIdempotencyRecord = {
    state: 'running',
    fingerprint,
    expiresAtMs: now + GMAIL_TOOL_IDEMPOTENCY_TTL_MS,
    promise: Promise.resolve(undefined),
  };

  const promise = operation().then(
    (result) => {
      record.state = 'done';
      record.result = result;
      return result;
    },
    (error: unknown) => {
      gmailToolIdempotencyStore.delete(cacheKey);
      throw error;
    }
  );
  record.promise = promise;
  gmailToolIdempotencyStore.set(cacheKey, record);
  pruneExpiredIdempotencyEntries();

  return promise as Promise<T>;
}

function isBackpressureError(message: string): boolean {
  return message.toLowerCase().includes("too many concurrent gmail tool executions");
}

function isGmailToolTimeout(message: string): boolean {
  return message.includes("Tool call timed out") || message.includes("timed out");
}

function isGmailCircuitError(message: string): boolean {
  return message.includes("temporarily unavailable") || message.includes("Tool call temporarily unavailable");
}

function isValidationFailure(message: string): boolean {
  const normalized = message.toLowerCase().trim();
  return (
    normalized === "tool or name is required" ||
    normalized === "unknown tool" ||
    normalized === "invalid params" ||
    normalized.includes("validation failed") ||
    normalized.includes("invalid input") ||
    normalized.includes("malformed request") ||
    normalized.includes("recipient list is empty") ||
    normalized.includes("tool payload")
  );
}

function isTransientGmailToolError(error: unknown): boolean {
  const message = extractToolErrorMessage(error, "Tool call failed").toLowerCase();
  if (isGmailToolError(error) && (error.code === "validation" || error.code === "scope")) {
    return false;
  }
  if (isGmailToolTimeout(message) || isBackpressureError(message) || isGmailCircuitError(message)) {
    return false;
  }
  return isTransientError(error);
}

function getToolRetrySeconds(message: string): number | null {
  if (isBackpressureError(message)) {
    return 2;
  }
  if (message.toLowerCase().includes("too many requests")) {
    return 3;
  }
  if (isGmailToolTimeout(message)) {
    return 1;
  }
  if (isGmailCircuitError(message)) {
    return Math.ceil(GMAIL_TOOL_CIRCUIT_RESET_MS / 1000);
  }
  return null;
}

async function withGmailToolCircuit<T>(toolName: string, operation: () => Promise<T>): Promise<T> {
  if (isGmailToolCircuitOpen(toolName)) {
    throw createToolError("circuit_open", "Tool call temporarily unavailable", {
      retryAfterSeconds: Math.ceil(GMAIL_TOOL_CIRCUIT_RESET_MS / 1000),
    });
  }

  try {
    const result = await operation();
    markGmailToolSuccess(toolName);
    return result;
  } catch (error) {
    const message = extractToolErrorMessage(error, "Tool call failed");
    if (!isValidationFailure(message) && !message.includes("Gmail not connected")) {
      markGmailToolFailure(toolName);
    }
    throw error;
  }
}

async function withGmailToolTimeout<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(createToolError("timeout", "Tool call timed out"));
    }, GMAIL_TOOL_CALL_TIMEOUT_MS);

    try {
      Promise.resolve(operation())
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    } catch (error) {
      clearTimeout(timeout);
      reject(error as Error);
    }
  });
}

async function withToolCallRetry<T>(toolName: GmailToolName, operation: () => Promise<T>): Promise<T> {
  return withRetry(
    () => withGmailToolCircuit(toolName, operation),
    {
      maxRetries: GMAIL_TOOL_MAX_RETRIES,
      baseDelay: 250,
      maxDelay: 1_000,
      exponentialBackoff: true,
      shouldRetry: (error: Error) => isTransientGmailToolError(error),
      onRetry: (error: Error, attempt: number, delay: number) => {
        logger.warn("[MCP Gmail] Retrying tool call", {
          tool: toolName,
          attempt,
          delay,
          reason: extractToolErrorMessage(error, "Tool call failed"),
        });
      },
    }
  );
}

function sanitizeMcpText(value: string, maxLen: number): string {
  return sanitizePlainText(value, { maxLen, collapseWs: true }).slice(0, maxLen);
}

function normalizeQuery(raw: string): string {
  return sanitizeSearchQuery(raw, 500);
}

function validateEmail(raw: string): string {
  const sanitized = sanitizeMcpText(raw, 254);
  if (!EMAIL_SAFE_REGEX.test(sanitized)) {
    throw createToolError("validation", "Invalid email address");
  }
  return sanitized;
}

function parseEmailList(raw: string): string[] {
  const addresses = raw
    .split(/[;,]/)
    .map((value) => sanitizeMcpText(value, 254))
    .map((value) => value.trim())
    .filter(Boolean);

  if (addresses.length === 0) {
    throw createToolError("validation", "Recipient list is empty");
  }

  for (const address of addresses) {
    validateEmail(address);
  }

  return addresses;
}

function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (!args || typeof args !== "object") {
    throw createToolError("validation", "Tool arguments must be an object");
  }

  const safeKeys = Object.keys(args).slice(0, GMAIL_TOOL_MAX_PAYLOAD_OBJECT_KEYS);
  const sanitized: Record<string, unknown> = {};
  for (const key of safeKeys) {
    if (GMAIL_TOOL_DANGEROUS_KEYS.has(key)) {
      continue;
    }
    if (key.length > 64) {
      continue;
    }
    sanitized[sanitizeText(key)] = args[key];
  }
  return sanitized;
}

function validateToolPayload(toolName: GmailToolName, args: Record<string, unknown>): Record<string, unknown> {
  if (!toolName || toolName.length > 48) {
    throw createToolError("validation", "Invalid tool name");
  }
  if (Object.keys(args).length > GMAIL_TOOL_MAX_PAYLOAD_OBJECT_KEYS) {
    throw createToolError("validation", "Tool payload has too many fields");
  }

  const sanitized = sanitizeToolArgs(args);
  const serialized = JSON.stringify(sanitized);
  if (serialized.length > GMAIL_TOOL_MAX_PAYLOAD_BYTES) {
    throw createToolError("validation", "Tool payload is too large");
  }

  return sanitized;
}

function validateToolArgs(toolName: GmailToolName, args: Record<string, unknown>): unknown {
  return gmailToolSchemas[toolName].parse(args);
}

function extractToolErrorMessage(error: unknown, fallback: string): string {
  const rawMessage = typeof error?.message === "string" ? error.message : fallback;
  const sanitized = sanitizeText(rawMessage);
  return sanitized.length > 0 ? sanitized : sanitizeText(fallback);
}

function resolveToolErrorCode(error: unknown, message: string): GmailToolErrorCode {
  if (isGmailToolError(error)) {
    return error.code;
  }
  if (isValidationFailure(message)) {
    return "validation";
  }
  const normalized = message.toLowerCase();
  if (normalized === "insufficient gmail scopes") {
    return "scope";
  }
  if (isBackpressureError(normalized)) {
    return "backpressure";
  }
  if (isGmailCircuitError(normalized)) {
    return "circuit_open";
  }
  if (isGmailToolTimeout(normalized)) {
    return "timeout";
  }
  if (normalized === "gmail not connected" || normalized === "unauthorized") {
    return "unauthorized";
  }
  if (normalized === "idempotency key is reused with a different payload") {
    return "idempotency_conflict";
  }
  if (normalized === "idempotent request already in progress") {
    return "idempotency_in_progress";
  }
  if (normalized.startsWith("unknown method:")) {
    return "unsupported_method";
  }
  return "internal";
}

function classifyToolError(
  error: unknown
): { status: number; body: { code: GmailToolErrorCode; error: string; retryAfter?: number } } {
  const message = extractToolErrorMessage(error, "Tool call failed");
  const code = resolveToolErrorCode(error, message);

  if (code === "validation" || code === "scope") {
    return {
      status: 400,
      body: { code, error: message },
    };
  }

  if (code === "idempotency_conflict" || code === "idempotency_in_progress") {
    return {
      status: 409,
      body: { code, error: message },
    };
  }

  if (code === "backpressure") {
    return {
      status: 429,
      body: {
        code,
        error: "Too many concurrent Gmail tool executions",
        retryAfter: getToolRetrySeconds(message) ?? 2,
      },
    };
  }

  if (code === "circuit_open") {
    return {
      status: 503,
      body: {
        code,
        error: "Tool call temporarily unavailable",
        retryAfter: getToolRetrySeconds(message) ?? Math.ceil(GMAIL_TOOL_CIRCUIT_RESET_MS / 1000),
      },
    };
  }

  if (code === "timeout") {
    return {
      status: 504,
      body: { code, error: "Tool call timed out" },
    };
  }

  if (code === "unauthorized" || code === "not_connected") {
    return {
      status: 403,
      body: { code, error: message },
    };
  }

  return {
    status: 500,
    body: { code, error: "Tool call failed" },
  };
}

function mapToolErrorToJsonRpcCode(code: GmailToolErrorCode): number {
  if (code === "validation") {
    return -32602;
  }
  if (code === "scope") {
    return -32602;
  }
  if (code === "unsupported_method") {
    return -32601;
  }
  if (code === "unauthorized" || code === "not_connected") {
    return -32000;
  }
  if (code === "idempotency_conflict" || code === "idempotency_in_progress") {
    return -32000;
  }
  if (code === "backpressure" || code === "circuit_open" || code === "timeout") {
    return -32000;
  }
  return -32603;
}

async function handleToolCall(
  toolName: GmailToolName,
  args: Record<string, unknown>,
  gmail: gmail_v1.Gmail
): Promise<unknown> {
  const sanitizedArgs = validateToolArgs(toolName, args);
  switch (toolName) {
    case 'gmail_search': {
      const { query, maxResults } = sanitizedArgs as z.infer<typeof gmailSearchSchema>;
      const safeQuery = normalizeQuery(query);
      return gmailSearch(gmail, { query: safeQuery, maxResults });
    }

    case 'gmail_fetch': {
      const { threadId } = sanitizedArgs as z.infer<typeof gmailFetchSchema>;
      return gmailFetchThread(gmail, { threadId });
    }

    case 'gmail_send': {
      const {
        to,
        subject,
        body,
        threadId,
      } = sanitizedArgs as z.infer<typeof gmailSendSchema>;

      const safeThreadId = threadId && sanitizeMcpText(threadId, 128);
      const recipients = parseEmailList(to).join(", ");
      const safeSubject = sanitizeMcpText(subject, 200);
      const safeBody = sanitizeMcpText(body, 30_000);
      return gmailSend(gmail, { to: recipients, subject: safeSubject, body: safeBody, threadId: safeThreadId });
    }

    case 'gmail_mark_read': {
      const { messageId } = sanitizedArgs as z.infer<typeof gmailMarkReadSchema>;
      return gmailMarkRead(gmail, { messageId });
    }

    case 'gmail_labels': {
      return gmailLabels(gmail);
    }

    default:
      throw createToolError("validation", "Unknown tool");
  }
}

async function executeToolCall(
  req: Request,
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
  token: GmailOAuthToken
): Promise<unknown> {
  if (!isKnownGmailToolName(toolName)) {
    throw createToolError("validation", "Unknown tool");
  }

  const normalizedToolName = toolName;
  const correlationId = readCorrelationId(req);
  const start = Date.now();
  const idempotencyKey = sanitizeIdempotencyKey(
    req.get("idempotency-key") || req.get("Idempotency-Key") || undefined
  );
  const sanitizedArgs = validateToolPayload(normalizedToolName, args);
  if (GMAIL_TOOL_IDEMPOTENT_TOOLS.has(normalizedToolName) && !idempotencyKey) {
    throw createToolError("validation", "Idempotency-Key header is required for this operation");
  }

  try {
    const result = await withToolIdempotency(
      userId,
      normalizedToolName,
      idempotencyKey,
      sanitizedArgs,
      async () => {
        const releaseSlot = acquireToolExecutionSlot(userId);
        if (!releaseSlot) {
          throw createToolError("backpressure", "Too many concurrent Gmail tool executions", { retryAfterSeconds: 2 });
        }

        if (!hasRequiredScopes(token.scopes, normalizedToolName)) {
          throw createToolError("scope", "Insufficient Gmail scopes");
        }

        try {
          const gmail = await getGmailClient(token);
          return await withToolCallRetry(normalizedToolName, () =>
            withGmailToolTimeout(() =>
              handleToolCall(normalizedToolName, sanitizedArgs, gmail)
            )
          );
        } finally {
          releaseSlot();
        }
      }
    );

    logger.info("[MCP Gmail] Tool call completed", {
      correlationId,
      userId: sanitizeText(String(userId)),
      tool: normalizedToolName,
      durationMs: Date.now() - start,
      status: "ok",
      idempotent: idempotencyKey !== null,
    });

    return result;
  } catch (error: unknown) {
    const message = extractToolErrorMessage(error, "Tool call failed");
    const code = resolveToolErrorCode(error, message);

    logger.warn("[MCP Gmail] Tool call execution failed", {
      correlationId,
      userId: sanitizeText(String(userId)),
      tool: normalizedToolName,
      durationMs: Date.now() - start,
      code,
      error: message,
    });

    throw error;
  }
}

const MCP_TOOLS: McpTool[] = [
  {
    name: 'gmail_search',
    description: 'Search emails in Gmail inbox with a query',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g., "is:unread", "from:example@gmail.com")' },
        maxResults: { type: 'number', description: 'Maximum number of results (default: 20)' }
      },
      required: ['query']
    }
  },
  {
    name: 'gmail_fetch',
    description: 'Fetch a specific email thread by ID',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: 'The Gmail thread ID to fetch' }
      },
      required: ['threadId']
    }
  },
  {
    name: 'gmail_send',
    description: 'Send an email',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
        threadId: { type: 'string', description: 'Optional thread ID for replies' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'gmail_mark_read',
    description: 'Mark an email as read',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The message ID to mark as read' }
      },
      required: ['messageId']
    }
  },
  {
    name: 'gmail_labels',
    description: 'Get all Gmail labels',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

export function createGmailMcpRouter(): Router {
  const router = Router();

  const resolveAuthenticatedUserId = (req: Request): string | null => {
    const userId = getUserId(req);
    if (!userId) return null;
    const normalized = String(userId);
    if (normalized.startsWith("anon_")) return null;
    return normalized;
  };

  router.get('/sse', async (req: Request, res: Response) => {
    const userId = resolveAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const token = await storage.getGmailOAuthToken(userId);
    if (!token) {
      res.status(403).json({ error: 'Gmail not connected' });
      return;
    }

    logger.info('MCP Gmail SSE session started', {
      userId: sanitizeText(String(userId)),
      correlationId: sanitizeText((req.headers['x-request-id'] as string) || (req.headers['x-correlation-id'] as string) || ''),
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('capabilities', {
      tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description }))
    });

    const heartbeat = setInterval(() => {
      sendEvent('heartbeat', { timestamp: Date.now() });
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });
  });

  router.post('/tools/call', aiLimiter, async (req: Request, res: Response) => {
    if (!isJsonRequest(req)) {
      res.status(415).json({ error: 'Unsupported Media Type', code: 'validation' });
      return;
    }

    if (isToolCallPayloadTooLarge(req)) {
      res.setHeader("Retry-After", String(Math.ceil(GMAIL_TOOL_MAX_PAYLOAD_BYTES / 1024)));
      res.status(413).json({ error: 'Request payload too large' });
      return;
    }

    const userId = resolveAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const token = await storage.getGmailOAuthToken(userId);
    if (!token) {
      res.status(403).json({ error: 'Gmail not connected' });
      return;
    }

    try {
      const parsed = toolCallSchema.parse(req.body);
      const result = await executeToolCall(req, userId, parsed.tool, parsed.arguments || {}, token);
      logger.info('[MCP Gmail] Tool call', {
        userId: sanitizeText(String(userId)),
        tool: parsed.tool,
      });
      res.json({ success: true, result });
    } catch (error: unknown) {
      const classification = classifyToolError(error);
      if (classification.body.retryAfter) {
        res.setHeader("Retry-After", String(classification.body.retryAfter));
      }

      const level = classification.status >= 500 ? "error" : "warn";
      logger[level]('[MCP Gmail] Tool call error', {
        userId: sanitizeText(String(userId)),
        tool: (req.body?.tool || req.body?.name) as string | undefined,
        error: classification.body.error,
        code: classification.body.code,
      });

      res.status(classification.status).json({
        error: classification.body.error,
        code: classification.body.code,
      });
    }
  });

  router.get('/tools', aiLimiter, (req: Request, res: Response) => {
    const userId = resolveAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({ tools: MCP_TOOLS });
  });

  router.post('/jsonrpc', aiLimiter, async (req: Request, res: Response) => {
    if (!isJsonRequest(req)) {
      res.status(415).json({ error: 'Unsupported Media Type', code: 'validation' });
      return;
    }

    if (isToolCallPayloadTooLarge(req)) {
      res.status(200).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Request payload too large" },
      });
      return;
    }

    const userId = resolveAuthenticatedUserId(req);
    const parsed = mcpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(200).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid JSON-RPC request" },
      });
      return;
    }

    const request = parsed.data as McpRequest;
    const response: McpResponse = {
      jsonrpc: '2.0',
      id: request.id ?? null,
    };

    try {
      if (!userId) {
        throw createToolError("unauthorized", "Unauthorized");
      }

      const token = await storage.getGmailOAuthToken(userId);
      if (!token) {
        throw createToolError("not_connected", "Gmail not connected");
      }

      switch (request.method) {
        case 'tools/list':
          response.result = { tools: MCP_TOOLS };
          break;

        case 'tools/call': {
          const params = toolCallSchema.parse(request.params || {});
          const result = await executeToolCall(req, userId, params.tool, params.arguments || {}, token);
          response.result = result;
          break;
        }

        default:
          throw createToolError("unsupported_method", `Unknown method: ${request.method}`);
      }
    } catch (error: unknown) {
      const message = extractToolErrorMessage(error, "Internal error");
      const code = resolveToolErrorCode(error, message);
      response.error = {
        code: mapToolErrorToJsonRpcCode(code),
        message: code === "validation" ? message : (message || "Internal error"),
      };

      logger.error('[MCP Gmail] JSON-RPC error', {
        userId: sanitizeText(String(userId ?? "")),
        method: request.method,
        error: message,
        code,
      });
    }

    res.status(200).json(response);
  });

  return router;
}

export const GMAIL_SCOPES_EXPORT = GMAIL_SCOPES;
