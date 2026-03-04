import { z } from "zod";
import { llmGateway } from "../../../lib/llmGateway";

// Esquema para solicitudes creativas
const MediaRequestSchema = z.object({
  type: z.enum(["image", "video", "audio"]),
  prompt: z.string(),
  style: z.enum(["photorealistic", "anime", "digital-art", "oil-painting", "3d-render", "logo", "studio-Ghibli"]).optional(),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3"]).default("1:1"),
  refImage: z.string().optional(),
  upscale: z.boolean().default(true),
  textOverlay: z.string().optional(),
});

export class MediaEngine {
  
  async generate(userId: string, request: z.infer<typeof MediaRequestSchema>) {
    console.log(`[MediaEngine] 🎨 Processing request for ${userId}: ${request.type}`);

    // 1. Optimización de Prompt
    const enhancedPrompt = await this.enhancePrompt(request);

    // 2. Selección de Modelo
    const model = this.selectModel(request);

    // 3. Ejecución Real
    let result;
    try {
        if (request.type === 'video') {
            result = await this.generateVideoReal(model, enhancedPrompt);
        } else if (request.type === 'audio') {
            result = await this.generateAudioReal(model, enhancedPrompt);
        } else {
            result = await this.generateImageReal(model, enhancedPrompt, request.aspectRatio);
        }
    } catch (e: any) {
        console.error(`[MediaEngine] Generation failed: ${e.message}. Fallback to mock.`);
        result = { url: "https://via.placeholder.com/1024?text=Generation+Failed", status: "failed" };
    }

    // 4. Upscaling (Simulado por ahora)
    if (request.upscale && request.type === 'image') {
        console.log(`[MediaEngine] Upscaling result...`);
    }

    return {
        url: result.url,
        type: request.type,
        metadata: {
            model: model,
            originalPrompt: request.prompt,
            enhancedPrompt: enhancedPrompt,
            style: request.style
        }
    };
  }

  private async enhancePrompt(req: z.infer<typeof MediaRequestSchema>): Promise<string> {
    const response = await llmGateway.chat([
        { role: "system", content: "You are an expert prompt engineer. Output ONLY the improved prompt." },
        { role: "user", content: `Improve this prompt for ${req.type} generation (${req.style}): ${req.prompt}` }
    ], { model: "gpt-4o-mini", _fromRouter: true });
    return response.content || req.prompt;
  }

  private selectModel(req: z.infer<typeof MediaRequestSchema>): string {
    if (req.type === "video") return "runway-gen-2";
    if (req.type === "audio") return "elevenlabs-v2";
    return "dall-e-3"; 
  }

  // Real DALL-E 3 Call
  private async generateImageReal(model: string, prompt: string, size: string) {
    if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
    
    console.log(`[MediaEngine] Calling OpenAI DALL-E 3...`);
    const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "dall-e-3",
            prompt: prompt,
            n: 1,
            size: "1024x1024", // Mapping aspect ratio to resolution logic needed here
            response_format: "url"
        })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "OpenAI API Error");
    
    return { url: data.data[0].url, status: "success" };
  }

  // Stub for Video (Runway)
  private async generateVideoReal(model: string, prompt: string) {
    console.log(`[MediaEngine] Calling Video API (Stub)...`);
    // Implementar fetch real a RunwayML
    await new Promise(r => setTimeout(r, 2000));
    return { url: "https://generated.placeholder/video.mp4", status: "success" };
  }

  // Stub for Audio (ElevenLabs)
  private async generateAudioReal(model: string, prompt: string) {
    console.log(`[MediaEngine] Calling Audio API (Stub)...`);
    // Implementar fetch real a ElevenLabs
    await new Promise(r => setTimeout(r, 1000));
    return { url: "https://generated.placeholder/audio.mp3", status: "success" };
  }
}
