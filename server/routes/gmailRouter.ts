// Gmail Router - API endpoints for Gmail integration
import { Router, Request, Response } from "express";
import {
  checkGmailConnection,
  searchEmails,
  getEmailThread,
  sendReply,
  getLabels,
  markAsRead,
  markAsUnread
} from "../services/gmailService";

export function createGmailRouter() {
  const router = Router();

  router.get("/status", async (req: Request, res: Response) => {
    try {
      const status = await checkGmailConnection();
      res.json(status);
    } catch (error: any) {
      console.error("[Gmail] Status check error:", error);
      res.json({ connected: false, error: error.message });
    }
  });

  router.get("/search", async (req: Request, res: Response) => {
    try {
      const { q, maxResults, labelIds } = req.query;
      
      const query = typeof q === 'string' ? q : '';
      const max = typeof maxResults === 'string' ? parseInt(maxResults, 10) : 20;
      const labels = typeof labelIds === 'string' ? labelIds.split(',') : undefined;

      const emails = await searchEmails(query, max, labels);
      res.json({ emails });
    } catch (error: any) {
      console.error("[Gmail] Search error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/threads/:threadId", async (req: Request, res: Response) => {
    try {
      const { threadId } = req.params;
      
      if (!threadId) {
        return res.status(400).json({ error: "Thread ID required" });
      }

      const thread = await getEmailThread(threadId);
      
      if (!thread) {
        return res.status(404).json({ error: "Thread not found" });
      }

      res.json(thread);
    } catch (error: any) {
      console.error("[Gmail] Thread fetch error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/reply", async (req: Request, res: Response) => {
    try {
      const { threadId, to, subject, body } = req.body;
      
      if (!threadId || !to || !body) {
        return res.status(400).json({ 
          error: "Missing required fields: threadId, to, body" 
        });
      }

      const result = await sendReply(threadId, to, subject || '', body);
      
      if (result.success) {
        res.json({ success: true, messageId: result.messageId });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      console.error("[Gmail] Reply error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/labels", async (req: Request, res: Response) => {
    try {
      const labels = await getLabels();
      res.json({ labels });
    } catch (error: any) {
      console.error("[Gmail] Labels fetch error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/messages/:messageId/read", async (req: Request, res: Response) => {
    try {
      const { messageId } = req.params;
      const success = await markAsRead(messageId);
      res.json({ success });
    } catch (error: any) {
      console.error("[Gmail] Mark read error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/messages/:messageId/unread", async (req: Request, res: Response) => {
    try {
      const { messageId } = req.params;
      const success = await markAsUnread(messageId);
      res.json({ success });
    } catch (error: any) {
      console.error("[Gmail] Mark unread error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/connect", async (req: Request, res: Response) => {
    try {
      const status = await checkGmailConnection();
      if (status.connected) {
        const returnUrl = req.query.return_url || '/';
        res.redirect(`${returnUrl}?gmail_connected=true`);
      } else {
        res.status(400).json({ 
          error: "Gmail no está configurado",
          message: "Gmail necesita ser conectado a través del panel de integraciones de Replit" 
        });
      }
    } catch (error: any) {
      res.status(400).json({ 
        error: "Gmail no está conectado",
        message: "Gmail necesita ser conectado a través del panel de integraciones de Replit",
        details: error.message
      });
    }
  });

  router.post("/disconnect", async (req: Request, res: Response) => {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    if (hostname) {
      res.json({ 
        success: true, 
        disconnectUrl: `https://${hostname}/connectors/google-mail/disconnect`,
        message: "Para desconectar Gmail, visita la URL de desconexión" 
      });
    } else {
      res.json({ success: false, message: "Connector not available" });
    }
  });

  return router;
}
