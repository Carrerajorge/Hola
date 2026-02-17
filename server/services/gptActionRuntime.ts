import crypto from "node:crypto";
import { isInternalIP, sanitizeSensitiveData } from "../lib/securityUtils";
import {
  checkIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  computePayloadHash,
  type IdempotencyCheckResult,
} from "../lib/idempotencyStore";
import { createLogger } from "../lib/structuredLogger";
import { createServiceCircuitBreaker, type CircuitState } from "../lib/circuitBreaker";
import { withToolSpan, addAttributes } from "../lib/tracing";
import { storage } from "../storage";
import { logToolCall } from "./integrationPolicyService";
import {
  recordGptActionRequest,
  recordGptActionRateLimit,
  recordGptActionRetry,
  recordGptActionValidationError,
  setGptActionCircuitBreakerState,
} from "../lib/parePrometheusMetrics";
import { type GptAction } from "@shared/schema/gpt";

const GPT_ACTION_IDENTIFIER_RE = /^[a-zA-Z0-9._-]{1,140}$/;
const SAFE_HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$/;
const SAFE_IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9._-]{6,140}$/;
const MAX_HEADERS = 50;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_REQUEST_PAYLOAD_BYTES = 50000;
const MAX_RESPONSE_PAYLOAD_BYTES = 50000;
const MAX_FETCH_RESPONSE_BYTES = 256_000;
const DEFAULT_CONVERSATION_RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_BUFFER = 2;
const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_FETCH_RETRY_LIMIT = 3;
const MAX_RETRY_ATTEMPTS = 10;
const CONCURRENCY_KEY_RE = /^[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$/;
const BACKOFF_JITTER_RATIO = 0.2;
const MAX_SCHEMA_VALIDATION_DEPTH = 64;
const ALLOWED_RESPONSE_MIME_PREFIXES = ["application/json", "text/", "application/problem+"];

interface GptActionExecuteInput {
  action: GptAction;
  gptId: string;
  conversationId: string;
  request: Record<string, unknown>;
  userId?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
  headers?: Record<string, string | number | boolean>;
}

interface GptActionExecutionPayload {
  success: boolean;
  actionId: string;
  actionName: string;
  gptId: string;
  status: "success" | "failure" | "validation_error" | "rate_limited" | "blocked" | "timeout";
  stage: "preflight" | "auth" | "validation" | "execution";
  statusCode?: number;
  data?: unknown;
  raw?: unknown;
  mappedData?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    retryAfter?: number;
  };
  latencyMs: number;
  retryCount: number;
  circuitState: CircuitState;
  fromIdempotencyCache?: boolean;
  requestId: string | null;
  idempotencyKey?: string | null;
}

interface RuntimeDependencies {
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
}

interface ConcurrencyEntry {
  active: number;
  waiters: Array<() => void>;
  lastAccess: number;
}

interface RateWindow {
  windowStart: number;
  used: number;
  maxRequests: number;
  lastAccess: number;
}

class ConversationActionLimiter {
  private readonly activeMap = new Map<string, ConcurrencyEntry>();

  constructor(
    private readonly maxConcurrentPerConversation: number,
    private readonly queueTimeoutMs: number,
    private readonly now: () => number
  ) {}

  async acquire(key: string): Promise<{ release: () => void }> {
    if (!CONCURRENCY_KEY_RE.test(key)) {
      throw new Error("Invalid conversation/action lock key");
    }

    const now = this.now();
    const nextEntry: ConcurrencyEntry = this.activeMap.get(key) || {
      active: 0,
      waiters: [],
      lastAccess: now,
    };
    this.activeMap.set(key, nextEntry);

    if (nextEntry.active < this.maxConcurrentPerConversation) {
      nextEntry.active += 1;
      nextEntry.lastAccess = now;
      return {
        release: () => this.release(key),
      };
    }

    return new Promise((resolve, reject) => {
      const waitEntry: ConcurrencyEntry = nextEntry;
      const timeout = setTimeout(() => {
        waitEntry.waiters = waitEntry.waiters.filter((waiter) => waiter !== onRelease);
        this.cleanupIfIdle(key);
        reject(new Error("Action execution queue timeout"));
      }, this.queueTimeoutMs);

      const onRelease = () => {
        clearTimeout(timeout);
        const found = this.activeMap.get(key);
        if (!found) {
          reject(new Error("Action execution queue invalid state"));
          return;
        }

        found.active += 1;
        found.lastAccess = this.now();
        resolve({
          release: () => this.release(key),
        });
      };

      waitEntry.waiters.push(onRelease);
    });
  }

  private release(key: string): void {
    const entry = this.activeMap.get(key);
    if (!entry) {
      return;
    }

    if (entry.active > 0) {
      entry.active -= 1;
    }
    entry.lastAccess = this.now();

    if (entry.waiters.length > 0) {
      const nextWaiter = entry.waiters.shift();
      nextWaiter?.();
    }

    this.cleanupIfIdle(key);
  }

  private cleanupIfIdle(key: string): void {
    const entry = this.activeMap.get(key);
    if (!entry) return;

    if (entry.active === 0 && entry.waiters.length === 0 && this.now() - entry.lastAccess > DEFAULT_RATE_BUFFER * 1000) {
      this.activeMap.delete(key);
    }
  }
}

class ActionRateLimiter {
  private readonly buckets = new Map<string, RateWindow>();
  constructor(private readonly windowMs: number) {}

  consume(key: string, limit: number): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const existing = this.buckets.get(key);
    const windowStart = now - this.windowMs;

    if (!existing || existing.windowStart < windowStart) {
      const next: RateWindow = {
        windowStart: now,
        used: 1,
        maxRequests: limit,
      };
      this.buckets.set(key, next);
      return {
        allowed: limit >= 1,
        remaining: Math.max(0, limit - 1),
        resetAt: now + this.windowMs,
      };
    }

