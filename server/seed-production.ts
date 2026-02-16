import { db } from "./db";
import { users, aiModels } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { syncAllProviders } from "./services/aiModelSyncService";
import { isChatModelType, normalizeModelProviderToRuntime, isChatModelIdCompatible } from "./services/modelIntegration";

const ADMIN_EMAIL_RAW = (process.env.ADMIN_EMAIL || "").trim();
const ADMIN_EMAIL = ADMIN_EMAIL_RAW.toLowerCase();

interface SeedResult {
  userUpdated: boolean;
  userMissing: boolean;
  modelsEnabled: number;
  modelsAlreadyEnabled: number;
  modelsSynced: number;
  errors: string[];
}

function shouldRunSeed(): boolean {
  const isProduction = process.env.NODE_ENV === "production";
  const seedFlagEnabled = process.env.SEED_ON_START === "true";
  return isProduction || seedFlagEnabled;
}

async function tableExists(tableName: string): Promise<boolean> {
  const result = await db.execute(sql`select to_regclass(${tableName}) as table_name`);
  const row = result.rows?.[0] as { table_name?: string | null } | undefined;
  return Boolean(row?.table_name);
}

export async function seedProductionData(): Promise<SeedResult> {
  const result: SeedResult = {
    userUpdated: false,
    userMissing: false,
    modelsEnabled: 0,
    modelsAlreadyEnabled: 0,
    modelsSynced: 0,
    errors: [],
  };

  if (!shouldRunSeed()) {
    console.log(`[seed] Skipped: NODE_ENV=${process.env.NODE_ENV}, SEED_ON_START=${process.env.SEED_ON_START}`);
    return result;
  }

  if (!ADMIN_EMAIL_RAW) {
    const errMsg = "ADMIN_EMAIL is not configured (required for production seeding)";
    result.errors.push(errMsg);
    console.error(`[seed] ${errMsg}`);
    return result;
  }

  console.log(`[seed] Starting production seed...`);

  // ---------- Admin User ----------
  try {
    const hasUsersTable = await tableExists("public.users");
    if (!hasUsersTable) {
      result.userMissing = true;
      console.warn("[seed] Users table missing; skipping admin seed.");
    } else {
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
      if (!ADMIN_PASSWORD && process.env.NODE_ENV === "production") {
        throw new Error("ADMIN_PASSWORD is not configured (required in production)");
      }
      const bcrypt = await import("bcrypt");
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD || "admin", 12);

      const existingUser = await db
        .select({ id: users.id, email: users.email, role: users.role })
        .from(users)
        .where(sql`lower(${users.email}) = ${ADMIN_EMAIL}`)
        .limit(1);

      if (existingUser.length > 0) {
        await db
          .update(users)
          .set({
            role: "admin",
            password: hashedPassword
          })
          .where(sql`lower(${users.email}) = ${ADMIN_EMAIL}`);

        result.userUpdated = true;
        console.log(`[seed] User ${ADMIN_EMAIL} updated to admin with configured password`);
      } else {
        await db.insert(users).values({
          email: ADMIN_EMAIL,
          password: hashedPassword,
          role: "admin",
          username: "admin",
          firstName: "Admin",
          lastName: "User",
          status: "active",
          emailVerified: "true",
          authProvider: "email"
        });
        result.userUpdated = true;
        console.log(`[seed] Created admin user ${ADMIN_EMAIL}`);
      }
    }
  } catch (error) {
    const errMsg = `User update failed: ${error instanceof Error ? error.message : String(error)}`;
    result.errors.push(errMsg);
    console.error(`[seed] ${errMsg}`);
  }

  // ---------- Sync + Enable ALL Models ----------
  try {
    const hasAiModelsTable = await tableExists("public.ai_models");
    if (!hasAiModelsTable) {
      console.warn("[seed] AI models table missing; skipping model sync.");
      return result;
    }

    // 1) Sync all known models from every provider into the DB
    console.log("[seed] Syncing models from all providers...");
    const syncResults = await syncAllProviders();
    for (const [provider, provResult] of Object.entries(syncResults)) {
      result.modelsSynced += provResult.added + provResult.updated;
      if (provResult.added > 0 || provResult.updated > 0) {
        console.log(`[seed]   ${provider}: ${provResult.added} added, ${provResult.updated} updated`);
      }
      if (provResult.errors.length > 0) {
        result.errors.push(...provResult.errors);
      }
    }

    // 2) Activate all chat-capable, non-deprecated models: set status=active + isEnabled=true
    const allModels = await db
      .select({
        id: aiModels.id,
        modelId: aiModels.modelId,
        provider: aiModels.provider,
        modelType: aiModels.modelType,
        isEnabled: aiModels.isEnabled,
        status: aiModels.status,
        name: aiModels.name,
        isDeprecated: aiModels.isDeprecated,
      })
      .from(aiModels);

    for (const model of allModels) {
      // Skip deprecated models
      if (model.isDeprecated === "true") continue;

      // Only activate chat-capable models (TEXT/MULTIMODAL with matching provider IDs)
      if (!isChatModelType(model.modelType)) continue;

      const runtime = normalizeModelProviderToRuntime(model.provider);
      if (!runtime) continue;
      if (!isChatModelIdCompatible(runtime, model.modelId)) continue;

      const needsUpdate = model.status !== "active" || model.isEnabled !== "true";
      if (!needsUpdate) {
        result.modelsAlreadyEnabled++;
        continue;
      }

      try {
        await db
          .update(aiModels)
          .set({
            status: "active",
            isEnabled: "true",
            enabledAt: new Date(),
          })
          .where(eq(aiModels.id, model.id));
        result.modelsEnabled++;
        console.log(`[seed] Enabled: ${model.name} (${model.provider}/${model.modelId})`);
      } catch (modelError) {
        const errMsg = `Failed to enable ${model.modelId}: ${modelError instanceof Error ? modelError.message : String(modelError)}`;
        result.errors.push(errMsg);
        console.error(`[seed] ${errMsg}`);
      }
    }

    console.log(`[seed] Models: ${result.modelsEnabled} enabled, ${result.modelsAlreadyEnabled} already active`);
  } catch (error) {
    const errMsg = `Models sync/enable failed: ${error instanceof Error ? error.message : String(error)}`;
    result.errors.push(errMsg);
    console.error(`[seed] ${errMsg}`);
  }

  console.log(`[seed] Completed: userUpdated=${result.userUpdated}, modelsEnabled=${result.modelsEnabled}, modelsSynced=${result.modelsSynced}, errors=${result.errors.length}`);

  return result;
}

