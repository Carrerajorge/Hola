import { db } from "./db";
import { users, aiModels } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { log } from "./index";

const ADMIN_EMAIL = "carrerajorge874@gmail.com";
const GEMINI_MODELS_TO_ENABLE = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3-flash-preview",
  "gemini-2.0-flash",
];

export async function seedProductionData(): Promise<void> {
  try {
    log("Starting production seed...", "seed");

    // 1. Ensure admin user exists and has correct role
    const existingUser = await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.email, ADMIN_EMAIL))
      .limit(1);

    if (existingUser.length > 0) {
      if (existingUser[0].role !== "admin") {
        const updated = await db
          .update(users)
          .set({ role: "admin" })
          .where(eq(users.email, ADMIN_EMAIL))
          .returning({ id: users.id, email: users.email, role: users.role });
        log(`Updated user to admin: ${JSON.stringify(updated)}`, "seed");
      } else {
        log(`User ${ADMIN_EMAIL} already has admin role`, "seed");
      }
    } else {
      log(`User ${ADMIN_EMAIL} not found - will be created on first login`, "seed");
    }

    // 2. Enable Gemini models if they exist
    const geminiModels = await db
      .select({ id: aiModels.id, modelId: aiModels.modelId, isEnabled: aiModels.isEnabled })
      .from(aiModels)
      .where(
        and(
          eq(aiModels.provider, "google"),
          inArray(aiModels.modelId, GEMINI_MODELS_TO_ENABLE)
        )
      );

    if (geminiModels.length > 0) {
      const modelsToUpdate = geminiModels.filter((m) => m.isEnabled !== "true");
      
      if (modelsToUpdate.length > 0) {
        const modelIds = modelsToUpdate.map((m) => m.id);
        const updated = await db
          .update(aiModels)
          .set({ 
            isEnabled: "true", 
            enabledAt: new Date() 
          })
          .where(inArray(aiModels.id, modelIds))
          .returning({ 
            id: aiModels.id, 
            modelId: aiModels.modelId, 
            isEnabled: aiModels.isEnabled 
          });
        log(`Enabled ${updated.length} Gemini models: ${updated.map(m => m.modelId).join(", ")}`, "seed");
      } else {
        log(`All Gemini models already enabled`, "seed");
      }
    } else {
      log(`No Gemini models found in database - run migration first`, "seed");
    }

    // 3. Verify final state
    const finalUser = await db
      .select({ email: users.email, role: users.role })
      .from(users)
      .where(eq(users.email, ADMIN_EMAIL))
      .limit(1);

    const enabledModels = await db
      .select({ name: aiModels.name, provider: aiModels.provider, modelId: aiModels.modelId })
      .from(aiModels)
      .where(eq(aiModels.isEnabled, "true"));

    log(`Production seed complete. Admin: ${finalUser.length > 0 ? finalUser[0].email : "pending"}, Enabled models: ${enabledModels.length}`, "seed");
    
  } catch (error) {
    log(`Production seed error: ${error instanceof Error ? error.message : String(error)}`, "seed");
  }
}
