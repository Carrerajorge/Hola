import { randomBytes } from "node:crypto";
import * as dotenv from "dotenv";
import { z } from "zod";
import { normalizeOpenAICompatibleEnv, usesCerebrasOpenAICompatibility } from "../lib/openaiCompatible";

const nodeEnv = process.env.NODE_ENV || "development";
const loadEnvLocal = process.env.LOAD_ENV_LOCAL === "true";
const envLoadedByBootstrap = process.env.ENV_LOADED_BY_BOOTSTRAP === "true";

// Load local overrides first, then defaults.
// .env.local is intended for development only; tests should be hermetic by default.
if (!envLoadedByBootstrap) {
  if (nodeEnv === "development" || loadEnvLocal) {
    dotenv.config({ path: ".env.local" });
  }
  dotenv.config();
}
// Backward compatible aliases for xAI keys used across different parts of the codebase.
process.env.XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY || process.env.ILIAGPT_API_KEY;
normalizeOpenAICompatibleEnv(process.env);

const boolish = z
  .preprocess((v) => {
    if (typeof v !== "string") return v;
    const t = v.trim().toLowerCase();
    if (t === "1") return "true";
    if (t === "0") return "false";
    return t;
  }, z.enum(["true", "false"]).default("false"))
  .transform((v) => v === "true");

// Preprocess empty strings to undefined so Zod `.optional()` handles them
// correctly. Docker/CI often passes env vars as `VAR=` (empty string), which
// Zod treats as a present-but-invalid value, crashing the validation.
const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