    if (existing.used >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: existing.windowStart + this.windowMs,
      };
    }

    if (existing.maxRequests !== limit) {
      existing.maxRequests = limit;
    }

    existing.used += 1;
    existing.lastAccess = now;
    return {
      allowed: true,
      remaining: Math.max(0, existing.maxRequests - existing.used),
      resetAt: existing.windowStart + this.windowMs,
    };
  }
}

interface JsonSchemaLike {
  type?: string | string[];
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  items?: JsonSchemaLike;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  enum?: Array<string | number | boolean | null>;
  anyOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
  additionalProperties?: boolean;
}

interface ParsedTemplateContext {
  input: Record<string, unknown>;
  action: GptAction;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeActionId(value: string): string {
  if (GPT_ACTION_IDENTIFIER_RE.test(value)) return value;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function sanitizeHeaderName(name: string): string {
  const trimmed = name.trim();
  return SAFE_HEADER_NAME_RE.test(trimmed) ? trimmed.toLowerCase() : "";
}

function sanitizeHeaderValue(value: string | number | boolean): string {
  return String(value).replace(/[\r\n]+/g, " ");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function truncatePayload(value: unknown, maxBytes: number): unknown {
  const serialized = safeStringify(value);
  if (serialized.length <= maxBytes) {
    return value;
  }

  if (typeof value === "string") {
    return value.slice(0, maxBytes);
  }

  return serialized.slice(0, maxBytes);
}

function toPathParts(path: string): string[] {
  return path.split(".").map((part) => part.trim()).filter(Boolean);
}

function normalizeContentType(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") {
    return null;
  }

  const normalized = value.split(";")[0]?.trim().toLowerCase();
  return normalized || null;
}

function isAllowedResponseMimeType(value: string | null | undefined): boolean {
  const normalized = normalizeContentType(value);
  if (!normalized) {
    return false;
  }

  return ALLOWED_RESPONSE_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isStructuredResponseSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") {
    return false;
  }

  const candidate = schema as JsonSchemaLike;
  const schemaType = candidate.type;

  if (schemaType === "object" || schemaType === "array") {
    return true;
  }

  if (Array.isArray(schemaType)) {
    return schemaType.includes("object") || schemaType.includes("array");
  }

  if (candidate.properties || candidate.required || candidate.items || candidate.additionalProperties === false || candidate.oneOf || candidate.anyOf) {
    return true;
  }

  return false;
}

function sanitizeLogValue(raw: unknown): unknown {
  if (typeof raw === "string") {
    return raw
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "[redacted]")
      .replace(/javascript:/gi, "[redacted]");
  }

  if (Array.isArray(raw)) {
    return raw.map((item) => sanitizeLogValue(item));
  }

  if (raw && typeof raw === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      output[key] = sanitizeLogValue(value);
    }
    return output;
  }

  return raw;
}

function getValueByPath(value: unknown, path: string): unknown {
  if (!path) return undefined;

  let current: unknown = value;
  const normalized = path.trim();
  const normalizedPath = normalized.startsWith("$.") ? normalized.slice(2) : normalized;

  for (const part of toPathParts(normalizedPath)) {
    if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }

  return current;
}

function setValueByPath(output: Record<string, unknown>, path: string, value: unknown): void {
  const parts = toPathParts(path);
  if (parts.length === 0) return;

  let cursor = output as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const segment = parts[i];
    if (!(segment in cursor) || typeof cursor[segment] !== "object" || cursor[segment] === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function interpolateTemplate(value: unknown, context: ParsedTemplateContext): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, token) => {
      const resolved = getValueByPath(context.input, String(token).trim());
      if (typeof resolved === "undefined") {
        return "";
      }
      if (typeof resolved === "string") return resolved;
      return safeStringify(resolved);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateTemplate(item, context));
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, candidate] of Object.entries(source)) {
      output[key] = interpolateTemplate(candidate, context);
    }
    return output;
  }

  return value;
}

function normalizePiiKeys(config: unknown): Set<string> {
  const defaults = new Set([
    "token",
    "access_token",
    "refresh_token",
    "authorization",
    "api_key",
    "apikey",
    "secret",
    "password",
    "credential",
    "private_key",
    "session",
    "cookie",
    "phone",
    "email",
  ]);

  if (!config || typeof config !== "object") {
    return defaults;
  }

  for (const key of Object.keys(config as Record<string, unknown>)) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      const raw = (config as Record<string, unknown>)[key];
      if (raw !== false) {
        defaults.add(key.toLowerCase());
      }
    }
  }

  return defaults;
}

function redactSensitiveFields(value: unknown, keys: Set<string>): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item, keys));
  }

  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      if (keys.has(key.toLowerCase()) || key.toLowerCase().includes("token") || key.toLowerCase().includes("secret")) {
        output[key] = "[REDACTED]";
        continue;
      }
      output[key] = redactSensitiveFields(item, keys);
    }
    return output;
  }

  return value;
}

