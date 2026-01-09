import { Router } from "express";
import { storage } from "../storage";
import { handleChatRequest, AVAILABLE_MODELS, DEFAULT_PROVIDER, DEFAULT_MODEL } from "../services/chatService";
import { llmGateway } from "../lib/llmGateway";
import { generateImage, detectImageRequest, extractImagePrompt } from "../services/imageGeneration";
import { runETLAgent, getAvailableCountries, getAvailableIndicators } from "../etl";
import { extractAllAttachmentsContent, extractAttachmentContent, formatAttachmentsAsContext, type Attachment } from "../services/attachmentService";
import { pareOrchestrator, type RobustRouteResult, type SimpleAttachment } from "../services/pare";
import { DocumentBatchProcessor, type BatchProcessingResult, type SimpleAttachment as BatchAttachment } from "../services/documentBatchProcessor";
import { pareRequestContract, pareRateLimiter, pareQuotaGuard, requirePareContext } from "../middleware";

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

  // Helper function to detect if a file is a document (not an image)
  // Uses mimeType AND file extension for reliable detection
  const isDocumentAttachment = (mimeType: string, fileName: string, type?: string): boolean => {
    const lowerMime = (mimeType || "").toLowerCase();
    const lowerName = (fileName || "").toLowerCase();
    const lowerType = (type || "").toLowerCase();
    
    // Check for explicit image type/MIME first
    if (lowerType === "image" || lowerMime.startsWith("image/")) return false;
    
    // Document MIME patterns
    const docMimePatterns = [
      "pdf", "word", "document", "sheet", "excel", 
      "spreadsheet", "presentation", "powerpoint", "csv",
      "text/plain", "text/csv", "application/json"
    ];
    if (docMimePatterns.some(p => lowerMime.includes(p))) return true;
    
    // Document file extensions
    const docExtensions = [
      ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
      ".csv", ".txt", ".json", ".rtf", ".odt", ".ods", ".odp"
    ];
    if (docExtensions.some(ext => lowerName.endsWith(ext))) return true;
    
    // If type is explicitly a document type
    if (["pdf", "word", "excel", "ppt", "document"].includes(lowerType)) return true;
    
    // If mimeType is empty/unknown, check extension before treating as document
    if (!lowerMime || lowerMime === "application/octet-stream") {
      const hasImageExt = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"].some(ext => lowerName.endsWith(ext));
      return !hasImageExt; // If not an image extension, treat as document
    }
    
    return false;
  };

  router.post("/chat", async (req, res) => {
    try {
      const { messages, useRag = true, conversationId, images, gptConfig, documentMode, figmaMode, provider = DEFAULT_PROVIDER, model = DEFAULT_MODEL, attachments } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages array is required" });
      }

      const user = (req as any).user;
      const userId = user?.claims?.sub;

      // DATA_MODE ENFORCEMENT: Reject document attachments - must use /analyze endpoint
      const hasDocumentAttachments = attachments && Array.isArray(attachments) && 
        attachments.some((a: any) => isDocumentAttachment(a.mimeType || a.type, a.name, a.type));
      
      if (hasDocumentAttachments) {
        console.log(`[Chat API] DATA_MODE: Rejecting document attachments - must use /analyze endpoint`);
        return res.status(400).json({ 
          error: "Document attachments must be processed via /api/analyze endpoint for proper analysis",
          code: "USE_ANALYZE_ENDPOINT"
        });
      }

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

      // DATA_MODE ENFORCEMENT: Reject document attachments - must use /analyze endpoint
      const hasDocumentAttachments = attachments && Array.isArray(attachments) && 
        attachments.some((a: any) => isDocumentAttachment(a.mimeType || a.type, a.name, a.type));
      
      if (hasDocumentAttachments) {
        console.log(`[Stream API] DATA_MODE: Rejecting document attachments - must use /analyze endpoint`);
        return res.status(400).json({ 
          error: "Document attachments must be processed via /api/analyze endpoint for proper analysis",
          code: "USE_ANALYZE_ENDPOINT"
        });
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

  // ============================================================================================
  // UNIVERSAL DOCUMENT ANALYZER - POST /analyze
  // DATA_MODE enforced: NO image generation, NO artifact creation, NO web search
  // Only deterministic text extraction and LLM analysis with per-document citations
  // PARE Phase 1: Request contract, rate limiting, and quota guard middlewares applied
  // ============================================================================================
  router.post("/analyze", 
    pareRequestContract,
    pareRateLimiter(),
    pareQuotaGuard(),
    async (req, res) => {
    const pareContext = requirePareContext(req);
    const { requestId, isDataMode, attachmentsCount: pareAttachmentsCount, startTime } = pareContext;
    const timestamp = new Date(startTime).toISOString();
    
    // SERVER-SIDE isDocumentMode flag - computed from PARE context (attachments.length > 0)
    // PARE enforces DATA_MODE when attachments are present, regardless of frontend flag
    const isDocumentMode = isDataMode; // Derived from PARE context (server-side enforcement)
    const productionWorkflowBlocked = isDataMode; // ProductionWorkflowRunner is NEVER called in DATA_MODE
    
    console.log(`[Analyze] ========== REQUEST ${requestId} ==========`);
    console.log(`[Analyze] timestamp: ${timestamp}`);
    console.log(`[Analyze] isDocumentMode: ${isDocumentMode} (reason: PARE detected ${pareAttachmentsCount} attachments)`);
    console.log(`[Analyze] productionWorkflowBlocked: ${productionWorkflowBlocked} (ProductionWorkflowRunner NEVER executed in DATA_MODE)`);
    console.log(`[Analyze] pareContext:`, JSON.stringify({
      requestId: pareContext.requestId,
      idempotencyKey: pareContext.idempotencyKey,
      isDataMode: pareContext.isDataMode,
      attachmentsCount: pareContext.attachmentsCount,
      clientIp: pareContext.clientIp,
      userId: pareContext.userId,
    }));
    
    try {
      const { messages, attachments, conversationId } = req.body;
      
      // GUARD: attachments are REQUIRED for /analyze endpoint
      if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
        console.log(`[Analyze] REJECTED: No attachments provided (requestId: ${requestId})`);
        return res.status(400).json({
          error: "ATTACHMENTS_REQUIRED",
          message: "El endpoint /analyze requiere al menos un documento adjunto.",
          requestId,
          isDocumentMode,
          productionWorkflowBlocked
        });
      }
      
      const attachmentsCount = attachments.length;
      
      // Log detailed attachment metadata
      const attachmentMetadata = attachments.map((att: any, idx: number) => ({
        index: idx,
        filename: att.name || 'unknown',
        mimeType: att.mimeType || att.type || 'unknown',
        type: att.type || 'unknown',
        hasStoragePath: !!att.storagePath,
        hasContent: !!att.content,
        fileId: att.fileId || null
      }));
      
      console.log(`[Analyze] attachments_count: ${attachmentsCount}`);
      console.log(`[Analyze] filenames: ${attachmentMetadata.map(a => a.filename).join(', ')}`);
      console.log(`[Analyze] attachment_metadata:`, JSON.stringify(attachmentMetadata, null, 2));
      console.log(`[Analyze] DATA_MODE ACTIVATED - image_generation: BLOCKED, artifact_creation: BLOCKED`);
      
      // Get user message
      const lastUserMessage = messages && Array.isArray(messages) 
        ? [...messages].reverse().find((m: any) => m.role === 'user')
        : null;
      const userQuery = lastUserMessage?.content || "Analiza el contenido de los documentos.";
      
      // Detect coverage requirement
      const requiresFullCoverage = /\b(todos|all|completo|complete|cada|every|analiza\s+todos)\b/i.test(userQuery);
      
      // Resolve storagePaths for all attachments
      const resolvedAttachments: any[] = [];
      for (const att of attachments) {
        const resolved = { ...att };
        if (!resolved.storagePath && resolved.fileId) {
          const fileRecord = await storage.getFile(resolved.fileId);
          if (fileRecord && fileRecord.storagePath) {
            resolved.storagePath = fileRecord.storagePath;
          }
        }
        resolvedAttachments.push(resolved);
      }
      
      // Initialize batch processor
      const batchProcessor = new DocumentBatchProcessor();
      
      // Convert to batch format
      const batchAttachments: BatchAttachment[] = resolvedAttachments
        .filter((att: any) => att.storagePath || att.content)
        .map((att: any) => ({
          name: att.name || 'document',
          mimeType: att.mimeType || att.type || 'application/octet-stream',
          storagePath: att.storagePath || '',
          content: att.content
        }));
      
      // Process documents atomically
      const batchResult = await batchProcessor.processBatch(batchAttachments);
      
      // Determine parser used based on mimeType/extension
      const getParserInfo = (mimeType: string, filename: string): { mime_detect: string; parser_used: string } => {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const mime = mimeType.toLowerCase();
        
        if (mime.includes('pdf') || ext === 'pdf') return { mime_detect: 'application/pdf', parser_used: 'PdfParser' };
        if (mime.includes('word') || mime.includes('document') || ext === 'docx' || ext === 'doc') return { mime_detect: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', parser_used: 'DocxParser' };
        if (mime.includes('sheet') || mime.includes('excel') || ext === 'xlsx' || ext === 'xls') return { mime_detect: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parser_used: 'XlsxParser' };
        if (mime.includes('presentation') || mime.includes('powerpoint') || ext === 'pptx' || ext === 'ppt') return { mime_detect: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', parser_used: 'PptxParser' };
        if (mime.includes('csv') || ext === 'csv') return { mime_detect: 'text/csv', parser_used: 'CsvParser' };
        if (mime.includes('text') || ext === 'txt') return { mime_detect: 'text/plain', parser_used: 'TextParser' };
        return { mime_detect: mimeType || 'application/octet-stream', parser_used: 'TextParser' };
      };
      
      // Build progress report (per-file metrics) with mime_detect and parser_used
      const progressReport = {
        requestId,
        isDocumentMode,
        productionWorkflowBlocked,
        attachments_count: batchResult.attachmentsCount,
        processedFiles: batchResult.processedFiles,
        failedFiles: batchResult.failedFiles.length,
        tokens_extracted_total: batchResult.totalTokens,
        totalChunks: batchResult.chunks.length,
        perFileStats: batchResult.stats.map((stat, idx) => {
          const originalAtt = resolvedAttachments[idx] || {};
          const parserInfo = getParserInfo(originalAtt.mimeType || originalAtt.type || '', stat.filename);
          return {
            filename: stat.filename,
            status: stat.status,
            bytesRead: stat.bytesRead,
            pagesProcessed: stat.pagesProcessed,
            tokensExtracted: stat.tokensExtracted,
            parseTimeMs: stat.parseTimeMs,
            chunkCount: stat.chunkCount,
            mime_detect: parserInfo.mime_detect,
            parser_used: parserInfo.parser_used,
            error: stat.error || null
          };
        }),
        coverageCheck: {
          required: requiresFullCoverage,
          passed: !requiresFullCoverage || (batchResult.processedFiles === batchResult.attachmentsCount)
        }
      };
      
      // Structured logging with all required fields
      console.log(`[Analyze] ========== BATCH PROCESSING COMPLETE ==========`);
      console.log(`[Analyze] requestId: ${requestId}`);
      console.log(`[Analyze] isDocumentMode: ${isDocumentMode}`);
      console.log(`[Analyze] productionWorkflowBlocked: ${productionWorkflowBlocked}`);
      console.log(`[Analyze] attachments_count: ${progressReport.attachments_count}`);
      console.log(`[Analyze] filenames: ${progressReport.perFileStats.map(s => s.filename).join(', ')}`);
      console.log(`[Analyze] tokens_extracted_total: ${progressReport.tokens_extracted_total}`);
      console.log(`[Analyze] perFileStats:`, JSON.stringify(progressReport.perFileStats, null, 2));
      console.log(`[Analyze] ProductionWorkflowRunner: NOT_EXECUTED (DATA_MODE enforced)`);
      
      // COVERAGE CHECK: If user asked to analyze "all", verify complete coverage
      if (requiresFullCoverage && batchResult.processedFiles !== batchResult.attachmentsCount) {
        const failedList = batchResult.failedFiles.map(f => `${f.filename}: ${f.error}`).join('; ');
        return res.status(422).json({
          error: "COVERAGE_CHECK_FAILED",
          message: `No se pudieron procesar todos los archivos. Procesados: ${batchResult.processedFiles}/${batchResult.attachmentsCount}`,
          failedFiles: failedList,
          progressReport,
          requestId
        });
      }
      
      // TOKENS CHECK: Ensure we extracted something
      if (batchResult.totalTokens === 0) {
        return res.status(422).json({
          error: "PARSE_FAILED",
          message: "No se pudo extraer texto de los documentos adjuntos.",
          progressReport,
          requestId
        });
      }
      
      // Build document context with citation format instructions
      const citationFormats = batchResult.stats
        .filter(s => s.status === 'success')
        .map(s => {
          const ext = s.filename.split('.').pop()?.toLowerCase();
          switch(ext) {
            case 'pdf': return `[doc:${s.filename} p:#]`;
            case 'xlsx': case 'xls': return `[doc:${s.filename} sheet:NombreHoja cell:A1]`;
            case 'docx': case 'doc': return `[doc:${s.filename} p:#]`;
            case 'pptx': case 'ppt': return `[doc:${s.filename} slide:#]`;
            case 'csv': return `[doc:${s.filename} row:#]`;
            default: return `[doc:${s.filename}]`;
          }
        });
      
      // Build the combined document text
      const documentText = batchResult.chunks.map(chunk => {
        const locator = chunk.metadata?.page ? `p:${chunk.metadata.page}` :
                       chunk.metadata?.sheet ? `sheet:${chunk.metadata.sheet}` :
                       chunk.metadata?.slide ? `slide:${chunk.metadata.slide}` :
                       '';
        return `--- ${chunk.docId}${locator ? ` (${locator})` : ''} ---\n${chunk.content}`;
      }).join('\n\n');
      
      // Build system prompt for document analysis (NO image generation instructions)
      const systemPrompt = `Eres un asistente experto en análisis de documentos. 

MODO: DATA_MODE (análisis de documentos)
PROHIBIDO: Generar imágenes, crear artefactos, inventar datos, usar fuentes externas

INSTRUCCIONES CRÍTICAS:
1. ANALIZA exclusivamente el contenido de los documentos adjuntos
2. Responde basándote SOLO en el contenido real extraído
3. Para cada afirmación, INCLUYE la cita del documento fuente
4. Si algo no está en los documentos, indica que "no se encontró en los documentos"

FORMATOS DE CITAS (usa estos exactamente):
${citationFormats.join('\n')}

DOCUMENTOS PROCESADOS: ${batchResult.processedFiles}/${batchResult.attachmentsCount}
${batchResult.stats.map(s => `- ${s.filename}: ${s.status === 'success' ? `${s.tokensExtracted} tokens` : `ERROR: ${s.error}`}`).join('\n')}

CONTENIDO DE LOS DOCUMENTOS:
${documentText}`;

      // Build messages for LLM
      const llmMessages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userQuery }
      ];
      
      // Call LLM with strict DATA_MODE (no tools, no image generation)
      const user = (req as any).user;
      const userId = user?.claims?.sub;
      
      const streamGenerator = llmGateway.streamChat(llmMessages, {
        userId: userId || conversationId || "anonymous",
        requestId,
        disableImageGeneration: true,  // HARD BLOCK
      });
      
      let answerText = "";
      for await (const chunk of streamGenerator) {
        answerText += chunk.content;
      }
      
      // Parse response for per-doc findings and citations
      const citations: string[] = [];
      const citationRegex = /\[doc:([^\]]+)\]/g;
      let match;
      while ((match = citationRegex.exec(answerText)) !== null) {
        if (!citations.includes(match[0])) {
          citations.push(match[0]);
        }
      }
      
      // Build per-doc findings (basic extraction)
      const perDocFindings: Record<string, string[]> = {};
      for (const stat of batchResult.stats.filter(s => s.status === 'success')) {
        const docName = stat.filename;
        const findings: string[] = [];
        // Find sentences that reference this document
        const sentences = answerText.split(/[.!?]\s+/);
        for (const sentence of sentences) {
          if (sentence.toLowerCase().includes(docName.toLowerCase()) || 
              sentence.includes(`[doc:${docName}`)) {
            findings.push(sentence.trim());
          }
        }
        if (findings.length > 0) {
          perDocFindings[docName] = findings;
        }
      }
      
      // Build response payload
      const responsePayload = {
        success: true,
        requestId,
        mode: "DATA_MODE",
        answer_text: answerText,
        per_doc_findings: perDocFindings,
        citations,
        progressReport,  // camelCase to match test expectations
        metadata: {
          totalTokensExtracted: batchResult.totalTokens,
          totalChunks: batchResult.chunks.length,
          processingTimeMs: Date.now() - parseInt(requestId.split('_')[1])
        }
      };
      
      // KILL-SWITCH: Validate DATA_MODE response before sending
      const { validateDataModeResponse, DataModeOutputViolationError } = await import('../lib/dataModeValidator');
      const validationResult = validateDataModeResponse(responsePayload, requestId);
      
      if (!validationResult.valid) {
        console.error(`[Analyze] ========== DATA_MODE_OUTPUT_VIOLATION ${requestId} ==========`);
        console.error(`[Analyze] Violations: ${validationResult.violations.join('; ')}`);
        console.error(`[Analyze] Stack: ${validationResult.stack}`);
        return res.status(500).json({
          error: "DATA_MODE_OUTPUT_VIOLATION",
          message: "La respuesta contiene elementos prohibidos en DATA_MODE (imágenes/artefactos)",
          violations: validationResult.violations,
          requestId,
          progressReport
        });
      }
      
      // Return structured response (progressReport key matches test expectations)
      console.log(`[Analyze] ========== SUCCESS ${requestId} ==========`);
      console.log(`[Analyze] Response includes isDocumentMode: ${progressReport.isDocumentMode}, productionWorkflowBlocked: ${progressReport.productionWorkflowBlocked}`);
      console.log(`[Analyze] KILL-SWITCH: Payload validated, no image/artifact violations`);
      
      res.json(responsePayload);
      
    } catch (error: any) {
      console.error(`[Analyze] Error ${requestId}:`, error);
      
      // Check if it's a DATA_MODE violation error
      if (error.name === 'DataModeOutputViolationError') {
        return res.status(500).json({
          error: "DATA_MODE_OUTPUT_VIOLATION",
          message: error.message,
          violations: error.violations,
          requestId
        });
      }
      
      res.status(500).json({
        error: "ANALYSIS_FAILED",
        message: error.message || "Error durante el análisis de documentos",
        requestId
      });
    }
  });

  return router;
}
