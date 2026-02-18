/**
 * GPT Action Executor
 *
 * Formal integration system for GPT Actions:
 * - OpenAPI/JSON Schema validation for every action
 * - Auth per action (API key, OAuth, Bearer, Basic)
 * - Domain allowlist enforcement
 * - Rate limiting per action per conversation
 * - PII redaction on request/response
 * - Full audit logging per call
 */
import crypto from "node:crypto";
import { db } from "../../db";
import { eq, and, sql } from "drizzle-orm";
import { gptActions, type GptAction, gptActionCreateSchema, gptActionUseSchema } from "@shared/schema/gpt";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActionSchema {
  operationId: string;
  description: string;
  httpMethod: string;
  endpoint: string;
  requestSchema: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  parameters: ActionParameter[];
}

export interface ActionParameter {
  name: string;
  type: "string" | "number" | "boolean" | "integer" | "array" | "object" | "date";
  required: boolean;
  description?: string;
}

export interface ActionExecutionInput {
  actionId: string;
  gptId: string;
  conversationId: string;
  userId?: string;
  requestId: string;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ActionExecutionResult {
  success: boolean;
  actionId: string;
  actionName: string;
  status: "success" | "failure" | "validation_error" | "rate_limited" | "blocked" | "timeout" | "auth_error";
  data?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  latencyMs: number;
  requestId: string;
}

export interface OpenAPIValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  operationCount: number;
}

export interface ActionAuditEntry {
  timestamp: number;
  actionId: string;
  actionName: string;
  gptId: string;
  conversationId: string;
  userId?: string;
  requestId: string;
  status: string;
  latencyMs: number;
  statusCode?: number;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const MAX_RESPONSE_BYTES = 256_000;
const MAX_REQUEST_BODY_BYTES = 80_000;

const PII_PATTERNS: Array<{ name: string; regex: RegExp; replacement: string }> = [
  { name: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: "[EMAIL_REDACTED]" },
  { name: "phone", regex: /\b\+?[1-9]\d{1,14}\b/g, replacement: "[PHONE_REDACTED]" },
  { name: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN_REDACTED]" },
  { name: "credit_card", regex: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, replacement: "[CC_REDACTED]" },
  { name: "ip_address", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "[IP_REDACTED]" },
];

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function redactPII(text: string, rules?: Record<string, unknown>): string {
  let result = text;
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern.regex, pattern.replacement);
  }
  return result;
}

function isDomainAllowed(url: string, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return allowlist.some((allowed) => {
      const normalizedAllowed = allowed.toLowerCase().replace(/^\./, "");
      return hostname === normalizedAllowed || hostname.endsWith("." + normalizedAllowed);
    });
  } catch {
    return false;
  }
}

