import { Router } from "express";
import { storage } from "../storage";

export function createGptRouter() {
  const router = Router();

  router.get("/gpt-categories", async (req, res) => {
    try {
      const categories = await storage.getGptCategories();
      res.json(categories);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/gpt-categories", async (req, res) => {
    try {
      const { name, slug, description, icon, sortOrder } = req.body;
      if (!name || !slug) {
        return res.status(400).json({ error: "name and slug are required" });
      }
      const category = await storage.createGptCategory({
        name,
        slug,
        description: description || null,
        icon: icon || null,
        sortOrder: sortOrder || 0
      });
      res.json(category);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/gpts", async (req, res) => {
    try {
      const { visibility, categoryId, creatorId } = req.query;
      const filters: any = {};
      if (visibility) filters.visibility = visibility as string;
      if (categoryId) filters.categoryId = categoryId as string;
      if (creatorId) filters.creatorId = creatorId as string;
      
      const gptList = await storage.getGpts(Object.keys(filters).length > 0 ? filters : undefined);
      res.json(gptList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/gpts/popular", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const gptList = await storage.getPopularGpts(limit);
      res.json(gptList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/gpts", async (req, res) => {
    try {
      const { 
        name, slug, description, avatar, categoryId, creatorId,
        visibility, systemPrompt, temperature, topP, maxTokens,
        welcomeMessage, capabilities, conversationStarters, isPublished
      } = req.body;
      
      if (!name || !slug || !systemPrompt) {
        return res.status(400).json({ error: "name, slug, and systemPrompt are required" });
      }
      
      const existing = await storage.getGptBySlug(slug);
      if (existing) {
        return res.status(409).json({ error: "A GPT with this slug already exists" });
      }
      
      const gpt = await storage.createGpt({
        name,
        slug,
        description: description || null,
        avatar: avatar || null,
        categoryId: categoryId || null,
        creatorId: creatorId || null,
        visibility: visibility || "private",
        systemPrompt,
        temperature: temperature || "0.7",
        topP: topP || "1",
        maxTokens: maxTokens || 4096,
        welcomeMessage: welcomeMessage || null,
        capabilities: capabilities || null,
        conversationStarters: conversationStarters || null,
        isPublished: isPublished || "false",
        version: 1
      });
      
      await storage.createGptVersion({
        gptId: gpt.id,
        versionNumber: 1,
        systemPrompt,
        temperature: temperature || "0.7",
        topP: topP || "1",
        maxTokens: maxTokens || 4096,
        changeNotes: "Initial version",
        createdBy: creatorId || null
      });
      
      res.json(gpt);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/gpts/:id", async (req, res) => {
    try {
      const gpt = await storage.getGpt(req.params.id);
      if (!gpt) {
        const gptBySlug = await storage.getGptBySlug(req.params.id);
        if (!gptBySlug) {
          return res.status(404).json({ error: "GPT not found" });
        }
        return res.json(gptBySlug);
      }
      res.json(gpt);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/gpts/:id", async (req, res) => {
    try {
      const updates = req.body;
      const gpt = await storage.updateGpt(req.params.id, updates);
      if (!gpt) {
        return res.status(404).json({ error: "GPT not found" });
      }
      res.json(gpt);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/gpts/:id", async (req, res) => {
    try {
      await storage.deleteGpt(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/gpts/:id/use", async (req, res) => {
    try {
      await storage.incrementGptUsage(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/gpts/:id/versions", async (req, res) => {
    try {
      const versions = await storage.getGptVersions(req.params.id);
      res.json(versions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/gpts/:id/versions", async (req, res) => {
    try {
      const { systemPrompt, temperature, topP, maxTokens, changeNotes, createdBy } = req.body;
      
      if (!systemPrompt) {
        return res.status(400).json({ error: "systemPrompt is required" });
      }
      
      const latestVersion = await storage.getLatestGptVersion(req.params.id);
      const newVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;
      
      const version = await storage.createGptVersion({
        gptId: req.params.id,
        versionNumber: newVersionNumber,
        systemPrompt,
        temperature: temperature || "0.7",
        topP: topP || "1",
        maxTokens: maxTokens || 4096,
        changeNotes: changeNotes || null,
        createdBy: createdBy || null
      });
      
      await storage.updateGpt(req.params.id, {
        version: newVersionNumber,
        systemPrompt,
        temperature: temperature || "0.7",
        topP: topP || "1",
        maxTokens: maxTokens || 4096
      });
      
      res.json(version);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GPT Knowledge Base routes
  router.get("/gpts/:id/knowledge", async (req, res) => {
    try {
      const knowledge = await storage.getGptKnowledge(req.params.id);
      res.json(knowledge);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/gpts/:id/knowledge", async (req, res) => {
    try {
      const { fileName, fileType, fileSize, storageUrl, contentHash, extractedText, embeddingStatus, metadata } = req.body;
      
      if (!fileName || !fileType || !fileSize || !storageUrl) {
        return res.status(400).json({ error: "fileName, fileType, fileSize, and storageUrl are required" });
      }
      
      const knowledge = await storage.createGptKnowledge({
        gptId: req.params.id,
        fileName,
        fileType,
        fileSize,
        storageUrl,
        contentHash: contentHash || null,
        extractedText: extractedText || null,
        embeddingStatus: embeddingStatus || "pending",
        metadata: metadata || null,
        isActive: "true"
      });
      res.json(knowledge);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/gpts/:id/knowledge/:knowledgeId", async (req, res) => {
    try {
      const updates = req.body;
      const knowledge = await storage.updateGptKnowledge(req.params.knowledgeId, updates);
      if (!knowledge) {
        return res.status(404).json({ error: "Knowledge item not found" });
      }
      res.json(knowledge);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/gpts/:id/knowledge/:knowledgeId", async (req, res) => {
    try {
      await storage.deleteGptKnowledge(req.params.knowledgeId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GPT Actions routes
  router.get("/gpts/:id/actions", async (req, res) => {
    try {
      const actions = await storage.getGptActions(req.params.id);
      res.json(actions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/gpts/:id/actions", async (req, res) => {
    try {
      const { 
        name, description, actionType, httpMethod, endpoint, 
        headers, bodyTemplate, responseMapping, authType, authConfig, 
        parameters, rateLimit, timeout 
      } = req.body;
      
      if (!name || !endpoint) {
        return res.status(400).json({ error: "name and endpoint are required" });
      }
      
      const action = await storage.createGptAction({
        gptId: req.params.id,
        name,
        description: description || null,
        actionType: actionType || "api",
        httpMethod: httpMethod || "GET",
        endpoint,
        headers: headers || null,
        bodyTemplate: bodyTemplate || null,
        responseMapping: responseMapping || null,
        authType: authType || "none",
        authConfig: authConfig || null,
        parameters: parameters || null,
        rateLimit: rateLimit || 100,
        timeout: timeout || 30000,
        isActive: "true"
      });
      res.json(action);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.patch("/gpts/:id/actions/:actionId", async (req, res) => {
    try {
      const updates = req.body;
      const action = await storage.updateGptAction(req.params.actionId, updates);
      if (!action) {
        return res.status(404).json({ error: "Action not found" });
      }
      res.json(action);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/gpts/:id/actions/:actionId", async (req, res) => {
    try {
      await storage.deleteGptAction(req.params.actionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/gpts/:id/actions/:actionId/use", async (req, res) => {
    try {
      await storage.incrementGptActionUsage(req.params.actionId);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
