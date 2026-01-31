import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform(Number).default("5000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_READ_URL: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),

  SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),

  BASE_URL: z.string().default("http://localhost:5000"),

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

  return result.data;
}

export const env = validateEnv();
