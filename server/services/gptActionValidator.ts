/**
 * GPT Action Validator
 *
 * Formal OpenAPI/JSON Schema validation for GPT Actions.
 * Implements the complete action lifecycle:
 *   1. Schema validation (OpenAPI spec + JSON Schema)
 *   2. Auth resolution (API key, OAuth, bearer, basic)
 *   3. Domain allowlist enforcement
 *   4. Rate limiting per action
 *   5. PII redaction on request/response
 *   6. Execution with audit logging
 *
 * This is the "contract layer" that ensures GPTs don't guess endpoints
 * but consume formally defined API operations.
 */

import crypto from "node:crypto";
import { createLogger } from "../lib/structuredLogger";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { gptActions, type GptAction } from "@shared/schema/gpt";
import { gptTraces, type InsertGptTrace } from "@shared/schema/gptProduct";

const logger = createLogger("gpt-action-validator");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenApiOperation {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: "query" | "path" | "header" | "cookie";
    required?: boolean;
    schema?: Record<string, unknown>;
  }>;
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Record<string, unknown> }> }>;
}

export interface ActionValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string; code: string }>;
  warnings: Array<{ path: string; message: string }>;
}

export interface ActionAuthResolution {
  headers: Record<string, string>;
  queryParams?: Record<string, string>;
}

export interface ActionExecutionResult {
  success: boolean;
  statusCode: number;
  data: unknown;
  redactedData?: unknown;
  headers: Record<string, string>;
  durationMs: number;
  retryCount: number;
  error?: { code: string; message: string; retryable: boolean };
}

export interface ActionCallLog {
  actionId: string;
  gptId: string;
  conversationId: string;
  operationId: string;
  method: string;
  endpoint: string;
  statusCode: number;
  success: boolean;
  durationMs: number;
  requestPayloadSize: number;
  responsePayloadSize: number;
  piiRedacted: boolean;
  timestamp: Date;
}

// ─── Schema Validator ─────────────────────────────────────────────────────────

const MAX_SCHEMA_DEPTH = 64;
const ALLOWED_TYPES = new Set(["string", "number", "integer", "boolean", "array", "object", "null"]);

/**
 * Validates an OpenAPI spec or JSON Schema for structural correctness.
 */
export function validateActionSchema(spec: unknown): ActionValidationResult {
  const errors: ActionValidationResult["errors"] = [];
  const warnings: ActionValidationResult["warnings"] = [];

  if (!spec || typeof spec !== "object") {
    errors.push({ path: "$", message: "Schema must be a non-null object", code: "INVALID_SCHEMA" });
    return { valid: false, errors, warnings };
  }

  const root = spec as Record<string, unknown>;

  // Check if it's an OpenAPI spec
  if (root.openapi || root.swagger) {
    return validateOpenApiSpec(root, errors, warnings);
  }

  // Otherwise treat as JSON Schema for a single operation
  return validateJsonSchema(root, "$", errors, warnings, 0);
}

