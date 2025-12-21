import { Router } from "express";
import { browserSessionManager, SessionEvent } from "../agent/browser";
import { guardrails } from "../agent";

export function createBrowserRouter(broadcastBrowserEvent: (sessionId: string, event: SessionEvent) => void) {
  const router = Router();

  router.post("/session", async (req, res) => {
    try {
      const { objective, config } = req.body;
      if (!objective) {
        return res.status(400).json({ error: "Objective is required" });
      }
      
      const sessionId = await browserSessionManager.createSession(
        objective,
        config || {},
        (event: SessionEvent) => {
          broadcastBrowserEvent(event.sessionId, event);
        }
      );
      
      browserSessionManager.startScreenshotStreaming(sessionId, 1500);
      
      res.json({ sessionId });
    } catch (error: any) {
      console.error("Error creating browser session:", error);
      res.status(500).json({ error: "Failed to create browser session" });
    }
  });

  router.post("/session/:id/navigate", async (req, res) => {
    try {
      const { url } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "navigate", url);
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.navigate(req.params.id, url);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/session/:id/click", async (req, res) => {
    try {
      const { selector } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "click", selector);
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.click(req.params.id, selector);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/session/:id/type", async (req, res) => {
    try {
      const { selector, text } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "type", selector, { text });
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.type(req.params.id, selector, text);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/session/:id/scroll", async (req, res) => {
    try {
      const { direction, amount } = req.body;
      const validation = await guardrails.validateAction(req.params.id, "scroll", "page");
      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, blocked: true });
      }
      const result = await browserSessionManager.scroll(req.params.id, direction, amount);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/session/:id/state", async (req, res) => {
    try {
      const state = await browserSessionManager.getPageState(req.params.id);
      if (!state) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(state);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/session/:id/screenshot", async (req, res) => {
    try {
      const screenshot = await browserSessionManager.getScreenshot(req.params.id);
      if (!screenshot) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json({ screenshot });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/session/:id", async (req, res) => {
    try {
      const session = browserSessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete("/session/:id", async (req, res) => {
    try {
      await browserSessionManager.closeSession(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/session/:id/cancel", async (req, res) => {
    try {
      browserSessionManager.cancelSession(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
