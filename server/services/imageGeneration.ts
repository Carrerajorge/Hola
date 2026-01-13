import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "";
const baseURL = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

const ai = new GoogleGenAI({ 
  apiKey,
  ...(baseURL ? { baseURL } : {})
});

const IMAGE_MODELS = [
  "models/gemini-2.5-flash-image",
  "gemini-2.0-flash-exp-image-generation",
];

export interface ImageGenerationResult {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  model?: string;
}

export async function generateImage(prompt: string): Promise<ImageGenerationResult> {
  const startTime = Date.now();
  console.log(`[ImageGeneration] Starting generation for prompt: "${prompt.slice(0, 100)}..."`);
  
  if (!apiKey) {
    console.error("[ImageGeneration] No API key configured (GEMINI_API_KEY or AI_INTEGRATIONS_GEMINI_API_KEY)");
    throw new Error("Image generation not configured - missing API key");
  }

  let lastError: Error | null = null;
  
  for (const model of IMAGE_MODELS) {
    try {
      console.log(`[ImageGeneration] Trying model: ${model}`);
      
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        config: {
          responseModalities: ["IMAGE"],
        }
      });

      const parts = response.candidates?.[0]?.content?.parts;
      
      if (!parts || parts.length === 0) {
        console.log(`[ImageGeneration] Model ${model} returned no parts, trying next...`);
        continue;
      }

      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          const durationMs = Date.now() - startTime;
          console.log(`[ImageGeneration] Success with model ${model} in ${durationMs}ms`);
          return {
            imageBase64: part.inlineData.data,
            mimeType: part.inlineData.mimeType || "image/png",
            prompt,
            model
          };
        }
      }
      
      console.log(`[ImageGeneration] Model ${model} returned parts but no image data, trying next...`);
    } catch (error: any) {
      console.error(`[ImageGeneration] Model ${model} failed:`, error.message);
      lastError = error;
      continue;
    }
  }

  const errorMsg = lastError?.message || "All models failed to generate image";
  console.error(`[ImageGeneration] All models exhausted. Last error: ${errorMsg}`);
  throw new Error(`Image generation failed: ${errorMsg}`);
}

export function detectImageRequest(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  
  // Negative indicators: structured content that should NOT trigger image generation
  const structuredContentKeywords = [
    'tabla', 'table', 'tablas', 'tables',
    'lista', 'list', 'listas', 'lists',
    'documento', 'document', 'documentos', 'documents',
    'texto', 'text', 'textos',
    'organigrama', 'organigram', 'org chart',
    'esquema', 'schema', 'outline',
    'resumen', 'summary', 'resúmenes',
    'código', 'code', 'script',
    'excel', 'word', 'powerpoint', 'ppt',
    'csv', 'json', 'xml', 'html',
    'fórmula', 'formula', 'ecuación', 'equation',
    'diagrama de flujo', 'flowchart', 'flow chart',
    'markdown', 'md',
    'párrafo', 'paragraph',
    'artículo', 'article',
    'informe', 'report',
    'análisis', 'analysis',
    'datos', 'data',
    'filas', 'rows', 'columnas', 'columns',
    'celdas', 'cells',
    '10x10', '5x5', '3x3', // Table dimensions
  ];
  
  // Check for structured content keywords first (negative indicators)
  const hasStructuredContent = structuredContentKeywords.some(keyword => 
    lowerMessage.includes(keyword)
  );
  
  if (hasStructuredContent) {
    // Only generate image if there's explicit image-specific noun
    const explicitImageNouns = [
      /\bimagen\b/i, /\bimágenes\b/i,
      /\bfoto\b/i, /\bfotos\b/i, /\bfotografía\b/i,
      /\bimage\b/i, /\bimages\b/i,
      /\bpicture\b/i, /\bpictures\b/i,
      /\bphoto\b/i, /\bphotos\b/i,
      /\bilustración\b/i, /\billustration\b/i,
      /\bdibujo\b/i, /\bdrawing\b/i,
    ];
    return explicitImageNouns.some(pattern => pattern.test(message));
  }
  
  // Positive indicators: image-specific patterns
  const imagePatterns = [
    /\b(genera|crea|dibuja|haz|hazme|dame|quiero|necesito|podr[ií]as)\b.{0,20}\b(imagen|foto|ilustraci[oó]n|dibujo|arte|retrato|paisaje)\b/i,
    /\b(generate|create|make|draw|give me|i want|i need|can you)\b.{0,20}\b(image|picture|photo|illustration|drawing|art|portrait|landscape)\b/i,
    /\b(imagen|picture|photo)\s+(de|of|with)\b/i,
    /\buna?\s+imagen\s+de\b/i,
    /\ban?\s+image\s+of\b/i,
    /\bdibuja(me)?\s+/i,
    /\bdraw\s+(me\s+)?a\b/i,
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