function validateJsonSchema(
  schema: JsonSchemaLike | undefined,
  value: unknown,
  path: string[] = [],
  depth = 0
): string[] {
  const errors: string[] = [];

  if (depth > MAX_SCHEMA_VALIDATION_DEPTH) {
    errors.push("Schema validation depth exceeded");
    return errors;
  }

  if (!schema || typeof schema !== "object") {
    return errors;
  }

  const pathLabel = path.join(".") || "root";
  const schemaType = schema.type;

  if (schemaType === "string") {
    if (typeof value !== "string") {
      errors.push(`Expected string at ${pathLabel}`);
      return errors;
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`String too short at ${pathLabel}: ${value.length}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`String too long at ${pathLabel}: ${value.length}`);
    }
    return errors;
  }

  if (schemaType === "number" || schemaType === "integer") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push(`Expected number at ${pathLabel}`);
      return errors;
    }
    return errors;
  }

  if (schemaType === "boolean") {
    if (typeof value !== "boolean") {
      errors.push(`Expected boolean at ${pathLabel}`);
    }
    return errors;
  }

  if (schemaType === "array") {
    if (!Array.isArray(value)) {
      errors.push(`Expected array at ${pathLabel}`);
      return errors;
    }

    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`Array too short at ${pathLabel}: ${value.length}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`Array too long at ${pathLabel}: ${value.length}`);
    }

    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateJsonSchema(schema.items as JsonSchemaLike, item, [...path, String(index)], depth + 1));
      });
    }
    return errors;
  }

  if (schemaType === "object" || schema.properties) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`Expected object at ${pathLabel}`);
      return errors;
    }

    const record = value as Record<string, unknown>;
    const required = schema.required || [];
    const properties = schema.properties || {};

    for (const requiredProperty of required) {
      if (!(requiredProperty in record)) {
        errors.push(`Missing required property ${requiredProperty} at ${pathLabel}`);
      }
    }

    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      if (propertyName in record) {
        errors.push(...validateJsonSchema(propertySchema, record[propertyName], [...path, propertyName], depth + 1));
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) {
          errors.push(`Unexpected property ${key} at ${pathLabel}`);
        }
      }
    }

    return errors;
  }

  if (Array.isArray(schemaType)) {
    const primitiveMatches = schemaType.includes(typeof value);
    if (!primitiveMatches) {
      errors.push(`Type mismatch at ${pathLabel}`);
    }
    return errors;
  }

  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    errors.push(`Invalid enum value at ${pathLabel}`);
    return errors;
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.some((candidate) => validateJsonSchema(candidate, value, path, depth + 1).length === 0);
    if (!matched) {
      errors.push(`No oneOf match at ${pathLabel}`);
    }
    return errors;
  }

  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.some((candidate) => validateJsonSchema(candidate, value, path, depth + 1).length === 0);
    if (!matched) {
      errors.push(`No anyOf match at ${pathLabel}`);
    }
    return errors;
  }

  return errors;
}

function mapResponse(response: unknown, mapping: unknown): unknown {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    return response;
  }

  const output: Record<string, unknown> = {};
  for (const [targetKey, sourcePath] of Object.entries(mapping)) {
    if (typeof sourcePath === "string") {
      const mapped = getValueByPath(response, sourcePath);
      if (typeof mapped !== "undefined") {
        output[targetKey] = mapped;
      }
      continue;
    }

    if (sourcePath === undefined || sourcePath === null) {
      continue;
    }

    output[targetKey] = sourcePath;
  }

  return Object.keys(output).length > 0 ? output : response;
}

function toFetchError(message: string, code: string, retryable: boolean, retryAfter?: number): Error & { code: string; retryable: boolean; retryAfter?: number } {
  const error = new Error(message) as Error & { code: string; retryable: boolean; retryAfter?: number };
  error.code = code;
  error.retryable = retryable;
  if (retryAfter !== undefined) {
    error.retryAfter = retryAfter;
  }
  return error;
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw toFetchError("endpoint is required", "validation_error", false);
  }
  if (trimmed.length > 2048) {
    throw toFetchError("endpoint too long", "validation_error", false);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw toFetchError("Invalid endpoint URL", "validation_error", false);
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw toFetchError("Only http/https endpoints are allowed", "security_blocked", false);
  }

  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    throw toFetchError("Localhost access is denied", "security_blocked", false);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.startsWith("::1") || hostname.startsWith("127.")) {
    throw toFetchError("Internal host access is denied", "security_blocked", false);
  }

  const ipLike = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/) || hostname.match(/^[0-9a-f:]+$/i);
  if (ipLike && isInternalIP(hostname)) {
    throw toFetchError("Private IP targets are denied", "security_blocked", false);
  }

  return parsed.toString();
}

function checkDomainAllowlist(urlValue: string, allowlist: unknown): void {
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return;
  }

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw toFetchError("Invalid URL", "validation_error", false);
  }

  const hostname = url.hostname.toLowerCase();
  const normalizedAllowlist = allowlist
    .filter((raw): raw is string => typeof raw === "string")
    .map((raw) => raw.trim().toLowerCase())
    .filter(Boolean);

  const allowed = normalizedAllowlist.some((candidate) => {
    if (candidate.startsWith("*.") && hostname.endsWith(candidate.slice(2))) return true;
    if (candidate === hostname) return true;
    return false;
  });

  if (!allowed) {
    throw toFetchError(
      `Host ${hostname} is not in allowed domains for this action`,
      "security_blocked",
      false
    );
  }
}

function normalizeEndpointHeaders(actionHeaders: unknown, requestHeaders: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};

  const sanitized: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const source = {
    ...(typeof actionHeaders === "object" && actionHeaders !== null ? actionHeaders as Record<string, unknown> : {}),
    ...requestHeaders,
  };

  for (const [name, rawValue] of Object.entries(source)) {
    if (typeof rawValue === "undefined") continue;

    const safeName = sanitizeHeaderName(name);
    if (!safeName || output[safeName]) continue;
    const safeValue = sanitizeHeaderValue(rawValue);
    sanitized[safeName] = safeValue;
    if (Object.keys(sanitized).length > MAX_HEADERS) break;
  }

  return sanitized;
}

