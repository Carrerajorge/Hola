import { z } from "zod";

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.string().transform(Number).default("5000"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required for AI features").optional(),

    // Authentication Secrets
    SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),

    // Microsoft OAuth
    MICROSOFT_CLIENT_ID: z.string().min(1, "MICROSOFT_CLIENT_ID is required for Azure AD Auth"),
    MICROSOFT_CLIENT_SECRET: z.string().min(1, "MICROSOFT_CLIENT_SECRET is required for Azure AD Auth"),
    MICROSOFT_TENANT_ID: z.string().min(1, "MICROSOFT_TENANT_ID is required for Azure AD Auth"),

    // Pool settings
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

        // In production, we crash. In dev, we might warn (but DB URL is critical).
        if (process.env.NODE_ENV === "production") {
            process.exit(1);
        } else {
            console.warn("⚠️  Running with invalid environment in development (some features may break).");
        }

        // Attempt best-effort return or throw?
        // If strict, throw.
        if (!process.env.DATABASE_URL) {
            throw new Error("DATABASE_URL is missing.");
        }
    }

    return result.data || process.env as any;
}

export const env = validateEnv();
