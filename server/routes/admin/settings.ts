import { Router } from "express";
import { storage } from "../../storage";

export const settingsRouter = Router();

settingsRouter.get("/", async (req, res) => {
    try {
        await storage.seedDefaultSettings();
        const settings = await storage.getSettingsConfig();
        const grouped = settings.reduce((acc: Record<string, any[]>, s) => {
            const cat = s.category || "general";
            if (!acc[cat]) acc[cat] = [];
            acc[cat].push({
                ...s,
                defaultValue: s.defaultValue as any
            });
            return acc;
        }, {});
        res.json({ settings, grouped });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

settingsRouter.get("/category/:category", async (req, res) => {
    try {
        await storage.seedDefaultSettings();
        const settings = await storage.getSettingsConfigByCategory(req.params.category);
        res.json(settings);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

settingsRouter.get("/key/:key", async (req, res) => {
    try {
        const setting = await storage.getSettingsConfigByKey(req.params.key);
        if (!setting) {
            return res.status(404).json({ error: "Setting not found" });
        }
        res.json(setting);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

settingsRouter.put("/:key", async (req, res) => {
    try {
        const existing = await storage.getSettingsConfigByKey(req.params.key);
        if (!existing) {
            return res.status(404).json({ error: "Setting not found" });
        }
        const updated = await storage.upsertSettingsConfig({
            ...existing,
            value: req.body.value,
            updatedBy: req.body.updatedBy,
            defaultValue: existing.defaultValue as any
        });
        await storage.createAuditLog({
            action: "setting_update",
            resource: "settings_config",
            details: { key: req.params.key, value: req.body.value }
        });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

settingsRouter.post("/bulk", async (req, res) => {
    try {
        const { settings } = req.body;
        if (!Array.isArray(settings)) {
            return res.status(400).json({ error: "settings must be an array" });
        }
        const results = [];
        for (const s of settings) {
            const existing = await storage.getSettingsConfigByKey(s.key);
            if (existing) {
                const updated = await storage.upsertSettingsConfig({
                    ...existing,
                    value: s.value,
                    updatedBy: s.updatedBy,
                    defaultValue: existing.defaultValue as any
                });
                results.push(updated);
            }
        }
        await storage.createAuditLog({
            action: "settings_bulk_update",
            resource: "settings_config",
            details: { count: results.length }
        });
        res.json({ updated: results.length, settings: results });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

settingsRouter.post("/reset/:key", async (req, res) => {
    try {
        const existing = await storage.getSettingsConfigByKey(req.params.key);
        if (!existing) {
            return res.status(404).json({ error: "Setting not found" });
        }
        const updated = await storage.upsertSettingsConfig({
            ...existing,
            value: existing.defaultValue as any,
            updatedBy: req.body.updatedBy,
            defaultValue: existing.defaultValue as any
        });
        await storage.createAuditLog({
            action: "setting_reset",
            resource: "settings_config",
            details: { key: req.params.key, defaultValue: existing.defaultValue }
        });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

settingsRouter.post("/seed", async (req, res) => {
    try {
        await storage.seedDefaultSettings();
        const settings = await storage.getSettingsConfig();
        res.json({ seeded: true, count: settings.length });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});
