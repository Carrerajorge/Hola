import { openai, MODELS } from "../lib/openai";
import { llmGateway } from "../lib/llmGateway";
import { LIMITS } from "../lib/constants";
import { storage } from "../storage";
import { generateEmbedding } from "../embeddingService";
import { searchWeb, searchScholar, needsWebSearch, needsAcademicSearch } from "./webSearch";
import { routeMessage, runPipeline, ProgressUpdate, checkDomainPolicy, checkRateLimit, sanitizeUrl, isValidObjective } from "../agent";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface GptConfig {
  id: string;
  systemPrompt: string;
  temperature: number;
  topP: number;
}

interface DocumentMode {
  type: "word" | "excel" | "ppt";
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
    gptConfig?: GptConfig;
    documentMode?: DocumentMode;
  } = {}
): Promise<ChatResponse> {
  const { useRag = true, conversationId, images, onAgentProgress, gptConfig, documentMode } = options;
  const hasImages = images && images.length > 0;
  
  let validatedGptConfig = gptConfig;
  if (gptConfig?.id) {
    try {
      const gpt = await storage.getGpt(gptConfig.id);
      if (gpt) {
        validatedGptConfig = {
          id: gpt.id,
          systemPrompt: gpt.systemPrompt,
          temperature: parseFloat(gpt.temperature || "0.7"),
          topP: parseFloat(gpt.topP || "1")
        };
        storage.incrementGptUsage(gpt.id).catch(console.error);
      } else {
        validatedGptConfig = undefined;
      }
    } catch (error) {
      console.error("Error loading GPT config:", error);
      validatedGptConfig = undefined;
    }
  }
  
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

  // Special system prompt for document mode - AI writes clean content only
  const documentModeInstructions = `
REGLAS DE ESCRITURA DE DOCUMENTOS:
1. Escribe SOLO el contenido solicitado, sin explicaciones ni introducciones.
2. NO incluyas frases como "Aquí está...", "A continuación...", "Claro, te escribo...", etc.
3. NO hagas preguntas de seguimiento ni pidas confirmación.
4. NO incluyas comentarios sobre lo que vas a hacer o has hecho.
5. Escribe el contenido directamente como si estuvieras escribiendo en el documento.
6. Usa formato apropiado: párrafos para Word, datos estructurados para Excel, puntos clave para PPT.
7. Si el usuario pide una lista, escribe solo la lista.
8. Si el usuario pide un párrafo, escribe solo el párrafo.
9. Si el usuario pide editar algo, escribe solo el texto editado/corregido.
10. El contenido se insertará directamente en el editor del usuario.

Escribe contenido limpio y directo.`;

  const excelChartInstructions = `
INSTRUCCIONES PARA GRÁFICOS EN EXCEL:
Cuando el usuario pida un gráfico de barras o datos visuales, genera los datos en formato de tabla CSV.
Usa caracteres de barra (█) para crear una representación visual del gráfico.

Ejemplo de gráfico de barras con datos del 2020 al 2025:
Año,Valor,Gráfico
2020,45,█████████
2021,62,████████████
2022,78,████████████████
2023,85,█████████████████
2024,92,██████████████████
2025,98,████████████████████

Las barras deben ser proporcionales al valor máximo.
Para valores negativos, usa caracteres vacíos o el símbolo ○.
Siempre incluye una columna con los valores numéricos reales.
No uses formato markdown ni bloques de código, solo datos CSV separados por comas.
`;

  const documentModePrompt = documentMode ? (
    validatedGptConfig
      ? `${validatedGptConfig.systemPrompt}

Estás ayudando al usuario a crear un documento ${documentMode.type === 'word' ? 'Word' : documentMode.type === 'excel' ? 'Excel' : 'PowerPoint'}.
${documentModeInstructions}${documentMode.type === 'excel' ? excelChartInstructions : ''}${contextInfo}`
      : `Eres un asistente de escritura de documentos. El usuario está editando un documento ${documentMode.type === 'word' ? 'Word' : documentMode.type === 'excel' ? 'Excel' : 'PowerPoint'}.
${documentModeInstructions}${documentMode.type === 'excel' ? excelChartInstructions : ''}${contextInfo}`
  ) : null;

  const defaultSystemContent = `Eres Sira GPT, un asistente de IA conciso y directo. Responde de forma breve y al punto. Evita introducciones largas y despedidas innecesarias. Ve directo a la respuesta sin rodeos.

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

El usuario podrá descargar el documento generado directamente.`;

  // Use document mode prompt when in document editing mode
  const systemContent = documentModePrompt 
    ? documentModePrompt
    : (validatedGptConfig 
        ? `${validatedGptConfig.systemPrompt}\n\n${defaultSystemContent}${webSearchInfo}${contextInfo}`
        : `${defaultSystemContent}${webSearchInfo}${contextInfo}`);

  const systemMessage: ChatMessage = {
    role: "system",
    content: systemContent
  };

  const temperature = validatedGptConfig?.temperature ?? 0.7;
  const topP = validatedGptConfig?.topP ?? 1;

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
      temperature,
      top_p: topP,
    });
  } else {
    const gatewayResponse = await llmGateway.chat(
      [systemMessage, ...messages],
      {
        model: MODELS.TEXT,
        temperature,
        topP,
        userId: conversationId,
        requestId: `chat_${Date.now()}`,
      }
    );
    
    console.log(`[ChatService] LLM Gateway response: ${gatewayResponse.latencyMs}ms, tokens: ${gatewayResponse.usage?.totalTokens || 0}`);
    
    return { 
      content: gatewayResponse.content,
      role: "assistant"
    };
  }

  const content = response.choices[0]?.message?.content || "No response generated";
  
  return { 
    content,
    role: "assistant"
  };
}