export async function getSeedStatus(): Promise<{
  adminUser: { email: string | null; role: string | null } | null;
  enabledModels: { name: string; provider: string; modelId: string }[];
  summary: {
    userExists: boolean;
    userIsAdmin: boolean;
    totalModels: number;
    enabledModels: number;
  };
}> {
  if (!ADMIN_EMAIL_RAW) {
    return {
      adminUser: null,
      enabledModels: [],
      summary: {
        userExists: false,
        userIsAdmin: false,
        totalModels: 0,
        enabledModels: 0,
      },
    };
  }

  const [hasUsersTable, hasAiModelsTable] = await Promise.all([
    tableExists("public.users"),
    tableExists("public.ai_models"),
  ]);

  if (!hasUsersTable || !hasAiModelsTable) {
    return {
      adminUser: null,
      enabledModels: [],
      summary: {
        userExists: false,
        userIsAdmin: false,
        totalModels: 0,
        enabledModels: 0,
      },
    };
  }

  const adminUser = await db
    .select({ email: users.email, role: users.role })
    .from(users)
    .where(sql`lower(${users.email}) = ${ADMIN_EMAIL}`)
    .limit(1);

  const allModels = await db
    .select({
      name: aiModels.name,
      provider: aiModels.provider,
      modelId: aiModels.modelId,
      isEnabled: aiModels.isEnabled,
    })
    .from(aiModels);

  const enabledModels = allModels.filter(m => m.isEnabled === "true");

  const userExists = adminUser.length > 0;
  const userIsAdmin = userExists && adminUser[0].role === "admin";

  return {
    adminUser: adminUser.length > 0 ? adminUser[0] : null,
    enabledModels,
    summary: {
      userExists,
      userIsAdmin,
      totalModels: allModels.length,
      enabledModels: enabledModels.length,
    },
  };
}
