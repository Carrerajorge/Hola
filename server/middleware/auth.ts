
import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { getSecureUserId } from "../lib/anonUserHelper";

/**
 * Middleware to require 2FA verification for accessing sensitive routes.
 * If the user has 2FA enabled in the database, they must have a valid 2FA session.
 * For specific high-security roles (like admin), this can be enforced even if they haven't set it up (forcing them to set it up via another route).
 */
export async function require2FA(req: Request, res: Response, next: NextFunction) {
    try {
        const user = (req as any).user;
        if (!user || !user.claims) {
            // Not authenticated at all
            return res.status(401).json({ error: "Unauthorized" });
        }

        const userId = user.claims.sub;
        const session = (req.session as any);

        // If 2FA is already verified in this session, proceed
        if (session.is2FAVerified) {
            return next();
        }

        // Fetch full user record to check if 2FA is enabled
        const dbUser = await storage.getUser(userId);
        if (!dbUser) {
            return res.status(401).json({ error: "User not found" });
        }

        // Check if 2FA is enabled for this user
        if (dbUser.totpEnabled) {
            // 2FA is enabled but not verified in session -> 403 Forbidden (requires verification)
            return res.status(403).json({
                error: "2FA Verification Required",
                code: "2FA_REQUIRED",
                message: "You must verify your 2FA code to access this resource."
            });
        }

        // IF we want to FORCE 2FA for admins:
        if (dbUser.role === 'admin' && !dbUser.totpEnabled) {
            // Optional: Force them to setup 2FA.
            // For now, we allow them if not enabled, but we might want to warn or block.
            // The audit said "Strictly Require", implying they MUST have it.
            // If we block here, they can't access admin panel. They need to go to profile settings to enable it.
            return res.status(403).json({
                error: "2FA Setup Required",
                code: "2FA_SETUP_REQUIRED",
                message: "Administrators must have 2FA enabled to access this area."
            });
        }

        // User does not have 2FA enabled (and is not forced), proceed
        next();
    } catch (error) {
        console.error("[AuthMiddleware] 2FA check error:", error);
        res.status(500).json({ error: "Internal Server Error during security check" });
    }
}
