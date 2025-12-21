import { Router } from "express";
import { generateImage, detectImageRequest, extractImagePrompt } from "../services/imageGeneration";

export const imageRouter = Router();

imageRouter.post("/generate", async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const result = await generateImage(prompt);
    
    res.json({
      success: true,
      imageData: `data:${result.mimeType};base64,${result.imageBase64}`,
      prompt: result.prompt
    });
  } catch (error: any) {
    console.error("Image generation error:", error);
    res.status(500).json({ 
      error: "Failed to generate image",
      details: error.message 
    });
  }
});

imageRouter.post("/detect", (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }
  
  const isImageRequest = detectImageRequest(message);
  const extractedPrompt = isImageRequest ? extractImagePrompt(message) : null;
  
  res.json({ isImageRequest, extractedPrompt });
});
