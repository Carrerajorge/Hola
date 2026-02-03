import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform(Number).default("5000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_READ_URL: z.string().optional(),

  // LLM keys
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(), // backward/alternate name used in parts of the codebase
  OPENAI_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),

  BASE_URL: z.string().default("http://localhost:5000"),

  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),

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
  if (data.NODE_ENV === "production") {
    if (!data.JWT_ACCESS_SECRET || !data.JWT_REFRESH_SECRET) {
      console.error("❌ JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required in production");
      process.exit(1);
    }
  }
  if (!data.XAI_API_KEY && !data.GEMINI_API_KEY && !data.OPENAI_API_KEY) {
    console.warn("⚠️  WARNING: No LLM API keys configured (XAI_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY)");
    console.warn("   Chat functionality will not work without at least one LLM provider.");
  } else {
    const providers = [];
    if (data.XAI_API_KEY) providers.push("xAI");
    if (data.GEMINI_API_KEY) providers.push("Gemini");
    if (data.OPENAI_API_KEY) providers.push("OpenAI");
    console.log(`✅ LLM Providers configured: ${providers.join(", ")}`);
  }

  return data;
}

export const env = validateEnv();
