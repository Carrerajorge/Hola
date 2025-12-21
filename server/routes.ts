import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { browserSessionManager, SessionEvent } from "./agent/browser";
import { StepUpdate } from "./agent";
import { FileStatusUpdate, fileProcessingQueue } from "./lib/fileProcessingQueue";
import { setupAuth, registerAuthRoutes, validateWebSocketSession } from "./replit_integrations/auth";

import { pptExportRouter } from "./routes/pptExport";
import { agentRouter } from "./routes/agent";
import { createBrowserRouter } from "./routes/browser";
import { createChatRouter } from "./routes/chat";
import { createFilesRouter } from "./routes/files";
import { createAdminRouter } from "./routes/admin";
import { imageRouter } from "./routes/image";
import { etlRouter } from "./routes/etl";
import { gptsRouter } from "./routes/gpts";
import { documentsRouter } from "./routes/documents";
import { figmaRouter } from "./routes/figma";
import { libraryRouter } from "./routes/library";
import { sandboxRouter } from "./routes/sandbox";
import { usersRouter } from "./routes/users";

const agentClients: Map<string, Set<WebSocket>> = new Map();
const browserClients: Map<string, Set<WebSocket>> = new Map();
const fileStatusClients: Map<string, Set<WebSocket>> = new Map();

function broadcastBrowserEvent(sessionId: string, event: SessionEvent) {
  const clients = browserClients.get(sessionId);
  if (!clients) return;
  
  const message = JSON.stringify({ 
    messageType: "browser_event", 
    eventType: event.type,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    data: event.data
  });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastAgentUpdate(runId: string, update: StepUpdate) {
  const clients = agentClients.get(runId);
  if (!clients) return;
  
  const message = JSON.stringify({ type: "step_update", ...update });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastFileStatus(update: FileStatusUpdate) {
  const clients = fileStatusClients.get(update.fileId);
  if (!clients) return;
  
  const message = JSON.stringify(update);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await setupAuth(app);
  registerAuthRoutes(app);

  browserSessionManager.addGlobalEventListener((event: SessionEvent) => {
    broadcastBrowserEvent(event.sessionId, event);
  });

  app.use("/api/ppt", pptExportRouter);
  app.use("/api/agent", agentRouter);
  app.use("/api/browser", createBrowserRouter(broadcastBrowserEvent));
  app.use(createChatRouter(broadcastAgentUpdate));
  app.use(createFilesRouter());
  app.use(createAdminRouter());

  fileProcessingQueue.setStatusChangeHandler(broadcastFileStatus);
  app.use("/api/image", imageRouter);
  app.use("/api/etl", etlRouter);
  app.use("/api/gpts", gptsRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/figma", figmaRouter);
  app.use("/api/library", libraryRouter);
  app.use(sandboxRouter);
  app.use(usersRouter);

  const wssAgent = new WebSocketServer({ noServer: true });
  const wssBrowser = new WebSocketServer({ noServer: true });
  const wssFileStatus = new WebSocketServer({ noServer: true });

  wssAgent.on("connection", (ws: WebSocket, runId: string) => {
    if (!agentClients.has(runId)) {
      agentClients.set(runId, new Set());
    }
    agentClients.get(runId)!.add(ws);

    ws.on("close", () => {
      const clients = agentClients.get(runId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          agentClients.delete(runId);
        }
      }
    });
  });

  wssBrowser.on("connection", (ws: WebSocket, sessionId: string) => {
    if (!browserClients.has(sessionId)) {
      browserClients.set(sessionId, new Set());
    }
    browserClients.get(sessionId)!.add(ws);

    ws.on("close", () => {
      const clients = browserClients.get(sessionId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          browserClients.delete(sessionId);
        }
      }
    });
  });

  wssFileStatus.on("connection", (ws: WebSocket, fileId: string) => {
    if (!fileStatusClients.has(fileId)) {
      fileStatusClients.set(fileId, new Set());
    }
    fileStatusClients.get(fileId)!.add(ws);

    ws.on("close", () => {
      const clients = fileStatusClients.get(fileId);
      if (clients) {
        clients.delete(ws);
        if (clients.size === 0) {
          fileStatusClients.delete(fileId);
        }
      }
    });
  });

  httpServer.on("upgrade", async (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const pathname = url.pathname;

    const user = await validateWebSocketSession(request.headers.cookie);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (pathname.startsWith("/ws/agent/")) {
      const runId = pathname.replace("/ws/agent/", "");
      wssAgent.handleUpgrade(request, socket, head, (ws) => {
        wssAgent.emit("connection", ws, runId, user);
      });
    } else if (pathname.startsWith("/ws/browser/")) {
      const sessionId = pathname.replace("/ws/browser/", "");
      wssBrowser.handleUpgrade(request, socket, head, (ws) => {
        wssBrowser.emit("connection", ws, sessionId, user);
      });
    } else if (pathname.startsWith("/ws/file-status/")) {
      const fileId = pathname.replace("/ws/file-status/", "");
      wssFileStatus.handleUpgrade(request, socket, head, (ws) => {
        wssFileStatus.emit("connection", ws, fileId, user);
      });
    } else {
      socket.destroy();
    }
  });

  return httpServer;
}
