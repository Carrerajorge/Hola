import { useState, useCallback } from "react";
import type { UppyFile } from "@uppy/core";
import { normalizeFileForUpload } from "@/lib/attachmentIngest";
import { uploadBlobWithProgress } from "@/lib/uploadTransport";
import type { UploadResponse } from "@shared/uploadContracts";
import { requestUploadUrl as requestUploadUrlFromServer } from "@/lib/uploadUrlRequest";

interface UseUploadOptions {
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: Error) => void;
  conversationId?: string;
  uploadIdPrefix?: string;
}

/**
 * React hook for handling file uploads with presigned URLs.
 *
 * This hook implements the two-step presigned URL upload flow:
 * 1. Request a presigned URL from your backend (sends JSON metadata, NOT the file)
 * 2. Upload the file directly to the presigned URL
 *
 * @example
 * ```tsx
 * function FileUploader() {
 *   const { uploadFile, isUploading, error } = useUpload({
 *     onSuccess: (response) => {
 *       console.log("Uploaded to:", response.storagePath);
 *     },
 *   });
 *
 *   const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
 *     const file = e.target.files?.[0];
 *     if (file) {
 *       await uploadFile(file);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <input type="file" onChange={handleFileChange} disabled={isUploading} />
 *       {isUploading && <p>Uploading...</p>}
 *       {error && <p>Error: {error.message}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useUpload(options: UseUploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState(0);
  const uploadIdPrefix = (options.uploadIdPrefix || "upload").trim() || "upload";

  const retryAsync = useCallback(
    async <T>(operation: () => Promise<T>, maxRetries = 2, baseDelayMs = 250): Promise<T> => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await operation();
        } catch (error: unknown) {
          lastError = error instanceof Error ? error : new Error("Upload request failed");
          const nonRetryable = /(invalid|unsupported|too large|missing|conflicting|csrf|forbidden|unauthorized)/i
            .test(lastError.message);
          if (nonRetryable) {
            throw lastError;
          }
          if (attempt < maxRetries) {
            const jitter = Math.floor(Math.random() * 120);
            const delay = baseDelayMs * Math.pow(2, attempt) + jitter;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      throw lastError || new Error("Upload request failed");
    },
    []
  );

  const buildUploadId = useCallback(
    (fileName: string): string => {
      const safeName = fileName.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 24) || "file";
      return `${uploadIdPrefix}-${safeName}-${Date.now()}`;
    },
    [uploadIdPrefix]
  );

  /**
   * Request a presigned URL from the backend.
   * IMPORTANT: Send JSON metadata, NOT the file itself.
   */
  const requestUploadUrl = useCallback(
    async (file: File): Promise<UploadResponse> => {
      const normalizedFile = normalizeFileForUpload(file);
      const uploadId = buildUploadId(normalizedFile.name);
      return requestUploadUrlFromServer({
        uploadId,
        conversationId: options.conversationId,
        fileName: normalizedFile.name,
        mimeType: normalizedFile.type,
        fileSize: normalizedFile.size,
      });
    },
    [buildUploadId, options.conversationId]
  );

  /**
   * Upload a file directly to the presigned URL.
   */
  const uploadToPresignedUrl = useCallback(
    async (file: File, uploadURL: string): Promise<void> => {
      await uploadBlobWithProgress(uploadURL, file, (percent) => {
        setProgress(Math.max(30, percent));
      }, {
        timeoutMs: 120000,
        skipContentType: true,
      });
    },
    []
  );

  /**
   * Upload a file using the presigned URL flow.
   *
   * @param file - The file to upload
   * @returns The upload response containing the object path
   */
  const uploadFile = useCallback(
    async (file: File): Promise<UploadResponse | null> => {
      setIsUploading(true);
      setError(null);
      setProgress(0);

      try {
        const normalizedFile = normalizeFileForUpload(file);
        if (!normalizedFile || !normalizedFile.name || normalizedFile.size <= 0) {
          throw new Error("Invalid file selected for upload");
        }

        // Step 1: Request presigned URL (send metadata as JSON)
        setProgress(10);
        const uploadResponse = await retryAsync(() => requestUploadUrl(normalizedFile), 2, 300);

        // Step 2: Upload file directly to presigned URL
        setProgress(30);
        await retryAsync(() => uploadToPresignedUrl(normalizedFile, uploadResponse.uploadURL), 2, 350);

        setProgress(100);
        options.onSuccess?.(uploadResponse);
        return uploadResponse;
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Upload failed");
        setError(error);
        options.onError?.(error);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [requestUploadUrl, retryAsync, uploadToPresignedUrl, options]
  );

  /**
   * Get upload parameters for Uppy's AWS S3 plugin.
   *
   * IMPORTANT: This function receives the UppyFile object from Uppy.
   * Use file.name, file.size, file.type to request per-file presigned URLs.
   *
   * Use this with the ObjectUploader component:
   * ```tsx
   * <ObjectUploader onGetUploadParameters={getUploadParameters}>
   *   Upload
   * </ObjectUploader>
   * ```
   */
  const getUploadParameters = useCallback(
    async (
      file: UppyFile<Record<string, unknown>, Record<string, unknown>>
    ): Promise<{
      method: "PUT";
      url: string;
      headers?: Record<string, string>;
    }> => {
      // Use the actual file properties to request a per-file presigned URL
      const normalizedFile = normalizeFileForUpload(file as unknown as File);
      const uploadId = buildUploadId(normalizedFile.name);
      const data = await requestUploadUrlFromServer({
        uploadId,
        conversationId: options.conversationId,
        fileName: normalizedFile.name,
        mimeType: normalizedFile.type,
        fileSize: normalizedFile.size,
      });
      return {
        method: "PUT",
        url: data.uploadURL,
        headers: {},
      };
    },
    [buildUploadId, options.conversationId]
  );

  return {
    uploadFile,
    getUploadParameters,
    isUploading,
    error,
    progress,
  };
}
