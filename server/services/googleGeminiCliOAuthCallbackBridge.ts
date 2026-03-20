import type { Request, Response } from "express";

const GEMINI_CLI_STATE_PREFIX = "gemini-cli:";
const GEMINI_CLI_BRIDGE_STORAGE_KEY = "iliagpt:gemini-cli-oauth-bridge-result";

type GeminiCliFlowSessionEntry = {
  verifier: string;
  createdAt: number;
  userId: string;
  oauthState: string;
  redirectUri: string;
};

type GeminiCliSessionState = {
  geminiCliOAuthFlows?: Record<string, GeminiCliFlowSessionEntry>;
};

function buildCallbackUrl(req: Request, path: string): string {
  const canonicalDomain = process.env.CANONICAL_DOMAIN || "iliagpt.com";
  const baseUrl =
    process.env.NODE_ENV === "production"
      ? `https://${canonicalDomain}${path}`
      : `${req.protocol}://${req.get("host")}${path}`;
  const callbackUrl = new URL(baseUrl);
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === "string") {
      callbackUrl.searchParams.set(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        callbackUrl.searchParams.append(key, String(entry));
      }
    }
  }
  return callbackUrl.toString();
}

function renderGeminiCliBridge(
  res: Response,
  payload: {
    flowId: string;
    callbackUrl?: string;
    error?: string;
    errorDescription?: string;
  },
): void {
  // Serialize payload with XSS-safe escaping for embedding directly in a <script> tag.
  // Inline script avoids the extra /gemini-cli-bridge.js request that could fail due
  // to CSP, network errors, or popup timing issues.
  const safeJson = JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  const storageKey = JSON.stringify(GEMINI_CLI_BRIDGE_STORAGE_KEY);
  const safeCallbackUrl = payload.callbackUrl
    ? payload.callbackUrl.replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : "";

  res
    .status(payload.error ? 400 : 200)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gemini CLI OAuth</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #0b1020; color: #f8fafc; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 24px; }
      .card { max-width: 520px; background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 20px; padding: 24px; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.35); }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { margin: 0 0 12px; line-height: 1.55; color: #cbd5e1; }
      code { display: block; margin-top: 12px; padding: 12px; background: rgba(15, 23, 42, 0.8); border-radius: 12px; color: #e2e8f0; word-break: break-all; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${payload.error ? "No se pudo completar Gemini CLI OAuth" : "Gemini CLI OAuth completado"}</h1>
      <p>${payload.error ? "Vuelve a ILIAGPT. El modal recibirá el error y podrás reintentar." : "Puedes volver a ILIAGPT. Esta ventana se cerrará automáticamente si el navegador lo permite."}</p>
      ${safeCallbackUrl ? `<code>${safeCallbackUrl}</code>` : ""}
    </div>
    <script>
    (function () {
      var payload = ${safeJson};
      var message = payload.error
        ? { type: "gemini-cli-oauth-result", flowId: payload.flowId, status: "error", error: payload.error, errorDescription: payload.errorDescription, callbackUrl: payload.callbackUrl }
        : { type: "gemini-cli-oauth-callback", flowId: payload.flowId, callbackUrl: payload.callbackUrl };
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(message, window.location.origin);
        }
      } catch (e) {}
      try {
        window.localStorage.setItem(${storageKey}, JSON.stringify(Object.assign({}, message, { createdAt: Date.now() })));
      } catch (e) {}
      setTimeout(function () { try { window.close(); } catch (e) {} }, 150);
    })();
    </script>
  </body>
</html>`);
}

export function isGeminiCliOAuthCallback(req: Request): boolean {
  const stateValue = typeof req.query.state === "string" ? req.query.state.trim() : "";
  return stateValue.startsWith(GEMINI_CLI_STATE_PREFIX);
}

export function handleGeminiCliOAuthCallback(req: Request, res: Response): boolean {
  const error = typeof req.query.error === "string" ? req.query.error : "";
  const errorDescription =
    typeof req.query.error_description === "string" ? req.query.error_description : "";
  const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
  const stateValue = typeof req.query.state === "string" ? req.query.state.trim() : "";
  const geminiFlowId = stateValue.startsWith(GEMINI_CLI_STATE_PREFIX)
    ? stateValue.slice(GEMINI_CLI_STATE_PREFIX.length)
    : "";

  if (!geminiFlowId) {
    return false;
  }

  if (error) {
    console.error("[Google Auth] Gemini CLI OAuth error:", error, errorDescription);
    renderGeminiCliBridge(res, {
      flowId: geminiFlowId,
      error,
      errorDescription,
    });
    return true;
  }

  if (!code) {
    console.error("[Google Auth] Gemini CLI callback missing code");
    renderGeminiCliBridge(res, {
      flowId: geminiFlowId,
      error: "gemini_cli_missing_code",
      errorDescription: "Google no devolvió el código de autorización.",
    });
    return true;
  }

  const session = (((req as any).session ?? {}) as GeminiCliSessionState);
  const flow = session.geminiCliOAuthFlows?.[geminiFlowId];
  if (flow && flow.oauthState !== stateValue) {
    console.error("[Google Auth] Gemini CLI OAuth state mismatch for active flow");
    renderGeminiCliBridge(res, {
      flowId: geminiFlowId,
      error: "gemini_cli_invalid_state",
      errorDescription: "El callback OAuth no coincide con la sesión iniciada.",
    });
    return true;
  }

  renderGeminiCliBridge(res, {
    flowId: geminiFlowId,
    callbackUrl: buildCallbackUrl(req, "/api/auth/google/callback"),
  });
  return true;
}
