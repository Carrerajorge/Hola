import { apiFetch } from "@/lib/apiClient";
import { ensureCsrfToken, resolveUploadUrlForResponse } from "@/lib/uploadTransport";
import type { UploadResponse } from "@shared/uploadContracts";

const RETRYABLE_UPLOAD_URL_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface UploadUrlRequestInput {
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadId?: string;
  conversationId?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

function isRetryableUploadUrlError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /timeout|network|failed to fetch|load failed|502|503|504|429/i.test(message);
}

async function buildUploadUrlError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null as { error?: string } | null);
  const requestId = response.headers.get("X-Request-Id") || response.headers.get("X-Trace-Id");
  const baseMessage = body?.error || `Failed to get upload URL (status ${response.status})`;
  return new Error(requestId ? `${baseMessage} (requestId ${requestId})` : baseMessage);
}

export async function requestUploadUrl(input: UploadUrlRequestInput): Promise<UploadResponse> {
  const {
    fileName,
    mimeType,
    fileSize,
    uploadId,
    conversationId,
    signal,
    timeoutMs = 30_000,
    maxRetries = 3,
    baseDelayMs = 350,
  } = input;

  await ensureCsrfToken();

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await apiFetch("/api/objects/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(uploadId ? { "X-Upload-Id": uploadId } : {}),
          ...(conversationId ? { "X-Conversation-Id": conversationId } : {}),
        },
        ...(signal ? { signal } : {}),
        timeoutMs,
        body: JSON.stringify({
          ...(uploadId ? { uploadId } : {}),
          ...(conversationId ? { conversationId } : {}),
          fileName,
          mimeType,
          fileSize,
        }),
      });

      if (!response.ok) {
        const responseError = await buildUploadUrlError(response);
        if (!RETRYABLE_UPLOAD_URL_STATUSES.has(response.status) || attempt >= maxRetries) {
          throw responseError;
        }
        lastError = responseError;
      } else {
        const payload = (await response.json()) as UploadResponse;
        if (!payload?.uploadURL || !payload?.storagePath) {
          throw new Error("Server returned invalid upload configuration");
        }

        return {
          ...payload,
          uploadURL: resolveUploadUrlForResponse(payload.uploadURL, response.url),
        };
      }
    } catch (error: unknown) {
      const normalizedError = error instanceof Error ? error : new Error("Failed to get upload URL");
      if (!isRetryableUploadUrlError(normalizedError) || attempt >= maxRetries) {
        throw normalizedError;
      }
      lastError = normalizedError;
    }

    const jitter = Math.floor(Math.random() * 140);
    const delay = baseDelayMs * Math.pow(2, attempt) + jitter;
    await new Promise((resolve) => window.setTimeout(resolve, delay));
  }

  throw lastError || new Error("Failed to get upload URL");
}
