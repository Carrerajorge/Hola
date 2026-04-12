/**
 * Upload transport utilities for file uploads with CSRF token management.
 */

/**
 * Ensures a CSRF token cookie is available for subsequent requests.
 * The server sets the XSRF-TOKEN cookie via csrfTokenMiddleware on every request.
 * This function makes a lightweight GET to guarantee the cookie is present before
 * state-changing requests.
 */
export async function ensureCsrfToken(): Promise<void> {
  const match = document.cookie.match(/(^|;\s*)XSRF-TOKEN=([^;]*)/);
  if (match) {
    return; // token cookie already present
  }
  // Trigger the server's CSRF middleware to set the cookie
  await fetch("/api/health", { credentials: "include" });
}

export interface UploadBlobOptions {
  timeoutMs?: number;
  skipContentType?: boolean;
}

/**
 * Uploads a Blob/File to the given URL with optional progress tracking.
 *
 * @param url - The presigned upload URL.
 * @param blob - The Blob or File to upload.
 * @param onProgress - Optional callback receiving a number between 0 and 1.
 * @param options - Optional configuration (timeout, content-type behaviour).
 */
export async function uploadBlobWithProgress(
  url: string,
  blob: Blob,
  onProgress?: ((progress: number) => void) | undefined,
  options?: UploadBlobOptions,
): Promise<void> {
  const { timeoutMs, skipContentType } = options ?? {};

  // Use XMLHttpRequest when progress tracking is needed
  if (onProgress) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);

      if (!skipContentType) {
        xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
      }

      if (timeoutMs) {
        xhr.timeout = timeoutMs;
      }

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded / e.total);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener("error", () => reject(new Error("Upload network error")));
      xhr.addEventListener("timeout", () => reject(new Error("Upload timed out")));

      xhr.send(blob);
    });
  }

  // Simple fetch-based upload when no progress tracking is needed
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const headers: Record<string, string> = {};
    if (!skipContentType) {
      headers["Content-Type"] = blob.type || "application/octet-stream";
    }

    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: blob,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Upload failed with status ${res.status}`);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
