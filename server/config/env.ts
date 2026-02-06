import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const boolish = z
  .preprocess((v) => {
    if (typeof v !== "string") return v;
    const t = v.trim().toLowerCase();
    if (t === "1") return "true";
    if (t === "0") return "false";
    return t;
  }, z.enum(["true", "false"]).default("false"))
  .transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform(Number).default("5000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_READ_URL: z.string().optional(),

  // LLM keys
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(), // backward/alternate name used in parts of the codebase
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),

  BASE_URL: z.string().default("http://localhost:5000"),

  // Token encryption (required for storing OAuth tokens securely in production)
  TOKEN_ENCRYPTION_KEY: z.string().min(32, "TOKEN_ENCRYPTION_KEY must be at least 32 characters").optional(),

  // Admin / bootstrap (used by admin panel and production seeding)
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD must be at least 8 characters").optional(),
  ADMIN_REQUIRE_2FA: boolish.optional(),
  SEED_ON_START: boolish.optional(),

  // Dangerous operations: keep off by default, enable explicitly for one-off seeding tasks.
  ALLOW_CATALOG_SEEDING: boolish.optional(),
  ALLOW_STRIPE_PRODUCT_SEEDING: boolish.optional(),

  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  AUTH0_DOMAIN: z.string().optional(),
  AUTH0_CLIENT_ID: z.string().optional(),
  AUTH0_CLIENT_SECRET: z.string().optional(),

  DB_POOL_MAX: z.string().transform(Number).default("20"),
  DB_POOL_MIN: z.string().transform(Number).default("2"),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    const errors = result.error.flatten().fieldErrors;
    Object.entries(errors).forEach(([key, msgs]) => {
      console.error(`   ${key}: ${msgs?.join(", ")}`);
    });
    process.exit(1);
  }

  // Warn about missing LLM keys
  const data = result.data;
  const hasAnyLlm =
    Boolean(data.XAI_API_KEY) ||
    Boolean(data.GEMINI_API_KEY) ||
    Boolean(data.OPENAI_API_KEY) ||
    Boolean(data.ANTHROPIC_API_KEY);

  if (!hasAnyLlm) {
    console.warn("⚠️  WARNING: No LLM API keys configured (XAI_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY)");
    console.warn("   Chat functionality will not work without at least one LLM provider.");
  } else {
    const providers = [];
    if (data.XAI_API_KEY) providers.push("xAI");
    if (data.GEMINI_API_KEY) providers.push("Gemini");
    if (data.OPENAI_API_KEY) providers.push("OpenAI");
    if (data.ANTHROPIC_API_KEY) providers.push("Anthropic");
    console.log(`✅ LLM Providers configured: ${providers.join(", ")}`);
  }

  // Session hardening: require a strong secret in production, warn in other envs.
  if (data.NODE_ENV === "production" && data.SESSION_SECRET.length < 32) {
    console.error("❌ SESSION_SECRET must be at least 32 characters in production.");
    process.exit(1);
  }
  if (data.NODE_ENV !== "production" && data.NODE_ENV !== "test" && data.SESSION_SECRET.length < 32) {
    console.warn("⚠️  WARNING: SESSION_SECRET should be at least 32 characters.");
  }

  // Security hardening: require a dedicated encryption key if OAuth token storage is enabled in production.
  // TokenManager falls back to a default key if unset, which is not acceptable for production.
  const oauthEnabled = Boolean(
    (data.GOOGLE_CLIENT_ID && data.GOOGLE_CLIENT_SECRET) ||
      (data.MICROSOFT_CLIENT_ID && data.MICROSOFT_CLIENT_SECRET) ||
      (data.AUTH0_DOMAIN && data.AUTH0_CLIENT_ID && data.AUTH0_CLIENT_SECRET)
  );
  if (data.NODE_ENV === "production" && oauthEnabled && !data.TOKEN_ENCRYPTION_KEY) {
    console.error("❌ TOKEN_ENCRYPTION_KEY is required in production when OAuth is enabled.");
    process.exit(1);
  }

  // Production bootstrap hardening: seed-production.ts runs on startup.
  if (data.NODE_ENV === "production") {
    if (!data.ADMIN_EMAIL) {
      console.error("❌ ADMIN_EMAIL is required in production.");
      process.exit(1);
    }
    if (!data.ADMIN_PASSWORD) {
      console.error("❌ ADMIN_PASSWORD is required in production.");
      process.exit(1);
    }
    if (data.ADMIN_PASSWORD && data.ADMIN_PASSWORD.length < 12) {
      console.warn("⚠️  WARNING: ADMIN_PASSWORD should be at least 12 characters in production.");
    }
  }

  return data;
}

export const env = validateEnv();
