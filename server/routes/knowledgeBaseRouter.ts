/**
 * Personal Knowledge Base (KB) API
 * Minimal, local-first, aggressive.
 */

import { Router } from "express";
import path from "node:path";

import { knowledgeBaseService } from "../services/knowledgeBaseService";

export const knowledgeBaseRouter = Router();

knowledgeBaseRouter.post("/upsert", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const { type = "note", title = null, content, tags = [], sourceRef = null } = req.body || {};
    if (!content) return res.status(400).json({ error: "content is required" });

    const out = await knowledgeBaseService.upsert(userId, { type, title, content, tags, sourceRef });
    res.json({ success: true, ...out });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

knowledgeBaseRouter.post("/link", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const { fromNodeId, toNodeId, relation, metadata } = req.body || {};
    if (!fromNodeId || !toNodeId || !relation) return res.status(400).json({ error: "fromNodeId,toNodeId,relation are required" });

    await knowledgeBaseService.link(userId, fromNodeId, toNodeId, relation, metadata);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

knowledgeBaseRouter.get("/search", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const q = String(req.query.q || "");
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;

    const results = await knowledgeBaseService.search(userId, q, limit);
    res.json({ success: true, results });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

knowledgeBaseRouter.post("/export/obsidian", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Not authenticated" });

    const relOutDir = req.body?.outDir || "artifacts/obsidian-vault";
    const outDir = path.resolve(process.cwd(), relOutDir);

    const result = await knowledgeBaseService.exportObsidianVault(userId, outDir);
    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(500).json({ error: e.message || String(e) });
  }
});
