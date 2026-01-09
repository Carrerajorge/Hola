import { Router } from "express";
import { storage } from "../storage";
import { handleChatRequest, AVAILABLE_MODELS, DEFAULT_PROVIDER, DEFAULT_MODEL } from "../services/chatService";
import { llmGateway } from "../lib/llmGateway";
import { generateImage, detectImageRequest, extractImagePrompt } from "../services/imageGeneration";
import { runETLAgent, getAvailableCountries, getAvailableIndicators } from "../etl";
import { extractAllAttachmentsContent, extractAttachmentContent, formatAttachmentsAsContext, type Attachment } from "../services/attachmentService";
import { pareOrchestrator, type RobustRouteResult, type SimpleAttachment } from "../services/pare";
import { DocumentBatchProcessor, type BatchProcessingResult, type SimpleAttachment as BatchAttachment } from "../services/documentBatchProcessor";

type ErrorCategory = 'network' | 'rate_limit' | 'api_error' | 'validation' | 'auth' | 'timeout' | 'unknown';

interface CategorizedError {
  category: ErrorCategory;
  userMessage: string;
  technicalDetails: string;
  requestId: string;
  retryable: boolean;
  statusCode: number;
}

function categorizeError(error: any, requestId: string): CategorizedError {
  const errorMessage = error?.message?.toLowerCase() || '';
  const errorCode = error?.code || error?.statusCode;
  
  if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests') || errorCode === 429) {
    return {
      category: 'rate_limit',
      userMessage: 'Has excedido el límite de solicitudes. Por favor espera unos segundos e intenta de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 429
    };
  }
  
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out') || errorCode === 'ETIMEDOUT') {
    return {
      category: 'timeout',
      userMessage: 'La solicitud tardó demasiado tiempo. Por favor intenta de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 504
    };
  }
  
  if (errorMessage.includes('network') || errorMessage.includes('econnrefused') || 
      errorMessage.includes('enotfound') || errorCode === 'ECONNREFUSED') {
    return {
      category: 'network',
      userMessage: 'Error de conexión. Verifica tu conexión a internet e intenta de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 503
    };
  }
  
  if (errorMessage.includes('unauthorized') || errorMessage.includes('authentication') || 
      errorCode === 401 || errorCode === 403) {
    return {
      category: 'auth',
      userMessage: 'Error de autenticación. Por favor inicia sesión de nuevo.',
      technicalDetails: error.message,
      requestId,
      retryable: false,
      statusCode: 401
    };
  }
  
  if (errorMessage.includes('invalid') || errorMessage.includes('validation') || errorCode === 400) {
    return {
      category: 'validation',
      userMessage: 'Los datos enviados no son válidos. Por favor verifica tu solicitud.',
      technicalDetails: error.message,
      requestId,
      retryable: false,
      statusCode: 400
    };
  }
  
  if (error?.response?.status >= 500 || errorMessage.includes('internal') || errorMessage.includes('server error')) {
    return {
      category: 'api_error',
      userMessage: 'El servicio de IA está experimentando problemas. Por favor intenta de nuevo en unos minutos.',
      technicalDetails: error.message,
      requestId,
      retryable: true,
      statusCode: 502
    };
  }
  
  return {
    category: 'unknown',
    userMessage: 'Ocurrió un error inesperado. Por favor intenta de nuevo.',
    technicalDetails: error.message || 'Unknown error',
    requestId,
    retryable: true,
    statusCode: 500
  };
}