function validateRequestSchema(data: Record<string, unknown>, schema: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const properties = (schema as any).properties ?? {};
  const required = (schema as any).required ?? [];

  for (const req of required) {
    if (!(req in data) || data[req] === undefined || data[req] === null) {
      errors.push(`Missing required parameter: ${req}`);
    }
  }

  for (const [key, value] of Object.entries(data)) {
    const propSchema = properties[key];
    if (!propSchema) continue;
    const expectedType = (propSchema as any).type;
    if (expectedType === "string" && typeof value !== "string") {
      errors.push(`Parameter '${key}' must be a string`);
    }
    if (expectedType === "number" && typeof value !== "number") {
      errors.push(`Parameter '${key}' must be a number`);
    }
    if (expectedType === "boolean" && typeof value !== "boolean") {
      errors.push(`Parameter '${key}' must be a boolean`);
    }
    if (expectedType === "array" && !Array.isArray(value)) {
      errors.push(`Parameter '${key}' must be an array`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function resolveAuth(action: GptAction): Record<string, string> {
  const headers: Record<string, string> = {};
  const authConfig = action.authConfig as Record<string, any> | null;
  if (!authConfig) return headers;

  switch (action.authType) {
    case "bearer":
      if (authConfig.token) headers["Authorization"] = `Bearer ${authConfig.token}`;
      break;
    case "api_key":
      if (authConfig.headerName && authConfig.apiKey) {
        headers[authConfig.headerName] = authConfig.apiKey;
      }
      break;
    case "basic":
      if (authConfig.username && authConfig.password) {
        const encoded = Buffer.from(`${authConfig.username}:${authConfig.password}`).toString("base64");
        headers["Authorization"] = `Basic ${encoded}`;
      }
      break;
    case "oauth":
      if (authConfig.accessToken) headers["Authorization"] = `Bearer ${authConfig.accessToken}`;
      break;
  }

  return headers;
}

function substituteTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = params[key];
    return val !== undefined ? String(val) : "";
  });
}

// ─── Rate Limiter (per action per conversation) ──────────────────────────────

class ActionRateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  check(key: string, limit: number, windowMs: number = 60_000): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const existing = this.windows.get(key);
    if (!existing || now > existing.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true };
    }
    if (existing.count >= limit) {
      return { allowed: false, retryAfterMs: existing.resetAt - now };
    }
    existing.count++;
    return { allowed: true };
  }

  /**
   * Periodically clean expired windows.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, val] of this.windows) {
      if (now > val.resetAt) this.windows.delete(key);
    }
  }
}

// ─── Action Executor ──────────────────────────────────────────────────────────

export class GptActionExecutor {
  private rateLimiter = new ActionRateLimiter();
  private auditLog: ActionAuditEntry[] = [];
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodic cleanup of rate limiter windows
    this.cleanupInterval = setInterval(() => this.rateLimiter.cleanup(), 60_000);
  }

  /**
   * Validate an OpenAPI spec document.
   */
  validateOpenAPISpec(spec: Record<string, unknown>): OpenAPIValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let operationCount = 0;

    if (!spec.openapi && !spec.swagger) {
      errors.push("Missing 'openapi' or 'swagger' version field");
    }

    const paths = spec.paths as Record<string, any> | undefined;
    if (!paths || typeof paths !== "object") {
      errors.push("Missing or invalid 'paths' field");
      return { valid: false, errors, warnings, operationCount: 0 };
    }

    for (const [path, methods] of Object.entries(paths)) {
      if (!path.startsWith("/")) {
        errors.push(`Path '${path}' must start with /`);
      }
      if (typeof methods !== "object" || !methods) continue;

      for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
        if (!SAFE_HTTP_METHODS.has(method.toUpperCase())) continue;
        operationCount++;

        if (!operation.operationId) {
          warnings.push(`Operation at ${method.toUpperCase()} ${path} is missing operationId`);
        }
        if (!operation.summary && !operation.description) {
          warnings.push(`Operation at ${method.toUpperCase()} ${path} has no description`);
        }
      }
    }

    if (operationCount === 0) {
      errors.push("No valid operations found in paths");
    }

    return { valid: errors.length === 0, errors, warnings, operationCount };
  }

  /**
   * Execute an action: validate → auth → call → redact → return.
   */
  async execute(input: ActionExecutionInput): Promise<ActionExecutionResult> {
    const start = Date.now();
    const requestId = input.requestId || crypto.randomUUID();

    // Load the action definition
    const [action] = await db
      .select()
      .from(gptActions)
      .where(and(eq(gptActions.id, input.actionId), eq(gptActions.gptId, input.gptId)))
      .limit(1);

    if (!action) {
      return this.fail(input.actionId, "unknown", input.gptId, requestId, start, "not_found", "Action not found", false);
    }

    if (action.isActive !== "true") {
      return this.fail(action.id, action.name, input.gptId, requestId, start, "disabled", "Action is disabled", false);
    }

    // Rate limit check
    const rateKey = `${input.conversationId}:${action.id}`;
    const rateCheck = this.rateLimiter.check(rateKey, action.rateLimit ?? 100);
    if (!rateCheck.allowed) {
      return this.fail(action.id, action.name, input.gptId, requestId, start, "rate_limited", `Rate limit exceeded. Retry after ${rateCheck.retryAfterMs}ms`, true);
    }

    // Domain allowlist check
    const allowlist = (action.domainAllowlist as string[]) ?? [];
    if (allowlist.length > 0 && !isDomainAllowed(action.endpoint, allowlist)) {
      return this.fail(action.id, action.name, input.gptId, requestId, start, "blocked", "Endpoint domain not in allowlist", false);
    }

    // Request schema validation
    if (action.requestSchema) {
      const validation = validateRequestSchema(input.arguments, action.requestSchema as Record<string, unknown>);
      if (!validation.valid) {
        return this.fail(action.id, action.name, input.gptId, requestId, start, "validation_error", validation.errors.join("; "), false);
      }
    }

    // Resolve auth headers
    const authHeaders = resolveAuth(action);
    const staticHeaders = (action.headers as Record<string, string>) ?? {};
    const allHeaders = { ...staticHeaders, ...authHeaders, "Content-Type": "application/json" };

    // Build request
    const method = (action.httpMethod ?? "GET").toUpperCase();
    const endpoint = substituteTemplate(action.endpoint, input.arguments);
    const hasBody = !["GET", "HEAD", "OPTIONS"].includes(method);
    const bodyStr = hasBody && action.bodyTemplate
      ? substituteTemplate(action.bodyTemplate, input.arguments)
      : hasBody
        ? JSON.stringify(input.arguments)
        : undefined;

    // PII redaction on request body
    const piiRules = action.piiRedactionRules as Record<string, unknown> | null;
    const redactedBody = bodyStr ? redactPII(bodyStr, piiRules ?? undefined) : undefined;

    // Execute with timeout
    const timeout = Math.min(input.timeoutMs ?? action.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(endpoint, {
        method,
        headers: allHeaders,
        body: redactedBody,
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Read response (with size limit)
      const text = await response.text();
      const truncated = text.slice(0, MAX_RESPONSE_BYTES);

      // PII redaction on response
      const redactedResponse = redactPII(truncated, piiRules ?? undefined);

      // Try to parse as JSON
      let data: unknown;
      try {
        data = JSON.parse(redactedResponse);
      } catch {
        data = redactedResponse;
      }

      // Update usage stats
      await db
        .update(gptActions)
        .set({
          usageCount: sql`${gptActions.usageCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(eq(gptActions.id, action.id));

      const latency = Date.now() - start;
      const entry: ActionAuditEntry = {
        timestamp: Date.now(),
        actionId: action.id,
        actionName: action.name,
        gptId: input.gptId,
        conversationId: input.conversationId,
        userId: input.userId,
        requestId,
        status: response.ok ? "success" : "failure",
        latencyMs: latency,
        statusCode: response.status,
      };
      this.auditLog.push(entry);

      if (!response.ok) {
        return {
          success: false,
          actionId: action.id,
          actionName: action.name,
          status: "failure",
          data,
          error: {
            code: `http_${response.status}`,
            message: `HTTP ${response.status}: ${response.statusText}`,
            retryable: response.status >= 500,
          },
          latencyMs: latency,
          requestId,
        };
      }

      return {
        success: true,
        actionId: action.id,
        actionName: action.name,
        status: "success",
        data,
        latencyMs: latency,
        requestId,
      };
    } catch (err: any) {
      clearTimeout(timer);
      const latency = Date.now() - start;

      const isTimeout = err.name === "AbortError";
      const entry: ActionAuditEntry = {
        timestamp: Date.now(),
        actionId: action.id,
        actionName: action.name,
        gptId: input.gptId,
        conversationId: input.conversationId,
        userId: input.userId,
        requestId,
        status: isTimeout ? "timeout" : "failure",
        latencyMs: latency,
        error: err.message,
      };
      this.auditLog.push(entry);

      return {
        success: false,
        actionId: action.id,
        actionName: action.name,
        status: isTimeout ? "timeout" : "failure",
        error: {
          code: isTimeout ? "timeout" : "fetch_error",
          message: err.message ?? "Unknown error",
          retryable: true,
        },
        latencyMs: latency,
        requestId,
      };
    }
  }

  /**
   * Get audit log entries for a GPT/conversation.
   */
  getAuditLog(filters?: { gptId?: string; conversationId?: string; limit?: number }): ActionAuditEntry[] {
    let entries = [...this.auditLog];
    if (filters?.gptId) entries = entries.filter((e) => e.gptId === filters.gptId);
    if (filters?.conversationId) entries = entries.filter((e) => e.conversationId === filters.conversationId);
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries.slice(0, filters?.limit ?? 100);
  }

  /**
   * Create an action from an OpenAPI spec.
   */
  async createFromOpenAPISpec(
    gptId: string,
    spec: Record<string, unknown>,
    authType?: string,
    authConfig?: Record<string, unknown>
  ): Promise<GptAction[]> {
    const validation = this.validateOpenAPISpec(spec);
    if (!validation.valid) {
      throw new Error(`Invalid OpenAPI spec: ${validation.errors.join("; ")}`);
    }

    const paths = spec.paths as Record<string, any>;
    const servers = (spec.servers as any[]) ?? [];
    const baseUrl = servers[0]?.url ?? "";
    const created: GptAction[] = [];

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
        if (!SAFE_HTTP_METHODS.has(method.toUpperCase())) continue;
        const opId = operation.operationId ?? `${method}_${path}`.replace(/[^a-zA-Z0-9]/g, "_");

        const params: ActionParameter[] = (operation.parameters ?? []).map((p: any) => ({
          name: p.name,
          type: p.schema?.type ?? "string",
          required: p.required ?? false,
          description: p.description,
        }));

        const input = gptActionCreateSchema.parse({
          gptId,
          name: opId,
          description: operation.summary ?? operation.description ?? `${method.toUpperCase()} ${path}`,
          actionType: "api",
          httpMethod: method.toUpperCase(),
          endpoint: `${baseUrl}${path}`,
          openApiSpec: operation,
          operationId: opId,
          requestSchema: operation.requestBody?.content?.["application/json"]?.schema ?? {},
          responseSchema: operation.responses?.["200"]?.content?.["application/json"]?.schema ?? {},
          parameters: params,
          authType: authType ?? "none",
          authConfig: authConfig ?? {},
          domainAllowlist: [],
          headers: {},
          piiRedactionRules: {},
        });

        const [record] = await db.insert(gptActions).values(input).returning();
        created.push(record);
      }
    }

    return created;
  }

  private fail(
    actionId: string,
    actionName: string,
    gptId: string,
    requestId: string,
    startTime: number,
    code: string,
    message: string,
    retryable: boolean
  ): ActionExecutionResult {
    return {
      success: false,
      actionId,
      actionName,
      status: code === "rate_limited" ? "rate_limited" : code === "blocked" ? "blocked" : code === "validation_error" ? "validation_error" : "failure",
      error: { code, message, retryable },
      latencyMs: Date.now() - startTime,
      requestId,
    };
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export const gptActionExecutor = new GptActionExecutor();
