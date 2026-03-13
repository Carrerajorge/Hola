import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../config/env";
import {
  clearExpiredGeminiCliOAuthCompletedStore,
  deleteGeminiCliOAuthFlow,
  extractGeminiCliFlowIdFromState,
  getGeminiCliOAuthFlow,
  saveGeminiCliOAuthCompleted,
  saveGeminiCliOAuthCompletedToStore,
  type GeminiCliOAuthCompletedSessionStore,
} from "../lib/geminiCliOAuthFlowStore";
import { finishGoogleGeminiCliOAuthFlow } from "../services/googleGeminiCliOAuthService";

type GeminiCliFlowSessionEntry = {
  verifier: string;
  createdAt: number;
  userId: string;
  oauthState: string;
  redirectUri: string;
};

type GeminiCliSessionState = {
  geminiCliOAuthFlows?: Record<string, GeminiCliFlowSessionEntry>;
  geminiCliOAuthCompleted?: GeminiCliOAuthCompletedSessionStore;
};

async function saveGeminiCliSession(req: Request): Promise<void> {
  const session = (req as any).session;
  if (!session || typeof session.save !== "function") {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    session.save((error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function buildGoogleCallbackUrl(req: Request): string {
  const canonicalDomain = process.env.CANONICAL_DOMAIN || "iliagpt.com";
  const callbackUrl = new URL(
    env.NODE_ENV === "production"
      ? `https://${canonicalDomain}/api/auth/google/callback`
      : `${req.protocol}://${req.get("host")}/api/auth/google/callback`,
  );

  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === "string") {
      callbackUrl.searchParams.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        callbackUrl.searchParams.append(key, String(item));
      }
    }
  }

  return callbackUrl.toString();
}

export function renderGeminiCliOAuthBridge(
  res: Response,
  payload: {
    flowId: string;
    status?: "success" | "error";
    result?: Record<string, unknown> | null;
    callbackUrl?: string;
    error?: string;
    errorDescription?: string;
  },
): void {
  const serializedPayload = JSON.stringify(payload).replace(/</g, "\\u003c");
  const bridgeStorageKey = "iliagpt:gemini-cli-oauth-bridge-result";
  const nonce = randomBytes(16).toString("base64");
  const contentSecurityPolicy = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    "connect-src 'self'",
  ].join("; ");

  res
    .status(payload.error ? 400 : 200)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .setHeader("Content-Security-Policy", contentSecurityPolicy)
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
      #status { color: #93c5fd; }
      code { display: block; margin-top: 12px; padding: 12px; background: rgba(15, 23, 42, 0.8); border-radius: 12px; color: #e2e8f0; word-break: break-all; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${payload.error ? "No se pudo completar Gemini CLI OAuth" : "Gemini CLI OAuth completado"}</h1>
      <p>${payload.error ? "Vuelve a ILIAGPT. El modal recibirá el error y podrás reintentar." : "Puedes volver a ILIAGPT. Esta ventana se cerrará automáticamente si el navegador lo permite."}</p>
      <p id="status">${payload.error ? "Error devuelto por Google." : "Completando la vinculación en ILIAGPT..."}</p>
      ${payload.callbackUrl ? `<code>${payload.callbackUrl.replace(/</g, "&lt;")}</code>` : ""}
    </div>
    <script nonce="${nonce}">
      (async function () {
        const payload = ${serializedPayload};
        const statusNode = document.getElementById("status");
        const postToOpener = (message) => {
          try {
            if (window.opener && !window.opener.closed) {
              window.opener.postMessage(
                { type: "gemini-cli-oauth-result", ...message },
                window.location.origin
              );
              return true;
            }
          } catch {}
          return false;
        };
        const persistForRecovery = (message) => {
          try {
            window.localStorage.setItem(
              "${bridgeStorageKey}",
              JSON.stringify({ ...message, createdAt: Date.now() })
            );
            return true;
          } catch {}
          return false;
        };

        try {
          if (!payload.error && payload.status === "success" && payload.result) {
            if (statusNode) {
              statusNode.textContent = "La vinculacion se completo correctamente. Volviendo a ILIAGPT...";
            }
            const message = {
              type: "gemini-cli-oauth-result",
              flowId: payload.flowId,
              status: "success",
              result: payload.result,
            };
            const deliveredToOpener = postToOpener(message);
            const persisted = persistForRecovery(message);
            if (!deliveredToOpener && !persisted && statusNode) {
              statusNode.textContent = "La vinculación se completó, pero no se pudo notificar a ILIAGPT automáticamente. Vuelve a la app para continuar.";
              return;
            }
          } else if (!payload.error && payload.flowId && payload.callbackUrl) {
            if (statusNode) {
              statusNode.textContent = "Código recibido. Volviendo a ILIAGPT para completar la vinculación...";
            }
            const message = {
              type: "gemini-cli-oauth-callback",
              flowId: payload.flowId,
              callbackUrl: payload.callbackUrl,
            };
            const deliveredToOpener = postToOpener(message);
            const persisted = persistForRecovery(message);
            if (!deliveredToOpener && !persisted && statusNode) {
              statusNode.textContent = "No se pudo notificar a ILIAGPT automáticamente. Copia la URL mostrada y vuelve a la app para completar la vinculación.";
              return;
            }
          } else {
            const message = {
              type: "gemini-cli-oauth-result",
              flowId: payload.flowId,
              status: "error",
              error: payload.error,
              errorDescription: payload.errorDescription,
              callbackUrl: payload.callbackUrl,
            };
            postToOpener(message);
            persistForRecovery(message);
          }
        } catch (error) {
          const message =
            error && typeof error === "object" && "message" in error
              ? String(error.message)
              : "No se pudo completar Gemini CLI OAuth";
          if (statusNode) {
            statusNode.textContent = message;
          }
          const bridgeMessage = {
            type: "gemini-cli-oauth-result",
            flowId: payload.flowId,
            status: "error",
            error: "gemini_cli_complete_failed",
            errorDescription: message,
            callbackUrl: payload.callbackUrl,
          };
          postToOpener(bridgeMessage);
          persistForRecovery(bridgeMessage);
        }
        setTimeout(() => {
          try { window.close(); } catch {}
        }, 900);
      })();
    </script>
  </body>
</html>`);
}

export async function handleGoogleGeminiCliOAuthCallback(
  req: Request,
  res: Response,
): Promise<boolean> {
  const stateValue =
    typeof req.query.state === "string" ? req.query.state.trim() : "";
  const geminiFlowId = extractGeminiCliFlowIdFromState(stateValue) || "";

  if (!geminiFlowId) {
    return false;
  }

  const session = ((req as any).session ?? {}) as GeminiCliSessionState;
  session.geminiCliOAuthCompleted = session.geminiCliOAuthCompleted ?? {};
  clearExpiredGeminiCliOAuthCompletedStore(session.geminiCliOAuthCompleted);

  const flow =
    session.geminiCliOAuthFlows?.[geminiFlowId] ??
    getGeminiCliOAuthFlow(geminiFlowId);
  const callbackUrl = buildGoogleCallbackUrl(req);

  if (req.query.error) {
    renderGeminiCliOAuthBridge(res, {
      flowId: geminiFlowId,
      error: String(req.query.error),
      errorDescription:
        typeof req.query.error_description === "string"
          ? req.query.error_description
          : "",
    });
    return true;
  }

  if (typeof req.query.code !== "string" || !req.query.code.trim()) {
    renderGeminiCliOAuthBridge(res, {
      flowId: geminiFlowId,
      error: "gemini_cli_missing_code",
      errorDescription: "Google no devolvió el código de autorización.",
    });
    return true;
  }

  if (flow && flow.oauthState !== stateValue) {
    renderGeminiCliOAuthBridge(res, {
      flowId: geminiFlowId,
      error: "gemini_cli_invalid_state",
      errorDescription: "El callback OAuth no coincide con la sesión iniciada.",
    });
    return true;
  }

  if (!flow) {
    renderGeminiCliOAuthBridge(res, {
      flowId: geminiFlowId,
      callbackUrl,
    });
    return true;
  }

  try {
    const status = await finishGoogleGeminiCliOAuthFlow({
      verifier: flow.verifier,
      callbackInput: callbackUrl,
      redirectUri: flow.redirectUri,
      expectedState: flow.oauthState,
    });
    const responsePayload = {
      ...status,
      selectedModelId: status.defaultModelId,
    };

    saveGeminiCliOAuthCompletedToStore(
      session.geminiCliOAuthCompleted,
      geminiFlowId,
      flow.userId,
      responsePayload,
    );
    saveGeminiCliOAuthCompleted(geminiFlowId, flow.userId, responsePayload);

    if (session.geminiCliOAuthFlows?.[geminiFlowId]) {
      delete session.geminiCliOAuthFlows[geminiFlowId];
    }
    deleteGeminiCliOAuthFlow(geminiFlowId);
    await saveGeminiCliSession(req);

    renderGeminiCliOAuthBridge(res, {
      flowId: geminiFlowId,
      status: "success",
      result: responsePayload,
    });
    return true;
  } catch (error) {
    console.error("[Google Auth] Gemini CLI callback completion failed:", error);
    renderGeminiCliOAuthBridge(res, {
      flowId: geminiFlowId,
      error: "gemini_cli_complete_failed",
      errorDescription:
        error instanceof Error
          ? error.message
          : "No se pudo completar Gemini CLI OAuth.",
      callbackUrl,
    });
    return true;
  }
}
