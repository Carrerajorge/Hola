import { z } from "zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { generateStructuredOutput } from "../../lib/structuredOutput";
import type { IngestedChunk } from "./ingestionTypes";

const ImageExtractionSchema = z.object({
  image_id: z.string().min(1),
  summary: z.string().min(1),
  detected_text: z.string().default(""),
  key_elements: z.array(z.string().min(1)).default([]),
  entities: z.array(z.string().min(1)).default([]),
  quantitative_facts: z.array(z.string().min(1)).default([]),
});

export type ImageExtraction = z.infer<typeof ImageExtractionSchema>;

// Avoid importing server/lib/openai here: it instantiates a client at import time.
const XAI_VISION_MODEL = "grok-2-vision-1212";


function inferMimeFromBase64(base64: string): string {
  const prefix = (base64 || "").slice(0, 12);
  if (prefix.startsWith("iVBORw0")) return "image/png";
  if (prefix.startsWith("/9j/")) return "image/jpeg";
  if (prefix.startsWith("R0lGOD")) return "image/gif";
  if (prefix.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

export async function extractImageSemantics(args: {
  imageId: string;
  base64: string;
  requestId?: string;
  userId?: string;
}): Promise<{ extraction: ImageExtraction; chunk: IngestedChunk }> {
  const { imageId, base64, requestId, userId } = args;

  const mime = inferMimeFromBase64(base64);
  const dataUrl = `data:${mime};base64,${base64}`;

  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: [
      {
        type: "text",
        text:
          `Extrae informacion de la imagen para usarla como contexto de respuesta.\n` +
          `Devuelve SOLO JSON con: image_id, summary, detected_text, key_elements, entities, quantitative_facts.\n` +
          `- detected_text: texto literal visible (si hay).\n` +
          `- quantitative_facts: numeros, fechas, porcentajes y unidades que aparezcan.\n` +
          `- No inventes; si no se ve, deja campos vacios.\n` +
          `image_id debe ser "${imageId}".`,
      },
      { type: "image_url", image_url: { url: dataUrl } },
    ] as any,
  };

  const out = await generateStructuredOutput({
    messages: [userMessage],
    schema: ImageExtractionSchema,
    schemaName: "ImageExtraction",
    model: XAI_VISION_MODEL,
    provider: "xai",
    temperature: 0,
    maxTokens: 900,
    userId,
    requestId,
    maxRetries: 2,
    timeoutMs: 45000,
  });

  const extraction = out.value;

  const chunkText = [
    `Type: image`,
    `ImageId: ${imageId}`,
    `Summary: ${extraction.summary}`,
    extraction.detected_text ? `DetectedText:\n${extraction.detected_text}` : "",
    extraction.key_elements.length ? `KeyElements: ${extraction.key_elements.join("; ")}` : "",
    extraction.entities.length ? `Entities: ${extraction.entities.join("; ")}` : "",
    extraction.quantitative_facts.length ? `QuantitativeFacts: ${extraction.quantitative_facts.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

  const chunk: IngestedChunk = {
    id: `imgchunk_${imageId}`,
    kind: "image",
    sourceId: `img:${imageId}`,
    location: {},
    headingPath: [],
    content: chunkText,
    rawContent: extraction.detected_text || "",
    metadata: {
      mime,
    },
  };

  return { extraction, chunk };
}

