import crypto from "crypto";
import { db } from "../db";
import { users, magicLinks } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import { getSettingValue } from "./settingsConfigService";
import { autoAcceptWorkspaceInvitationForUser } from "./workspaceInvitationService";

const MAGIC_LINK_EXPIRY_MINUTES = 15;

interface MagicLinkResult {
    success: boolean;
    token?: string;
    error?: string;
}

/**
 * Generate a magic link token for email authentication
 */
export async function createMagicLink(email: string): Promise<MagicLinkResult> {
    try {
        // Generate secure token
        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000);

        // Find or create user
        let [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);

        if (!user) {
            const allowRegistration = await getSettingValue<boolean>("allow_registration", true);
            if (!allowRegistration) {
                return { success: false, error: "El registro está deshabilitado. Contacta al administrador." };
            }

            // Create new user for magic link signup
            const newUserId = crypto.randomUUID();
            const [newUser] = await db.insert(users).values({
                id: newUserId,
                orgId: "default",
                email: email.toLowerCase(),
                firstName: email.split("@")[0],
                lastName: "",
                role: "user",
                status: "pending", // Will be activated on first magic link verification
                emailVerified: "false",
            }).returning();
            user = newUser;
        }

        // Delete any existing magic links for this user
        await db.delete(magicLinks).where(eq(magicLinks.userId, user.id));

        // Create new magic link
        await db.insert(magicLinks).values({
            userId: user.id,
            token,
            expiresAt,
            used: false,
        });

        console.log(`[MagicLink] Created token for ${email}, expires at ${expiresAt.toISOString()}`);

        return { success: true, token };
    } catch (error) {
        console.error("[MagicLink] Error creating magic link:", error);
        return { success: false, error: "Error al crear el enlace mágico" };
    }
}

/**
 * Verify a magic link token
 */
export async function verifyMagicLink(token: string): Promise<{ success: boolean; user?: any; error?: string }> {
    try {
        // Find the magic link
        const [link] = await db
            .select()
            .from(magicLinks)
            .where(
                and(
                    eq(magicLinks.token, token),
                    eq(magicLinks.used, false),
                    gt(magicLinks.expiresAt, new Date())
                )
            )
            .limit(1);

        if (!link) {
            return { success: false, error: "Enlace inválido o expirado" };
        }

        // Mark as used
        await db.update(magicLinks).set({ used: true }).where(eq(magicLinks.id, link.id));

        // Get and activate user
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, link.userId))
            .limit(1);

        if (!user) {
            return { success: false, error: "Usuario no encontrado" };
        }

        // Activate user if pending + mark email verified
        const wasPending = user.status === "pending";
        const patch: Record<string, any> = { emailVerified: "true", updatedAt: new Date() };
        if (wasPending) patch.status = "active";
        await db.update(users).set(patch).where(eq(users.id, user.id));

        try {
            await autoAcceptWorkspaceInvitationForUser(user.id);
        } catch (e) {
            console.warn("[MagicLink] Failed to auto-accept workspace invitation:", e);
        }

        console.log(`[MagicLink] Verified token for user ${user.email}`);

        return {
            success: true,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
            },
        };
    } catch (error) {
        console.error("[MagicLink] Error verifying magic link:", error);
        return { success: false, error: "Error al verificar el enlace" };
    }
}

/**
 * Generate the full magic link URL
 */
export function getMagicLinkUrl(token: string): string {
    const baseUrl = process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
        : "http://localhost:5050";
    // This endpoint performs the login and redirects to the app.
    return `${baseUrl}/api/auth/magic-link/verify?token=${token}`;
}