function applyAuthHeaders(
  actionAuthType: string,
  authConfig: Record<string, unknown> | null,
  headers: Record<string, string>,
): Record<string, string> {
  if (!actionAuthType || actionAuthType === "none") {
    return headers;
  }

  const output = { ...headers };
  const config = (authConfig && typeof authConfig === "object") ? authConfig as Record<string, unknown> : {};

  if (actionAuthType === "api_key") {
    const candidate = config.apiKey || config.key || config.token || config.value;
    if (!candidate || typeof candidate !== "string" || !candidate.trim()) {
      throw toFetchError("api_key auth requires a valid api key", "auth_error", false);
    }
    const headerName = typeof config.headerName === "string" && config.headerName.trim()
      ? sanitizeHeaderName(config.headerName)
      : "x-api-key";
    if (!headerName) {
      throw toFetchError("Invalid api-key header name", "auth_error", false);
    }
    output[headerName] = candidate.trim();
    return output;
  }

  if (actionAuthType === "bearer") {
    const token = config.bearerToken || config.accessToken || config.token;
    if (!token || typeof token !== "string" || !token.trim()) {
      throw toFetchError("bearer auth requires a valid token", "auth_error", false);
    }
    output.Authorization = `Bearer ${token.trim()}`;
    return output;
  }

  if (actionAuthType === "basic") {
    const username = typeof config.username === "string" ? config.username : "";
    const password = typeof config.password === "string" ? config.password : "";
    if (!username || !password) {
      throw toFetchError("basic auth requires username and password", "auth_error", false);
    }
    output.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    return output;
  }

  if (actionAuthType === "custom") {
    if (typeof config.headerName === "string" && typeof config.headerValue === "string") {
      const customHeaderName = sanitizeHeaderName(config.headerName);
      if (customHeaderName) {
        output[customHeaderName] = sanitizeHeaderValue(config.headerValue);
      }
    }
    return output;
  }

  if (actionAuthType === "oauth") {
    const oauthToken = config.accessToken || config.token || config.bearerToken;
    if (!oauthToken || typeof oauthToken !== "string") {
      throw toFetchError("oauth auth requires access token", "auth_error", false);
    }
    output.Authorization = `Bearer ${oauthToken.trim()}`;
    return output;
  }

  return output;
}

function clampRetryLimit(actionRateLimit: unknown, maxRetries: number): number {
  if (typeof actionRateLimit === "number" && Number.isInteger(actionRateLimit) && actionRateLimit >= 0) {
    return Math.max(0, Math.min(actionRateLimit, MAX_RETRY_ATTEMPTS));
  }

  if (typeof actionRateLimit === "string") {
    const parsed = Number.parseInt(actionRateLimit, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(parsed, MAX_RETRY_ATTEMPTS));
    }
  }

  return maxRetries;
}

function buildExecutionErrorPayload(error: unknown): { code: string; message: string; retryable: boolean; retryAfter?: number } {
  const typed = error as { code?: string; message?: string; retryable?: boolean; retryAfter?: number };
  const code = typed.code || "execution_error";
  const retryAfterCandidate = typed.retryAfter;
  const retryAfter =
    typeof retryAfterCandidate === "number" && Number.isFinite(retryAfterCandidate)
      ? Math.max(1, Math.ceil(retryAfterCandidate))
      : undefined;
  return {
    code,
    message: typed.message || "Execution failed",
    retryable: typed.retryable ?? false,
    retryAfter,
  };
}

function responseFromCache(cache: Record<string, unknown>): GptActionExecutionPayload {
  if (cache.status && cache.actionId) {
    return cache as GptActionExecutionPayload;
  }

  return {
    success: true,
    actionId: String(cache.actionId || "cached"),
    actionName: String(cache.actionName || "cached"),
    gptId: String(cache.gptId || ""),
    status: "success",
    stage: "execution",
    latencyMs: Number(cache.latencyMs || 0),
    retryCount: Number(cache.retryCount || 0),
    circuitState: "CLOSED",
    requestId: (cache.requestId as string | null) ?? null,
    idempotencyKey: (cache.idempotencyKey as string | null) ?? null,
    fromIdempotencyCache: true,
    data: cache.data,
    mappedData: cache.mappedData,
    raw: cache.raw,
  };
}

export class GptActionRuntime {
  private readonly logger = createLogger("gpt-action-runtime");
  private readonly limiter: ConversationActionLimiter;
  private readonly rateLimiter: ActionRateLimiter;
  private readonly dependencies: RuntimeDependencies;
  private readonly fetcher: typeof fetch;
  private readonly random: () => number;

  constructor(
    dependencies: RuntimeDependencies = {}
  ) {
    this.dependencies = dependencies;
    this.fetcher = dependencies.fetch || globalThis.fetch;
    this.random = dependencies.random || Math.random;
    this.limiter = new ConversationActionLimiter(
      DEFAULT_MAX_CONCURRENCY,
      8_000,
      this.now
    );
    this.rateLimiter = new ActionRateLimiter(DEFAULT_CONVERSATION_RATE_WINDOW_MS);
  }

  async execute(payload: GptActionExecuteInput): Promise<GptActionExecutionPayload> {
    const startedAt = this.now();
    const normalizedIdempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey);

