import type { Request, Response, NextFunction } from "express";
import { randomUUID, createHash } from "crypto";
import {
  checkIdempotencyKey,
  computePayloadHash,
  type IdempotencyCheckResult
} from "../lib/idempotencyStore";

export interface PareContext {
  requestId: string;
  idempotencyKey: string | null;
  payloadHash: string | null;
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
  
  let payloadHash: string | null = null;
  if (idempotencyKey && req.body) {
    payloadHash = computePayloadHash(req.body);
  }
  
  const pareContext: PareContext = {
    requestId,
    idempotencyKey,
    payloadHash,
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

export async function pareIdempotencyGuard(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const pareContext = req.pareContext;
  
  if (!pareContext) {
    next();
    return;
  }
  
  const { idempotencyKey, payloadHash, requestId } = pareContext;
  
  if (!idempotencyKey || !payloadHash) {
    next();
    return;
  }
  
  try {
    const result = await checkIdempotencyKey(idempotencyKey, payloadHash);
    
    switch (result.status) {
      case 'new':
        next();
        return;
      
      case 'completed':
        console.log(JSON.stringify({
          level: "info",
          event: "IDEMPOTENCY_REPLAY",
          requestId,
          idempotencyKey,
          timestamp: new Date().toISOString()
        }));
        res.status(200).json(result.cachedResponse);
        return;
      
      case 'processing':
        console.log(JSON.stringify({
          level: "warn",
          event: "IDEMPOTENCY_IN_PROGRESS",
          requestId,
          idempotencyKey,
          timestamp: new Date().toISOString()
        }));
        res.status(409).json({
          error: "IDEMPOTENCY_IN_PROGRESS",
          message: "Request with this idempotency key is currently being processed. Please retry later.",
          requestId,
          idempotencyKey
        });
        return;
      
      case 'conflict':
        console.log(JSON.stringify({
          level: "warn",
          event: "IDEMPOTENCY_CONFLICT",
          requestId,
          idempotencyKey,
          timestamp: new Date().toISOString()
        }));
        res.status(409).json({
          error: "IDEMPOTENCY_CONFLICT",
          message: "Request with this idempotency key exists with a different payload.",
          requestId,
          idempotencyKey
        });
        return;
    }
  } catch (error: any) {
    console.error(JSON.stringify({
      level: "error",
      event: "IDEMPOTENCY_GUARD_ERROR",
      requestId,
      idempotencyKey,
      error: error.message,
      timestamp: new Date().toISOString()
    }));
    next();
  }
}
