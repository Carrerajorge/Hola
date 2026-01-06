import { openai, MODELS } from "../lib/openai";
import { llmGateway } from "../lib/llmGateway";
import { geminiChat, geminiStreamChat, GEMINI_MODELS, GeminiChatMessage } from "../lib/gemini";
import { LIMITS, MEMORY_INTENT_KEYWORDS } from "../lib/constants";
import { storage } from "../storage";
import { generateEmbedding } from "../embeddingService";
import { searchWeb, searchScholar, needsWebSearch, needsAcademicSearch } from "./webSearch";
import { routeMessage, runPipeline, ProgressUpdate, checkDomainPolicy, checkRateLimit, sanitizeUrl, isValidObjective, multiIntentManager, multiIntentPipeline } from "../agent";
import type { PipelineResponse } from "../../shared/schemas/multiIntent";
import { checkToolPolicy, logToolCall } from "./integrationPolicyService";
import { detectEmailIntent, handleEmailChatRequest } from "./gmailChatIntegration";
import { productionWorkflowRunner, classifyIntent, isGenerationIntent } from "../agent/registry/productionWorkflowRunner";

export type LLMProvider = "xai" | "gemini";

export const AVAILABLE_MODELS = {
  xai: {
    name: "xAI Grok",
    models: [
      { id: "grok-4-1-fast-non-reasoning", name: "Grok 4.1 Fast", description: "Respuestas rápidas con 2M de contexto", default: true },
      { id: "grok-4-1-fast-reasoning", name: "Grok 4.1 Fast Reasoning", description: "Razonamiento avanzado con 2M de contexto" },
      { id: "grok-4-fast-non-reasoning", name: "Grok 4 Fast", description: "Modelo rápido y eficiente" },
      { id: "grok-4-fast-reasoning", name: "Grok 4 Fast Reasoning", description: "Razonamiento paso a paso" },
      { id: "grok-code-fast-1", name: "Grok Code", description: "Especializado en código" },
      { id: "grok-4-0709", name: "Grok 4 Premium", description: "Modelo premium de alta calidad" },
      { id: "grok-3-fast", name: "Grok 3 Fast", description: "Respuestas rápidas" },
      { id: "grok-2-vision-1212", name: "Grok 2 Vision", description: "Comprensión de imágenes" },
    ]
  },
  gemini: {
    name: "Google Gemini",
    models: [
      { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview", description: "El más nuevo y rápido" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Rápido y eficiente" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", description: "El más capaz" },
    ]
  }
} as const;

export const DEFAULT_PROVIDER = "xai";
export const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

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

type DiagramType = "flowchart" | "orgchart" | "mindmap";

interface FigmaDiagram {
  diagramType: DiagramType;
  nodes: Array<{
    id: string;
    type: "start" | "end" | "process" | "decision" | "role" | "department" | "person";
    label: string;
    x: number;
    y: number;
    level?: number;
    parentId?: string;
  }>;
  connections: Array<{
    from: string;
    to: string;
    label?: string;
  }>;
  title?: string;
}

function detectDiagramType(prompt: string): DiagramType {
  const lowerPrompt = prompt.toLowerCase();
  const orgChartKeywords = ["organigrama", "org chart", "estructura organizacional", "jerarqu", "organización", "equipo", "departamento", "ceo", "director", "gerente", "jefe"];
  const mindmapKeywords = ["mapa mental", "mindmap", "lluvia de ideas", "brainstorm"];
  
  if (orgChartKeywords.some(kw => lowerPrompt.includes(kw))) return "orgchart";
  if (mindmapKeywords.some(kw => lowerPrompt.includes(kw))) return "mindmap";
  return "flowchart";
}

function detectMemoryIntent(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return MEMORY_INTENT_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
}

function validateOrgChart(diagram: FigmaDiagram): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  const hasStartEnd = diagram.nodes.some(n => n.type === "start" || n.type === "end");
  if (hasStartEnd) errors.push("Org charts should not have start/end nodes");
  
  const invalidWords = ["inicio", "fin", "start", "end", "aleta"];
  const validOrgTypes = ["role", "department", "person"];
  
  diagram.nodes.forEach(node => {
    if (invalidWords.some(w => node.label.toLowerCase() === w)) {
      errors.push(`Invalid label: ${node.label}`);
    }
    if (!validOrgTypes.includes(node.type)) {
      errors.push(`Invalid node type for org chart: ${node.type}`);
    }
  });
  
  const nodeIds = new Set(diagram.nodes.map(n => n.id));
  const childIds = new Set(diagram.connections.map(c => c.to));
  const roots = diagram.nodes.filter(n => !childIds.has(n.id));
  if (roots.length !== 1) errors.push(`Expected 1 root, found ${roots.length}`);
  
  const parentCount = new Map<string, number>();
  diagram.connections.forEach(conn => {
    const count = parentCount.get(conn.to) || 0;
    parentCount.set(conn.to, count + 1);
  });
  parentCount.forEach((count, nodeId) => {
    if (count > 1) errors.push(`Node ${nodeId} has multiple parents (${count})`);
  });
  
  function hasCycle(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const childrenMap = new Map<string, string[]>();
    diagram.connections.forEach(conn => {
      const children = childrenMap.get(conn.from) || [];
      children.push(conn.to);
      childrenMap.set(conn.from, children);
    });
    
    function dfs(nodeId: string): boolean {
      visited.add(nodeId);
      recStack.add(nodeId);
      for (const child of childrenMap.get(nodeId) || []) {
        if (!visited.has(child)) {
          if (dfs(child)) return true;
        } else if (recStack.has(child)) {
          return true;
        }
      }
      recStack.delete(nodeId);
      return false;
    }
    
    for (const node of diagram.nodes) {
      if (!visited.has(node.id) && dfs(node.id)) return true;
    }
    return false;
  }
  
  if (hasCycle()) errors.push("Org chart contains cycles");
  
  return { valid: errors.length === 0, errors };
}