    try {
      return await withToolSpan(`gpt-action:${payload.action.name || payload.action.id}`, async () => {
        addAttributes({
          "action.id": payload.action.id,
          "gpt.id": payload.gptId,
          "conversation.id": payload.conversationId,
        });

        return await this.executeInternal(payload, startedAt);
      }, {
        requestId: payload.requestId || null,
        userId: payload.userId || null,
      } as any);
    } catch (error) {
      const endAt = this.now();
      const err = buildExecutionErrorPayload(error);
      const fallback = this.createFailureResult(
        payload,
        startedAt,
        endAt,
        0,
        "execution",
        "failure",
        undefined,
        err.message,
        err.code,
        err.retryable,
        normalizedIdempotencyKey,
        err.retryAfter
      );
      if (normalizedIdempotencyKey) {
        await this.failIdempotency(normalizedIdempotencyKey, fallback.error?.message || err.message);
      }
      await this.recordFailureLog(payload.action, payload, fallback, requestIdForLogging(payload.requestId)).catch(() => {
        // best-effort log
      });
      return fallback;
    }
  }

  private async executeInternal(
    payload: GptActionExecuteInput,
    startedAt: number
  ): Promise<GptActionExecutionPayload> {
    const action = payload.action;
    const actionId = action.id || "unknown-action";
    const gptId = payload.gptId;
    const requestId = requestIdForLogging(payload.requestId);
    const normalizedIdempotency = normalizeIdempotencyKey(payload.idempotencyKey);

    const payloadCheck = await this.checkIdempotency(
      action,
      gptId,
      payload.conversationId,
      payload.request,
      requestId,
      payload.userId,
      normalizedIdempotency
    );

    if (payloadCheck.status !== "new") {
      return payloadCheck.result as GptActionExecutionPayload;
    }

    await this.enforceRateLimit(action, gptId, payload.conversationId);

    const conversationKey = `${payload.conversationId}:${actionId}`;
    const release = await this.limiter.acquire(conversationKey);

    try {
      const endpoint = normalizeEndpoint(action.endpoint);
      checkDomainAllowlist(endpoint, action.domainAllowlist);

      if (String(action.isActive) !== "true") {
        const blockedResult = this.createFailureResult(
          payload,
          startedAt,
          this.now(),
          0,
          "execution",
          "failure",
          undefined,
          "Action is disabled",
          "action_inactive",
          false,
          normalizedIdempotency
        );
        await this.failIdempotencyIfEnabled(
          normalizedIdempotency,
          blockedResult,
          blockedResult.error?.message || "Action is disabled"
        );
        return blockedResult;
      }

      if (action.requestSchema && action.requestSchema !== null) {
        const schemaErrors = validateJsonSchema(action.requestSchema as JsonSchemaLike, payload.request, []);
        if (schemaErrors.length > 0) {
          recordGptActionValidationError(gptId, actionId, "requestSchema");
          const validationError = this.createFailureResult(
            payload,
            startedAt,
            this.now(),
            0,
            "validation",
            "validation_error",
            undefined,
            `Request schema validation failed: ${schemaErrors.slice(0, 3).join("; ")}`,
            "validation_error",
            false,
            normalizedIdempotency
          );

          await this.failIdempotencyIfEnabled(
            normalizedIdempotency,
            validationError,
            validationError.error?.message || "Request schema validation failed"
          );

          return validationError;
        }
      }

      const method = action.httpMethod || "GET";
      const contextForTemplate: ParsedTemplateContext = {
        input: payload.request,
        action,
      };

      const requestBody = this.buildRequestBody(action, payload.request, contextForTemplate);
      const headers = this.buildHeaders(action, payload.headers || {});

      const maxRetries = clampRetryLimit(payload.maxRetries, DEFAULT_FETCH_RETRY_LIMIT);

      const endpointTimeout = clampTimeout(payload.timeoutMs ?? action.timeout ?? 30000);
      const breakerName = `gpt_action_${sanitizeActionId(action.id)}_${sanitizeActionId(payload.conversationId)}`;
      const breaker = createServiceCircuitBreaker({
        name: breakerName,
        timeout: endpointTimeout,
        retries: 0,
        retryDelay: 0,
        onStateChange: (from, to) => {
          const fromValue = this.mapCircuitState(from);
          const toValue = this.mapCircuitState(to);
          setGptActionCircuitBreakerState(gptId, actionId, to, toValue);
          this.logger.warn("gpt-action.circuit_state", {
            actionId,
            gptId,
            from,
            to,
          });
        },
      });

      const executionResult = await this.executeWithRetries(
        payload,
        { action, actionId, gptId, requestId, headers, requestBody, method, endpoint, timeoutMs: endpointTimeout },
        breaker,
        maxRetries,
        startedAt,
        normalizedIdempotency
      );

      return executionResult;
    } finally {
      release.release();
    }
  }

  private async executeWithRetries(
    payload: GptActionExecuteInput,
    executionContext: {
      action: GptAction;
      actionId: string;
      gptId: string;
      requestId: string;
      headers: Record<string, string>;
      requestBody: unknown;
      method: string;
      endpoint: string;
      timeoutMs: number;
    },
    breaker: ReturnType<typeof createServiceCircuitBreaker>,
    maxRetries: number,
    startedAt: number,
    idempotencyKey: string | null
  ): Promise<GptActionExecutionPayload> {
    const { action, actionId, gptId, requestId, headers, requestBody, method, endpoint, timeoutMs } = executionContext;
    let lastError: Error & { retryable?: boolean; code?: string; retryAfter?: number } | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        retryCount = attempt;
        recordGptActionRetry(gptId, actionId);
        const delay = this.computeBackoff(attempt);
        await sleep(delay);
      }

      try {
        const result = await breaker.call(async () => {
          return await this.fetchAction(action, method, endpoint, headers, requestBody, timeoutMs);
        }, `${method} ${endpoint}`);

        if (!result.success || !result.data) {
          const error = new Error(result.error || "Execution failed") as Error & { retryable: boolean; code?: string };
          error.retryable = retryCount < 1;
          error.code = result.error || "execution_failed";
          throw error;
        }

        const statusCode = result.data.status;
        const responsePayload = result.data.body;
        const responseContentType = result.data.contentType;

        if (isStructuredResponseSchema(action.responseSchema) && !isAllowedResponseMimeType(responseContentType)) {
          return this.createFailureResult(
            payload,
            startedAt,
            this.now(),
            retryCount,
            "execution",
            "validation_error",
            statusCode,
            "Response content-type is not compatible with structured response schema",
            "validation_error",
            false,
            idempotencyKey
          );
        }

        if (action.responseSchema && action.responseSchema !== null) {
          const outputErrors = validateJsonSchema(action.responseSchema as JsonSchemaLike, responsePayload, []);
          if (outputErrors.length > 0) {
            recordGptActionValidationError(gptId, actionId, "responseSchema");
            return this.createFailureResult(
              payload,
              startedAt,
              this.now(),
              retryCount,
              "execution",
              "validation_error",
              statusCode,
              `Response schema validation failed: ${outputErrors.slice(0, 3).join("; ")}`,
              "validation_error",
              false,
              idempotencyKey
            );
          }
        }

        const mappedData = mapResponse(responsePayload, action.responseMapping);
        const piiRules = normalizePiiKeys(action.piiRedactionRules);
        const redactedMapped = redactSensitiveFields(mappedData, piiRules);
        const redactedRaw = redactSensitiveFields(responsePayload, piiRules);

        const successResult = this.createSuccessResult(
          payload,
          action,
          startedAt,
          retryCount,
          result.data.durationMs,
          statusCode,
          redactedMapped,
          redactedRaw,
          idempotencyKey
        );

        await this.markUsageAndFinalize(action);
        await this.storeToolCallLog(payload, action, true, statusCode, successResult.latencyMs, null);
        await this.completeIdempotencyIfEnabled(idempotencyKey, {
          ...successResult,
          data: redactedMapped,
          raw: redactedRaw,
        });

        recordGptActionRequest(gptId, actionId, successResult.status, successResult.latencyMs / 1000, result.data.circuitState || "closed");

        return successResult;
      } catch (error) {
        lastError = error as Error & { retryable?: boolean; code?: string; retryAfter?: number };

        const stage = retryCount > 0 ? "execution" : "execution";
        const details = buildExecutionErrorPayload(error);
        const isRetryable = !!(error.retryable ?? (error.code === "timeout" || error.code === "fetch_error"));

        if (!isRetryable || retryCount >= maxRetries || (error.message || "").includes("security_blocked")) {
          const failure = this.createFailureResult(
            payload,
            startedAt,
            this.now(),
            retryCount,
            stage,
            details.retryable ? "timeout" : "failure",
            (error as any).statusCode,
            details.message,
            details.code,
            details.retryable,
            idempotencyKey,
            details.retryAfter
          );
          await this.storeToolCallLog(payload, action, false, undefined, failure.latencyMs, details.message, error);
          await this.failIdempotencyIfEnabled(idempotencyKey, failure, details.message);
          recordGptActionRequest(gptId, actionId, failure.status, failure.latencyMs / 1000, "closed");
          return failure;
        }

        this.logger.warn("gpt-action.retry", {
          actionId,
          attempt,
          error: details.message,
          retryable: isRetryable,
          code: details.code,
        });
      }
    }

    const fallback = this.createFailureResult(
      payload,
      startedAt,
      this.now(),
      retryCount,
      "execution",
      "failure",
      undefined,
      lastError?.message || "Action execution failed",
      lastError?.code || "execution_error",
      false,
      idempotencyKey,
      lastError?.retryAfter
    );

    await this.failIdempotencyIfEnabled(idempotencyKey, fallback, fallback.error?.message || "Action execution failed");
    return fallback;
  }

  private async fetchAction(
    action: GptAction,
    method: string,
    endpoint: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs: number
  ): Promise<{ data: { status: number; body: unknown; response: Response; contentType: string | null; durationMs: number; circuitState?: "closed" | "half_open" | "open" } }> {
    const started = this.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;

    try {
      const responseInit: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (method !== "GET" && method !== "HEAD") {
        if (body !== undefined) {
          const content = typeof body === "string" ? body : JSON.stringify(body);
          responseInit.body = content;
          responseInit.headers = {
            ...responseInit.headers,
            "Content-Type": "application/json",
          };
        }
      }

      response = await this.fetcher(endpoint, responseInit);
      const contentType = response.headers.get("content-type");
      const durationMs = this.now() - started;
      clearTimeout(timeoutId);

      const text = await this.readResponseBodySafe(response, MAX_FETCH_RESPONSE_BYTES);
      const rawBody = this.safeParseResponseBody(text);

      if (!response.ok) {
        const shouldRetry = response.status >= 500 || response.status === 429 || response.status === 408;
        const parsedRetryAfter = parseRetryAfterHeader(response.headers.get("retry-after"));
        throw this.makeNetworkError(
          `Execution failed with status ${response.status}`,
          shouldRetry ? "execution_retryable" : "execution_not_retryable",
          shouldRetry,
          parsedRetryAfter
        );
      }

      return {
        data: {
          status: response.status,
          body: rawBody,
          response,
          contentType,
          durationMs,
          circuitState: response.ok ? "closed" : "open",
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
        throw this.makeNetworkError("Request timeout", "timeout", true);
      }
      throw this.makeNetworkError((error as Error).message || "Request failed", "fetch_error", true);
    }
  }

  private async readResponseBodySafe(response: Response, maxBytes: number): Promise<string> {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength) {
      const parsedLength = Number.parseInt(declaredLength, 10);
      if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
        throw this.makeNetworkError(
          `Response body exceeds maximum allowed size: ${parsedLength} > ${maxBytes}`,
          "response_too_large",
          false
        );
      }
    }

    if (!response.body) {
      return "";
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    const chunks: string[] = [];

    let completed = false;
    try {
      while (true) {
        const readResult = await reader.read();
        if (readResult.done) {
          completed = true;
          break;
        }

        if (readResult.value) {
          totalBytes += readResult.value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            throw this.makeNetworkError(
              `Response body exceeds maximum allowed size: ${totalBytes} > ${maxBytes}`,
              "response_too_large",
              false
            );
          }
        }

        const chunk = decoder.decode(readResult.value, { stream: true });
        chunks.push(chunk);
      }
    } finally {
      if (!completed) {
        await reader.cancel().catch(() => undefined);
      }
    }

    const tail = decoder.decode(undefined, { stream: false });
    return chunks.join("") + tail;
  }

  private async checkIdempotency(
    action: GptAction,
    gptId: string,
    conversationId: string,
    request: Record<string, unknown>,
    requestId: string,
    userId?: string | null,
    idempotencyKey: string | null
  ): { status: IdempotencyCheckResult["status"]; result?: GptActionExecutionPayload } {
    if (!idempotencyKey) {
      return { status: "new" };
    }

    const payloadHash = computePayloadHash({
      actionId: action.id,
      gptId,
      conversationId,
      userId: userId || "anonymous",
      request,
      requestId,
    });

    const state = await checkIdempotencyKey(idempotencyKey, payloadHash);
    if (state.status === "new") {
      return { status: "new" };
    }

    if (state.status === "processing") {
      return {
        status: "processing",
        result: this.createFailureResult(
          {
            action,
            gptId,
            conversationId,
            request,
            requestId,
            userId,
            idempotencyKey,
          },
          this.now(),
          this.now(),
          0,
          "execution",
          "failure",
          undefined,
          "Request with this idempotency key is already in progress",
          "idempotency_in_progress",
          false,
          idempotencyKey
        ),
      };
    }

    if (state.status === "conflict") {
      return {
        status: "conflict",
        result: this.createFailureResult(
          {
            action,
            gptId,
            conversationId,
            request,
            requestId,
            userId,
            idempotencyKey,
          },
          this.now(),
          this.now(),
          0,
          "validation",
          "failure",
          undefined,
          "Idempotency key conflict for different payload",
          "idempotency_conflict",
          false,
          idempotencyKey
        ),
      };
    }

    if (state.status === "completed" && state.cachedResponse) {
      return {
        status: "completed",
        result: responseFromCache(state.cachedResponse),
      };
    }

    return { status: "new" };
  }

  private async enforceRateLimit(action: GptAction, gptId: string, conversationId: string): Promise<void> {
    const actionLimit = typeof action.rateLimit === "number" && Number.isFinite(action.rateLimit) ? action.rateLimit : 100;
    const limit = Math.max(1, Math.floor(actionLimit));
    const { allowed, remaining, resetAt } = this.rateLimiter.consume(`${gptId}:${conversationId}:${action.id}`, limit);

    if (!allowed) {
      recordGptActionRateLimit(gptId, action.id);
      const retryAfter = Math.max(1, Math.ceil((resetAt - this.now()) / 1000));
      throw this.makeNetworkError(
        `Rate limit exceeded. Retry after ${retryAfter}s`,
        "rate_limited",
        true,
        retryAfter
      );
    }

    if (remaining < DEFAULT_RATE_BUFFER) {
      this.logger.warn("gpt-action.rate_limit_threshold", {
        actionId: action.id,
        gptId,
        remaining,
      });
    }
  }

  private buildRequestBody(
    action: GptAction,
    request: Record<string, unknown>,
    context: ParsedTemplateContext
  ): unknown {
    if (typeof action.bodyTemplate === "string") {
      const interpolated = interpolateTemplate(action.bodyTemplate, context);
      if (typeof interpolated === "string") {
        try {
          return JSON.parse(interpolated as string);
        } catch {
          return interpolated;
        }
      }
      return interpolated;
    }

    if (action.bodyTemplate != null && typeof action.bodyTemplate === "object") {
      return interpolateTemplate(action.bodyTemplate, context);
    }

    return request;
  }

  private buildHeaders(action: GptAction, requestHeaders: Record<string, unknown>): Record<string, string> {
    const merged = normalizeEndpointHeaders(action.headers as Record<string, unknown> | undefined, requestHeaders);
    const authApplied = applyAuthHeaders(action.authType, action.authConfig as Record<string, unknown> | null, merged);
    return authApplied;
  }

  private makeNetworkError(
    message: string,
    code: string,
    retryable: boolean,
    retryAfter?: number
  ): Error & { code: string; retryable: boolean; retryAfter?: number } {
    return toFetchError(message, code, retryable, retryAfter);
  }

  private safeParseResponseBody(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private async storeToolCallLog(
    payload: GptActionExecuteInput,
    action: GptAction,
    success: boolean,
    statusCode: number | undefined,
    latencyMs: number,
    error?: string,
    throwable?: Error | null
  ): Promise<void> {
    try {
      const piiRules = normalizePiiKeys(action.piiRedactionRules);
      const requestPayload = sanitizeSensitiveData({ ...payload.request, conversationId: payload.conversationId });
      const safeRequest = sanitizeLogValue(redactSensitiveFields(requestPayload, piiRules));
      const safeError = throwable ? sanitizeSensitiveData(throwable.message) : error;

      await logToolCall(
        payload.userId || payload.conversationId,
        action.id,
        `gpt-action:${payload.gptId}`,
        safeRequest,
        null,
        success ? "success" : "failed",
        latencyMs,
        String(safeError || "")
      );
    } catch {
      // Best-effort audit: never fail operation on log errors.
    }
  }

  private async completeIdempotencyIfEnabled(
    idempotencyKey: string | null,
    response: Record<string, unknown>
  ): Promise<void> {
    if (!idempotencyKey) return;
    await this.completeIdempotency(idempotencyKey, sanitizeSensitiveData(response));
  }

  private async failIdempotencyIfEnabled(
    idempotencyKey: string | null,
    response: GptActionExecutionPayload,
    message: string
  ): Promise<void> {
    if (!idempotencyKey) return;
    await this.failIdempotency(idempotencyKey, message);
  }

  private async completeIdempotency(idempotencyKey: string, response: Record<string, unknown>): Promise<void> {
    try {
      await completeIdempotencyKey(idempotencyKey, response);
    } catch {
      // no-op
    }
  }

  private async failIdempotency(idempotencyKey: string, error: string): Promise<void> {
    try {
      await failIdempotencyKey(idempotencyKey, error);
    } catch {
      // no-op
    }
  }

  private async markUsageAndFinalize(action: GptAction): Promise<void> {
    await storage.incrementGptActionUsage(action.id);
  }

  private createSuccessResult(
    payload: GptActionExecuteInput,
    action: GptAction,
    startedAt: number,
    retryCount: number,
    durationMs: number,
    statusCode: number,
    mappedData: unknown,
    rawData: unknown,
    idempotencyKey: string | null
  ): GptActionExecutionPayload {
    const result: GptActionExecutionPayload = {
      success: true,
      actionId: action.id,
      actionName: action.name,
      gptId: payload.gptId,
      status: "success",
      stage: "execution",
      statusCode,
      data: truncatePayload(mappedData, MAX_RESPONSE_PAYLOAD_BYTES),
      raw: truncatePayload(rawData, MAX_RESPONSE_PAYLOAD_BYTES),
      mappedData: truncatePayload(mappedData, MAX_RESPONSE_PAYLOAD_BYTES),
      latencyMs: durationMs > 0 ? durationMs : this.now() - startedAt,
      retryCount,
      circuitState: "CLOSED",
      requestId: payload.requestId || null,
      idempotencyKey,
      error: undefined,
    };

    recordGptActionRequest(
      payload.gptId,
      action.id,
      "success",
      result.latencyMs / 1000,
      "closed"
    );

    return result;
  }

  private createFailureResult(
    payload: GptActionExecuteInput,
    startedAt: number,
    finishedAt: number,
    retryCount: number,
    stage: "preflight" | "auth" | "validation" | "execution",
    status: "failure" | "validation_error" | "timeout",
    statusCode: number | undefined,
    errorMessage: string,
    errorCode: string,
    retryable: boolean,
    idempotencyKey: string | null,
    retryAfter?: number
  ): GptActionExecutionPayload {
    const result: GptActionExecutionPayload = {
      success: false,
      actionId: payload.action.id,
      actionName: payload.action.name,
      gptId: payload.gptId,
      status,
      stage,
      statusCode,
      latencyMs: Math.max(0, finishedAt - startedAt),
      retryCount,
      circuitState: "CLOSED",
      requestId: payload.requestId || null,
      idempotencyKey,
      error: {
        code: errorCode,
        message: errorMessage,
        retryable,
        retryAfter,
      },
    };

    recordGptActionRequest(
      payload.gptId,
      payload.action.id,
      status,
      result.latencyMs / 1000,
      "closed"
    );

    return result;
  }

  private computeBackoff(attempt: number): number {
    const base = DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
    const capped = Math.min(8_000, base);
    const jitterSeed = this.random();
    const jitter = capped * BACKOFF_JITTER_RATIO * (jitterSeed - 0.5) * 2;
    return Math.max(DEFAULT_RETRY_DELAY_MS, Math.floor(capped + jitter));
  }

  private mapCircuitState(state: string): number {
    if (state === "OPEN" || state === "open") return 1;
    if (state === "HALF_OPEN" || state === "half_open") return 0.5;
    return 0;
  }

  private now(): number {
    return (this.dependencies.now || Date.now)();
  }
}

