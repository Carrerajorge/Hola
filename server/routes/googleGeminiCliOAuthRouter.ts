import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { requireAdmin } from "./admin/utils";
import { getUserId } from "../types/express";
import {
  beginGoogleGeminiCliOAuthFlow,
  finishGoogleGeminiCliOAuthFlow,
  getGoogleGeminiCliOAuthStatus,
} from "../services/googleGeminiCliOAuthService";

const FLOW_TTL_MS = 20 * 60 * 1000;

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

function getFlowStore(req: Request): Record<string, GeminiCliFlowSessionEntry> {
  const session = ((req as any).session ?? {}) as GeminiCliSessionState;
  session.geminiCliOAuthFlows = session.geminiCliOAuthFlows ?? {};
  (req as any).session = session;
  return session.geminiCliOAuthFlows;
}

function clearExpiredFlows(store: Record<string, GeminiCliFlowSessionEntry>): void {
  const now = Date.now();
  for (const [flowId, flow] of Object.entries(store)) {
    if (now - flow.createdAt > FLOW_TTL_MS) {
      delete store[flowId];
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

const googleGeminiCliOAuthRouter = Router();

googleGeminiCliOAuthRouter.use(requireAdmin);

googleGeminiCliOAuthRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    res.json(await getGoogleGeminiCliOAuthStatus());
  } catch (error) {
    console.error("[GeminiCliOAuth] status failed:", error);
    res.status(500).json({ error: "No se pudo consultar el estado de Gemini CLI OAuth" });
  }
});

googleGeminiCliOAuthRouter.post("/start", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const flowStore = getFlowStore(req);
    clearExpiredFlows(flowStore);

    const flowId = randomUUID();
    const redirectUri = getCanonicalGoogleCallbackUri(req);
    const oauthState = `gemini-cli:${flowId}`;
    const flow = beginGoogleGeminiCliOAuthFlow({
      redirectUri,
      state: oauthState,
    });
    flowStore[flowId] = {
      verifier: flow.verifier,
      createdAt: Date.now(),
      userId,
      oauthState,
      redirectUri,
    };

    res.json({
      flowId,
      authUrl: flow.authUrl,
      redirectUri: flow.redirectUri,
      warning:
        "Integracion no oficial. Algunas cuentas pueden sufrir restricciones al usar Gemini CLI OAuth desde terceros.",
    });
  } catch (error) {
    console.error("[GeminiCliOAuth] start failed:", error);
    const message = error instanceof Error ? error.message : "No se pudo iniciar Gemini CLI OAuth";
    res.status(500).json({ error: message });
  }
});

googleGeminiCliOAuthRouter.post("/complete", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const flowId = typeof req.body?.flowId === "string" ? req.body.flowId.trim() : "";
    const callbackUrl = typeof req.body?.callbackUrl === "string" ? req.body.callbackUrl.trim() : "";
    if (!flowId || !callbackUrl) {
      return res.status(400).json({ error: "flowId y callbackUrl son requeridos" });
    }

    const flowStore = getFlowStore(req);
    clearExpiredFlows(flowStore);

    const flow = flowStore[flowId];
    if (!flow) {
      return res.status(400).json({ error: "La sesion OAuth expiro. Inicia la vinculacion otra vez." });
    }
    if (flow.userId !== userId) {
      return res.status(403).json({ error: "La sesion OAuth no pertenece a este usuario" });
    }

    const status = await finishGoogleGeminiCliOAuthFlow({
      verifier: flow.verifier,
      callbackInput: callbackUrl,
      redirectUri: flow.redirectUri,
      expectedState: flow.oauthState,
    });

    delete flowStore[flowId];

    res.json({
      ...status,
      selectedModelId: status.defaultModelId,
    });
  } catch (error) {
    console.error("[GeminiCliOAuth] complete failed:", error);
    const message = error instanceof Error ? error.message : "No se pudo completar Gemini CLI OAuth";
    res.status(400).json({ error: message });
  }
});

export default googleGeminiCliOAuthRouter;
