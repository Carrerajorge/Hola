import { Router, Request, Response, NextFunction } from "express";
import { conversationStateService } from "../services/conversationStateService";
import { z } from "zod";

const router = Router();

const appendMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
  chatMessageId: z.string().optional(),
  tokenCount: z.number().optional(),
  attachmentIds: z.array(z.string()).optional(),
  imageIds: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const addArtifactSchema = z.object({
  artifactType: z.string(),
  mimeType: z.string(),
  storageUrl: z.string(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  messageId: z.string().optional(),
  extractedText: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const addImageSchema = z.object({
  prompt: z.string(),
  imageUrl: z.string(),
  model: z.string(),
  mode: z.enum(["generate", "edit_last", "edit_specific"]).default("generate"),
  messageId: z.string().optional(),
  parentImageId: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  base64Preview: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const updateContextSchema = z.object({
  summary: z.string().optional(),
  entities: z.array(z.object({
    name: z.string(),
    type: z.string(),
    mentions: z.number().default(1),
    lastMentioned: z.string().optional(),
  })).optional(),
  userPreferences: z.record(z.string(), z.unknown()).optional(),
  topics: z.array(z.string()).optional(),
  sentiment: z.enum(["positive", "negative", "neutral"]).optional(),
});

router.get("/chats/:chatId/state", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const forceRefresh = req.query.refresh === "true";
    const userId = (req as any).user?.id;

    const state = await conversationStateService.hydrateState(chatId, userId, { forceRefresh });

    if (!state) {
      return res.status(404).json({ error: "Conversation state not found" });
    }

    res.json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] GET state error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const userId = (req as any).user?.id;

    const state = await conversationStateService.getOrCreateState(chatId, userId);
    res.status(201).json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST state error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state/messages", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const validation = appendMessageSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const { role, content, ...options } = validation.data;
    const state = await conversationStateService.appendMessage(chatId, role, content, options);

    res.status(201).json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST message error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state/artifacts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const validation = addArtifactSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const { artifactType, mimeType, storageUrl, fileName, fileSize, ...options } = validation.data;
    const state = await conversationStateService.addArtifact(
      chatId,
      artifactType,
      mimeType,
      storageUrl,
      fileName,
      fileSize,
      undefined,
      options
    );

    res.status(201).json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST artifact error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state/images", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const validation = addImageSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const { prompt, imageUrl, model, mode, ...options } = validation.data;
    const state = await conversationStateService.addImage(chatId, prompt, imageUrl, model, mode, options);

    res.status(201).json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST image error:", error.message);
    next(error);
  }
});

router.patch("/chats/:chatId/state/context", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const validation = updateContextSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const state = await conversationStateService.updateContext(chatId, validation.data);
    res.json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] PATCH context error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state/snapshot", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const { description } = req.body;
    const authorId = (req as any).user?.id;

    const version = await conversationStateService.createSnapshot(chatId, description, authorId);
    res.status(201).json({ version, chatId });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST snapshot error:", error.message);
    next(error);
  }
});

router.get("/chats/:chatId/state/versions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const versions = await conversationStateService.getVersionHistory(chatId);
    res.json({ versions });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] GET versions error:", error.message);
    next(error);
  }
});

router.post("/chats/:chatId/state/restore/:version", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId, version } = req.params;
    const versionNum = parseInt(version, 10);

    if (isNaN(versionNum)) {
      return res.status(400).json({ error: "Invalid version number" });
    }

    const state = await conversationStateService.restoreToVersion(chatId, versionNum);
    if (!state) {
      return res.status(404).json({ error: "Version not found" });
    }

    res.json(state);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] POST restore error:", error.message);
    next(error);
  }
});

router.get("/chats/:chatId/state/latest-image", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    const image = await conversationStateService.getLatestImage(chatId);

    if (!image) {
      return res.status(404).json({ error: "No images found" });
    }

    res.json(image);
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] GET latest-image error:", error.message);
    next(error);
  }
});

router.get("/images/:imageId/chain", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { imageId } = req.params;
    const chain = await conversationStateService.getImageEditChain(imageId);
    res.json({ chain });
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] GET image chain error:", error.message);
    next(error);
  }
});

router.delete("/chats/:chatId/state", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chatId } = req.params;
    await conversationStateService.deleteState(chatId);
    res.status(204).send();
  } catch (error: any) {
    console.error("[ConversationMemoryRoutes] DELETE state error:", error.message);
    next(error);
  }
});

router.get("/memory/stats", async (_req: Request, res: Response) => {
  const stats = conversationStateService.getCacheStats();
  res.json(stats);
});

export default router;
