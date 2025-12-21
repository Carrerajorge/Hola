import { Router } from "express";
import { figmaService } from "../services/figmaService";

export const figmaRouter = Router();

figmaRouter.post("/connect", async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: "Access token is required" });
    }
    
    figmaService.setAccessToken(accessToken);
    
    try {
      res.json({ success: true, message: "Figma connected successfully" });
    } catch (error: any) {
      res.status(401).json({ error: "Invalid Figma access token" });
    }
  } catch (error: any) {
    console.error("Error connecting to Figma:", error);
    res.status(500).json({ error: error.message });
  }
});

figmaRouter.get("/status", (req, res) => {
  const token = figmaService.getAccessToken();
  res.json({ connected: !!token });
});

figmaRouter.post("/disconnect", (req, res) => {
  figmaService.setAccessToken("");
  res.json({ success: true });
});

figmaRouter.get("/file/:fileKey", async (req, res) => {
  try {
    const { fileKey } = req.params;
    const fileData = await figmaService.getFile(fileKey);
    res.json(fileData);
  } catch (error: any) {
    console.error("Error fetching Figma file:", error);
    res.status(500).json({ error: error.message });
  }
});

figmaRouter.get("/file/:fileKey/tokens", async (req, res) => {
  try {
    const { fileKey } = req.params;
    const fileData = await figmaService.getFile(fileKey);
    const tokens = figmaService.extractDesignTokens(fileData);
    res.json({ tokens });
  } catch (error: any) {
    console.error("Error extracting design tokens:", error);
    res.status(500).json({ error: error.message });
  }
});

figmaRouter.post("/code", async (req, res) => {
  try {
    const { fileKey, nodeId } = req.body;
    if (!fileKey) {
      return res.status(400).json({ error: "File key is required" });
    }
    
    const codeContext = await figmaService.getDesignContext(fileKey, nodeId);
    res.json(codeContext);
  } catch (error: any) {
    console.error("Error generating code from Figma:", error);
    res.status(500).json({ error: error.message });
  }
});

figmaRouter.post("/parse-url", (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }
    
    const parsed = figmaService.parseFileUrl(url);
    if (!parsed) {
      return res.status(400).json({ error: "Invalid Figma URL" });
    }
    
    res.json(parsed);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

figmaRouter.get("/images/:fileKey", async (req, res) => {
  try {
    const { fileKey } = req.params;
    const { nodeIds, format = "png", scale = "2" } = req.query;
    
    if (!nodeIds || typeof nodeIds !== "string") {
      return res.status(400).json({ error: "Node IDs are required" });
    }
    
    const ids = nodeIds.split(",");
    const images = await figmaService.getImages(
      fileKey, 
      ids, 
      format as "png" | "svg" | "jpg",
      parseInt(scale as string)
    );
    res.json({ images });
  } catch (error: any) {
    console.error("Error fetching Figma images:", error);
    res.status(500).json({ error: error.message });
  }
});
