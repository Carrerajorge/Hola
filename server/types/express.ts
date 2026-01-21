/**
 * Typed Express Request Extensions
 * Fix #13: Replace `as any` type bypasses with proper typing
 */
import { Request } from 'express';

/**
 * User claims from authentication middleware (Replit Auth style)
 */
export interface UserClaims {
    sub: string;          // User ID
    email?: string;       // User email
    name?: string;        // Display name
    picture?: string;     // Profile picture URL
    iat?: number;         // Issued at timestamp
    exp?: number;         // Expiration timestamp
}

/**
 * Authenticated user object attached by auth middleware
 */
export interface AuthenticatedUser {
    claims: UserClaims;
    id?: string;          // Convenience alias for sub
}

/**
 * Express Request with authenticated user
 * Use this instead of `(req as any).user`
 */
export interface AuthenticatedRequest extends Request {
    user?: AuthenticatedUser;
}

/**
 * Express Request with required authentication
 * Guaranteed to have user after auth middleware
 */
export interface RequiredAuthRequest extends Request {
    user: AuthenticatedUser;
}

/**
 * Helper to safely extract user ID from request
 * @param req Express request (potentially authenticated)
 * @returns User ID string or undefined
 */
export function getUserId(req: Request): string | undefined {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.claims?.sub;
}

/**
 * Helper to safely extract user claims from request
 * @param req Express request (potentially authenticated)
 * @returns User claims or undefined
 */
export function getUserClaims(req: Request): UserClaims | undefined {
    const authReq = req as AuthenticatedRequest;
    return authReq.user?.claims;
}

/**
 * Type guard to check if request is authenticated
 */
export function isAuthenticatedRequest(req: Request): req is RequiredAuthRequest {
    const authReq = req as AuthenticatedRequest;
    return !!(authReq.user?.claims?.sub);
}
