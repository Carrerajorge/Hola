import { db } from "./db";
import { users, aiModels } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

const ADMIN_EMAIL = "carrerajorge874@gmail.com";
const GEMINI_MODELS_TO_ENABLE = [
  "gemini-2.5-flash",
  "gemini-2.5-pro", 
  "gemini-3-flash-preview",
  "gemini-2.0-flash",
];

interface SeedResult {
  userUpdated: boolean;
  modelsEnabled: number;
  modelsAlreadyEnabled: number;
  errors: string[];
}

function shouldRunSeed(): boolean {
  const isProduction = process.env.NODE_ENV === "production";
  const seedFlagEnabled = process.env.SEED_ON_START === "true";
  return isProduction || seedFlagEnabled;
}

export async function seedProductionData(): Promise<SeedResult> {
  const result: SeedResult = {
    userUpdated: false,
    modelsEnabled: 0,
    modelsAlreadyEnabled: 0,
    errors: [],
  };

  if (!shouldRunSeed()) {
    console.log(`[seed] Skipped: NODE_ENV=${process.env.NODE_ENV}, SEED_ON_START=${process.env.SEED_ON_START}`);
    return result;
  }

  console.log(`[seed] Starting production seed...`);

  try {
    const existingUser = await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.email, ADMIN_EMAIL))
      .limit(1);

    if (existingUser.length > 0) {
      if (existingUser[0].role !== "admin") {
        await db
          .update(users)
          .set({ role: "admin" })
          .where(eq(users.email, ADMIN_EMAIL));
        result.userUpdated = true;
        console.log(`[seed] User ${ADMIN_EMAIL} updated to admin`);
      } else {
        console.log(`[seed] User ${ADMIN_EMAIL} already admin (no change)`);
      }
    } else {
      console.log(`[seed] User ${ADMIN_EMAIL} not found - will be set on first login`);
    }
  } catch (error) {
    const errMsg = `User update failed: ${error instanceof Error ? error.message : String(error)}`;
    result.errors.push(errMsg);
    console.error(`[seed] ${errMsg}`);
  }

  try {
    const geminiModels = await db
      .select({ 
        id: aiModels.id, 
        modelId: aiModels.modelId, 
        isEnabled: aiModels.isEnabled,
        name: aiModels.name 
      })
      .from(aiModels)
      .where(
        and(
          eq(aiModels.provider, "google"),
          inArray(aiModels.modelId, GEMINI_MODELS_TO_ENABLE)
        )
      );

    for (const model of geminiModels) {
      if (model.isEnabled === "true") {
        result.modelsAlreadyEnabled++;
      } else {
        try {
          await db
            .update(aiModels)
            .set({ 
              isEnabled: "true", 
              enabledAt: new Date() 
            })
            .where(eq(aiModels.id, model.id));
          result.modelsEnabled++;
          console.log(`[seed] Enabled model: ${model.name} (${model.modelId})`);
        } catch (modelError) {
          const errMsg = `Failed to enable ${model.modelId}: ${modelError instanceof Error ? modelError.message : String(modelError)}`;
          result.errors.push(errMsg);
          console.error(`[seed] ${errMsg}`);
        }
      }
    }

    if (geminiModels.length === 0) {
      console.log(`[seed] No Gemini models found in database`);
    }
  } catch (error) {
    const errMsg = `Models query failed: ${error instanceof Error ? error.message : String(error)}`;
    result.errors.push(errMsg);
    console.error(`[seed] ${errMsg}`);
  }

  console.log(`[seed] Completed: userUpdated=${result.userUpdated}, modelsEnabled=${result.modelsEnabled}, modelsAlreadyEnabled=${result.modelsAlreadyEnabled}, errors=${result.errors.length}`);
  
  return result;
}

export async function getSeedStatus(): Promise<{
  adminUser: { email: string; role: string } | null;
  enabledModels: { name: string; provider: string; modelId: string }[];
  geminiModelsStatus: { modelId: string; isEnabled: boolean }[];
}> {
  const adminUser = await db
    .select({ email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);

  const enabledModels = await db
    .select({ 
      name: aiModels.name, 
      provider: aiModels.provider, 
      modelId: aiModels.modelId 
    })
    .from(aiModels)
    .where(eq(aiModels.isEnabled, "true"));

  const geminiModels = await db
    .select({ 
      modelId: aiModels.modelId, 
      isEnabled: aiModels.isEnabled 
    })
    .from(aiModels)
    .where(
      and(
        eq(aiModels.provider, "google"),
        inArray(aiModels.modelId, GEMINI_MODELS_TO_ENABLE)
      )
    );

  return {
    adminUser: adminUser.length > 0 ? adminUser[0] : null,
    enabledModels,
    geminiModelsStatus: geminiModels.map(m => ({
      modelId: m.modelId,
      isEnabled: m.isEnabled === "true"
    })),
  };
}
