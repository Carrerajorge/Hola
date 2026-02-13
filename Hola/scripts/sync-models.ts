import "dotenv/config";
import { syncAllProviders } from "../server/services/aiModelSyncService";

async function main() {
    console.log("Syncing all AI models to database...");

    try {
        const results = await syncAllProviders();

        for (const [provider, result] of Object.entries(results)) {
            console.log(`\n${provider}:`);
            console.log(`  Added: ${result.added}`);
            console.log(`  Updated: ${result.updated}`);
            if (result.errors.length > 0) {
                console.log(`  Errors: ${result.errors.join(", ")}`);
            }
        }

        console.log("\n✅ Sync complete!");
        process.exit(0);
    } catch (error) {
        console.error("Error syncing models:", error);
        process.exit(1);
    }
}

main();
