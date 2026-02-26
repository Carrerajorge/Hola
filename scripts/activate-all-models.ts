/**
 * One-off script: Sync all known models to DB and activate/enable chat-capable ones.
 * Usage: node --import tsx scripts/activate-all-models.ts
 */
import "dotenv/config";

async function main() {
  // Dynamic imports so dotenv is loaded first
  const { syncAllProviders, getModelStats } = await import("../server/services/aiModelSyncService");
  const { storage } = await import("../server/storage");
  const { isModelProviderIntegrated, isModelChatCapable } = await import("../server/services/modelIntegration");

  console.log("\n=== Model Activation Script ===\n");

  // 1. Show catalog stats
  const stats = getModelStats();
  console.log(`📚 Known models in catalog: ${stats.totalKnown}`);
  console.log(`   By provider:`, stats.byProvider);

  // 2. Sync all models from catalog → database
  console.log("\n🔄 Syncing all providers to database...");
  const syncResults = await syncAllProviders();
  for (const [provider, result] of Object.entries(syncResults)) {
    console.log(`   ${provider}: +${result.added} added, ~${result.updated} updated${result.errors.length > 0 ? `, ❌ ${result.errors.length} errors` : ""}`);
  }

  // 3. Fetch all models from DB
  const allModels = await storage.getAiModels();
  console.log(`\n📦 Total models in database: ${allModels.length}`);

  // 4. Activate and enable chat-capable models from integrated providers
  let activated = 0;
  let enabled = 0;
  let skipped = 0;

  for (const model of allModels) {
    const isIntegrated = isModelProviderIntegrated(model.provider);
    const isChatCapable = isModelChatCapable(model);

    if (!isIntegrated || !isChatCapable) {
      skipped++;
      continue;
    }

    const updates: Record<string, any> = {};

    if (model.status !== "active") {
      updates.status = "active";
      activated++;
    }

    if (model.isEnabled !== "true") {
      updates.isEnabled = "true";
      updates.enabledAt = new Date();
      enabled++;
    }

    if (Object.keys(updates).length > 0) {
      await storage.updateAiModel(model.id, updates);
    }
  }

  console.log(`\n✅ Results:`);
  console.log(`   Activated: ${activated} models`);
  console.log(`   Enabled: ${enabled} models`);
  console.log(`   Skipped (non-chat or no API key): ${skipped} models`);

  // 5. Final count
  const finalModels = await storage.getAiModels();
  const publicModels = finalModels.filter(
    (m: any) => m.status === "active" && m.isEnabled === "true"
  );
  console.log(`\n🎯 Models now visible in UI: ${publicModels.length}`);
  for (const m of publicModels) {
    console.log(`   [${m.provider}] ${m.name} (${m.modelId})`);
  }

  console.log("\n✨ Done! Refresh the UI to see all models.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Script failed:", err);
  process.exit(1);
});
