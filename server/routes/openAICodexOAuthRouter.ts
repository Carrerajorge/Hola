import { Router, type Request, type Response } from "express";
import { requireAdmin } from "./admin/utils";
import { getUserId } from "../types/express";
import {
  getOpenAICodexOAuthFlowState,
  getOpenAICodexOAuthStatus,
  startOpenAICodexOAuthFlow,
  submitOpenAICodexOAuthManualInput,
} from "../services/openAICodexOAuthService";

const openAICodexOAuthRouter = Router();

openAICodexOAuthRouter.use(requireAdmin);

openAICodexOAuthRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    res.json(await getOpenAICodexOAuthStatus());
  } catch (error) {
    console.error("[OpenAICodexOAuth] status failed:", error);
    res
      .status(500)
      .json({ error: "No se pudo consultar el estado de ChatGPT OAuth" });
  }
});

openAICodexOAuthRouter.post("/start", async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const flow = await startOpenAICodexOAuthFlow({ userId });
    res.json({
      ...flow,
      instructions:
        "Inicia sesión con tu cuenta de ChatGPT Plus/Pro. Si el callback local no se completa, pega la URL final de localhost o el código.",
    });
  } catch (error) {
    console.error("[OpenAICodexOAuth] start failed:", error);
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo iniciar ChatGPT OAuth";
    res.status(500).json({ error: message });
  }
});

openAICodexOAuthRouter.get("/flow/:flowId", (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    res.json(
      getOpenAICodexOAuthFlowState({
        flowId: String(req.params.flowId || "").trim(),
        userId,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo consultar el flujo OAuth";
    const statusCode = message.includes("no pertenece") ? 403 : 400;
    res.status(statusCode).json({ error: message });
  }
});

openAICodexOAuthRouter.post("/complete", (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const flowId =
      typeof req.body?.flowId === "string" ? req.body.flowId.trim() : "";
    const input = typeof req.body?.input === "string" ? req.body.input.trim() : "";
    if (!flowId || !input) {
      return res.status(400).json({ error: "flowId e input son requeridos" });
    }

    submitOpenAICodexOAuthManualInput({
      flowId,
      userId,
      input,
    });
    res.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No se pudo completar ChatGPT OAuth";
    const statusCode = message.includes("no pertenece") ? 403 : 400;
    res.status(statusCode).json({ error: message });
  }
});

export default openAICodexOAuthRouter;