export function createChatAiRouter(broadcastAgentUpdate: (runId: string, update: any) => void) {
  const router = Router();

  router.get("/models", (req, res) => {
    res.json(AVAILABLE_MODELS);
  });

  router.post("/chat", async (req, res) => {
    try {
      const { messages, useRag = true, conversationId, images, gptConfig, documentMode, figmaMode, provider = DEFAULT_PROVIDER, model = DEFAULT_MODEL, attachments } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const user = (req as any).user;
      const userId = user?.claims?.sub;

      let attachmentContext = "";
      const hasAttachments = attachments && Array.isArray(attachments) && attachments.length > 0;
      
      if (hasAttachments) {
        console.log(`[Chat API] Processing ${attachments.length} attachment(s)`);
        try {
          const extractedContents: { extracted: Awaited<ReturnType<typeof extractAttachmentContent>>; attachment: Attachment }[] = [];
          for (const attachment of attachments as Attachment[]) {
            const extracted = await extractAttachmentContent(attachment);
            extractedContents.push({ extracted, attachment });
          }
          
          const successfulExtractions = extractedContents.filter(e => e.extracted !== null).map(e => e.extracted!);
          if (successfulExtractions.length > 0) {
            attachmentContext = formatAttachmentsAsContext(successfulExtractions);
            console.log(`[Chat API] Extracted content from ${successfulExtractions.length} attachment(s), context length: ${attachmentContext.length}`);
          }
          
          if (conversationId) {
            for (const { extracted, attachment } of extractedContents) {
              if (extracted) {
                try {
                  await storage.createConversationDocument({
                    chatId: conversationId,
                    fileName: extracted.fileName,
                    storagePath: attachment.storagePath || null,
                    mimeType: extracted.mimeType || "application/octet-stream",
                    extractedText: extracted.content,
                    metadata: { fileId: attachment.fileId }
                  });
                  console.log(`[Chat API] Persisted document: ${extracted.fileName} to conversation ${conversationId}`);
                } catch (persistError) {
                  console.error(`[Chat API] Error persisting document ${extracted.fileName}:`, persistError);
                }
              }
            }
          }
        } catch (attachmentError) {
          console.error("[Chat API] Error extracting attachment content:", attachmentError);
        }
      }

      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      const response = await handleChatRequest(formattedMessages, {
        useRag,
        conversationId,
        userId,
        images,
        gptConfig,
        documentMode,
        figmaMode,
        provider,
        model,
        attachmentContext,
        forceDirectResponse: hasAttachments && attachmentContext.length > 0,
        hasRawAttachments: hasAttachments,
        onAgentProgress: (update) => broadcastAgentUpdate(update.runId, update)
      });
      
      if (userId) {
        try {
          await storage.createAuditLog({
            userId,
            action: "chat_query",
            resource: "chats",
            resourceId: conversationId || null,
            details: { 
              messageCount: messages.length,
              useRag,
              documentMode: documentMode || false,
              hasImages: !!images && images.length > 0
            }
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
      }
      
      res.json(response);
    } catch (error: any) {
      const requestId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.error(`[Chat API Error] requestId=${requestId}:`, error);
      
      const categorized = categorizeError(error, requestId);
      res.status(categorized.statusCode).json({ 
        error: categorized.userMessage,
        category: categorized.category,
        details: categorized.technicalDetails,
        requestId: categorized.requestId,
        retryable: categorized.retryable
      });
    }
  });

  router.post("/voice-chat", async (req, res) => {
    try {
      const { message } = req.body;
      
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      console.log("[VoiceChat] Processing voice input:", message);
      
      const result = await llmGateway.chat([
        {
          role: "system",
          content: `Eres Sira, un asistente de voz amigable y conversacional. 
Responde de manera natural y concisa, como si estuvieras hablando directamente con el usuario.
Mantén las respuestas cortas (2-3 oraciones máximo) para que sean fáciles de escuchar.
Usa un tono cálido y conversacional en español.
No uses markdown, emojis ni formatos especiales ya que tu respuesta será leída en voz alta.`
        },
        {
          role: "user",
          content: message
        }
      ], {
        model: "grok-3-fast",
        temperature: 0.7,
        maxTokens: 150,
      });
      
      res.json({ 
        success: true,
        response: result.content,
        latencyMs: result.latencyMs
      });
    } catch (error: any) {
      console.error("Voice chat error:", error);
      res.status(500).json({ 
        error: "Failed to process voice message",
        details: error.message 
      });
    }
  });

  router.post("/image/generate", async (req, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log("[ImageGen] Generating image for prompt:", prompt);
      
      const result = await generateImage(prompt);
      
      res.json({
        success: true,
        imageData: `data:${result.mimeType};base64,${result.imageBase64}`,
        prompt: result.prompt
      });
    } catch (error: any) {
      console.error("Image generation error:", error);
      res.status(500).json({ 
        error: "Failed to generate image",
        details: error.message 
      });
    }
  });

  router.post("/image/detect", (req, res) => {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }
    
    const isImageRequest = detectImageRequest(message);
    const extractedPrompt = isImageRequest ? extractImagePrompt(message) : null;
    
    res.json({ isImageRequest, extractedPrompt });
  });

  router.get("/etl/config", async (req, res) => {
    try {
      res.json({
        countries: getAvailableCountries(),
        indicators: getAvailableIndicators()
      });
    } catch (error: any) {
      console.error("ETL config error:", error);
      res.status(500).json({ error: "Failed to get ETL config" });
    }
  });

  router.post("/etl/run", async (req, res) => {
    try {
      const { countries, indicators, startDate, endDate } = req.body;
      
      if (!countries || !Array.isArray(countries) || countries.length === 0) {
        return res.status(400).json({ error: "Countries array is required" });
      }

      console.log("[ETL API] Starting ETL for countries:", countries);

      const result = await runETLAgent({
        countries,
        indicators,
        startDate,
        endDate
      });

      if (result.success && result.workbookBuffer) {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.workbookBuffer);
      } else {
        res.status(result.success ? 200 : 500).json({
          success: result.success,
          message: result.message,
          summary: result.summary,
          errors: result.errors
        });
      }
    } catch (error: any) {
      console.error("ETL API error:", error);
      res.status(500).json({ 
        error: "ETL pipeline failed",
        details: error.message 
      });
    }
  });

  // Get run status - for polling
  router.get("/chat/runs/:runId", async (req, res) => {
    try {
      const run = await storage.getChatRun(req.params.runId);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/chat/stream", async (req, res) => {
    const requestId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let isConnectionClosed = false;
    let claimedRun: any = null;

    try {
      const { messages, conversationId, runId, chatId, attachments } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const user = (req as any).user;
      const userId = user?.claims?.sub;

      // Get the last user message for PARE routing
      const lastUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
      const userMessageText = lastUserMessage?.content || '';

      // Resolve storagePaths for all attachments first (before PARE routing)
      // This ensures PARE has valid paths for routing decisions
      const resolvedAttachments: any[] = [];
      if (attachments && Array.isArray(attachments)) {
        for (const att of attachments) {
          const resolved = { ...att };
          if (!resolved.storagePath && resolved.fileId) {
            const fileRecord = await storage.getFile(resolved.fileId);
            if (fileRecord && fileRecord.storagePath) {
              resolved.storagePath = fileRecord.storagePath;
              console.log(`[Stream] Pre-resolved storagePath for ${resolved.name}: ${resolved.storagePath}`);
            }
          }
          resolvedAttachments.push(resolved);
        }
      }

      // Convert attachments to PARE format using resolved paths
      const pareAttachments: SimpleAttachment[] = resolvedAttachments.map((att: any) => ({
        name: att.name,
        type: att.type || att.mimeType,
        path: att.storagePath || '',
      }));

      // Use PARE for intelligent routing when attachments are present
      let routeDecision: RobustRouteResult | null = null;
      if (pareOrchestrator.isEnabled() && userMessageText) {
        try {
          routeDecision = pareOrchestrator.robustRoute(userMessageText, pareAttachments);
          console.log(`[Stream] PARE routing: route=${routeDecision.route}, intent=${routeDecision.intent}, confidence=${routeDecision.confidence.toFixed(2)}, tools=${routeDecision.tools.slice(0, 3).join(',')}`);
        } catch (routeError) {
          console.error('[Stream] PARE routing error, falling back to chat:', routeError);
        }
      }

      // If runId provided, claim the pending run (idempotent processing)
      if (runId && chatId) {
        const existingRun = await storage.getChatRun(runId);
        if (!existingRun) {
          return res.status(404).json({ error: "Run not found" });
        }
        
        // If run is already processing or done, don't re-process
        if (existingRun.status === 'processing') {
          console.log(`[Run] Run ${runId} is already being processed, returning status`);
          return res.json({ status: 'already_processing', run: existingRun });
        }
        if (existingRun.status === 'done') {
          console.log(`[Run] Run ${runId} already completed`);
          return res.json({ status: 'already_done', run: existingRun });
        }
        if (existingRun.status === 'failed') {
          console.log(`[Run] Run ${runId} previously failed`);
          // Allow retry for failed runs by claiming again
        }
        
        // Atomically claim the pending run using clientRequestId for specificity
        claimedRun = await storage.claimPendingRun(chatId, existingRun.clientRequestId);
        if (!claimedRun || claimedRun.id !== runId) {
          console.log(`[Run] Failed to claim run ${runId} - may have been claimed by another request`);
          return res.json({ status: 'claim_failed', message: 'Run already claimed or not pending' });
        }
        console.log(`[Run] Successfully claimed run ${runId}`);
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Request-Id", requestId);
      if (claimedRun) {
        res.setHeader("X-Run-Id", claimedRun.id);
      }
      res.flushHeaders();

      req.on("close", () => {
        isConnectionClosed = true;
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
        console.log(`[SSE] Connection closed: ${requestId}`);
      });

      heartbeatInterval = setInterval(() => {
        if (!isConnectionClosed) {
          res.write(`:heartbeat\n\n`);
        }
      }, 15000);

      // Process attachments using DocumentBatchProcessor for atomic batch handling
      let attachmentContext = "";
      let batchResult: BatchProcessingResult | null = null;
      const hasAttachments = resolvedAttachments.length > 0;
      const attachmentsCount = hasAttachments ? resolvedAttachments.length : 0;
      
      // GUARD: Detect if user requests "analyze all" - requires full coverage
      const userMessage = messages[messages.length - 1]?.content || "";
      const requiresFullCoverage = /\b(todos|all|completo|complete|cada|every)\b/i.test(userMessage);
      
      if (hasAttachments) {
        console.log(`[Stream] Processing ${attachmentsCount} attachment(s) as atomic batch:`, 
          resolvedAttachments.map((a: any) => ({ 
            name: a.name, 
            type: a.type, 
            storagePath: a.storagePath,
            fileId: a.fileId
          }))
        );
        
        try {
          const batchProcessor = new DocumentBatchProcessor();
          
          // Convert resolved attachments to BatchAttachment format
          // storagePaths were already resolved earlier
          const batchAttachments: BatchAttachment[] = resolvedAttachments
            .filter((att: any) => att.storagePath || att.content)
            .map((att: any) => ({
              name: att.name || 'document',
              mimeType: att.mimeType || att.type || 'application/octet-stream',
              storagePath: att.storagePath || '',
              content: att.content
            }));
          
          batchResult = await batchProcessor.processBatch(batchAttachments);
          
          // Log observability metrics per file
          console.log(`[Stream] Batch processing complete:`, {
            attachmentsCount: batchResult.attachmentsCount,
            processedFiles: batchResult.processedFiles,
            failedFiles: batchResult.failedFiles.length,
            totalChunks: batchResult.chunks.length,
            totalTokens: batchResult.totalTokens
          });
          
          // Log per-file stats
          for (const stat of batchResult.stats) {
            console.log(`[Stream] File stats: ${stat.filename}`, {
              bytesRead: stat.bytesRead,
              pagesProcessed: stat.pagesProcessed,
              tokensExtracted: stat.tokensExtracted,
              parseTimeMs: stat.parseTimeMs,
              chunkCount: stat.chunkCount,
              status: stat.status
            });
          }
          
          // COVERAGE CHECK: If user asked to analyze "all" files, verify complete coverage
          if (requiresFullCoverage && batchResult.processedFiles !== batchResult.attachmentsCount) {
            const failedList = batchResult.failedFiles.map(f => `${f.filename}: ${f.error}`).join(', ');
            const errorMsg = `Coverage check failed: processed ${batchResult.processedFiles}/${batchResult.attachmentsCount} files. Failed: ${failedList}`;
            console.error(`[Stream] ${errorMsg}`);
            
            res.write(`event: error\ndata: ${JSON.stringify({
              type: 'coverage_failure',
              message: 'No se pudieron procesar todos los archivos solicitados',
              details: {
                requested: batchResult.attachmentsCount,
                processed: batchResult.processedFiles,
                failedFiles: batchResult.failedFiles
              },
              requestId,
              timestamp: Date.now()
            })}\n\n`);
            
            clearInterval(heartbeatInterval);
            return res.end();
          }
          
          // Use unified context from batch processor
          if (batchResult.unifiedContext) {
            attachmentContext = batchResult.unifiedContext;
            console.log(`[Stream] Unified context from ${batchResult.processedFiles} files, length: ${attachmentContext.length} chars`);
          }
          
        } catch (batchError: any) {
          console.error("[Stream] Batch processing error:", batchError);
          
          res.write(`event: error\ndata: ${JSON.stringify({
            type: 'batch_processing_error',
            message: 'Error al procesar los archivos adjuntos',
            details: batchError.message,
            requestId,
            timestamp: Date.now()
          })}\n\n`);
          
          clearInterval(heartbeatInterval);
          return res.end();
        }
      }

      const formattedMessages = messages.map((msg: { role: string; content: string }) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content
      }));

      // GUARD: Block image generation when attachments are present
      if (hasAttachments && attachmentsCount > 0) {
        console.log(`[Stream] GUARD: Image generation BLOCKED - ${attachmentsCount} attachments present`);
        // Ensure route decision does not include image generation
        if (routeDecision) {
          routeDecision.tools = routeDecision.tools.filter(t => !['generate_image', 'image_gen', 'dall_e'].includes(t));
          if (routeDecision.route === 'image_generation') {
            routeDecision.route = 'document_analysis';
            routeDecision.intent = 'analysis';
          }
        }
      }

      // Build system message with attachment awareness and citation instructions
      let systemContent = `Eres MICHAT, un asistente de IA avanzado. Responde de manera útil y profesional en el idioma del usuario.`;
      
      if (hasAttachments && attachmentContext && batchResult) {
        // Build citation format instructions based on document types
        const citationFormats = batchResult.stats
          .filter(s => s.status === 'success')
          .map(s => {
            const ext = s.filename.split('.').pop()?.toLowerCase();
            switch(ext) {
              case 'pdf': return `- ${s.filename}: [doc:${s.filename} p#]`;
              case 'xlsx': case 'xls': return `- ${s.filename}: [doc:${s.filename} sheet:NombreHoja cell:A1]`;
              case 'docx': case 'doc': return `- ${s.filename}: [doc:${s.filename} p#]`;
              case 'pptx': case 'ppt': return `- ${s.filename}: [doc:${s.filename} slide:#]`;
              case 'csv': return `- ${s.filename}: [doc:${s.filename} row:#]`;
              default: return `- ${s.filename}: [doc:${s.filename}]`;
            }
          })
          .join('\n');
        
        systemContent = `Eres un asistente experto en análisis de documentos. El usuario ha adjuntado ${batchResult.processedFiles} archivo(s) para análisis.

INSTRUCCIONES CRÍTICAS:
1. ANALIZA el contenido de TODOS los documentos adjuntos
2. NO generes imágenes, NO inventes información, NO uses datos ficticios
3. Responde basándote EXCLUSIVAMENTE en el contenido real de los documentos
4. Para cada hallazgo, SIEMPRE incluye la cita del documento fuente

FORMATO DE CITAS (OBLIGATORIO):
${citationFormats}

DOCUMENTOS PROCESADOS (${batchResult.processedFiles}/${batchResult.attachmentsCount}):
${batchResult.stats.map(s => `- ${s.filename}: ${s.status === 'success' ? `${s.tokensExtracted} tokens, ${s.pagesProcessed} páginas` : `ERROR: ${s.error}`}`).join('\n')}

CONTENIDO DE LOS DOCUMENTOS:
${attachmentContext}

${systemContent}`;
      }

      const systemMessage = {
        role: "system" as const,
        content: systemContent
      };

      // If we have a run, create an assistant message placeholder at the start
      let assistantMessageId: string | null = null;
      if (claimedRun && chatId) {
        const assistantMessage = await storage.createChatMessage({
          chatId,
          role: 'assistant',
          content: '', // Will be updated during streaming
          status: 'pending',
          runId: claimedRun.id,
          userMessageId: claimedRun.userMessageId,
        });
        assistantMessageId = assistantMessage.id;
        await storage.updateChatRunAssistantMessage(claimedRun.id, assistantMessageId);
      }

      res.write(`event: start\ndata: ${JSON.stringify({ 
        requestId, 
        runId: claimedRun?.id,
        assistantMessageId,
        timestamp: Date.now() 
      })}\n\n`);

      const streamGenerator = llmGateway.streamChat(
        [systemMessage, ...formattedMessages],
        {
          userId: userId || conversationId || "anonymous",
          requestId,
          disableImageGeneration: hasAttachments,
        }
      );

      let fullContent = "";
      let lastAckSequence = -1;

      for await (const chunk of streamGenerator) {
        if (isConnectionClosed) break;

        fullContent += chunk.content;
        lastAckSequence = chunk.sequenceId;

        // Update run's lastSeq for deduplication on reconnect
        if (claimedRun && chunk.sequenceId > (claimedRun.lastSeq || 0)) {
          await storage.updateChatRunLastSeq(claimedRun.id, chunk.sequenceId);
        }

        if (chunk.done) {
          res.write(`event: done\ndata: ${JSON.stringify({
            sequenceId: chunk.sequenceId,
            requestId: chunk.requestId,
            runId: claimedRun?.id,
            timestamp: Date.now(),
          })}\n\n`);
        } else {
          res.write(`event: chunk\ndata: ${JSON.stringify({
            content: chunk.content,
            sequenceId: chunk.sequenceId,
            requestId: chunk.requestId,
            runId: claimedRun?.id,
            timestamp: Date.now(),
          })}\n\n`);
        }
      }

      // Update assistant message with full content and mark run as done
      if (claimedRun && assistantMessageId) {
        await storage.updateChatMessageContent(assistantMessageId, fullContent, 'done');
        await storage.updateChatRunStatus(claimedRun.id, 'done');
      }

      if (!isConnectionClosed) {
        res.write(`event: complete\ndata: ${JSON.stringify({ 
          requestId, 
          runId: claimedRun?.id,
          assistantMessageId,
          totalSequences: lastAckSequence + 1,
          contentLength: fullContent.length,
          timestamp: Date.now() 
        })}\n\n`);
      }

      if (userId) {
        try {
          await storage.createAuditLog({
            userId,
            action: "chat_stream",
            resource: "chats",
            resourceId: conversationId || null,
            details: { 
              messageCount: messages.length,
              requestId,
              runId: claimedRun?.id,
              streaming: true
            }
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }
      }

    } catch (error: any) {
      console.error(`[SSE] Stream error ${requestId}:`, error);
      
      // Mark run as failed if we claimed one
      if (claimedRun) {
        try {
          await storage.updateChatRunStatus(claimedRun.id, 'failed', error.message);
        } catch (updateError) {
          console.error(`[SSE] Failed to update run status:`, updateError);
        }
      }
      
      if (!isConnectionClosed) {
        try {
          res.write(`event: error\ndata: ${JSON.stringify({ 
            error: error.message, 
            requestId,
            runId: claimedRun?.id,
            timestamp: Date.now() 
          })}\n\n`);
        } catch (writeError) {
          console.error(`[SSE] Failed to write error event:`, writeError);
        }
      }
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      if (!isConnectionClosed) {
        res.end();
      }
    }
  });

  return router;
}
