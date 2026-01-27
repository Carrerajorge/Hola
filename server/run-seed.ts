import { seedProductionData, getSeedStatus } from "./seed-production";

async function main() {
  console.log("=== Running Admin Seed ===\n");

  // Force seed to run regardless of NODE_ENV
  process.env.SEED_ON_START = "true";

  const result = await seedProductionData();

  console.log("\n=== Seed Result ===");
  console.log(JSON.stringify(result, null, 2));

  console.log("\n=== Current Status ===");
  const status = await getSeedStatus();
  console.log(JSON.stringify(status, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
