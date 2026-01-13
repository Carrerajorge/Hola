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

export interface ImageEditResult extends ImageGenerationResult {
  parentId?: string;
}

export async function editImage(
  baseImageBase64: string,
  editPrompt: string,
  baseMimeType: string = "image/png"
): Promise<ImageEditResult> {
  const startTime = Date.now();
  console.log(`[ImageGeneration] Starting edit for prompt: "${editPrompt.slice(0, 100)}..."`);
  
  if (!apiKey) {
    console.error("[ImageGeneration] No API key configured");
    throw new Error("Image generation not configured - missing API key");
  }

  const EDIT_MODELS = [
    "models/gemini-2.5-flash-image",
    "gemini-2.0-flash-exp-image-generation",
  ];

  let lastError: Error | null = null;
  
  for (const model of EDIT_MODELS) {
    try {
      console.log(`[ImageGeneration] Trying edit with model: ${model}`);
      
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: baseMimeType,
                  data: baseImageBase64,
                }
              },
              { text: `Edit this image: ${editPrompt}` }
            ]
          }
        ],
        config: {
          responseModalities: ["IMAGE"],
        }
      });

      const parts = response.candidates?.[0]?.content?.parts;
      
      if (!parts || parts.length === 0) {
        console.log(`[ImageGeneration] Edit model ${model} returned no parts, trying next...`);
        continue;
      }

      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          const durationMs = Date.now() - startTime;
          console.log(`[ImageGeneration] Edit success with model ${model} in ${durationMs}ms`);
          return {
            imageBase64: part.inlineData.data,
            mimeType: part.inlineData.mimeType || "image/png",
            prompt: editPrompt,
            model
          };
        }
      }
      
      console.log(`[ImageGeneration] Edit model ${model} returned parts but no image data, trying next...`);
    } catch (error: any) {
      console.error(`[ImageGeneration] Edit model ${model} failed:`, error.message);
      lastError = error;
      continue;
    }
  }

  const errorMsg = lastError?.message || "All models failed to edit image";
  console.error(`[ImageGeneration] All edit models exhausted. Last error: ${errorMsg}`);
  throw new Error(`Image edit failed: ${errorMsg}`);
}

export type ImageMode = 'generate' | 'edit_last' | 'edit_specific';

export interface ImageIntentResult {
  mode: ImageMode;
  prompt: string;
  editInstruction: string | null;
  referenceImageId: string | null;
}

export function classifyImageIntent(message: string, hasLastImage: boolean): ImageIntentResult {
  const lowerMessage = message.toLowerCase();
  
  const editLastPatterns = [
    /\b(edita|modifica|cambia|ajusta|arregla)\s+(la\s+)?(última|anterior|esa|esta)\s*(imagen|foto)?/i,
    /\b(hazle|ponle|agrégale|quítale|añádele)\s+/i,
    /\b(edit|modify|change|adjust|fix)\s+(the\s+)?(last|previous|that|this)\s*(image|photo)?/i,
    /\bpon(le|er)?\s+/i,
    /\bagrega(r|le)?\s+(a\s+)?(la\s+)?imagen/i,
    /\bcambia(r|le)?\s+(a\s+)?(la\s+)?imagen/i,
  ];
  
  const editSpecificPatterns = [
    /\bedita(r)?\s+(la\s+)?imagen\s+(número|#|id:?\s*)\d+/i,
    /\bedit\s+(image|photo)\s+(number|#|id:?\s*)\d+/i,
    /\bmodifica(r)?\s+(la\s+)?imagen\s+\d+/i,
  ];
  
  for (const pattern of editSpecificPatterns) {
    if (pattern.test(message)) {
      const idMatch = message.match(/\d+/);
      return {
        mode: 'edit_specific',
        prompt: message,
        editInstruction: message,
        referenceImageId: idMatch ? idMatch[0] : null,
      };
    }
  }
  
  for (const pattern of editLastPatterns) {
    if (pattern.test(message) && hasLastImage) {
      return {
        mode: 'edit_last',
        prompt: message,
        editInstruction: message,
        referenceImageId: null,
      };
    }
  }
  
  return {
    mode: 'generate',
    prompt: message,
    editInstruction: null,
    referenceImageId: null,
  };
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
