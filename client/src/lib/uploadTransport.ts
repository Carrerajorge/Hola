type UploadHeaders = Record<string, string>;

interface UploadTransportOptions {
  headers?: UploadHeaders;
  signal?: AbortSignal;
  timeoutMs?: number;
  requireCsrf?: boolean;
}

const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

interface UrlAnalysis {
  sameOrigin: boolean;
  sameSite: boolean;
  sameSiteCookieFlow: boolean;
  includeCredentials: boolean;
  shouldIncludeCsrf: boolean;
}

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.match(new RegExp(`(^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function analyzeUploadUrl(rawUrl: string): UrlAnalysis {
  const current = new URL(window.location.href);
  const url = new URL(rawUrl, current.href);
  const currentHost = window.location.hostname.toLowerCase();
  const targetHost = url.hostname.toLowerCase();
  const isIp = (host: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const siteForHost = (host: string): string => {
    if (!host || isIp(host)) return host;
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    return parts.slice(-2).join(".");
  };
  const currentSite = siteForHost(currentHost);
  const targetSite = siteForHost(targetHost);
  const sameSite = currentSite === targetSite;
  const sameSiteCookieFlow = sameSite && url.protocol === current.protocol;
  const sameOrigin = url.origin === current.origin;
  const includeCredentials = sameOrigin || sameSiteCookieFlow;
  const includeCsrfByContext = sameOrigin || sameSiteCookieFlow;

  return {
    sameOrigin,
    sameSite,
    sameSiteCookieFlow,
    includeCredentials,
    shouldIncludeCsrf: includeCsrfByContext,
  };
}

function buildUploadHeaders(
  rawUrl: string,
  headers: UploadHeaders = {},
  requireCsrf?: boolean
): { headers: Headers; includeCredentials: boolean; shouldIncludeCsrf: boolean } {
  const resolved = analyzeUploadUrl(rawUrl);
  const finalHeaders = new Headers(headers);
  const shouldIncludeCsrf = requireCsrf === undefined
    ? resolved.shouldIncludeCsrf
    : requireCsrf;
  if (shouldIncludeCsrf && (resolved.sameOrigin || resolved.sameSiteCookieFlow)) {
    const csrfToken = getCookieValue("XSRF-TOKEN");
    if (csrfToken) {
      finalHeaders.set("X-CSRF-Token", csrfToken);
      finalHeaders.set("X-CSRFToken", csrfToken);
    }
  }
  return {
    headers: finalHeaders,
    includeCredentials: resolved.includeCredentials,
    shouldIncludeCsrf,
  };
}

async function ensureCsrfToken(): Promise<void> {
  const existingToken = getCookieValue("XSRF-TOKEN");
  if (existingToken && CSRF_TOKEN_PATTERN.test(existingToken)) {
    return;
  }

  if (existingToken) {
    // Force rotation if token format is unexpected.
  }

  const response = await fetch("/api/csrf/token", {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to refresh CSRF token");
  }

  const renewedToken = getCookieValue("XSRF-TOKEN");
  if (!renewedToken || !CSRF_TOKEN_PATTERN.test(renewedToken)) {
    throw new Error("Invalid CSRF token after refresh");
  }
}

function createAbortSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortController {
  const abortController = new AbortController();
  const externalSignal = signal;

  const onAbort = () => abortController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortController.abort(externalSignal.reason as unknown as DOMException);
    } else {
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    const timeoutId = window.setTimeout(() => {
      abortController.abort(new DOMException("Upload timeout", "TimeoutError"));
    }, timeoutMs);
    abortController.signal.addEventListener("abort", () => {
      window.clearTimeout(timeoutId);
    }, { once: true });
  }

  return abortController;
}

export async function uploadBlob(
  url: string,
  body: Blob | ArrayBuffer | Uint8Array,
  options: UploadTransportOptions = {}
): Promise<Response> {
  const initial = buildUploadHeaders(url, options.headers, options.requireCsrf);
  if (initial.shouldIncludeCsrf) {
    await ensureCsrfToken();
  }
  const { headers, includeCredentials, shouldIncludeCsrf } = buildUploadHeaders(url, options.headers, options.requireCsrf);
  if (shouldIncludeCsrf) {
    if (!getCookieValue("XSRF-TOKEN")) {
      throw new Error("CSRF token missing after refresh attempt");
    }
  }
  const abortController = createAbortSignal(options.signal, options.timeoutMs);

  return fetch(url, {
    method: "PUT",
    body,
    headers,
    credentials: includeCredentials ? "include" : "omit",
    signal: abortController.signal,
  });
}

export async function uploadBlobWithProgress(
  url: string,
  body: Blob | ArrayBuffer | Uint8Array,
  onProgress?: (percent: number) => void,
  options: UploadTransportOptions = {}
): Promise<void> {
  const initial = buildUploadHeaders(url, options.headers, options.requireCsrf);
  if (initial.shouldIncludeCsrf) {
    await ensureCsrfToken();
  }
  const { headers, includeCredentials, shouldIncludeCsrf } = buildUploadHeaders(url, options.headers, options.requireCsrf);
  if (shouldIncludeCsrf && !getCookieValue("XSRF-TOKEN")) {
    throw new Error("CSRF token missing after refresh attempt");
  }
  const bodyForUpload = body instanceof ArrayBuffer ? new Blob([body]) : body;
  const file = bodyForUpload instanceof Blob ? bodyForUpload : new Blob([bodyForUpload]);

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abortController = createAbortSignal(options.signal, options.timeoutMs);

    const cleanup = () => {
      abortController.signal.removeEventListener("abort", handleAbort);
    };

    const handleAbort = () => {
      xhr.abort();
      cleanup();
      reject(new Error("Upload aborted"));
    };

    abortController.signal.addEventListener("abort", handleAbort, { once: true });

    xhr.upload.addEventListener("progress", (event) => {
      if (!onProgress || !event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    });

    xhr.addEventListener("load", () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      cleanup();
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new Error("Upload aborted"));
    });

    xhr.open("PUT", url);
    xhr.withCredentials = includeCredentials;
    headers.forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.send(file);
  });
}