function applyTreeLayout(diagram: FigmaDiagram): FigmaDiagram {
  if (diagram.diagramType !== "orgchart") return diagram;
  
  const nodeMap = new Map(diagram.nodes.map(n => [n.id, n]));
  const childrenMap = new Map<string, string[]>();
  const childIds = new Set(diagram.connections.map(c => c.to));
  
  diagram.connections.forEach(conn => {
    const children = childrenMap.get(conn.from) || [];
    children.push(conn.to);
    childrenMap.set(conn.from, children);
  });
  
  const root = diagram.nodes.find(n => !childIds.has(n.id));
  if (!root) return diagram;
  
  const NODE_WIDTH = 140;
  const NODE_HEIGHT = 50;
  const HORIZONTAL_GAP = 40;
  const VERTICAL_GAP = 80;
  
  const subtreeWidthCache = new Map<string, number>();
  const visited = new Set<string>();
  
  function getSubtreeWidth(nodeId: string): number {
    if (subtreeWidthCache.has(nodeId)) return subtreeWidthCache.get(nodeId)!;
    if (visited.has(nodeId)) return NODE_WIDTH;
    visited.add(nodeId);
    
    const children = childrenMap.get(nodeId) || [];
    const width = children.length === 0 
      ? NODE_WIDTH 
      : children.reduce((sum, childId) => sum + getSubtreeWidth(childId), 0) + (children.length - 1) * HORIZONTAL_GAP;
    
    subtreeWidthCache.set(nodeId, width);
    return width;
  }
  
  const positioned = new Set<string>();
  
  function positionNode(nodeId: string, x: number, y: number, level: number) {
    if (positioned.has(nodeId)) return;
    positioned.add(nodeId);
    
    const node = nodeMap.get(nodeId);
    if (!node) return;
    
    node.x = x;
    node.y = y;
    node.level = level;
    
    const children = childrenMap.get(nodeId) || [];
    if (children.length === 0) return;
    
    const totalWidth = children.reduce((sum, childId) => sum + getSubtreeWidth(childId), 0) + (children.length - 1) * HORIZONTAL_GAP;
    let childX = x - totalWidth / 2 + NODE_WIDTH / 2;
    
    children.forEach(childId => {
      const childWidth = getSubtreeWidth(childId);
      positionNode(childId, childX + childWidth / 2 - NODE_WIDTH / 2, y + NODE_HEIGHT + VERTICAL_GAP, level + 1);
      childX += childWidth + HORIZONTAL_GAP;
    });
  }
  
  positionNode(root.id, 400, 50, 0);
  
  return diagram;
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
  figmaDiagram?: FigmaDiagram;
  multiIntentResponse?: PipelineResponse;
}

function broadcastAgentUpdate(runId: string, update: any) {
}

