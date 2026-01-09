import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

export interface PareContext {
  requestId: string;
  idempotencyKey: string | null;
  isDataMode: boolean;
  attachmentsCount: number;
  startTime: number;
  clientIp: string;
  userId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      pareContext: PareContext;
    }
  }
}

const HEADER_REQUEST_ID = "x-request-id";
const HEADER_IDEMPOTENCY_KEY = "x-idempotency-key";

function getClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) 
      ? forwardedFor[0] 
      : forwardedFor.split(",")[0];
    return ips.trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function extractHeader(req: Request, headerName: string): string | null {
  const value = req.headers[headerName];
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

function isValidUUIDv4(uuid: string): boolean {
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(uuid);
}

function countAttachments(req: Request): number {
  const { attachments } = req.body || {};
  if (!attachments || !Array.isArray(attachments)) {
    return 0;
  }
  return attachments.length;
}

function detectDataMode(attachmentsCount: number): boolean {
  return attachmentsCount > 0;
}

export function pareRequestContract(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startTime = Date.now();
  
  let requestId = extractHeader(req, HEADER_REQUEST_ID);
  if (!requestId || !isValidUUIDv4(requestId)) {
    requestId = randomUUID();
  }
  
  const idempotencyKey = extractHeader(req, HEADER_IDEMPOTENCY_KEY);
  
  const clientIp = getClientIp(req);
  
  const user = (req as any).user;
  const userId = user?.claims?.sub || null;
  
  const attachmentsCount = countAttachments(req);
  
  const isDataMode = detectDataMode(attachmentsCount);
  
  const pareContext: PareContext = {
    requestId,
    idempotencyKey,
    isDataMode,
    attachmentsCount,
    startTime,
    clientIp,
    userId,
  };
  
  req.pareContext = pareContext;
  
  res.setHeader("X-Request-Id", requestId);
  
  console.log(JSON.stringify({
    level: "info",
    event: "PARE_REQUEST_RECEIVED",
    requestId,
    idempotencyKey,
    isDataMode,
    attachmentsCount,
    clientIp,
    userId,
    method: req.method,
    path: req.path,
    timestamp: new Date(startTime).toISOString(),
  }));
  
  next();
}

export function getPareContext(req: Request): PareContext | undefined {
  return req.pareContext;
}

export function requirePareContext(req: Request): PareContext {
  if (!req.pareContext) {
    throw new Error("PARE context not initialized - pareRequestContract middleware must be applied first");
  }
  return req.pareContext;
}
