/**
 * Upload transport utilities for file uploads with CSRF token handling.
 */

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Ensures a CSRF token cookie is available before making state-changing requests.
 * If the token is missing, makes a lightweight GET to trigger the server to set it.
 */
export async function ensureCsrfToken(): Promise<string | null> {
  let token = getCookie("XSRF-TOKEN");
  if (token) return token;

  // Make a lightweight request to trigger CSRF cookie generation
  try {
    await fetch("/api/health", { credentials: "include" });
    token = getCookie("XSRF-TOKEN");
  } catch {
    // Ignore - token may not be available
  }

  return token;
}

interface UploadProgressOptions {
  onProgress?: (loaded: number, total: number) => void;
  headers?: Record<string, string>;
}

/**
 * Upload a Blob/File to a URL with progress tracking.
 * Uses XMLHttpRequest for progress event support.
 */
export function uploadBlobWithProgress(
  url: string,
  blob: Blob | File,
  _fieldName?: string,
  options?: UploadProgressOptions
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.withCredentials = true;

    // Set CSRF header
    const csrfToken = getCookie("XSRF-TOKEN");
    if (csrfToken) {
      xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    }

    // Set custom headers
    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        xhr.setRequestHeader(key, value);
      }
    }

    // Set content type from the blob
    if (blob.type) {
      xhr.setRequestHeader("Content-Type", blob.type);
    }

    // Progress tracking
    if (options?.onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          options.onProgress!(event.loaded, event.total);
        }
      };
    }

    xhr.onload = () => {
      const response = new Response(xhr.response, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: parseXHRHeaders(xhr.getAllResponseHeaders()),
      });
      resolve(response);
    };

    xhr.onerror = () => {
      reject(new Error("Upload failed due to network error"));
    };

    xhr.onabort = () => {
      reject(new Error("Upload aborted"));
    };

    xhr.send(blob);
  });
}

function parseXHRHeaders(headersString: string): Headers {
  const headers = new Headers();
  headersString.split("\r\n").forEach((line) => {
    const idx = line.indexOf(":");
    if (idx > 0) {
      headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    }
  });
  return headers;
}
