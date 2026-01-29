
import { storage } from "../storage";
import { type InsertAiModel } from "@shared/schema";

const NEW_MODELS = [
    {
        name: "Grok 2.0 (Latest)",
        provider: "xai",
        modelId: "grok-2-latest",
        description: "XAI Grok 2.0 - Fast and capable.",
        isEnabled: "true",
        displayOrder: 20,
        modelType: "chat",
        contextWindow: 128000,
        icon: "sparkles"
    },
    {
        name: "Grok 4.1 Reasoning",
        provider: "xai",
        modelId: "grok-4-1-fast-reasoning",
        description: "XAI Grok Next-Gen Reasoning Model",
        isEnabled: "true",
        displayOrder: 21,
        modelType: "chat",
        contextWindow: 128000,
        icon: "sparkles"
    }
];

async function seedModels() {
    console.log("🌱 Seeding AI Models...");

    try {
        const existingModels = await storage.getAiModels();

        for (const model of NEW_MODELS) {
            const exists = existingModels.find(m => m.modelId === model.modelId);

            if (!exists) {
                console.log(`➕ Adding model: ${model.name} (${model.modelId})`);
                const newModel: InsertAiModel = {
                    ...model,
                    enabledAt: new Date(),
                    enabledByAdminId: "system_seed"
                };
                await storage.createAiModel(newModel);
            } else {
                console.log(`✅ Model already exists: ${model.name}`);
            }
        }

        console.log("✨ Model seeding complete.");
    } catch (error) {
        console.error("❌ Error seeding models:", error);
        process.exit(1);
    }
}

seedModels().catch(console.error);
