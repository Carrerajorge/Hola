import { syncAllProviders } from "../server/services/aiModelSyncService";
import { storage } from "../server/storage";

async function main() {
  console.log("[models] syncing providers...");
  const results = await syncAllProviders();
  console.log("[models] sync results:", results);

  const allModels = await storage.getAiModels();

  // Enable everything we have in the DB. (In dev this is fine; in prod you may want allowlists.)
  let enabled = 0;
  for (const m of allModels) {
    if (m.isEnabled === "true") continue;
    await storage.updateAiModel(m.id, {
      isEnabled: "true",
      enabledAt: new Date(),
      enabledByAdminId: null,
    });
    enabled++;
  }

  const enabledModels = (await storage.getAiModels()).filter((m) => m.isEnabled === "true");
  console.log(`[models] enabled ${enabled} models (now enabled total=${enabledModels.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
