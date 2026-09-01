import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { requireAdmin } from "./admin/utils";
import { getUserId } from "../types/express";
import { parse as parseCookie } from "cookie";
import {
  clearExpiredGeminiCliOAuthCompletedStore,
  clearExpiredGeminiCliOAuthFlows,
  getGeminiCliOAuthCompletedFromStore,
  getGeminiCliOAuthCompleted,
  deleteGeminiCliOAuthFlow,
  extractGeminiCliFlowIdFromCallbackInput,
  getGeminiCliOAuthFlow,
  saveGeminiCliOAuthCompletedToStore,
  saveGeminiCliOAuthCompleted,
  saveGeminiCliOAuthFlow,
  type GeminiCliOAuthCompletedSessionStore,
  type GeminiCliOAuthFlowRecord,
} from "../lib/geminiCliOAuthFlowStore";
import {
  beginGoogleGeminiCliOAuthFlow,
  finishGoogleGeminiCliOAuthFlow,
  getGoogleGeminiCliOAuthStatus,
  persistGeminiCliCredentialsFromGoogleTokens,
} from "../services/googleGeminiCliOAuthService";

const FLOW_TTL_MS = 45 * 60 * 1000;

type GeminiCliFlowSessionEntry = GeminiCliOAuthFlowRecord;

type GeminiCliFlowProof = {
  verifier: string;
  oauthState: string;
  redirectUri: string;
  createdAt: number;
};

type GeminiCliSessionState = {
  geminiCliOAuthFlows?: Record<string, GeminiCliFlowSessionEntry>;
  geminiCliOAuthCompleted?: GeminiCliOAuthCompletedSessionStore;
};

const pendingFlowStore = new Map<string, GeminiCliFlowSessionEntry>();

function getFlowStore(req: Request): Record<string, GeminiCliFlowSessionEntry> {
  const session = ((req as any).session ?? {}) as GeminiCliSessionState;
  session.geminiCliOAuthFlows = session.geminiCliOAuthFlows ?? {};
  (req as any).session = session;
  return session.geminiCliOAuthFlows;
}

function getCompletedStore(req: Request): GeminiCliOAuthCompletedSessionStore {
  const session = ((req as any).session ?? {}) as GeminiCliSessionState;
  session.geminiCliOAuthCompleted = session.geminiCliOAuthCompleted ?? {};
  (req as any).session = session;
  return session.geminiCliOAuthCompleted;
}

async function saveSession(req: Request): Promise<void> {
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

function clearExpiredFlows(
  store: Record<string, GeminiCliFlowSessionEntry>,
  completedStore?: GeminiCliOAuthCompletedSessionStore,
): void {
  clearExpiredGeminiCliOAuthFlows();
  const now = Date.now();
  for (const [flowId, flow] of Object.entries(store)) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      delete store[flowId];
    }
  }
  if (completedStore) {
    clearExpiredGeminiCliOAuthCompletedStore(completedStore, now);
  }
}

function getPendingFlowKey(userId: string, flowId: string): string {
  return `${userId}:${flowId}`;
}

function clearExpiredPendingFlows(): void {
  const now = Date.now();
  for (const [key, flow] of pendingFlowStore.entries()) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      pendingFlowStore.delete(key);
    }
  }
}