export async function handleChatRequest(
  messages: ChatMessage[],
  options: {
    useRag?: boolean;
    conversationId?: string;
    userId?: string;
    images?: string[];
    onAgentProgress?: (update: ProgressUpdate) => void;
    gptConfig?: GptConfig;
    documentMode?: DocumentMode;
    figmaMode?: boolean;
    provider?: LLMProvider;
    model?: string;
    attachmentContext?: string;
    forceDirectResponse?: boolean;
  } = {}
): Promise<ChatResponse> {
  const { useRag = true, conversationId, userId, images, onAgentProgress, gptConfig, documentMode, figmaMode, provider = DEFAULT_PROVIDER, model = DEFAULT_MODEL, attachmentContext = "", forceDirectResponse = false } = options;
  const hasImages = images && images.length > 0;
  
  // Fetch user settings for feature flags and preferences
  let userSettings: Awaited<ReturnType<typeof storage.getUserSettings>> = null;
  let companyKnowledge: Awaited<ReturnType<typeof storage.getActiveCompanyKnowledge>> = [];
  if (userId) {
    try {
      userSettings = await storage.getUserSettings(userId);
      companyKnowledge = await storage.getActiveCompanyKnowledge(userId);
    } catch (error) {
      console.error("Error fetching user settings or company knowledge:", error);
    }
  }
  
  // Extract feature flags with defaults
  // These flags control tool availability:
  // - memoryEnabled: controls RAG/document memory retrieval
  // - webSearchAuto: controls automatic web search triggering
  // - codeInterpreterEnabled: controls code execution for charts/visualizations
  // - connectorSearchAuto: controls automatic connector searches (TODO: implement in orchestrator/agent pipeline)
  // - canvasEnabled: controls canvas/visualization features
  // - voiceEnabled: controls voice input/output features
  const featureFlags = {
    memoryEnabled: userSettings?.featureFlags?.memoryEnabled ?? false,
    webSearchAuto: userSettings?.featureFlags?.webSearchAuto ?? false,
    codeInterpreterEnabled: userSettings?.featureFlags?.codeInterpreterEnabled ?? true,
    connectorSearchAuto: userSettings?.featureFlags?.connectorSearchAuto ?? false,
    canvasEnabled: userSettings?.featureFlags?.canvasEnabled ?? true,
    voiceEnabled: userSettings?.featureFlags?.voiceEnabled ?? true,
  };
  
  // TODO: Tool Policy Enforcement Integration Points
  // The checkToolPolicy and logToolCall functions from integrationPolicyService.ts
  // should be called at the following tool invocation points:
  // 
  // 1. Web Search (lines ~291-324): Before calling searchWeb/searchScholar
  //    Example: const policyCheck = await checkToolPolicy(userId, "web_search", "search_provider");
  //    if (!policyCheck.allowed) { skip search and inform user }
  //
  // 2. RAG/Memory Retrieval (lines ~328-346): Before searching similar chunks
  //    Example: const policyCheck = await checkToolPolicy(userId, "memory_retrieval", "rag_provider");
  //
  // 3. Multi-Intent Pipeline (line ~183): Before executing multiIntentPipeline.execute()
  //    Example: const policyCheck = await checkToolPolicy(userId, "multi_intent", "agent_pipeline");
  //
  // 4. Agent Pipeline (line ~258): Before calling runPipeline()
  //    Example: const policyCheck = await checkToolPolicy(userId, "agent_pipeline", "browser_agent");
  //
  // 5. Code Interpreter (detected via wantsChart flag): Before executing Python code
  //    Example: const policyCheck = await checkToolPolicy(userId, "code_interpreter", "python_executor");
  //
  // After each tool execution, call logToolCall to record the invocation for audit purposes.
  
  // Extract response preferences
  const customInstructions = userSettings?.responsePreferences?.customInstructions || "";
  const responseStyle = userSettings?.responsePreferences?.responseStyle || "default";
  
  // Extract user profile for context
  const userProfile = userSettings?.userProfile || null;
  
  // Load persistent conversation documents for context continuity
  let persistentDocumentContext = "";
  if (conversationId) {
    try {
      const conversationDocs = await storage.getConversationDocuments(conversationId);
      if (conversationDocs.length > 0) {
        const parts: string[] = ["\n\n=== DOCUMENTOS DE ESTA CONVERSACIÓN ===\n"];
        for (const doc of conversationDocs) {
          parts.push(`\n--- Archivo: ${doc.fileName} ---\n`);
          parts.push(doc.extractedText || "[Sin contenido extraído]");
          parts.push("\n--- Fin del archivo ---\n");
        }
        persistentDocumentContext = parts.join("");
        console.log(`[ChatService] Loaded ${conversationDocs.length} persistent document(s) for conversation ${conversationId}`);
      }
    } catch (error) {
      console.error("[ChatService] Error loading conversation documents:", error);
    }
  }

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
    // GMAIL INTEGRATION: Detectar y manejar solicitudes de correo electrónico
    if (!documentMode && !figmaMode && userId && detectEmailIntent(lastUserMessage.content)) {
      try {
        const emailResult = await handleEmailChatRequest(userId, lastUserMessage.content);
        if (emailResult.handled && emailResult.response) {
          console.log(`[Gmail Chat] Handled email query for user ${userId}`);
          return {
            content: emailResult.response,
            role: "assistant"
          };
        }
      } catch (error) {
        console.error("[Gmail Chat] Error handling email request:", error);
      }
    }

    // PRODUCTION WORKFLOW: Route generation intents (image, slides, docs) through ProductionWorkflowRunner
    // This ensures real artifacts are generated with proper termination guarantees
    if (!documentMode && !figmaMode && !hasImages) {
      const intent = classifyIntent(lastUserMessage.content);
      if (isGenerationIntent(intent)) {
        console.log(`[ChatService] Generation intent detected: ${intent}, routing to ProductionWorkflowRunner`);
        try {
          const { run, response } = await productionWorkflowRunner.executeAndWait(lastUserMessage.content);
          
          // Build response with artifact information
          let artifactInfo = null;
          if (run.artifacts.length > 0) {
            const artifact = run.artifacts[0];
            artifactInfo = {
              artifactId: artifact.artifactId,
              type: artifact.type,
              mimeType: artifact.mimeType,
              sizeBytes: artifact.sizeBytes,
              downloadUrl: `/api/registry/artifacts/${artifact.artifactId}/download`,
            };
          }
          
          return {
            content: response,
            role: "assistant",
            wasAgentTask: true,
            agentRunId: run.runId,
            artifact: artifactInfo,
          };
        } catch (error: any) {
          console.error(`[ChatService] ProductionWorkflowRunner error:`, error);
          return {
            content: `Error al procesar la solicitud: ${error.message || "Error desconocido"}`,
            role: "assistant",
          };
        }
      }
    }
    
    // PRIMERO: Detectar multi-intent ANTES de routeMessage para evitar que el agent pipeline
    // capture prompts con múltiples tareas y solo procese la última
    if (!documentMode && !figmaMode && !hasImages) {
      try {
        const detection = await multiIntentManager.detectMultiIntent(lastUserMessage.content, {
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          userPreferences: {}
        });
        
        if (detection.isMultiIntent && detection.confidence >= 0.7) {
          
          const pipelineResponse = await multiIntentPipeline.execute(
            lastUserMessage.content,
            {
              userId: conversationId,
              conversationId,
              messages: messages.map(m => ({ role: m.role, content: m.content })),
              onProgress: onAgentProgress
            }
          );
          
          if (pipelineResponse.aggregate.completionStatus === "complete") {
            return {
              content: pipelineResponse.aggregate.summary,
              role: "assistant",
              wasAgentTask: true,
              pipelineSteps: pipelineResponse.plan.length,
              pipelineSuccess: true,
              multiIntentResponse: pipelineResponse
            };
          }
          
          // Si el pipeline multi-intent falla, continuar con routeMessage normal
        }
      } catch (error) {
        console.error("Multi-intent pipeline error, falling back to routeMessage:", error);
      }
    }
    
    // SEGUNDO: Si no es multi-intent o falló, usar routeMessage normal
    // BUT: Skip agent mode if we have attachment content - answer directly from document
    if (forceDirectResponse && attachmentContext) {
      console.log("[ChatService] Force direct response mode - skipping agent pipeline for attachment-based query");
      // Fall through to direct LLM response with attachment context
    } else {
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
  }

  let contextInfo = "";
  let sources: ChatSource[] = [];
  let webSearchInfo = "";

  // Web search is gated by the webSearchAuto feature flag
  // If webSearchAuto is false, skip automatic web search detection
  if (featureFlags.webSearchAuto && lastUserMessage && needsAcademicSearch(lastUserMessage.content)) {
    try {
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
  } else if (featureFlags.webSearchAuto && lastUserMessage && needsWebSearch(lastUserMessage.content)) {
    try {
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

  // RAG/Memory retrieval is gated by memoryEnabled AND explicit user intent
  // Only inject memory context when user explicitly mentions their documents
  const userWantsMemory = lastUserMessage ? detectMemoryIntent(lastUserMessage.content) : false;
  
  if (useRag && featureFlags.memoryEnabled && lastUserMessage && userWantsMemory) {
    try {
      const queryEmbedding = await generateEmbedding(lastUserMessage.content);
      const allChunks = await storage.searchSimilarChunks(queryEmbedding, LIMITS.RAG_SIMILAR_CHUNKS, userId);
      
      // Filter by similarity threshold - only include highly relevant chunks
      const similarChunks = allChunks.filter((chunk: any) => {
        const distance = parseFloat(chunk.distance || "1");
        return distance < LIMITS.RAG_SIMILARITY_THRESHOLD;
      });
      
      if (similarChunks.length > 0) {
        sources = similarChunks.map((chunk: any) => ({
          fileName: chunk.file_name || "Documento",
          content: chunk.content.slice(0, 200) + "..."
        }));
        
        contextInfo = "\n\nContexto de tus documentos:\n" + 
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

FORMATO DE TEXTO ENRIQUECIDO (se convertirá a estilos nativos de Office):
- Para texto en **negrita**, usa **doble asterisco**
- Para texto en *cursiva*, usa *asterisco simple*
- Para \`código\`, usa \`comillas invertidas\`

FÓRMULAS MATEMÁTICAS - OBLIGATORIO USAR SINTAXIS LaTeX:
- Para fórmulas en línea: $x^2 + y^2 = z^2$
- Para fórmulas en bloque: $$\\frac{a}{b}$$
- Fracciones: $\\frac{numerador}{denominador}$
- Exponentes: $x^2$, $x^{n+1}$
- Subíndices: $x_1$, $a_{ij}$
- Raíces: $\\sqrt{x}$, $\\sqrt[n]{x}$
- Letras griegas: $\\alpha$, $\\beta$, $\\pi$, $\\theta$
- Derivadas: $\\frac{d}{dx}$, $f'(x)$
- Integrales: $\\int_{a}^{b} f(x) dx$
- Sumas: $\\sum_{i=1}^{n} x_i$
- Límites: $\\lim_{x \\to 0}$

IMPORTANTE: SIEMPRE usa $ para envolver fórmulas matemáticas:
- CORRECTO: "La función $f(x) = x^2$ tiene derivada $f'(x) = 2x$"
- INCORRECTO: "La función f(x) = x²" (NO uses caracteres Unicode como ², ³, ⁴)
- INCORRECTO: "f(x) = 8x⁴ - 6x³" (NO uses superíndices Unicode)
- CORRECTO: "$f(x) = 8x^4 - 6x^3$" (USA LaTeX con $...$)

Escribe contenido limpio y directo.`;

  const excelChartInstructions = `
FORMATO OBLIGATORIO PARA EXCEL:
- SIEMPRE usa formato CSV con valores separados por comas.
- NUNCA uses markdown, asteriscos (**), guiones (-), ni bloques de código.
- Cada línea es una fila de la hoja de cálculo.
- Los valores se separan con comas.

COMANDOS DE HOJAS:
- Para crear una NUEVA hoja: [NUEVA_HOJA:Nombre de la Hoja]
- Puedes crear múltiples hojas en una sola respuesta.

EJEMPLO DE GRÁFICOS DE BARRAS con múltiples hojas:
[NUEVA_HOJA:Ventas 2020-2025]
Año,Ventas,Gráfico
2020,45000,█████████
2021,62000,████████████
2022,78000,████████████████
2023,85000,█████████████████
2024,92000,██████████████████
2025,98000,████████████████████

[NUEVA_HOJA:Proyección 2030-2035]
Año,Proyección,Gráfico
2030,150000,██████████████████████
2031,175000,█████████████████████████
2032,200000,████████████████████████████
2033,225000,███████████████████████████████
2034,250000,██████████████████████████████████
2035,280000,█████████████████████████████████████

[NUEVA_HOJA:Balance de Ventas]
Concepto,Q1,Q2,Q3,Q4,Total
Ingresos,25000,28000,32000,35000,=B2+C2+D2+E2
Costos,15000,16000,18000,20000,=B3+C3+D3+E3
Utilidad Bruta,=B2-B3,=C2-C3,=D2-D3,=E2-E3,=B4+C4+D4+E4
Gastos Operativos,3000,3500,4000,4500,=B5+C5+D5+E5
Utilidad Neta,=B4-B5,=C4-C5,=D4-D5,=E4-E5,=B6+C6+D6+E6

REGLAS IMPORTANTES:
1. Usa [NUEVA_HOJA:nombre] para crear cada hoja nueva.
2. Después del comando de hoja, escribe los datos CSV directamente SIN líneas vacías.
3. Para gráficos de barras visuales, usa █ repetido proporcionalmente.
4. Para fórmulas usa el formato =CELDA+CELDA (ej: =B2+C2 o =SUM(B2:E2)).
5. Las celdas se nombran como en Excel: A1, B2, C3, etc.
6. NO incluyas explicaciones, solo los comandos y datos.
`;

  const documentModePrompt = documentMode ? (
    validatedGptConfig
      ? `${validatedGptConfig.systemPrompt}

Estás ayudando al usuario a crear un documento ${documentMode.type === 'word' ? 'Word' : documentMode.type === 'excel' ? 'Excel' : 'PowerPoint'}.
${documentModeInstructions}${documentMode.type === 'excel' ? excelChartInstructions : ''}${contextInfo}`
      : `Eres un asistente de escritura de documentos. El usuario está editando un documento ${documentMode.type === 'word' ? 'Word' : documentMode.type === 'excel' ? 'Excel' : 'PowerPoint'}.
${documentModeInstructions}${documentMode.type === 'excel' ? excelChartInstructions : ''}${contextInfo}`
  ) : null;

  // Check if user explicitly requests document creation
  const lastUserMsgText = messages.filter(m => m.role === "user").pop()?.content?.toLowerCase() || "";
  const wantsDocument = /\b(crea|crear|genera|generar|haz|hacer|escribe|escribir|redacta|redactar|elabora|elaborar)\b.*(documento|word|excel|powerpoint|ppt|archivo|docx|xlsx|pptx)/i.test(lastUserMsgText) ||
                        /\b(documento|word|excel|powerpoint|ppt)\b.*(crea|crear|genera|generar|haz|hacer)/i.test(lastUserMsgText);

  // Check if user wants a chart/graph/visualization
  // Code interpreter is gated by the codeInterpreterEnabled feature flag
  const wantsChart = /\b(gr[aá]fic[oa]|chart|plot|visualiz|histograma|diagrama de barras|pie chart|scatter|l[ií]nea|barras)\b/i.test(lastUserMsgText);

  const codeInterpreterPrompt = (wantsChart && featureFlags.codeInterpreterEnabled) ? `
⚠️ OBLIGATORIO - CODE INTERPRETER ACTIVO ⚠️
El usuario ha solicitado una GRÁFICA o VISUALIZACIÓN. DEBES responder con código Python ejecutable.

REGLAS ESTRICTAS:
1. Tu respuesta DEBE contener un bloque \`\`\`python con código ejecutable
2. NO describas la gráfica con texto - GENERA EL CÓDIGO
3. NO uses caracteres ASCII (█, ─, etc.) para simular gráficas
4. El código se ejecutará automáticamente y mostrará la gráfica real

CÓDIGO OBLIGATORIO para gráfica de barras:
\`\`\`python
import matplotlib.pyplot as plt
import numpy as np

# Datos simulados
years = [2020, 2021, 2022, 2023, 2024, 2025]
values = [450, 520, 610, 580, 720, 850]

plt.figure(figsize=(10, 6))
plt.bar(years, values, color='steelblue', edgecolor='navy')
plt.xlabel('Año', fontsize=12)
plt.ylabel('Valor', fontsize=12)
plt.title('Datos Simulados 2020-2025', fontsize=14, fontweight='bold')
plt.grid(axis='y', alpha=0.3, linestyle='--')
plt.tight_layout()
plt.show()
\`\`\`

Para gráfica de líneas:
\`\`\`python
import matplotlib.pyplot as plt
plt.figure(figsize=(10, 6))
plt.plot(years, values, marker='o', linewidth=2, markersize=8)
plt.xlabel('Año')
plt.ylabel('Valor')
plt.title('Tendencia')
plt.grid(True, alpha=0.3)
plt.show()
\`\`\`

Para gráfica circular (pie):
\`\`\`python
import matplotlib.pyplot as plt
labels = ['A', 'B', 'C', 'D']
sizes = [30, 25, 25, 20]
plt.figure(figsize=(8, 8))
plt.pie(sizes, labels=labels, autopct='%1.1f%%', startangle=90)
plt.title('Distribución')
plt.show()
\`\`\`

RESPONDE AHORA CON UN BLOQUE \`\`\`python QUE CREE LA GRÁFICA SOLICITADA.
` : '';

  const documentCapabilitiesPrompt = wantsDocument ? `
CAPACIDADES DE GENERACIÓN DE DOCUMENTOS:
Puedes crear documentos Word, Excel y PowerPoint. Incluye en tu respuesta un bloque especial con el formato:

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

El usuario podrá descargar el documento generado directamente.` : `
IMPORTANTE: Cuando el usuario pida un resumen, análisis o información, responde directamente en texto plano en el chat. 
NO generes documentos Word/Excel/PPT a menos que el usuario lo pida EXPLÍCITAMENTE con frases como "crea un documento", "genera un Word", "haz un PowerPoint", etc.
Si el usuario dice "dame un resumen" o "analiza esto", responde en texto, NO como documento.`;

  // Build user profile context if available
  const userProfileContext = userProfile && (userProfile.nickname || userProfile.occupation || userProfile.bio) 
    ? `\n\nInformación del usuario:${userProfile.nickname ? `\n- Nombre/Apodo: ${userProfile.nickname}` : ''}${userProfile.occupation ? `\n- Ocupación: ${userProfile.occupation}` : ''}${userProfile.bio ? `\n- Bio: ${userProfile.bio}` : ''}`
    : '';

  // Build custom instructions section if present
  const customInstructionsSection = customInstructions 
    ? `\n\nInstrucciones personalizadas del usuario:\n${customInstructions}`
    : '';

  // Build response style modifier based on user preference
  const responseStyleModifier = responseStyle !== 'default' 
    ? `\n\nEstilo de respuesta preferido: ${
        responseStyle === 'formal' ? 'formal y profesional' :
        responseStyle === 'casual' ? 'casual y amigable' :
        responseStyle === 'concise' ? 'muy conciso y breve' : ''
      }`
    : '';

  // Build company knowledge context if available
  const companyKnowledgeSection = companyKnowledge && companyKnowledge.length > 0
    ? `\n\n**CONOCIMIENTOS DE LA EMPRESA (usa esta información para responder):**\n${
        companyKnowledge.map(k => `### ${k.title} [${k.category}]\n${k.content}`).join('\n\n')
      }`
    : '';

  // Current date/time context for real-time awareness
  const now = new Date();
  const currentDateTimeContext = `\n\n**FECHA Y HORA ACTUAL:**
- Fecha: ${now.toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Lima' })}
- Hora (Perú/Lima): ${now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Lima' })}
- Hora UTC: ${now.toISOString()}
Usa esta información para responder preguntas sobre la hora, fecha o día actual.`;

  const defaultSystemContent = `Eres IliaGPT, un asistente de IA conciso y directo. Responde de forma breve y al punto. Evita introducciones largas y despedidas innecesarias. Ve directo a la respuesta sin rodeos.${currentDateTimeContext}${userProfileContext}${customInstructionsSection}${responseStyleModifier}${companyKnowledgeSection}
${codeInterpreterPrompt}${documentCapabilitiesPrompt}`;

  // Use document mode prompt when in document editing mode
  // Include attachment context for document-based Q&A
  // Combine persistent conversation documents with current attachments
  const fullDocumentContext = persistentDocumentContext + attachmentContext;
  const systemContent = documentModePrompt 
    ? documentModePrompt
    : (validatedGptConfig 
        ? `${validatedGptConfig.systemPrompt}\n\n${defaultSystemContent}${webSearchInfo}${contextInfo}${fullDocumentContext}`
        : `${defaultSystemContent}${webSearchInfo}${contextInfo}${fullDocumentContext}`);

  const systemMessage: ChatMessage = {
    role: "system",
    content: systemContent
  };

  const temperature = validatedGptConfig?.temperature ?? 0.7;
  const topP = validatedGptConfig?.topP ?? 1;

  // Handle Figma diagram generation mode
  if (figmaMode && lastUserMessage) {
    const diagramType = detectDiagramType(lastUserMessage.content);
    
    const flowchartPrompt = `Eres un generador de diagramas de flujo. Analiza la solicitud del usuario y genera un diagrama de flujo estructurado.

DEBES responder ÚNICAMENTE con un objeto JSON válido en el siguiente formato:
{
  "title": "Título del diagrama",
  "diagramType": "flowchart",
  "nodes": [
    { "id": "node1", "type": "start", "label": "Inicio", "x": 100, "y": 50 },
    { "id": "node2", "type": "process", "label": "Paso 1", "x": 100, "y": 150 },
    { "id": "node3", "type": "decision", "label": "¿Condición?", "x": 100, "y": 250 },
    { "id": "node4", "type": "process", "label": "Paso Sí", "x": 250, "y": 350 },
    { "id": "node5", "type": "process", "label": "Paso No", "x": -50, "y": 350 },
    { "id": "node6", "type": "end", "label": "Fin", "x": 100, "y": 450 }
  ],
  "connections": [
    { "from": "node1", "to": "node2" },
    { "from": "node2", "to": "node3" },
    { "from": "node3", "to": "node4", "label": "Sí" },
    { "from": "node3", "to": "node5", "label": "No" },
    { "from": "node4", "to": "node6" },
    { "from": "node5", "to": "node6" }
  ]
}

TIPOS DE NODOS:
- "start": Nodo de inicio (óvalo)
- "end": Nodo de fin (óvalo)  
- "process": Proceso o acción (rectángulo)
- "decision": Decisión/bifurcación (rombo)

REGLAS:
1. Cada diagrama DEBE tener exactamente UN nodo "start" y al menos UN nodo "end"
2. Los labels deben ser concisos (máximo 4 palabras)
3. SOLO responde con el JSON, sin explicaciones`;

    const orgchartPrompt = `Eres un generador de organigramas empresariales. Analiza la solicitud del usuario y genera una estructura jerárquica.

DEBES responder ÚNICAMENTE con un objeto JSON válido en el siguiente formato:
{
  "title": "Organigrama de la Empresa",
  "diagramType": "orgchart",
  "nodes": [
    { "id": "ceo", "type": "role", "label": "Director General", "x": 0, "y": 0 },
    { "id": "cfo", "type": "role", "label": "Director Financiero", "x": 0, "y": 0 },
    { "id": "coo", "type": "role", "label": "Director Operaciones", "x": 0, "y": 0 },
    { "id": "team1", "type": "department", "label": "Equipo Finanzas", "x": 0, "y": 0 },
    { "id": "team2", "type": "department", "label": "Equipo Operaciones", "x": 0, "y": 0 }
  ],
  "connections": [
    { "from": "ceo", "to": "cfo" },
    { "from": "ceo", "to": "coo" },
    { "from": "cfo", "to": "team1" },
    { "from": "coo", "to": "team2" }
  ]
}

TIPOS DE NODOS:
- "role": Cargo o posición (Director, Gerente, Jefe)
- "department": Departamento o área (Finanzas, Ventas, RRHH)
- "person": Persona específica con nombre

REGLAS OBLIGATORIAS:
1. NUNCA uses nodos "start", "end", "Inicio" o "Fin" - esto es un organigrama, NO un diagrama de flujo
2. Debe haber exactamente UN nodo raíz (CEO/Director General) sin padre
3. La estructura debe ser jerárquica (árbol), sin ciclos
4. Labels deben ser cargos o departamentos reales en español
5. Las posiciones x,y serán recalculadas automáticamente, ponlas en 0
6. SOLO responde con el JSON, sin explicaciones
7. NO inventes palabras, usa vocabulario empresarial estándar`;

    const figmaSystemPrompt = diagramType === "orgchart" ? orgchartPrompt : flowchartPrompt;

    try {
      const figmaResponse = await llmGateway.chat(
        [
          { role: "system", content: figmaSystemPrompt },
          { role: "user", content: lastUserMessage.content }
        ],
        {
          model: MODELS.TEXT,
          temperature: 0.2,
          topP: 1,
          userId: conversationId,
          requestId: `figma_${Date.now()}`,
        }
      );

      // Parse the JSON response
      let figmaDiagram: FigmaDiagram | undefined;
      try {
        const jsonMatch = figmaResponse.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          figmaDiagram = {
            diagramType: parsed.diagramType || diagramType,
            title: parsed.title || "Diagrama",
            nodes: parsed.nodes || [],
            connections: parsed.connections || []
          };
          
          // Apply tree layout for org charts
          if (figmaDiagram.diagramType === "orgchart") {
            const validOrgTypes = ["role", "department", "person"];
            const invalidLabels = ["inicio", "fin", "start", "end", "aleta"];
            
            // Filter out invalid nodes
            const validNodeIds = new Set<string>();
            figmaDiagram.nodes = figmaDiagram.nodes.filter(node => {
              const isValidType = validOrgTypes.includes(node.type);
              const isValidLabel = !invalidLabels.includes(node.label.toLowerCase());
              if (isValidType && isValidLabel) {
                validNodeIds.add(node.id);
                return true;
              }
              console.warn(`Filtering out invalid org chart node: ${node.id} (type: ${node.type}, label: ${node.label})`);
              return false;
            });
            
            // Filter connections to only reference valid nodes
            figmaDiagram.connections = figmaDiagram.connections.filter(conn => 
              validNodeIds.has(conn.from) && validNodeIds.has(conn.to)
            );
            
            // Validate the cleaned diagram - reject if still invalid
            const validation = validateOrgChart(figmaDiagram);
            if (!validation.valid) {
              console.warn("Org chart validation errors after filtering:", validation.errors);
              // Reject the diagram entirely if structural issues remain
              figmaDiagram = undefined;
            } else {
              figmaDiagram = applyTreeLayout(figmaDiagram);
            }
          }
        }
      } catch (parseError) {
        console.error("Failed to parse Figma diagram JSON:", parseError);
      }

      if (figmaDiagram && figmaDiagram.nodes.length > 0) {
        const typeLabel = diagramType === "orgchart" ? "organigrama" : "diagrama";
        return {
          content: `Ha creado el ${typeLabel} "${figmaDiagram.title}". Puedes verlo abajo y editarlo en Figma.`,
          role: "assistant",
          figmaDiagram
        };
      } else {
        return {
          content: "No pude generar el diagrama. Por favor, describe la estructura que quieres visualizar con más detalle.",
          role: "assistant"
        };
      }
    } catch (error) {
      console.error("Figma diagram generation error:", error);
      return {
        content: "Hubo un error al generar el diagrama. Por favor, intenta de nuevo.",
        role: "assistant"
      };
    }
  }

  let response;
  
  if (provider === "gemini") {
    if (hasImages) {
      return {
        content: "Gemini actualmente no soporta análisis de imágenes en esta versión. Por favor, selecciona xAI Grok 2 Vision para analizar imágenes.",
        role: "assistant"
      };
    }
    

    const geminiMessages: GeminiChatMessage[] = [];
    
    if (systemMessage.content) {
      geminiMessages.push({
        role: "user",
        parts: [{ text: `[System Instructions]\n${systemMessage.content}\n\n[End System Instructions]` }]
      });
      geminiMessages.push({
        role: "model",
        parts: [{ text: "Entendido. Seguiré estas instrucciones." }]
      });
    }
    
    for (const msg of messages) {
      geminiMessages.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }]
      });
    }
    
    const geminiModel = (model as typeof GEMINI_MODELS[keyof typeof GEMINI_MODELS]) || GEMINI_MODELS.FLASH;
    
    const geminiResponse = await geminiChat(geminiMessages, {
      model: geminiModel,
      temperature,
      topP,
    });
    
    console.log(`[ChatService] Gemini response: model=${geminiResponse.model}`);
    
    return { 
      content: geminiResponse.content,
      role: "assistant"
    };
  } else if (hasImages) {
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
    
    const content = response.choices[0]?.message?.content || "No response generated";
    
    return { 
      content,
      role: "assistant"
    };
  } else {
    const gatewayResponse = await llmGateway.chat(
      [systemMessage, ...messages],
      {
        model: model || MODELS.TEXT,
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
}
