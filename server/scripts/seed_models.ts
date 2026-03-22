import { storage } from "../storage";
import {
    DEFAULT_END_USER_MODEL_ID,
    DEFAULT_END_USER_MODEL_NAME,
} from "../services/modelIntegration";

const NEW_MODELS = [
    {
        name: DEFAULT_END_USER_MODEL_NAME,
        provider: "openrouter",
        modelId: DEFAULT_END_USER_MODEL_ID,
        description: "Modelo de producción para usuarios finales vía OpenRouter.",
        isEnabled: "true",
        status: "active",
        displayOrder: 0,
        modelType: "chat",
        contextWindow: 80000,
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
                await storage.createAiModel({
                    ...model,
                    enabledAt: new Date(),
                    enabledByAdminId: "system_seed"
                });
            } else {
                console.log(`✅ Model already exists: ${model.name}, updating status to active`);
                await storage.updateAiModel(exists.id, {
                    isEnabled: "true",
                    status: "active"
                });
            }
        }

        await storage.upsertSettingsConfig({
            category: "ai_models",
            key: "default_model",
            value: DEFAULT_END_USER_MODEL_ID,
            defaultValue: DEFAULT_END_USER_MODEL_ID,
            valueType: "string",
            description: "Default AI model",
        });

        console.log("✨ Model seeding complete.");
    } catch (error) {
        console.error("❌ Error seeding models:", error);
        process.exit(1);
    }
}

seedModels().catch(console.error);
