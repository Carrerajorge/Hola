import { Response } from "express";
import { randomUUID } from "crypto";
import { agentEventBus } from "./eventBus";
import { createRequestSpec, detectIntent, AttachmentSpecSchema, SessionStateSchema, RequestSpecSchema } from "./requestSpec";
import type { z } from "zod";

type RequestSpec = z.infer<typeof RequestSpecSchema>;
type AttachmentSpec = z.infer<typeof AttachmentSpecSchema>;
type SessionState = z.infer<typeof SessionStateSchema>;
import { storage } from "../storage";
import { db } from "../db";
import { agentModeRuns, agentModeSteps } from "@shared/schema";
import { llmGateway } from "../lib/llmGateway";
import type { TraceEventType } from "@shared/schema";

export interface UnifiedChatRequest {
  messages: Array<{ role: string; content: string }>;
  chatId: string;
  userId: string;
  runId?: string;
  messageId?: string;
  attachments?: AttachmentSpec[];
  sessionState?: SessionState;
}

export interface UnifiedChatContext {
  requestSpec: RequestSpec;
  runId: string;
  startTime: number;
  isAgenticMode: boolean;
}

function writeSse(res: Response, event: string, data: object): boolean {
  try {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    res.write(chunk);
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
    return true;
  } catch (err) {
    console.error('[UnifiedChat] SSE write failed:', err);
    return false;
  }
}

export async function hydrateSessionState(chatId: string, userId: string): Promise<SessionState | undefined> {
  try {
    const recentMessages = await storage.getChatMessages(chatId, { limit: 10 });
    
    if (recentMessages.length === 0) {
      return undefined;
    }
    
    const previousIntents = recentMessages
      .filter(m => m.role === 'user')
      .slice(0, 5)
      .map(m => detectIntent(m.content).intent);
    
    return {
      conversationId: chatId,
      turnNumber: recentMessages.length,
      previousIntents,
      previousDeliverables: [],
      workingContext: {},
      memoryKeys: [],
      lastUpdated: new Date()
    };
  } catch (error) {
    console.error('[UnifiedChat] Failed to hydrate session state:', error);
    return undefined;
  }
}

export async function createUnifiedRun(
  request: UnifiedChatRequest
): Promise<UnifiedChatContext> {
  const startTime = Date.now();
  
  const sessionState = request.sessionState || 
    await hydrateSessionState(request.chatId, request.userId);
  
  const lastUserMessage = [...request.messages]
    .reverse()
    .find(m => m.role === 'user')?.content || '';
  
  const requestSpec = createRequestSpec({
    chatId: request.chatId,
    messageId: request.messageId,
    userId: request.userId,
    rawMessage: lastUserMessage,
    attachments: request.attachments,
    sessionState,
  });
  
  const runId = request.runId || randomUUID();
  
  const isAgenticMode = 
    requestSpec.intent !== 'chat' ||
    requestSpec.intentConfidence > 0.7 ||
    (request.attachments && request.attachments.length > 0);
  
  try {
    await db.insert(agentModeRuns).values({
      id: runId,
      chatId: request.chatId,
      messageId: request.messageId,
      userId: request.userId,
      status: 'planning',
      idempotencyKey: requestSpec.id,
    }).onConflictDoNothing();
  } catch (error) {
    console.error('[UnifiedChat] Failed to persist run:', error);
  }
  
  console.log(`[UnifiedChat] Created run ${runId} - intent: ${requestSpec.intent}, agentic: ${isAgenticMode}`);
  
  return {
    requestSpec,
    runId,
    startTime,
    isAgenticMode
  };
}

export async function emitTraceEvent(
  runId: string,
  eventType: TraceEventType,
  data: Record<string, any> = {}
): Promise<void> {
  try {
    await agentEventBus.emit(runId, eventType, data);
  } catch (error) {
    console.error(`[UnifiedChat] Failed to emit ${eventType}:`, error);
  }
}

