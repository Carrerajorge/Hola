import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const IMAGE_MODEL = "gemini-2.0-flash-exp-image-generation";
const IMAGE_MODEL_ALT = "models/gemini-2.5-flash-preview-04-17";

export interface ImageGenerationResult {
  imageBase64: string;
  mimeType: string;
  prompt: string;
}

export async function generateImage(prompt: string): Promise<ImageGenerationResult> {
  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      config: {
        responseModalities: ["image", "text"],
      }
    });

    const parts = response.candidates?.[0]?.content?.parts;
    
    if (!parts || parts.length === 0) {
      throw new Error("No image generated");
    }

    for (const part of parts) {
      if (part.inlineData) {
        return {
          imageBase64: part.inlineData.data || "",
          mimeType: part.inlineData.mimeType || "image/png",
          prompt
        };
      }
    }

    throw new Error("No image data in response");
  } catch (error: any) {
    console.error("[ImageGeneration] Error:", error.message);
    throw new Error(`Image generation failed: ${error.message}`);
  }
}

export function detectImageRequest(message: string): boolean {
  const imagePatterns = [
    /\b(genera|crea|dibuja|haz|hazme|dame|quiero|necesito|podr[ií]as)\b.{0,20}\b(imagen|imagen|foto|ilustraci[oó]n|dibujo|arte|retrato|paisaje)\b/i,
    /\b(generate|create|make|draw|give me|i want|i need|can you)\b.{0,20}\b(image|picture|photo|illustration|drawing|art|portrait|landscape)\b/i,
    /\b(imagen|picture|photo)\s+(de|of|with)\b/i,
    /^(dibuja|draw|genera|generate|crea|create)\s+/i,
    /\buna?\s+imagen\s+de\b/i,
    /\ban?\s+image\s+of\b/i,
  ];

  return imagePatterns.some(pattern => pattern.test(message));
}

export function extractImagePrompt(message: string): string {
  let prompt = message
    .replace(/^(genera|crea|dibuja|haz|hazme|dame|quiero|necesito|podrías|generate|create|make|draw|give me|i want|i need|can you)\s*/i, "")
    .replace(/\b(una?\s+)?(imagen|image|picture|photo|ilustración|illustration|dibujo|drawing)\s*(de|of|with)?\s*/gi, "")
    .trim();
  
  if (prompt.length < 5) {
    prompt = message;
  }
  
  return prompt;
}
