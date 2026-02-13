
import "dotenv/config";
import { verifyDatabaseConnection } from "../server/db";
import fs from "fs";
import path from "path";
import { Logger } from "../server/lib/logger";

const REQUIRED_ENV_VARS = [
    "DATABASE_URL",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "XAI_API_KEY",
    "NODE_ENV"
];

const CRITICAL_FILES = [
    "server/index.ts",
    "server/routes.ts",
    "server/middleware/apiErrorHandler.ts",
    "server/services/CitationService.ts",
    "server/services/AuditService.ts",
    "package.json",
    "client/src/App.tsx",
    "client/src/components/chat-interface.tsx"
];

async function runCertification() {
    console.log("🚀 Starting Production Certification (Pre-Flight Check)...\n");
    let passed = true;

    // 1. Check Environment Variables
    console.log("1️⃣  Checking Environment Variables...");
    const missingEnv = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
    if (missingEnv.length > 0) {
        console.error(`❌ Missing critical env vars: ${missingEnv.join(", ")}`);
        passed = false;
    } else {
        console.log("✅ All critical environment variables present.");
    }

    // 2. Check Critical Files
    console.log("\n2️⃣  Checking Critical Files...");
    const missingFiles = CRITICAL_FILES.filter(f => !fs.existsSync(path.join(process.cwd(), f)));
    if (missingFiles.length > 0) {
        console.error(`❌ Missing critical files: ${missingFiles.join(", ")}`);
        passed = false;
    } else {
        console.log("✅ All critical files exist.");
    }

    // 3. Database Connection
    console.log("\n3️⃣  Checking Database Connection...");
    try {
        const dbConnected = await verifyDatabaseConnection();
        if (!dbConnected) {
            console.error("❌ Database connection failed.");
            passed = false;
        } else {
            console.log("✅ Database connected successfully.");
        }
    } catch (error) {
        console.error("❌ Database check error:", error);
        passed = false;
    }

    // 4. Check Build Artifacts (Frontend)
    console.log("\n4️⃣  Checking Build Artifacts...");
    if (process.env.NODE_ENV === "production") {
        if (!fs.existsSync(path.join(process.cwd(), "dist"))) {
            console.warn("⚠️  'dist' directory missing. Ensure frontend is built for production.");
            // Not failing hard here as it might be a pre-build check
        } else {
            console.log("✅ 'dist' directory exists.");
        }
    } else {
        console.log("ℹ️  Skipping build artifact check (not in production mode).");
    }

    console.log("\n-------------------------------------------");
    if (passed) {
        console.log("✅ SYSTEM CERTIFIED FOR PRODUCTION ✅");
        process.exit(0);
    } else {
        console.error("❌ SYSTEM CERTIFICATION FAILED ❌");
        process.exit(1);
    }
}

runCertification().catch(err => {
    console.error("Certification script error:", err);
    process.exit(1);
});
