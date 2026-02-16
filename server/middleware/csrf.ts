import crypto from "crypto";
import { timingSafeEqual } from "crypto";
import { Request, Response, NextFunction } from "express";
import { parse } from "cookie";

const CSRF_COOKIE_NAME = "XSRF-TOKEN";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const IGNORED_METHODS = ["GET", "HEAD", "OPTIONS"];
const CSRF_TOKEN_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
const CSRF_TOKEN_BYTES = 16;

/**
 * Helper to ensure req.cookies exists
 */
const ensureCookies = (req: Request) => {
    if (!req.cookies && req.headers.cookie) {
        req.cookies = parse(req.headers.cookie);
    }
    return req.cookies || {};
};

function issueCsrfCookie(res: Response, isReplitDeployment: boolean, isProduction: boolean) {
  const token = crypto.randomBytes(CSRF_TOKEN_BYTES).toString("base64url");

  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Must be readable by client JS to header-ize it
    secure: isProduction,
    sameSite: isReplitDeployment ? "none" : "lax",
    maxAge: CSRF_TOKEN_MAX_AGE_MS,
    path: "/",
  });

  return token;
}

/**
 * Generates a CSRF token and sets it as a cookie readable by the client.
 * This implements the "Double Submit Cookie" pattern.
 * The client reads this cookie and sends it back in the X-CSRF-Token header.
 */
export const csrfTokenMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const cookies = ensureCookies(req);
    const isReplitDeployment = !!process.env.REPL_SLUG;
    const isProduction = process.env.NODE_ENV === "production" || isReplitDeployment;

    // Only set the token if it doesn't exist or we want to rotate it
    if (!res.headersSent && (!cookies[CSRF_COOKIE_NAME] || !CSRF_TOKEN_PATTERN.test(cookies[CSRF_COOKIE_NAME]))) {
        issueCsrfCookie(res, isReplitDeployment, isProduction);
    }
    next();
};

/**
 * Validates the CSRF token on state-changing requests.
 */
export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
    if (IGNORED_METHODS.includes(req.method)) {
        return next();
    }

    // Exempt pre-auth and webhook endpoints from CSRF.
    // Webhooks are validated with provider signatures; auth endpoints are not session-authenticated yet.
    const CSRF_EXEMPT_PATHS = [
        "/api/auth/login",
        "/api/auth/admin-login",
        "/api/auth/logout",
        "/api/auth/google",
        "/api/auth/google/callback",
        "/api/auth/microsoft",
        "/api/auth/microsoft/callback",
        "/api/auth/magic-link/send",
        "/api/auth/magic-link/verify",
        "/api/callback",
        "/api/login",
        "/api/webhooks",
    ];

    if (CSRF_EXEMPT_PATHS.some((path) => req.path === path || req.originalUrl === path)) {
        return next();
    }

    if (req.path.startsWith("/api/webhooks") || req.originalUrl.startsWith("/api/webhooks")) {
        return next();
    }

    const cookies = ensureCookies(req);

    // Frontend sends token in header
    const headerToken = req.headers[CSRF_HEADER_NAME.toLowerCase()] || req.headers[CSRF_HEADER_NAME];
    // Valid token comes from the cookie (which user agent sends automatically)
    const cookieToken = cookies[CSRF_COOKIE_NAME];
    const isReplitDeployment = !!process.env.REPL_SLUG;
    const isProduction = process.env.NODE_ENV === "production" || isReplitDeployment;

    if (typeof headerToken !== "string" || typeof cookieToken !== "string") {
        if (!res.headersSent) {
            issueCsrfCookie(res, isReplitDeployment, isProduction);
        }
        console.warn(`[Security] CSRF missing token. Method: ${req.method}, IP: ${req.ip}`);
        return res.status(403).json({
            error: "CSRF token validation failed",
            code: "CSRF_INVALID"
        });
    }

    if (!CSRF_TOKEN_PATTERN.test(cookieToken) || !CSRF_TOKEN_PATTERN.test(headerToken)) {
        if (!res.headersSent) {
            issueCsrfCookie(res, isReplitDeployment, isProduction);
        }
        console.warn(`[Security] CSRF invalid token format. Method: ${req.method}, IP: ${req.ip}`);
        return res.status(403).json({
            error: "CSRF token validation failed",
            code: "CSRF_INVALID"
        });
    }

    if (cookieToken.length !== headerToken.length) {
        if (!res.headersSent) {
            issueCsrfCookie(res, isReplitDeployment, isProduction);
        }
        console.warn(`[Security] CSRF mismatch length. Method: ${req.method}, IP: ${req.ip}`);
        return res.status(403).json({
            error: "CSRF token validation failed",
            code: "CSRF_INVALID"
        });
    }

    const cookieBuf = Buffer.from(cookieToken);
    const headerBuf = Buffer.from(headerToken);

    if (!timingSafeEqual(cookieBuf, headerBuf)) {
        if (!res.headersSent) {
            issueCsrfCookie(res, isReplitDeployment, isProduction);
        }
        console.warn(`[Security] CSRF mismatch/missing. Method: ${req.method}, IP: ${req.ip}`);
        return res.status(403).json({
            error: "CSRF token validation failed",
            code: "CSRF_INVALID"
        });
    }

    next();
};
