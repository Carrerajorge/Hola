import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { parse } from "cookie";

const CSRF_COOKIE_NAME = "XSRF-TOKEN";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const IGNORED_METHODS = ["GET", "HEAD", "OPTIONS"];

/**
 * Helper to ensure req.cookies exists
 */
const ensureCookies = (req: Request) => {
    if (!req.cookies && req.headers.cookie) {
        req.cookies = parse(req.headers.cookie);
    }
    return req.cookies || {};
};

/**
 * Generates a CSRF token and sets it as a cookie readable by the client.
 * This implements the "Double Submit Cookie" pattern.
 * The client reads this cookie and sends it back in the X-CSRF-Token header.
 */
export const csrfTokenMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const cookies = ensureCookies(req);

    // Only set the token if it doesn't exist or we want to rotate it
    if (!cookies[CSRF_COOKIE_NAME]) {
        const token = crypto.randomUUID();
        res.cookie(CSRF_COOKIE_NAME, token, {
            httpOnly: false, // Must be readable by client JS to header-ize it
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax", // Changed from "none" to "lax" for better compatibility
            path: "/",
        });
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

    // Exempt pre-authentication endpoints and essential API routes from CSRF
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
    ];

    // Also exempt paths that start with certain prefixes
    const CSRF_EXEMPT_PREFIXES = [
        "/api/chat",
        "/api/chats",  // Added plural form
        "/api/conversations",
        "/api/messages",
        "/api/sse",
        "/api/stream",
    ];

    if (CSRF_EXEMPT_PATHS.some(path => req.path === path || req.originalUrl === path)) {
        return next();
    }

    if (CSRF_EXEMPT_PREFIXES.some(prefix => req.path.startsWith(prefix) || req.originalUrl.startsWith(prefix))) {
        return next();
    }


    const cookies = ensureCookies(req);

    // Frontend sends token in header
    const headerToken = req.headers[CSRF_HEADER_NAME.toLowerCase()] || req.headers[CSRF_HEADER_NAME];
    // Valid token comes from the cookie (which user agent sends automatically)
    const cookieToken = cookies[CSRF_COOKIE_NAME];

    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
        console.warn(`[Security] CSRF mismatch/missing. Method: ${req.method}, IP: ${req.ip}`);
        return res.status(403).json({
            error: "CSRF token validation failed",
            code: "CSRF_INVALID"
        });
    }

    next();
};
