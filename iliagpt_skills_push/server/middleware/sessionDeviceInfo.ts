import type { Request, Response, NextFunction } from "express";

function ipPrefixFromRequest(req: Request): string {
  const raw = String(req.ip || (req.socket as any)?.remoteAddress || "").replace("::ffff:", "");
  if (!raw) return "";

  // IPv6: keep first 4 groups. IPv4: keep first 3 octets.
  if (raw.includes(":")) return raw.split(":").slice(0, 4).join(":");
  return raw.split(".").slice(0, 3).join(".");
}

/**
 * Best-effort device metadata to help users manage active sessions.
 * Stored on the session object and persisted by connect-pg-simple.
 */
export function sessionDeviceInfoMiddleware(req: Request, _res: Response, next: NextFunction) {
  const session = (req as any)?.session as any;
  if (!session) return next();

  const ua = String(req.headers["user-agent"] || "");
  const ipPrefix = ipPrefixFromRequest(req);

  const device = (session.device || {}) as any;

  if (typeof device.userAgent !== "string") device.userAgent = ua;
  if (typeof device.ipPrefix !== "string") device.ipPrefix = ipPrefix;
  if (typeof device.createdAt !== "string") device.createdAt = new Date().toISOString();

  // Only write to the session when something is missing to avoid extra DB churn.
  const shouldUpdate =
    !session.device ||
    session.device.userAgent !== device.userAgent ||
    session.device.ipPrefix !== device.ipPrefix ||
    session.device.createdAt !== device.createdAt;

  if (shouldUpdate) {
    session.device = device;
  }

  next();
}

