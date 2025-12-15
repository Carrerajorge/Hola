import { openai, MODELS } from "../lib/openai";
import { LIMITS } from "../lib/constants";
import { storage } from "../storage";
import { generateEmbedding } from "../embeddingService";
import { searchWeb, searchScholar, needsWebSearch, needsAcademicSearch } from "./webSearch";
import { routeMessage, runPipeline, ProgressUpdate, checkDomainPolicy, checkRateLimit, sanitizeUrl, isValidObjective } from "../agent";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatSource {
  fileName: string;
  content: string;
}

interface ChatResponse {
  content: string;
  role: string;
  sources?: ChatSource[];
  agentRunId?: string;
  wasAgentTask?: boolean;
  pipelineSteps?: number;
  pipelineSuccess?: boolean;
  browserSessionId?: string | null;
}

function broadcastAgentUpdate(runId: string, update: any) {
}

export async function handleChatRequest(
  messages: ChatMessage[],
  options: {
    useRag?: boolean;
    conversationId?: string;
    images?: string[];
    onAgentProgress?: (update: ProgressUpdate) => void;
  } = {}
): Promise<ChatResponse> {
  const { useRag = true, conversationId, images, onAgentProgress } = options;
  const hasImages = images && images.length > 0;
  
  const lastUserMessage = messages.filter(m => m.role === "user").pop();
  
  if (lastUserMessage) {
    const routeResult = await routeMessage(lastUserMessage.content);
    
    if (routeResult.decision === "agent" || routeResult.decision === "hybrid") {
      const urls = routeResult.urls || [];
      
      for (const url of urls) {
        try {
          const sanitizedUrl = sanitizeUrl(url);
          const securityCheck = await checkDomainPolicy(sanitizedUrl);
          
          if (!securityCheck.allowed) {
            return {
              content: `No puedo acceder a ${url}: ${securityCheck.reason}`,
              role: "assistant"
            };
          }
          
          const domain = new URL(sanitizedUrl).hostname;
          if (!checkRateLimit(domain, securityCheck.rateLimit)) {
            return {
              content: `Límite de solicitudes alcanzado para ${domain}. Intenta de nuevo en un minuto.`,
              role: "assistant"
            };
          }
        } catch (e) {
          console.error("URL validation error:", e);
        }
      }
      
      if (!isValidObjective(routeResult.objective || lastUserMessage.content)) {
        return {
          content: "No puedo procesar solicitudes que involucren información sensible o actividades no permitidas.",
          role: "assistant"
        };
      }
      
      const objective = routeResult.objective || lastUserMessage.content;
      let lastBrowserSessionId: string | null = null;
      
      const pipelineResult = await runPipeline({
        objective,
        conversationId,
        onProgress: (update) => {
          onAgentProgress?.(update);
          if (update.detail?.browserSessionId) {
            lastBrowserSessionId = update.detail.browserSessionId;
          }
        }
      });
      
      return {
        content: pipelineResult.summary || "Tarea completada.",
        role: "assistant",
        sources: pipelineResult.artifacts
          .filter(a => a.type === "text" && a.name)
          .slice(0, 5)
          .map(a => ({ fileName: a.name!, content: a.content?.slice(0, 200) || "" })),
        agentRunId: pipelineResult.runId,
        wasAgentTask: true,
        pipelineSteps: pipelineResult.steps.length,
        pipelineSuccess: pipelineResult.success,
        browserSessionId: lastBrowserSessionId
      };
    }
  }

  let contextInfo = "";
  let sources: ChatSource[] = [];
  let webSearchInfo = "";

  if (lastUserMessage && needsAcademicSearch(lastUserMessage.content)) {
    try {
      console.log("Academic search triggered for:", lastUserMessage.content);
      const scholarResults = await searchScholar(lastUserMessage.content, 5);
      
      if (scholarResults.length > 0) {
        webSearchInfo = "\n\n**Artículos académicos encontrados en Google Scholar:**\n" +
          scholarResults.map((r, i) => 
            `[${i + 1}] Autores: ${r.authors || "No disponible"}\nAño: ${r.year || "No disponible"}\nTítulo: ${r.title}\nURL: ${r.url}\nResumen: ${r.snippet}\nCita sugerida: ${r.citation}`
          ).join("\n\n");
      }
    } catch (error) {
      console.error("Academic search error:", error);
    }
  } else if (lastUserMessage && needsWebSearch(lastUserMessage.content)) {
    try {
      console.log("Web search triggered for:", lastUserMessage.content);
      const searchResults = await searchWeb(lastUserMessage.content, 5);
      
      if (searchResults.contents.length > 0) {
        webSearchInfo = "\n\n**Información de Internet (actualizada):**\n" +
          searchResults.contents.map((content, i) => 
            `[${i + 1}] ${content.title} (${content.url}):\n${content.content}`
          ).join("\n\n");
      } else if (searchResults.results.length > 0) {
        webSearchInfo = "\n\n**Resultados de búsqueda web:**\n" +
          searchResults.results.map((r, i) => 
            `[${i + 1}] ${r.title}: ${r.snippet} (${r.url})`
          ).join("\n");
      }
    } catch (error) {
      console.error("Web search error:", error);
    }
  }

  if (useRag && lastUserMessage) {
    try {
      const queryEmbedding = await generateEmbedding(lastUserMessage.content);
      const similarChunks = await storage.searchSimilarChunks(queryEmbedding, LIMITS.RAG_SIMILAR_CHUNKS);
      
      if (similarChunks.length > 0) {
        sources = similarChunks.map((chunk: any) => ({
          fileName: chunk.file_name || "Documento",
          content: chunk.content.slice(0, 200) + "..."
        }));
        
        contextInfo = "\n\nContexto de documentos relevantes:\n" + 
          similarChunks.map((chunk: any, i: number) => 
            `[${i + 1}] ${chunk.file_name || "Documento"}: ${chunk.content}`
          ).join("\n\n");
      }
    } catch (error) {
      console.error("RAG search error:", error);
    }
  }

  const systemMessage: ChatMessage = {
    role: "system",
    content: `Eres Sira GPT, un asistente de IA avanzado con conexión a Internet. Puedes buscar información actualizada en la web. Responde de manera útil y profesional en el idioma del usuario. Si usas información de la web, cita las fuentes.

CAPACIDADES DE GENERACIÓN DE DOCUMENTOS:
Puedes crear documentos Word, Excel y PowerPoint. Cuando el usuario solicite crear un documento, incluye en tu respuesta un bloque especial con el formato:

\`\`\`document
{
  "type": "word" | "excel" | "ppt",
  "title": "Título del documento",
  "content": "Contenido formateado del documento"
}
\`\`\`

Para Word: usa markdown simple (## para títulos, - para listas).
Para Excel: usa formato de tabla con | columna1 | columna2 | o CSV.
Para PPT: usa ## para títulos de diapositivas y - para puntos.

El usuario podrá descargar el documento generado directamente.${webSearchInfo}${contextInfo}`
  };

  let response;
  
  if (hasImages) {
    const imageContents = images!.map((img: string) => ({
      type: "image_url" as const,
      image_url: { url: img }
    }));
    
    const lastUserIdx = messages.findLastIndex(m => m.role === "user");
    const messagesWithImages = messages.map((msg, idx) => {
      if (idx === lastUserIdx) {
        return {
          role: msg.role,
          content: [
            ...imageContents,
            { type: "text" as const, text: msg.content || "Analiza esta imagen" }
          ]
        };
      }
      return msg;
    });
    
    response = await openai.chat.completions.create({
      model: MODELS.VISION,
      messages: [systemMessage, ...messagesWithImages] as any,
      max_tokens: 4096,
    });
  } else {
    response = await openai.chat.completions.create({
      model: MODELS.TEXT,
      messages: [systemMessage, ...messages],
    });
  }

  const content = response.choices[0]?.message?.content || "No response generated";
  
  return { 
    content,
    role: "assistant",
    sources: sources.length > 0 ? sources : undefined
  };
}