const optionalStr = z.preprocess(emptyToUndefined, z.string().optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().email().optional());
const optionalMinStr = (min: number, msg: string) =>
  z.preprocess(emptyToUndefined, z.string().min(min, msg).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform(Number).default("5000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_READ_URL: optionalStr,

  // LLM keys
  GEMINI_API_KEY: optionalStr,
  GOOGLE_API_KEY: optionalStr,
  OPENAI_API_KEY: optionalStr,
  OPENAI_BASE_URL: optionalStr,
  OPENROUTER_API_KEY: optionalStr,
  CEREBRAS_API_KEY: optionalStr,
  CEREBRAS_BASE_URL: optionalStr,
  XAI_API_KEY: optionalStr,
  ANTHROPIC_API_KEY: optionalStr,
  DEEPSEEK_API_KEY: optionalStr,

  // Optional model/baseURL overrides
  OPENAI_MODEL: optionalStr,
  CEREBRAS_MODEL: optionalStr,
  ANTHROPIC_MODEL: optionalStr,
  DEEPSEEK_MODEL: optionalStr,
  DEEPSEEK_BASE_URL: optionalStr,

  SESSION_SECRET: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? randomBytes(32).toString("hex") : v),
    z.string().min(1, "SESSION_SECRET is required"),
  ),

  BASE_URL: z.string().default("http://localhost:5000"),

  // Token encryption (required for storing OAuth tokens securely in production)
  TOKEN_ENCRYPTION_KEY: optionalMinStr(32, "TOKEN_ENCRYPTION_KEY must be at least 32 characters"),

  // Admin / bootstrap (used by admin panel and production seeding)
  ADMIN_EMAIL: optionalEmail,
  ADMIN_PASSWORD: optionalMinStr(8, "ADMIN_PASSWORD must be at least 8 characters"),
  ADMIN_REQUIRE_2FA: boolish.optional(),
  SEED_ON_START: boolish.optional(),

  // Dangerous operations: keep off by default, enable explicitly for one-off seeding tasks.
  ALLOW_CATALOG_SEEDING: boolish.optional(),
  ALLOW_STRIPE_PRODUCT_SEEDING: boolish.optional(),

  MICROSOFT_CLIENT_ID: optionalStr,
  MICROSOFT_CLIENT_SECRET: optionalStr,
  MICROSOFT_TENANT_ID: optionalStr,

  GOOGLE_CLIENT_ID: optionalStr,
  GOOGLE_CLIENT_SECRET: optionalStr,

  AUTH0_DOMAIN: optionalStr,
  AUTH0_CLIENT_ID: optionalStr,
  AUTH0_CLIENT_SECRET: optionalStr,

  DB_POOL_MAX: z.string().transform(Number).default("20"),
  DB_POOL_MIN: z.string().transform(Number).default("2"),

  // Channels (Telegram / WhatsApp Cloud)
  TELEGRAM_BOT_TOKEN: optionalStr,
  TELEGRAM_WEBHOOK_SECRET_TOKEN: optionalStr,
  TELEGRAM_WEBHOOK_URL: optionalStr,
  TELEGRAM_AUTO_SET_WEBHOOK: boolish.optional(),

  WHATSAPP_VERIFY_TOKEN: optionalStr,
  WHATSAPP_APP_SECRET: optionalStr,
  WHATSAPP_CLOUD_ACCESS_TOKEN: optionalStr,
  WHATSAPP_CLOUD_DEFAULT_USER_ID: optionalStr,

  // Messenger (Meta)
  MESSENGER_PAGE_ACCESS_TOKEN: optionalStr,
  MESSENGER_APP_SECRET: optionalStr,
  MESSENGER_VERIFY_TOKEN: optionalStr,
  MESSENGER_DEFAULT_USER_ID: optionalStr,

  // WeChat Official Account
  WECHAT_APP_ID: optionalStr,
  WECHAT_APP_SECRET: optionalStr,
  WECHAT_TOKEN: optionalStr,
  WECHAT_DEFAULT_USER_ID: optionalStr,

  // Channel ingest execution mode:
  // - auto: queue in production when Redis is configured, otherwise in-process
  // - queue: always enqueue to BullMQ (requires Redis + worker)
  // - inprocess: process inside web server (best for local dev)
  CHANNEL_INGEST_MODE: z.enum(["auto", "queue", "inprocess"]).default("auto"),
  MAX_CHANNEL_INGEST_JOB_BYTES: optionalStr,
  CHANNEL_INGEST_ATTEMPTS: optionalStr,
  CHANNEL_INGEST_BACKOFF_MS: optionalStr,
  CHANNEL_INGEST_IDEMPOTENCY_TTL_MS: optionalStr,
  CHANNEL_INGEST_IDEMPOTENCY_MAX_ENTRIES: optionalStr,
  CHANNEL_INGEST_QUEUE_FAILURE_THRESHOLD: optionalStr,
  CHANNEL_INGEST_QUEUE_CIRCUIT_OPEN_MS: optionalStr,
  CHANNEL_INGEST_QUEUE_BACKPRESSURE_LIMIT: optionalStr,
  CHANNEL_INGEST_QUEUE_OPERATION_TIMEOUT_MS: optionalStr,
  CHANNEL_INGEST_INPROCESS_CONCURRENCY: optionalStr,
  CHANNEL_INGEST_INPROCESS_TIMEOUT_MS: optionalStr,
  CHANNEL_INGEST_INPROCESS_QUEUE_MAX: optionalStr,
  CHANNEL_INGEST_INPROCESS_DEDUPE_TTL_MS: optionalStr,
  CHANNEL_INGEST_INPROCESS_RESERVATION_TTL_MS: optionalStr,
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";

    if (isProduction) {
      // In production, warn but do NOT crash — a crash-loop is worse than
      // running with missing optional vars. Required vars (DATABASE_URL,
      // SESSION_SECRET) will surface as runtime errors immediately.
      console.warn("⚠️  Environment validation warnings (non-fatal in production):");
      Object.entries(errors).forEach(([key, msgs]) => {
        console.warn(`   ${key}: ${msgs?.join(", ")}`);
      });
    } else {
      console.error("❌ Invalid environment variables:");
      Object.entries(errors).forEach(([key, msgs]) => {
        console.error(`   ${key}: ${msgs?.join(", ")}`);
      });
      process.exit(1);
    }
  }

  // Warn about missing LLM keys
  const data = result.data;
  const hasAnyLlm =
    Boolean(data.XAI_API_KEY) ||
    Boolean(data.GEMINI_API_KEY || data.GOOGLE_API_KEY) ||
    Boolean(data.OPENROUTER_API_KEY) ||
    Boolean(data.OPENAI_API_KEY || data.OPENAI_BASE_URL || data.CEREBRAS_API_KEY) ||
    Boolean(data.ANTHROPIC_API_KEY) ||
    Boolean(data.DEEPSEEK_API_KEY);

  if (!hasAnyLlm) {
    console.warn("⚠️  WARNING: No LLM API keys configured (XAI_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY/CEREBRAS_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY)");
    console.warn("   Chat functionality will not work without at least one LLM provider.");
  } else {
    const providers = [];
    if (data.XAI_API_KEY) providers.push("xAI");
    if (data.GEMINI_API_KEY || data.GOOGLE_API_KEY) providers.push("Gemini");
    if (data.OPENROUTER_API_KEY) providers.push("OpenRouter");
    if (usesCerebrasOpenAICompatibility(data as NodeJS.ProcessEnv)) providers.push("Cerebras (OpenAI-compatible)");
    else if (data.OPENAI_API_KEY || data.OPENAI_BASE_URL) providers.push("OpenAI");
    if (data.ANTHROPIC_API_KEY) providers.push("Anthropic");
    if (data.DEEPSEEK_API_KEY) providers.push("DeepSeek");
    console.log(`✅ LLM Providers configured: ${providers.join(", ")}`);
  }

  const isTestRuntime = Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";

  // Session hardening: auto-generate if missing in production to prevent crash-loop.
  if (data.NODE_ENV === "production" && !isTestRuntime && data.SESSION_SECRET.length < 32) {
    const generated = randomBytes(32).toString("hex");
    (data as any).SESSION_SECRET = generated;
    process.env.SESSION_SECRET = generated;
    console.warn("⚠️  SESSION_SECRET was too short — auto-generated a random value for this run.");
    console.warn("   Persist a stable SESSION_SECRET (>=32 chars) in .env.production to keep sessions across restarts.");
  }
  if (data.NODE_ENV !== "production" && data.NODE_ENV !== "test" && data.SESSION_SECRET.length < 32) {
    console.warn("⚠️  WARNING: SESSION_SECRET should be at least 32 characters.");
  }

  // Security hardening: auto-generate TOKEN_ENCRYPTION_KEY if missing to prevent crash-loop.
  const oauthEnabled = Boolean(
    (data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET) ||
    (data.MICROSOFT_CLIENT_ID && data.MICROSOFT_CLIENT_SECRET) ||
    (data.AUTH0_DOMAIN && data.AUTH0_CLIENT_ID && data.AUTH0_CLIENT_SECRET)
  );
  if (data.NODE_ENV === "production" && !isTestRuntime && oauthEnabled && !data.TOKEN_ENCRYPTION_KEY) {
    const generated = randomBytes(32).toString("hex");
    (data as any).TOKEN_ENCRYPTION_KEY = generated;
    process.env.TOKEN_ENCRYPTION_KEY = generated;
    console.warn("⚠️  TOKEN_ENCRYPTION_KEY was missing — auto-generated a random value for this run.");
    console.warn("   Persist a stable TOKEN_ENCRYPTION_KEY (>=32 chars) in .env.production for durable token storage.");
  }

  // Production bootstrap: warn instead of crashing so the app can still start.
  if (data.NODE_ENV === "production" && !isTestRuntime) {
    if (!data.ADMIN_EMAIL) {
      console.warn("⚠️  WARNING: ADMIN_EMAIL is not set. Admin panel bootstrapping will be skipped.");
    }
    if (!data.ADMIN_PASSWORD) {
      console.warn("⚠️  WARNING: ADMIN_PASSWORD is not set. Admin panel bootstrapping will be skipped.");
    }
    if (data.ADMIN_PASSWORD && data.ADMIN_PASSWORD.length < 12) {
      console.warn("⚠️  WARNING: ADMIN_PASSWORD should be at least 12 characters in production.");
    }
  }

  // Channel hardening (best-effort warnings; keep optional to avoid breaking deployments
  // that don't use these connectors).
  if (data.TELEGRAM_BOT_TOKEN && !data.TELEGRAM_WEBHOOK_SECRET_TOKEN) {
    console.warn("⚠️  WARNING: TELEGRAM_WEBHOOK_SECRET_TOKEN is not set. Telegram webhook requests won't be authenticated.");
  }
  if (data.TELEGRAM_AUTO_SET_WEBHOOK && !data.TELEGRAM_WEBHOOK_URL) {
    console.warn("⚠️  WARNING: TELEGRAM_AUTO_SET_WEBHOOK=true but TELEGRAM_WEBHOOK_URL is not set. Webhook auto-registration will be skipped.");
  }
  if (data.WHATSAPP_VERIFY_TOKEN && !data.WHATSAPP_APP_SECRET) {
    console.warn("⚠️  WARNING: WHATSAPP_APP_SECRET is not set. WhatsApp Cloud webhook signatures will not be verified.");
  }
  if (data.MESSENGER_PAGE_ACCESS_TOKEN && !data.MESSENGER_VERIFY_TOKEN) {
    console.warn("⚠️  WARNING: MESSENGER_VERIFY_TOKEN is not set. Messenger webhook verification will reject all requests.");
  }
  if (data.MESSENGER_PAGE_ACCESS_TOKEN && !data.MESSENGER_APP_SECRET) {
    console.warn("⚠️  WARNING: MESSENGER_APP_SECRET is not set. Messenger webhook signatures will not be verified.");
  }
  if (data.WECHAT_APP_ID && !data.WECHAT_TOKEN) {
    console.warn("⚠️  WARNING: WECHAT_TOKEN is not set. WeChat webhook requests won't be authenticated.");
  }

  return data;
}

export const env = validateEnv();