function validateOpenApiSpec(
  spec: Record<string, unknown>,
  errors: ActionValidationResult["errors"],
  warnings: ActionValidationResult["warnings"]
): ActionValidationResult {
  // Validate version
  const version = spec.openapi || spec.swagger;
  if (typeof version !== "string") {
    errors.push({ path: "$.openapi", message: "Missing or invalid OpenAPI version", code: "MISSING_VERSION" });
  }

  // Validate info
  const info = spec.info as Record<string, unknown> | undefined;
  if (!info || typeof info !== "object") {
    errors.push({ path: "$.info", message: "Missing info object", code: "MISSING_INFO" });
  } else {
    if (!info.title) warnings.push({ path: "$.info.title", message: "Missing API title" });
    if (!info.version) warnings.push({ path: "$.info.version", message: "Missing API version" });
  }

  // Validate paths
  const paths = spec.paths as Record<string, unknown> | undefined;
  if (!paths || typeof paths !== "object") {
    errors.push({ path: "$.paths", message: "Missing paths object", code: "MISSING_PATHS" });
  } else {
    for (const [pathKey, pathValue] of Object.entries(paths)) {
      if (typeof pathValue !== "object" || !pathValue) continue;
      const pathObj = pathValue as Record<string, unknown>;

      for (const method of ["get", "post", "put", "delete", "patch"]) {
        const operation = pathObj[method] as Record<string, unknown> | undefined;
        if (!operation) continue;

        if (!operation.operationId) {
          warnings.push({
            path: `$.paths.${pathKey}.${method}`,
            message: "Missing operationId — will auto-generate from method+path",
          });
        }

        // Validate parameters
        const params = operation.parameters as Array<Record<string, unknown>> | undefined;
        if (params && Array.isArray(params)) {
          for (let i = 0; i < params.length; i++) {
            const param = params[i];
            if (!param.name) {
              errors.push({
                path: `$.paths.${pathKey}.${method}.parameters[${i}]`,
                message: "Parameter missing name",
                code: "INVALID_PARAMETER",
              });
            }
            if (!param.in || !["query", "path", "header", "cookie"].includes(param.in as string)) {
              errors.push({
                path: `$.paths.${pathKey}.${method}.parameters[${i}]`,
                message: "Parameter missing or invalid 'in' field",
                code: "INVALID_PARAMETER",
              });
            }
          }
        }
      }
    }
  }

  // Validate servers
  const servers = spec.servers as Array<Record<string, unknown>> | undefined;
  if (!servers || !Array.isArray(servers) || servers.length === 0) {
    warnings.push({ path: "$.servers", message: "No servers defined — endpoint must be provided separately" });
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateJsonSchema(
  schema: Record<string, unknown>,
  path: string,
  errors: ActionValidationResult["errors"],
  warnings: ActionValidationResult["warnings"],
  depth: number
): ActionValidationResult {
  if (depth > MAX_SCHEMA_DEPTH) {
    errors.push({ path, message: "Schema exceeds maximum depth", code: "MAX_DEPTH" });
    return { valid: false, errors, warnings };
  }

  const type = schema.type as string | undefined;
  if (type && !ALLOWED_TYPES.has(type)) {
    errors.push({ path: `${path}.type`, message: `Invalid type: ${type}`, code: "INVALID_TYPE" });
  }

  // Validate object properties
  if (type === "object" && schema.properties) {
    const props = schema.properties as Record<string, unknown>;
    for (const [propName, propValue] of Object.entries(props)) {
      if (typeof propValue === "object" && propValue !== null) {
        validateJsonSchema(
          propValue as Record<string, unknown>,
          `${path}.properties.${propName}`,
          errors,
          warnings,
          depth + 1
        );
      }
    }
  }

  // Validate array items
  if (type === "array" && schema.items) {
    if (typeof schema.items === "object" && schema.items !== null) {
      validateJsonSchema(
        schema.items as Record<string, unknown>,
        `${path}.items`,
        errors,
        warnings,
        depth + 1
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Auth Resolution ──────────────────────────────────────────────────────────

/**
 * Resolves authentication for an action based on its auth configuration.
 */
export function resolveActionAuth(action: GptAction): ActionAuthResolution {
  const authType = action.authType || "none";
  const authConfig = (action.authConfig || {}) as Record<string, unknown>;
  const result: ActionAuthResolution = { headers: {} };

  switch (authType) {
    case "api_key": {
      const key = authConfig.key as string | undefined;
      const headerName = (authConfig.headerName as string) || "X-API-Key";
      const location = (authConfig.location as string) || "header";
      if (key) {
        if (location === "header") {
          result.headers[headerName] = key;
        } else if (location === "query") {
          const paramName = (authConfig.paramName as string) || "api_key";
          result.queryParams = { [paramName]: key };
        }
      }
      break;
    }
    case "bearer": {
      const token = authConfig.token as string | undefined;
      if (token) {
        result.headers["Authorization"] = `Bearer ${token}`;
      }
      break;
    }
    case "basic": {
      const username = authConfig.username as string | undefined;
      const password = authConfig.password as string | undefined;
      if (username && password) {
        const encoded = Buffer.from(`${username}:${password}`).toString("base64");
        result.headers["Authorization"] = `Basic ${encoded}`;
      }
      break;
    }
    case "oauth": {
      const accessToken = authConfig.accessToken as string | undefined;
      if (accessToken) {
        result.headers["Authorization"] = `Bearer ${accessToken}`;
      }
      break;
    }
    case "custom": {
      const customHeaders = authConfig.headers as Record<string, string> | undefined;
      if (customHeaders && typeof customHeaders === "object") {
        for (const [key, value] of Object.entries(customHeaders)) {
          if (typeof value === "string") {
            result.headers[key] = value;
          }
        }
      }
      break;
    }
    default:
      break;
  }

  return result;
}

// ─── Domain Allowlist ─────────────────────────────────────────────────────────

/**
 * Checks if an endpoint URL is allowed by the action's domain allowlist.
 */
export function isDomainAllowed(endpoint: string, allowlist: string[] | null): boolean {
  if (!allowlist || allowlist.length === 0) {
    return true; // No restrictions
  }

  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();

    return allowlist.some((domain) => {
      const normalizedDomain = domain.toLowerCase().trim();
      return (
        hostname === normalizedDomain ||
        hostname.endsWith(`.${normalizedDomain}`)
      );
    });
  } catch {
    return false; // Invalid URL
  }
}

// ─── PII Redaction ────────────────────────────────────────────────────────────

const PII_PATTERNS = [
  { name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL]" },
  { name: "phone", pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[PHONE]" },
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  { name: "credit_card", pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, replacement: "[CC]" },
  { name: "ip_address", pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: "[IP]" },
];

/**
 * Redacts PII from a string based on configured rules.
 */
export function redactPII(text: string, customRules?: Record<string, unknown>): { redacted: string; redactedCount: number } {
  let result = text;
  let redactedCount = 0;

  for (const { pattern, replacement } of PII_PATTERNS) {
    const matches = result.match(pattern);
    if (matches) {
      redactedCount += matches.length;
      result = result.replace(pattern, replacement);
    }
  }

  return { redacted: result, redactedCount };
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

const rateLimitWindows = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Check and consume a rate limit slot for an action.
 */
export function checkRateLimit(actionId: string, maxPerMinute: number): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const key = `action:${actionId}`;
  const window = rateLimitWindows.get(key);

  if (!window || now - window.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitWindows.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (window.count >= maxPerMinute) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - window.windowStart);
    return { allowed: false, retryAfterMs };
  }

  window.count++;
  return { allowed: true };
}

// ─── Action-to-Tool Spec Converter ────────────────────────────────────────────

/**
 * Converts a GPT Action definition into a tool spec that can be passed
 * to the model for function calling.
 */
export function actionToToolSpec(action: GptAction): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
} {
  const params = action.parameters as Array<{ name: string; type: string; required: boolean; description?: string }> | null;
  const requestSchema = action.requestSchema as Record<string, unknown> | null;

  // Build parameters from action definition
  let parameters: Record<string, unknown>;

  if (requestSchema) {
    // Use the explicitly defined request schema
    parameters = requestSchema;
  } else if (params && Array.isArray(params)) {
    // Build from parameter list
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of params) {
      properties[param.name] = {
        type: param.type || "string",
        description: param.description || param.name,
      };
      if (param.required) {
        required.push(param.name);
      }
    }

    parameters = {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  } else {
    parameters = { type: "object", properties: {} };
  }

  return {
    type: "function",
    function: {
      name: `action_${action.operationId || action.id}`,
      description: action.description || action.name,
      parameters,
    },
  };
}

// ─── Action Executor ──────────────────────────────────────────────────────────

/**
 * Executes a validated GPT Action:
 *  1. Validates input against request schema
 *  2. Resolves auth
 *  3. Checks domain allowlist
 *  4. Checks rate limits
 *  5. Executes HTTP call
 *  6. Validates response
 *  7. Redacts PII if enabled
 *  8. Logs the call
 */
export async function executeAction(
  action: GptAction,
  input: Record<string, unknown>,
  context: {
    gptId: string;
    conversationId: string;
    userId?: string;
    requestId?: string;
    piiRedactionEnabled?: boolean;
  }
): Promise<ActionExecutionResult> {
  const start = Date.now();
  let retryCount = 0;

  // 1. Domain allowlist check
  const domainAllowlist = action.domainAllowlist as string[] | null;
  if (!isDomainAllowed(action.endpoint, domainAllowlist)) {
    return {
      success: false,
      statusCode: 403,
      data: null,
      durationMs: Date.now() - start,
      retryCount: 0,
      headers: {},
      error: {
        code: "DOMAIN_BLOCKED",
        message: `Endpoint domain is not in the allowlist`,
        retryable: false,
      },
    };
  }

  // 2. Rate limit check
  const rateLimit = action.rateLimit || 100;
  const rateLimitResult = checkRateLimit(action.id, rateLimit);
  if (!rateLimitResult.allowed) {
    return {
      success: false,
      statusCode: 429,
      data: null,
      durationMs: Date.now() - start,
      retryCount: 0,
      headers: {},
      error: {
        code: "RATE_LIMITED",
        message: `Rate limit exceeded. Retry after ${rateLimitResult.retryAfterMs}ms`,
        retryable: true,
      },
    };
  }

  // 3. Resolve auth
  const auth = resolveActionAuth(action);

  // 4. Build request
  const method = (action.httpMethod || "GET").toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "ILIAGPT-Action/1.0",
    ...auth.headers,
  };

  // Merge action-defined headers
  const actionHeaders = action.headers as Record<string, string | number | boolean> | null;
  if (actionHeaders) {
    for (const [key, value] of Object.entries(actionHeaders)) {
      headers[key] = String(value);
    }
  }

  // Build URL with query params
  let url = action.endpoint;
  if (auth.queryParams) {
    const urlObj = new URL(url);
    for (const [key, value] of Object.entries(auth.queryParams)) {
      urlObj.searchParams.set(key, value);
    }
    url = urlObj.toString();
  }

  // Replace path parameters
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "number") {
      url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
    }
  }

  // 5. Execute with retry
  const maxRetries = 2;
  const timeout = action.timeout || 30000;

  while (retryCount <= maxRetries) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (["POST", "PUT", "PATCH"].includes(method)) {
        // Apply body template if defined
        let body: unknown = input;
        if (action.bodyTemplate) {
          try {
            let template = action.bodyTemplate;
            for (const [key, value] of Object.entries(input)) {
              template = template.replace(
                new RegExp(`\\{\\{${key}\\}\\}`, "g"),
                JSON.stringify(value)
              );
            }
            body = JSON.parse(template);
          } catch {
            body = input;
          }
        }

        // PII redaction on request
        if (context.piiRedactionEnabled) {
          const bodyStr = JSON.stringify(body);
          const { redacted } = redactPII(bodyStr, action.piiRedactionRules as Record<string, unknown>);
          body = JSON.parse(redacted);
        }

        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let data: unknown;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      // PII redaction on response
      let redactedData: unknown | undefined;
      if (context.piiRedactionEnabled && data) {
        const dataStr = JSON.stringify(data);
        const { redacted, redactedCount } = redactPII(dataStr);
        if (redactedCount > 0) {
          redactedData = JSON.parse(redacted);
        }
      }

      // Log the call
      await logActionCall({
        actionId: action.id,
        gptId: context.gptId,
        conversationId: context.conversationId,
        operationId: action.operationId || action.id,
        method,
        endpoint: url,
        statusCode: response.status,
        success: response.ok,
        durationMs: Date.now() - start,
        requestPayloadSize: fetchOptions.body ? String(fetchOptions.body).length : 0,
        responsePayloadSize: JSON.stringify(data).length,
        piiRedacted: !!redactedData,
        timestamp: new Date(),
      });

      return {
        success: response.ok,
        statusCode: response.status,
        data: redactedData || data,
        redactedData,
        headers: responseHeaders,
        durationMs: Date.now() - start,
        retryCount,
        error: response.ok
          ? undefined
          : {
              code: `HTTP_${response.status}`,
              message: `Action returned status ${response.status}`,
              retryable: response.status >= 500,
            },
      };
    } catch (err: any) {
      retryCount++;
      if (retryCount > maxRetries) {
        return {
          success: false,
          statusCode: 0,
          data: null,
          headers: {},
          durationMs: Date.now() - start,
          retryCount,
          error: {
            code: err?.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR",
            message: err?.message ?? "Action execution failed",
            retryable: false,
          },
        };
      }
      // Exponential backoff
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, retryCount)));
    }
  }

  return {
    success: false,
    statusCode: 0,
    data: null,
    headers: {},
    durationMs: Date.now() - start,
    retryCount,
    error: { code: "MAX_RETRIES", message: "Max retries exceeded", retryable: false },
  };
}

// ─── Audit Logging ────────────────────────────────────────────────────────────

async function logActionCall(log: ActionCallLog): Promise<void> {
  try {
    await db.insert(gptTraces).values({
      gptId: log.gptId,
      conversationId: log.conversationId,
      traceType: "action_call",
      stage: "execution",
      durationMs: log.durationMs,
      inputSize: log.requestPayloadSize,
      outputSize: log.responsePayloadSize,
      success: log.success ? "true" : "false",
      metadata: {
        actionId: log.actionId,
        operationId: log.operationId,
        method: log.method,
        statusCode: log.statusCode,
        piiRedacted: log.piiRedacted,
      },
    });
  } catch (err) {
    logger.error("Failed to log action call", { err });
  }
}