function normalizeIdempotencyKey(key: string | undefined): string | null {
  if (!key || !SAFE_IDEMPOTENCY_KEY_RE.test(key.trim())) {
    return null;
  }
  return key.trim();
}

function clampTimeout(timeoutMs: number | undefined): number {
  const base = typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : 30000;
  if (base < 250) return 250;
  if (base > 120000) return 120_000;
  return Math.floor(base);
}

function requestIdForLogging(rawId?: string | null): string {
  if (!rawId || !GPT_ACTION_IDENTIFIER_RE.test(rawId)) {
    return `gpt_action_${Date.now()}`;
  }
  return rawId;
}

function normalizeRequestInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

export function parseRetryAfterHeader(rawHeader: string | null | undefined): number | undefined {
  if (!rawHeader) {
    return undefined;
  }

  const trimmed = rawHeader.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds > 0 ? Math.max(1, seconds) : undefined;
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    const delta = Math.ceil((parsedDate - Date.now()) / 1000);
    return delta > 0 ? delta : undefined;
  }

  return undefined;
}

export function normalizeGptActionRequestPayload(rawInput: Record<string, unknown>): Record<string, unknown> {
  const request = rawInput.request;
  const fallback = rawInput.input;
  const normalized =
    request !== undefined && request !== null
      ? normalizeRequestInput(request)
      : normalizeRequestInput(fallback);

  return truncatePayload(normalized, MAX_REQUEST_PAYLOAD_BYTES) as Record<string, unknown>;
}

export function isAllowedResponseMimeTypeForTesting(rawContentType: string | null | undefined): boolean {
  return isAllowedResponseMimeType(rawContentType);
}

export function normalizeContentTypeForTesting(rawContentType: string | null | undefined): string | null {
  return normalizeContentType(rawContentType);
}

export function sanitizeLogValueForTesting(value: unknown): unknown {
  return sanitizeLogValue(value);
}

export function createGptActionRuntime(): GptActionRuntime {
  return new GptActionRuntime();
}
