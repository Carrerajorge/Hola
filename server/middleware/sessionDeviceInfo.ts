import type { Request, Response, NextFunction } from "express";

const SESSION_DEVICE_INFO_BYPASS_PATHS = [
  "/health",
  "/health/live",
  "/health/ready",
  "/api/health",
  "/api/health/live",
  "/api/health/ready",
];

function normalizeRequestPath(pathValue: string): string {
  return pathValue.split("#", 1)[0]?.split("?", 1)[0] ?? pathValue;
}

function ipPrefixFromRequest(req: Request): string {
  const raw = String(req.ip || (req.socket as any)?.remoteAddress || "").replace("::ffff:", "");
  if (!raw) return "";

  // IPv6: keep first 4 groups. IPv4: keep first 3 octets.
  if (raw.includes(":")) return raw.split(":").slice(0, 4).join(":");
  return raw.split(".").slice(0, 3).join(".");
}

function hasPersistentSessionIdentity(session: any): boolean {
  if (!session || typeof session !== "object") return false;

  if (typeof session.authUserId === "string" && session.authUserId) return true;
  if (typeof session.anonUserId === "string" && session.anonUserId) return true;

  const passportUser = session.passport?.user;
  if (typeof passportUser === "string" && passportUser) return true;
  if (passportUser?.claims?.sub || passportUser?.id || passportUser?.sub) return true;

  return false;
}

function isHealthRequest(req: Request): boolean {
  const requestPaths = [req.path, req.originalUrl]
    .filter((value): value is string => Boolean(value))
    .map(normalizeRequestPath);

  return requestPaths.some((pathValue) =>
    SESSION_DEVICE_INFO_BYPASS_PATHS.some(
      (prefix) => pathValue === prefix || pathValue.startsWith(`${prefix}/`),
    ),
  );
}

export function shouldTrackSessionDeviceInfo(req: Request): boolean {
  const session = (req as any)?.session as any;
  if (!session) return false;

  if (hasPersistentSessionIdentity(session)) {
    return true;
  }

  const method = String(req.method || "GET").toUpperCase();
  return !["GET", "HEAD", "OPTIONS"].includes(method);
}

/**
 * Best-effort device metadata to help users manage active sessions.
 * Stored on the session object and persisted by connect-pg-simple.
 */
export function sessionDeviceInfoMiddleware(req: Request, _res: Response, next: NextFunction) {
  // Health probes must stay side-effect free so readiness never depends on
  // session persistence or a writable database-backed session store.
  if (isHealthRequest(req)) return next();

  const session = (req as any)?.session as any;
  if (!session) return next();
  if (!shouldTrackSessionDeviceInfo(req)) return next();

  const now = Date.now();
  const ua = String(req.headers["user-agent"] || "");
  // Privacy-preserving IP prefix (enough to recognize a network without storing full IP).
  const ip = ipPrefixFromRequest(req);

  const device = (session.device || {}) as any;

  let changed = false;

  if (typeof device.createdAt !== "number") {
    device.createdAt = now;
    changed = true;
  }

  if (typeof device.userAgent !== "string" || device.userAgent !== ua) {
    device.userAgent = ua;
    changed = true;
  }

  if (typeof device.ip !== "string" || device.ip !== ip) {
    device.ip = ip;
    changed = true;
  }

  // Throttle lastSeenAt updates to reduce DB writes (sessions are persisted in Postgres).
  if (typeof device.lastSeenAt !== "number" || now - device.lastSeenAt > 60_000) {
    device.lastSeenAt = now;
    changed = true;
  }

  if (changed) session.device = device;

  next();
}
