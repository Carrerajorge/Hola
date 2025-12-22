import { Router } from "express";
import { storage } from "../storage";

export function createLibraryRouter() {
  const router = Router();

  router.get("/api/library", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const mediaType = req.query.type as string | undefined;
      const items = await storage.getLibraryItems(userId, mediaType);
      res.json(items);
    } catch (error: any) {
      console.error("Error getting library items:", error);
      res.status(500).json({ error: "Failed to get library items" });
    }
  });

  router.post("/api/library", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const { mediaType, title, description, storagePath, thumbnailPath, mimeType, size, metadata, sourceChatId } = req.body;
      
      if (!mediaType || !title || !storagePath) {
        return res.status(400).json({ error: "mediaType, title, and storagePath are required" });
      }
      
      const item = await storage.createLibraryItem({
        userId,
        mediaType,
        title,
        description: description || null,
        storagePath,
        thumbnailPath: thumbnailPath || null,
        mimeType: mimeType || null,
        size: size || null,
        metadata: metadata || null,
        sourceChatId: sourceChatId || null,
      });
      
      res.json(item);
    } catch (error: any) {
      console.error("Error creating library item:", error);
      res.status(500).json({ error: "Failed to create library item" });
    }
  });

  router.delete("/api/library/:id", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      
      const deleted = await storage.deleteLibraryItem(req.params.id, userId);
      
      if (!deleted) {
        return res.status(404).json({ error: "Library item not found" });
      }
      
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting library item:", error);
      res.status(500).json({ error: "Failed to delete library item" });
    }
  });

  return router;
}
