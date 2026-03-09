import type { Request } from "express";

import { env } from "../../config/env";

function firstHeaderValue(value: string | undefined): string | null {
  if (!value) return null;
  const [first] = value.split(",");
  const trimmed = first?.trim();
  return trimmed ? trimmed : null;
}

function safeOriginFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function safeOriginFromBaseUrl(): string | null {
  try {
    return new URL(env.BASE_URL).origin;
  } catch {
    return null;
  }
}

function normalizeHostname(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "").replace(/:\d+$/, "").toLowerCase();
}

function extractPort(host: string): string | null {
  const match = host.match(/:(\d+)$/);
  return match?.[1] ?? null;
}

function isLoopbackHost(host: string): boolean {
  const hostname = normalizeHostname(host);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0";
}

function isLikelyInternalDevHost(host: string | null): boolean {
  if (!host) return false;
  return isLoopbackHost(host) && extractPort(host) === String(env.PORT);
}

function resolveRequestOrigin(req: Request): string {
  const forwardedHost = firstHeaderValue(req.get("x-forwarded-host"));
  const forwardedProto = firstHeaderValue(req.get("x-forwarded-proto"));
  if (forwardedHost) {
    return `${forwardedProto || req.protocol || "https"}://${forwardedHost}`;
  }

  const host = firstHeaderValue(req.get("host"));
  if (host && !isLikelyInternalDevHost(host)) {
    return `${req.protocol || "http"}://${host}`;
  }

  const headerOrigin =
    safeOriginFromUrl(firstHeaderValue(req.get("origin"))) ||
    safeOriginFromUrl(firstHeaderValue(req.get("referer")));
  if (headerOrigin) {
    return headerOrigin;
  }

  const baseOrigin = safeOriginFromBaseUrl();
  if (baseOrigin) {
    return baseOrigin;
  }

  if (host) {
    return `${req.protocol || "http"}://${host}`;
  }

  return "http://localhost";
}

export function resolveOAuthCallbackUrl(req: Request, path: string): string {
  return new URL(path, resolveRequestOrigin(req)).toString();
}