function getCanonicalGoogleCallbackUri(req: Request): string {
  const canonicalDomain = process.env.CANONICAL_DOMAIN || "iliagpt.com";
  if (process.env.NODE_ENV === "production") {
    return `https://${canonicalDomain}/api/auth/google/callback`;
  }
  return `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
}

function normalizeLoginHint(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized.length > 320 ||
    /\s/.test(normalized) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new Error(
      "Ingresa un correo Gmail valido para sugerir la cuenta que deseas vincular.",
    );
  }

  return normalized;
}

const googleGeminiCliOAuthRouter = Router();

// Allow any authenticated user (not just admin) to use Gemini CLI OAuth.
// Authentication is still required via getUserId() checks in each handler.
// googleGeminiCliOAuthRouter.use(requireAdmin);

googleGeminiCliOAuthRouter.get(
  "/status",
  async (req: Request, res: Response) => {
    try {
      let userId: string | null = null;
      try { userId = getUserId(req); } catch { /* unauthenticated */ }
      const session = (req as any).session;

      // Fast path: check session-level Gemini connection flag first.
      // This is set by the Google login callback when provider_hint is gemini/antigravity,
      // and avoids the slower file/DB lookups that may fail in transient environments.
      // Check regardless of whether getUserId() succeeded — the session flag
      // is available even before passport deserialization completes.
      const sessionGemini = session?.geminiCliConnected;
      if (
        sessionGemini &&
        sessionGemini.hasAccessToken &&
        Date.now() - (sessionGemini.connectedAt || 0) < 24 * 3600 * 1000
      ) {
        const fastPathUserId = userId || session?.passport?.user || sessionGemini.userId;
        if (sessionGemini.accessToken && fastPathUserId) {
          // Normalize expiresAt: values < 1e12 are seconds, convert to ms
          const normalizedExpiresAt = sessionGemini.expiresAt
            ? (sessionGemini.expiresAt > 1e12 ? sessionGemini.expiresAt : sessionGemini.expiresAt * 1000)
            : undefined;
          persistGeminiCliCredentialsFromGoogleTokens(
            fastPathUserId,
            sessionGemini.email,
            {
              access_token: sessionGemini.accessToken,
              refresh_token: sessionGemini.refreshToken,
              expires_at: normalizedExpiresAt,
            },
          ).catch(() => {});
        }
        return res.json({
          connected: true,
          providerId: "google-gemini-cli",
          defaultModelRef: "google-gemini-cli/gemini-3.1-pro-preview",
          defaultModelId: "gemini-3.1-pro-preview",
          profileId: "session-fallback",
          email: sessionGemini.email || null,
        });
      }

      // Cookie fallback: the Google OAuth callback sets a short-lived
      // cookie when provider_hint is gemini/antigravity. This survives
      // even when the session store hasn't propagated the flag yet.
      const cookieFallback = (() => {
        try {
          const cookies = req.cookies || (req.headers.cookie ? parseCookie(req.headers.cookie) : {});
          const raw =
            cookies.iliagpt_provider_connected_gemini ||
            cookies.iliagpt_provider_connected_antigravity;
          if (!raw) return null;
          const parsed = JSON.parse(decodeURIComponent(raw));
          if (
            parsed &&
            (parsed.provider === "gemini" || parsed.provider === "antigravity") &&
            parsed.ts &&
            Date.now() - parsed.ts < 30 * 60 * 1000
          ) {
            return parsed as { provider: string; email: string | null; userId: string };
          }
        } catch {}
        return null;
      })();

      if (cookieFallback) {
        const fallbackUserId = userId || cookieFallback.userId;
        res.clearCookie("iliagpt_provider_connected_gemini", { path: "/" });
        res.clearCookie("iliagpt_provider_connected_antigravity", { path: "/" });

        // Only set the cookie-based session flag if the session does NOT
        // already carry a richer geminiCliConnected entry (e.g. one with
        // a real access token set by the Google OAuth callback).  Previous
        // code unconditionally overwrote the session flag with
        // hasAccessToken:false, destroying valid tokens that the callback
        // had just persisted.
        if (session && typeof session.save === "function") {
          try {
            const existing = session.geminiCliConnected;
            const existingIsFresh =
              existing &&
              existing.hasAccessToken &&
              Date.now() - (existing.connectedAt || 0) < 24 * 3600 * 1000;
            if (!existingIsFresh) {
              session.geminiCliConnected = {
                hasAccessToken: false,
                email: cookieFallback.email || null,
                connectedAt: Date.now(),
                userId: fallbackUserId,
              };
              session.save(() => {});
            }
          } catch { /* best-effort */ }
        }

        // Also attempt to persist via DB if we have a userId, so the
        // file/DB fallback path works on subsequent status checks even
        // if the session store loses the flag.
        if (fallbackUserId) {
          const sessionUser = (req as any).user;
          if (sessionUser?.access_token) {
            persistGeminiCliCredentialsFromGoogleTokens(
              fallbackUserId,
              cookieFallback.email || sessionUser.claims?.email || sessionUser.email,
              {
                access_token: sessionUser.access_token,
                refresh_token: sessionUser.refresh_token,
                expires_at: sessionUser.expires_at,
              },
            ).catch(() => {});
          }
        }

        return res.json({
          connected: true,
          providerId: "google-gemini-cli",
          defaultModelRef: "google-gemini-cli/gemini-3.1-pro-preview",
          defaultModelId: "gemini-3.1-pro-preview",
          profileId: "cookie-fallback",
          email: cookieFallback.email || null,
        });
      }

      // Session user fallback: if the user just logged in with Gemini scopes
      // (via provider_hint=gemini/antigravity), the session user's access_token
      // includes generative-language scope. Try persisting now even if the
      // geminiCliConnected flag wasn't set or was lost.
      const sessionUser = (req as any).user;
      const fallbackUserId = userId || session?.passport?.user || session?.authUserId;
      if (fallbackUserId && sessionUser?.access_token && !session?.geminiCliConnected) {
        try {
          await persistGeminiCliCredentialsFromGoogleTokens(
            fallbackUserId,
            sessionUser.claims?.email || sessionUser.email,
            {
              access_token: sessionUser.access_token,
              refresh_token: sessionUser.refresh_token,
              expires_at: sessionUser.expires_at,
            },
          );
          const freshStatus = await getGoogleGeminiCliOAuthStatus(fallbackUserId);
          if (freshStatus.connected) {
            if (session && typeof session.save === "function") {
              try {
                session.geminiCliConnected = {
                  hasAccessToken: true,
                  accessToken: sessionUser.access_token,
                  refreshToken: sessionUser.refresh_token,
                  email: sessionUser.claims?.email || sessionUser.email || null,
                  connectedAt: Date.now(),
                  userId: fallbackUserId,
                };
                session.save(() => {});
              } catch { /* best-effort */ }
            }
            return res.json(freshStatus);
          }
        } catch {
          // Re-persistence failed; continue to normal check
        }
      }

      const effectiveUserId = fallbackUserId || userId || session?.passport?.user || session?.authUserId;

      const status = await getGoogleGeminiCliOAuthStatus(effectiveUserId || userId);

      // If the file/credential-based check says not connected, also check
      // the DB via providersService.  The Google OAuth callback persists
      // tokens to the DB, so this covers the case where the file-based
      // store hasn't been written yet (e.g. first login, container restart).
      if (!status.connected && (effectiveUserId || userId)) {
        try {
          const { providersService } = await import("../services/providersService.js");
          const dbStatus = await providersService.getUserTokenStatus(
            effectiveUserId || userId!,
            "gemini",
          );
          if (dbStatus.connected) {
            return res.json({
              connected: true,
              providerId: "google-gemini-cli",
              defaultModelRef: "google-gemini-cli/gemini-3.1-pro-preview",
              defaultModelId: "gemini-3.1-pro-preview",
              profileId: "db-fallback",
              email: status.email || null,
            });
          }
        } catch {
          // DB lookup failed; return the file-based status
        }
      }

      res.json(status);
    } catch (error) {
      console.error("[GeminiCliOAuth] status failed:", error);
      res
        .status(500)
        .json({ error: "No se pudo consultar el estado de Gemini CLI OAuth" });
    }
  },
);

googleGeminiCliOAuthRouter.post(
  "/start",
  async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const flowStore = getFlowStore(req);
      const completedStore = getCompletedStore(req);
      clearExpiredFlows(flowStore, completedStore);
      clearExpiredPendingFlows();

      const flowId = randomUUID();
      const redirectUri = getCanonicalGoogleCallbackUri(req);
      const oauthState = `gemini-cli:${flowId}`;
      const loginHint = normalizeLoginHint(req.body?.loginHint);
      const flow = await beginGoogleGeminiCliOAuthFlow({
        redirectUri,
        state: oauthState,
        loginHint,
      });
      const flowRecord: GeminiCliFlowSessionEntry = {
        verifier: flow.verifier,
        createdAt: Date.now(),
        userId,
        oauthState,
        redirectUri,
      };
      flowStore[flowId] = flowRecord;
      pendingFlowStore.set(getPendingFlowKey(userId, flowId), flowRecord);
      saveGeminiCliOAuthFlow(flowId, flowRecord);
      const respond = () =>
        res.json({
          flowId,
          authUrl: flow.authUrl,
          redirectUri: flow.redirectUri,
          flowProof: {
            verifier: flow.verifier,
            oauthState,
            redirectUri,
            createdAt: flowRecord.createdAt,
          } satisfies GeminiCliFlowProof,
          warning:
            "Integracion no oficial. Algunas cuentas pueden sufrir restricciones al usar Gemini CLI OAuth desde terceros.",
        });

      if (typeof (req as any).session?.save === "function") {
        return (req as any).session.save((sessionError: unknown) => {
          if (sessionError) {
            console.error(
              "[GeminiCliOAuth] failed to persist session flow:",
              sessionError,
            );
          }
          respond();
        });
      }

      respond();
    } catch (error) {
      console.error("[GeminiCliOAuth] start failed:", error);
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo iniciar Gemini CLI OAuth";
      res.status(500).json({ error: message });
    }
  },
);

googleGeminiCliOAuthRouter.post(
  "/complete",
  async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const callbackUrl =
        typeof req.body?.callbackUrl === "string"
          ? req.body.callbackUrl.trim()
          : "";
      const requestedFlowId =
        typeof req.body?.flowId === "string" ? req.body.flowId.trim() : "";
      const callbackFlowId =
        extractGeminiCliFlowIdFromCallbackInput(callbackUrl) || "";
      const flowId = callbackFlowId || requestedFlowId || "";
      const flowProofRaw = req.body?.flowProof;
      const flowProof: GeminiCliFlowProof | null =
        flowProofRaw &&
        typeof flowProofRaw?.verifier === "string" &&
        typeof flowProofRaw?.oauthState === "string" &&
        typeof flowProofRaw?.redirectUri === "string" &&
        typeof flowProofRaw?.createdAt === "number"
          ? {
              verifier: flowProofRaw.verifier.trim(),
              oauthState: flowProofRaw.oauthState.trim(),
              redirectUri: flowProofRaw.redirectUri.trim(),
              createdAt: flowProofRaw.createdAt,
            }
          : null;
      if (!flowId || !callbackUrl) {
        return res
          .status(400)
          .json({ error: "flowId y callbackUrl son requeridos" });
      }
      if (
        requestedFlowId &&
        callbackFlowId &&
        requestedFlowId !== callbackFlowId
      ) {
        console.warn(
          "[GeminiCliOAuth] flowId mismatch between request body and callback state",
          {
            requestedFlowId,
            callbackFlowId,
            userId,
          },
        );
      }

      const flowStore = getFlowStore(req);
      const completedStore = getCompletedStore(req);
      clearExpiredFlows(flowStore, completedStore);
      clearExpiredPendingFlows();
      const pendingFlowKey = getPendingFlowKey(userId, flowId);

      const storedFlow =
        flowStore[flowId] ??
        pendingFlowStore.get(pendingFlowKey) ??
        getGeminiCliOAuthFlow(flowId);
      let flow:
        | (GeminiCliFlowSessionEntry & {
            userId: string;
          })
        | null = storedFlow;

      if (!flow && flowProof) {
        const isFresh = Date.now() - flowProof.createdAt <= FLOW_TTL_MS;
        const expectedState = `gemini-cli:${flowId}`;
        if (isFresh && flowProof.oauthState === expectedState) {
          flow = {
            verifier: flowProof.verifier,
            createdAt: flowProof.createdAt,
            userId,
            oauthState: flowProof.oauthState,
            redirectUri: flowProof.redirectUri,
          };
        }
      }
      if (!flow) {
        const sessionCompleted = getGeminiCliOAuthCompletedFromStore(
          completedStore,
          flowId,
          userId,
        );
        if (sessionCompleted) {
          return res.json(sessionCompleted.response);
        }
        const completed = getGeminiCliOAuthCompleted(flowId, userId);
        if (completed) {
          return res.json(completed.response);
        }
        return res.status(400).json({
          error: "La sesion OAuth expiro. Inicia la vinculacion otra vez.",
        });
      }
      if (flow.userId !== userId) {
        return res
          .status(403)
          .json({ error: "La sesion OAuth no pertenece a este usuario" });
      }

      const status = await finishGoogleGeminiCliOAuthFlow({
        verifier: flow.verifier,
        callbackInput: callbackUrl,
        redirectUri: flow.redirectUri,
        expectedState: flow.oauthState,
        userId,
      });

      delete flowStore[flowId];
      pendingFlowStore.delete(pendingFlowKey);
      deleteGeminiCliOAuthFlow(flowId);
      const responsePayload = {
        ...status,
        selectedModelId: status.defaultModelId,
      };
      saveGeminiCliOAuthCompletedToStore(
        completedStore,
        flowId,
        userId,
        responsePayload,
      );
      saveGeminiCliOAuthCompleted(flowId, userId, responsePayload);
      await saveSession(req);

      res.json(responsePayload);
    } catch (error) {
      console.error("[GeminiCliOAuth] complete failed:", error);
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo completar Gemini CLI OAuth";
      res.status(400).json({ error: message });
    }
  },
);

export default googleGeminiCliOAuthRouter;