export async function executeUnifiedChat(
  context: UnifiedChatContext,
  request: UnifiedChatRequest,
  res: Response,
  options: {
    onChunk?: (chunk: string) => void;
    disableImageGeneration?: boolean;
    systemPrompt?: string;
  } = {}
): Promise<void> {
  const { requestSpec, runId, isAgenticMode } = context;
  
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("X-Run-Id", runId);
  res.setHeader("X-Intent", requestSpec.intent);
  res.setHeader("X-Agentic-Mode", String(isAgenticMode));
  res.flushHeaders();
  
  await emitTraceEvent(runId, 'task_start', {
    metadata: {
      intent: requestSpec.intent,
      intentConfidence: requestSpec.intentConfidence,
      deliverableType: requestSpec.deliverableType,
      targetAgents: requestSpec.targetAgents,
      attachmentsCount: requestSpec.attachments.length,
      isAgenticMode
    }
  });
  
  if (requestSpec.sessionState) {
    await emitTraceEvent(runId, 'memory_loaded', {
      memory: {
        keys: requestSpec.sessionState.memoryKeys,
        loaded: requestSpec.sessionState.turnNumber
      }
    });
  }
  
  writeSse(res, 'start', {
    runId,
    intent: requestSpec.intent,
    deliverableType: requestSpec.deliverableType,
    isAgenticMode,
    timestamp: Date.now()
  });
  
  if (isAgenticMode) {
    await emitTraceEvent(runId, 'thinking', {
      content: `Analyzing request: ${requestSpec.intent}`,
      phase: 'planning'
    });
    
    await emitTraceEvent(runId, 'agent_delegated', {
      agent: {
        name: requestSpec.primaryAgent,
        role: 'primary',
        status: 'active'
      }
    });
  }
  
  try {
    const systemContent = options.systemPrompt || buildSystemPrompt(requestSpec);
    
    const formattedMessages = [
      { role: "system" as const, content: systemContent },
      ...request.messages.map(m => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content
      }))
    ];
    
    let fullResponse = '';
    let chunkCount = 0;
    
    const streamGenerator = llmGateway.streamChat(formattedMessages, {
      userId: request.userId,
      requestId: runId,
      disableImageGeneration: options.disableImageGeneration,
    });
    
    for await (const chunk of streamGenerator) {
      if (chunk.type === 'delta' && chunk.content) {
        fullResponse += chunk.content;
        chunkCount++;
        
        writeSse(res, 'chunk', {
          content: chunk.content,
          sequence: chunkCount,
          runId
        });
        
        if (options.onChunk) {
          options.onChunk(chunk.content);
        }
        
        if (chunkCount % 50 === 0) {
          await emitTraceEvent(runId, 'progress_update', {
            progress: {
              current: chunkCount,
              total: 0,
              message: 'Generating response...'
            }
          });
        }
      } else if (chunk.type === 'done') {
        break;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error || 'Stream error');
      }
    }
    
    const durationMs = Date.now() - context.startTime;
    
    if (isAgenticMode) {
      await emitTraceEvent(runId, 'agent_completed', {
        agent: {
          name: requestSpec.primaryAgent,
          role: 'primary',
          status: 'completed'
        },
        durationMs
      });
    }
    
    await emitTraceEvent(runId, 'done', {
      summary: fullResponse.slice(0, 200),
      durationMs,
      phase: 'completed'
    });
    
    writeSse(res, 'done', {
      runId,
      totalChunks: chunkCount,
      durationMs,
      intent: requestSpec.intent,
      timestamp: Date.now()
    });
    
    try {
      await db.update(agentModeRuns)
        .set({ status: 'completed' })
        .where(require('drizzle-orm').eq(agentModeRuns.id, runId));
    } catch (dbError) {
      console.error('[UnifiedChat] Failed to update run status:', dbError);
    }
    
  } catch (error: any) {
    console.error(`[UnifiedChat] Execution error:`, error);
    
    await emitTraceEvent(runId, 'error', {
      error: {
        code: 'EXECUTION_ERROR',
        message: error.message,
        retryable: true
      }
    });
    
    writeSse(res, 'error', {
      runId,
      message: error.message,
      code: 'EXECUTION_ERROR',
      timestamp: Date.now()
    });
    
    try {
      await db.update(agentModeRuns)
        .set({ status: 'failed' })
        .where(require('drizzle-orm').eq(agentModeRuns.id, runId));
    } catch (dbError) {
      console.error('[UnifiedChat] Failed to update run status:', dbError);
    }
  }
  
  res.end();
}

function buildSystemPrompt(requestSpec: RequestSpec): string {
  let prompt = `Eres un asistente de IA avanzado. `;
  
  switch (requestSpec.intent) {
    case 'research':
      prompt += `Tu tarea es investigar y proporcionar información precisa y bien fundamentada. Incluye fuentes cuando sea posible.`;
      break;
    case 'document_analysis':
      prompt += `Analiza los documentos adjuntos de forma exhaustiva. Extrae información clave, identifica patrones y proporciona insights.`;
      break;
    case 'document_generation':
      prompt += `Genera documentos profesionales y bien estructurados según las instrucciones del usuario.`;
      break;
    case 'data_analysis':
      prompt += `Analiza datos de forma rigurosa. Proporciona estadísticas, tendencias y visualizaciones cuando sea apropiado.`;
      break;
    case 'code_generation':
      prompt += `Escribe código limpio, eficiente y bien documentado. Sigue las mejores prácticas del lenguaje.`;
      break;
    case 'presentation_creation':
      prompt += `Crea presentaciones profesionales con estructura clara, puntos clave concisos y diseño visual atractivo.`;
      break;
    case 'spreadsheet_creation':
      prompt += `Crea hojas de cálculo bien organizadas con fórmulas apropiadas y formato profesional.`;
      break;
    default:
      prompt += `Responde de manera útil y profesional en el idioma del usuario.`;
  }
  
  if (requestSpec.attachments.length > 0) {
    prompt += `\n\nEl usuario ha proporcionado ${requestSpec.attachments.length} archivo(s). Analiza su contenido cuidadosamente.`;
  }
  
  if (requestSpec.sessionState && requestSpec.sessionState.turnNumber > 1) {
    prompt += `\n\nEsta es una conversación en curso (turno ${requestSpec.sessionState.turnNumber}). Mantén coherencia con el contexto previo.`;
  }
  
  return prompt;
}

export { RequestSpec, AttachmentSpec, SessionState };
