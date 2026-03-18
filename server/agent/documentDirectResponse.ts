import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llmGateway } from "../lib/llmGateway";
import {
  extractAllAttachmentsContent,
  formatAttachmentsAsContext,
  type Attachment,
} from "../services/attachmentService";
import {
  buildDocumentPrompt,
  createAuditLog,
  detectIntent,
  validateResponse,
} from "../services/intentGuard";

const MAX_DOCUMENT_RESPONSE_RETRIES = 2;
const DEFAULT_DOCUMENT_MODEL = "gemini-2.5-flash";

function normalizeAttachmentForExtraction(raw: unknown): Attachment | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const attachment = raw as Record<string, unknown>;
  const name = String(attachment.name || attachment.filename || "").trim();
  const storagePath = String(attachment.storagePath || "").trim();
  const mimeType = String(attachment.mimeType || attachment.type || "").trim();

  if (!name || !storagePath) {
    return null;
  }

  if (mimeType.toLowerCase().startsWith("image/")) {
    return null;
  }

  return {
    name,
    storagePath,
    mimeType,
    type: mimeType || "application/octet-stream",
    fileId: typeof attachment.fileId === "string" ? attachment.fileId : undefined,
  };
}

export async function buildDocumentAttachmentContext(attachments: unknown[]): Promise<string> {
  const normalizedAttachments = attachments
    .map((attachment) => normalizeAttachmentForExtraction(attachment))
    .filter((attachment): attachment is Attachment => attachment !== null);

  if (normalizedAttachments.length === 0) {
    return "";
  }

  const extractedContents = await extractAllAttachmentsContent(normalizedAttachments);
  if (extractedContents.length === 0) {
    return "";
  }

  return formatAttachmentsAsContext(extractedContents);
}

export async function generateDirectDocumentResponse(options: {
  userMessage: string;
  attachments: unknown[];
  userId: string;
  modelId?: string;
}): Promise<string | null> {
  const attachmentContext = await buildDocumentAttachmentContext(options.attachments);
  if (!attachmentContext.trim()) {
    return null;
  }

  const intentContract = detectIntent(options.userMessage, false, true);
  if (intentContract.taskType === "web_search") {
    return null;
  }

  const documentPrompt = buildDocumentPrompt(
    intentContract,
    attachmentContext,
    options.userMessage
  );

  let systemPrompt = documentPrompt;
  let attempt = 0;

  try {
    while (attempt <= MAX_DOCUMENT_RESPONSE_RETRIES) {
      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: options.userMessage },
      ];

      const llmResponse = await llmGateway.chat(messages, {
        temperature: 0.3,
        maxTokens: 2500,
        userId: options.userId,
        model: options.modelId || DEFAULT_DOCUMENT_MODEL,
      });

      const validation = validateResponse(llmResponse.content, intentContract);
      if (validation.valid) {
        return llmResponse.content;
      }

      if (attempt < MAX_DOCUMENT_RESPONSE_RETRIES && validation.suggestedRetryPrompt) {
        systemPrompt = `${documentPrompt}\n\nCORRECCIÓN IMPORTANTE:\n${validation.suggestedRetryPrompt}`;
        attempt++;
        continue;
      }

      const auditLog = createAuditLog(
        intentContract,
        options.userMessage,
        "agent_document_direct_response",
        attempt < MAX_DOCUMENT_RESPONSE_RETRIES ? "retry" : "fail",
        validation.error
      );
      console.error(
        `[DocumentDirectResponse] Validation failed after retries: ${JSON.stringify(auditLog)}`
      );

      return "Error de análisis: el sistema detectó una inconsistencia en la respuesta. Reformula tu pregunta sobre el documento.";
    }
  } catch (error: unknown) {
    console.error("[DocumentDirectResponse] Failed to analyze attachment content:", error);
    const message = error instanceof Error ? error.message : "no se pudo procesar el archivo adjunto.";
    return `Error al analizar el documento: ${message}`;
  }

  return null;
}
