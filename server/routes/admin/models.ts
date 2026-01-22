import { Router } from "express";
import { AuthenticatedRequest } from "../../types/express";
import { storage } from "../../storage";
import { checkApiKeyExists } from "./utils";
import { syncModelsForProvider, syncAllProviders, getAvailableProviders, getModelStats } from "../../services/aiModelSyncService";

export const modelsRouter = Router();

modelsRouter.get("/", async (req, res) => {
    try {
        const models = await storage.getAiModels();
        res.json(models);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.post("/", async (req, res) => {
    try {
        const { name, provider, modelId, costPer1k, description, status } = req.body;
        if (!name || !provider || !modelId) {
            return res.status(400).json({ error: "name, provider, and modelId are required" });
        }
        const model = await storage.createAiModel({
            name, provider, modelId, costPer1k, description, status
        });
        await storage.createAuditLog({
            action: "model_create",
            resource: "ai_models",
            resourceId: model.id,
            details: { name, provider }
        });
        res.json(model);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.get("/filtered", async (req, res) => {
    try {
        const {
            page = "1",
            limit = "20",
            provider,
            type,
            status,
            search,
            sortBy = "name",
            sortOrder = "asc"
        } = req.query;

        const result = await storage.getAiModelsFiltered({
            provider: provider as string,
            type: type as string,
            status: status as string,
            search: search as string,
            sortBy: sortBy as string,
            sortOrder: sortOrder as string,
            page: parseInt(page as string),
            limit: parseInt(limit as string),
        });

        res.json({
            models: result.models,
            total: result.total,
            page: parseInt(page as string),
            limit: parseInt(limit as string),
            totalPages: Math.ceil(result.total / parseInt(limit as string)),
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.get("/stats", async (req, res) => {
    try {
        const allModels = await storage.getAiModels();
        const knownStats = getModelStats();

        const byProvider: Record<string, number> = {};
        const byType: Record<string, number> = {};
        let active = 0;
        let inactive = 0;
        let deprecated = 0;

        for (const model of allModels) {
            byProvider[model.provider] = (byProvider[model.provider] || 0) + 1;
            byType[model.modelType || "TEXT"] = (byType[model.modelType || "TEXT"] || 0) + 1;
            if (model.status === "active") active++;
            else inactive++;
            if (model.isDeprecated === "true") deprecated++;
        }

        res.json({
            total: allModels.length,
            active,
            inactive,
            deprecated,
            byProvider,
            byType,
            knownModels: knownStats,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.patch("/:id", async (req, res) => {
    try {
        const model = await storage.updateAiModel(req.params.id, req.body);
        if (!model) {
            return res.status(404).json({ error: "Model not found" });
        }
        await storage.createAuditLog({
            action: "model_update",
            resource: "ai_models",
            resourceId: req.params.id,
            details: req.body
        });
        res.json(model);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.delete("/:id", async (req, res) => {
    try {
        await storage.deleteAiModel(req.params.id);
        await storage.createAuditLog({
            action: "model_delete",
            resource: "ai_models",
            resourceId: req.params.id
        });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.patch("/:id/toggle", async (req, res) => {
    try {
        const { isEnabled } = req.body;
        const userId = (req as AuthenticatedRequest).user?.id || null;

        const updateData: any = {
            isEnabled: isEnabled ? "true" : "false",
        };

        if (isEnabled) {
            updateData.enabledAt = new Date();
            updateData.enabledByAdminId = userId;
        } else {
            updateData.enabledAt = null;
            updateData.enabledByAdminId = null;
        }

        const model = await storage.updateAiModel(req.params.id, updateData);
        if (!model) {
            return res.status(404).json({ error: "Model not found" });
        }

        await storage.createAuditLog({
            userId,
            action: isEnabled ? "model_enable" : "model_disable",
            resource: "ai_models",
            resourceId: req.params.id,
            details: { isEnabled, modelName: model.name }
        });

        res.json(model);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.get("/:id", async (req, res) => {
    try {
        const model = await storage.getAiModelById(req.params.id);
        if (!model) {
            return res.status(404).json({ error: "Model not found" });
        }
        res.json(model);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// sync routes
modelsRouter.post("/sync/:provider", async (req, res) => {
    try {
        const { provider } = req.params;
        const result = await syncModelsForProvider(provider);

        await storage.createAuditLog({
            action: "models_sync",
            resource: "ai_models",
            details: { provider, ...result },
        });

        res.json({
            success: true,
            provider,
            ...result,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

modelsRouter.post("/sync", async (req, res) => {
    try {
        const results = await syncAllProviders();

        let totalAdded = 0;
        let totalUpdated = 0;
        for (const r of Object.values(results)) {
            totalAdded += r.added;
            totalUpdated += r.updated;
        }

        await storage.createAuditLog({
            action: "models_sync_all",
            resource: "ai_models",
            details: { results, totalAdded, totalUpdated },
        });

        res.json({
            success: true,
            results,
            summary: { totalAdded, totalUpdated },
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// providers route
modelsRouter.get("/providers/list", async (req, res) => { // Renamed from /providers to avoid conflict if mounted on /models
    try {
        const providers = getAvailableProviders();
        const allModels = await storage.getAiModels();

        const providerStats = providers.map(provider => {
            const models = allModels.filter(m => m.provider.toLowerCase() === provider.toLowerCase());
            const activeCount = models.filter(m => m.status === "active").length;
            return {
                id: provider,
                name: provider.charAt(0).toUpperCase() + provider.slice(1),
                modelCount: models.length,
                activeCount,
                hasApiKey: checkApiKeyExists(provider),
            };
        });

        res.json(providerStats);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
