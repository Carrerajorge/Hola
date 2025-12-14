import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import OpenAI from "openai";

// xAI Grok integration
const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY 
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Chat endpoint using xAI Grok API
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      // Format messages for the API
      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      // Add system prompt for Sira GPT
      const systemMessage = {
        role: "system" as const,
        content: "Eres Sira GPT, un asistente de IA avanzado capaz de navegar la web, recopilar información, crear documentos y ejecutar objetivos complejos. Responde de manera útil y profesional en el idioma del usuario."
      };

      const response = await openai.chat.completions.create({
        model: "grok-2-1212",
        messages: [systemMessage, ...formattedMessages],
      });

      const content = response.choices[0]?.message?.content || "No response generated";
      
      res.json({ 
        content,
        role: "assistant"
      });
    } catch (error: any) {
      console.error("Chat API error:", error);
      res.status(500).json({ 
        error: "Failed to get AI response",
        details: error.message 
      });
    }
  });

  return httpServer;
}
