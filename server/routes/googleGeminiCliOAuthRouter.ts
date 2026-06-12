import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { requireAdmin } from "./admin/utils";
import { getUserId } from "../types/express";
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
      const userId = getUserId(req);
      const session = (req as any).session;
      const sessionUser = (req as any).user;

      const connectedResponse = (email: string | null, profileId = "session-fallback") => ({
        connected: true,
        providerId: "google-gemini-cli" as const,
        defaultModelRef: "google-gemini-cli/gemini-3.1-pro-preview" as const,
        defaultModelId: "gemini-3.1-pro-preview" as const,
        profileId,
        email,
      });

      // 1. Session-level Gemini connection flag (set by Google login callback
      //    when provider_hint is gemini/antigravity). Most reliable for the
      //    immediately-after-login window.
      const sessionGemini = session?.geminiCliConnected;
      if (
        sessionGemini &&
        sessionGemini.hasAccessToken &&
        Date.now() - (sessionGemini.connectedAt || 0) < 24 * 3600 * 1000
      ) {
        const effectiveUserId = userId || session?.passport?.user;
        if (sessionGemini.accessToken && effectiveUserId) {
          persistGeminiCliCredentialsFromGoogleTokens(
            effectiveUserId,
            sessionGemini.email,
            {
              access_token: sessionGemini.accessToken,
              refresh_token: sessionGemini.refreshToken,
              expires_at: sessionGemini.expiresAt,
            },
          ).catch(() => {});
        }
        return res.json(connectedResponse(sessionGemini.email || null));
      }

      // 2. Session user has a Google access_token (only available on the initial
      //    request right after Passport callback, before serialization).
      const googleTokens = sessionUser?._googleOAuthTokens || (
        sessionUser?.access_token ? {
          access_token: sessionUser.access_token,
          refresh_token: sessionUser.refresh_token,
          expires_at: sessionUser.expires_at,
        } : null
      );
      if (googleTokens?.access_token && userId) {
        const userEmail = sessionUser.claims?.email || sessionUser.email || null;
        persistGeminiCliCredentialsFromGoogleTokens(
          userId,
          userEmail,
          googleTokens,
        ).catch(() => {});
        return res.json(connectedResponse(userEmail, `user-token:${userId}`));
      }

      // 3. File-based and DB-backed profile resolution
      if (userId) {
        const status = await getGoogleGeminiCliOAuthStatus(userId);
        if (status.connected) {
          return res.json(status);
        }
      }

      // 4. Check DB provider tokens directly as final fallback
      if (userId) {
        try {
          const { providersService } = await import("../services/providersService.js");
          const tokenStatus = await providersService.getUserTokenStatus(userId, "gemini");
          if (tokenStatus.connected) {
            // Set session flag so subsequent requests don't need the DB lookup
            if (session && !session.geminiCliConnected) {
              session.geminiCliConnected = {
                hasAccessToken: true,
                email: null,
                userId,
                connectedAt: Date.now(),
                persisted: true,
              };
              if (typeof session.save === "function") {
                session.save(() => {});
              }
            }
            return res.json(connectedResponse(null, `db-provider:${userId}`));
          }
        } catch {
          // DB might not have the oauth tables yet
        }
      }

      const status = await getGoogleGeminiCliOAuthStatus(userId);
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
