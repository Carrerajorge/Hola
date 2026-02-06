import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated, getSessionStats } from "./replitAuth";
import { storage } from "../../storage";
import { db } from "../../db";
import { sessions as sessionsTable } from "@shared/schema";
import { hashPassword, verifyPassword, isHashed } from "../../utils/password";
import { loginSchema, registerSchema, validate } from "../../validation/schemas";
import { rateLimiter as authRateLimiter, getRateLimitStats } from "../../middleware/userRateLimiter";
import { sendMagicLinkEmail } from "../../services/genericEmailService";
import { desc, eq, inArray, sql } from "drizzle-orm";

// Admin credentials from environment variables - REQUIRED, no fallback for security
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAdminConfigured(): boolean {
  return !!(ADMIN_EMAIL && ADMIN_PASSWORD && ADMIN_PASSWORD.length >= 8);
}

// Sanitize user object to remove sensitive fields
function sanitizeUser(user: any): any {
  if (!user) return user;
  const { password, ...safeUser } = user;
  return safeUser;
}

function getEffectiveUserId(req: any): string | null {
  const sessionUser = req.session?.passport?.user;
  const effectiveUser = req.user || sessionUser;
  return (
    effectiveUser?.claims?.sub ||
    effectiveUser?.id ||
    req.session?.authUserId ||
    null
  );
}

function sessionBelongsToUser(sess: any, userId: string): boolean {
  if (!sess || !userId) return false;
  if (String(sess.authUserId || "") === userId) return true;
  const sub = sess?.passport?.user?.claims?.sub;
  if (String(sub || "") === userId) return true;
  const id = sess?.passport?.user?.id;
  if (String(id || "") === userId) return true;
  return false;
}

function updateSessionDevice(req: any): boolean {
  const sess = req.session;
  if (!sess) return false;

  const now = Date.now();
  const previousLastSeen = sess.device?.lastSeenAtMs;
  // Avoid a DB write on every page load/render cycle; update at most once per minute.
  if (typeof previousLastSeen === "number" && now - previousLastSeen < 60_000) {
    return false;
  }

  const createdAtMs =
    typeof sess.device?.createdAtMs === "number" ? sess.device.createdAtMs : now;

  sess.device = {
    ...(sess.device || {}),
    createdAtMs,
    lastSeenAtMs: now,
    userAgent: req.headers["user-agent"] || null,
    ipAddress: req.ip || req.socket?.remoteAddress || null,
  };

  return true;
}

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Legacy routes removed in favor of Passport.js in server/routes.ts

  // Auth metrics endpoint (admin only)


  app.get("/api/auth/metrics", isAuthenticated, async (req: any, res) => {
    try {
      const user = await authStorage.getUser(req.user?.claims?.sub);
      if (user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
      }

      res.json({
        auth: getSessionStats(),
        rateLimit: getRateLimitStats(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[Auth] Failed to get metrics:", error);
      res.status(500).json({ message: "Failed to retrieve metrics" });
    }
  });

  // User login with email/password (for users created by admin)
  app.post("/api/auth/login", authRateLimiter, async (req: any, res) => {
    try {
      // Validate input
      const validation = loginSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Datos inválidos",
          errors: validation.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      
      const { email, password } = validation.data;

      // Check if it's the admin (case-insensitive email comparison)
      if (isAdminConfigured() && email.toLowerCase() === ADMIN_EMAIL!.toLowerCase() && password === ADMIN_PASSWORD) {
        const adminId = "admin-user-id";
        await authStorage.upsertUser({
          id: adminId,
          email: ADMIN_EMAIL,
          firstName: "Admin",
          lastName: "User",
          profileImageUrl: null,
          role: "admin",
        });

        const adminUser = {
          claims: {
            sub: adminId,
            email: ADMIN_EMAIL,
            first_name: "Admin",
            last_name: "User",
          },
          expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
        };

        return req.login(adminUser, async (err: any) => {
          if (err) {
            return res.status(500).json({ message: "Error al iniciar sesión" });
          }

          // Workaround: persist userId explicitly (robust even if Passport serialization fails).
          // Some environments end up persisting an empty `passport` object.
          if (req.session) {
            req.session.authUserId = adminId;
            req.session.passport = req.session.passport || {};
            req.session.passport.user = adminUser;
          }

          // Force session save before responding
          req.session.save(async (saveErr: any) => {
            if (saveErr) {
              console.error("Session save error:", saveErr);
              return res.status(500).json({ message: "Error al guardar sesión" });
            }
            const user = await authStorage.getUser(adminId);
            res.json({ success: true, user: sanitizeUser(user) });
          });
        });
      }

      // Find user in database by email
      const allUsers = await storage.getAllUsers();
      const dbUser = allUsers.find(u => u.email?.toLowerCase() === email.toLowerCase());

      if (!dbUser) {
        return res.status(401).json({ message: "Usuario no encontrado" });
      }

      // Verify password - handle both hashed and legacy plain text passwords
      let passwordValid = false;
      let needsPasswordMigration = false;

      if (dbUser.password) {
        if (isHashed(dbUser.password)) {
          passwordValid = await verifyPassword(password, dbUser.password);
        } else {
          passwordValid = dbUser.password === password;
          needsPasswordMigration = passwordValid;
        }
      }

      if (!passwordValid) {
        return res.status(401).json({ message: "Contraseña incorrecta" });
      }

      // Migrate legacy plain text password to hashed version
      if (needsPasswordMigration) {
        try {
          const hashedPassword = await hashPassword(password);
          await storage.updateUser(dbUser.id, { password: hashedPassword });
          console.log(`Password migrated to bcrypt hash for user: ${dbUser.email}`);
        } catch (migrationError) {
          console.error("Failed to migrate password to hash:", migrationError);
        }
      }

      // Check if user is active
      if (dbUser.status !== "active") {
        return res.status(401).json({ message: "Usuario inactivo" });
      }

      // Set up session
      const sessionUser = {
        claims: {
          sub: dbUser.id,
          email: dbUser.email,
          first_name: dbUser.firstName || "",
          last_name: dbUser.lastName || "",
          role: dbUser.role || "user",
        },
        role: dbUser.role || "user",
        expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
      };

      req.login(sessionUser, async (err: any) => {
        if (err) {
          return res.status(500).json({ message: "Error al iniciar sesión" });
        }

        // Workaround: persist userId explicitly (robust even if Passport serialization fails).
        if (req.session) {
          req.session.authUserId = dbUser.id;
          req.session.passport = req.session.passport || {};
          req.session.passport.user = sessionUser;
        }

        // Track login and update last login
        try {
          await authStorage.updateUserLogin(dbUser.id, {
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.headers["user-agent"] || null
          });

          await storage.createAuditLog({
            userId: dbUser.id,
            action: "user_login",
            resource: "auth",
            details: { email: dbUser.email },
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.headers["user-agent"] || null
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }

        // Force session save before responding
        req.session.save((saveErr: any) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.status(500).json({ message: "Error al guardar sesión" });
          }
          res.json({ success: true, user: sanitizeUser(dbUser) });
        });
      });
    } catch (error) {
      console.error("Login error:", error);
      const fs = require('fs');
      try {
        fs.appendFileSync('login_debug.log', `[${new Date().toISOString()}] Login Error: ${error}\nStack: ${(error as any).stack}\n`);
      } catch (e) { /* ignore */ }
      res.status(500).json({ message: "Error al iniciar sesión" });
    }
  });

  // Admin login with email/password
  app.post("/api/auth/admin-login", authRateLimiter, async (req: any, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: "Email and password required" });
      }

      // Verify admin is configured and credentials match
      if (!isAdminConfigured() || email.toLowerCase() !== ADMIN_EMAIL!.toLowerCase() || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Create or get admin user
      const adminId = "admin-user-id";
      await authStorage.upsertUser({
        id: adminId,
        email: ADMIN_EMAIL,
        firstName: "Admin",
        lastName: "User",
        profileImageUrl: null,
        role: "admin",
      });

      // Set up session for admin
      const adminUser = {
        claims: {
          sub: adminId,
          email: ADMIN_EMAIL,
          first_name: "Admin",
          last_name: "User",
        },
        expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 1 week
      };

      req.login(adminUser, async (err: any) => {
        if (err) {
          console.error("Admin login error:", err);
          return res.status(500).json({ message: "Login failed" });
        }

        // Track admin login and update last login
        try {
          await authStorage.updateUserLogin(adminId, {
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.headers["user-agent"] || null
          });

          await storage.createAuditLog({
            userId: adminId,
            action: "admin_login",
            resource: "auth",
            details: { email: ADMIN_EMAIL },
            ipAddress: req.ip || req.socket.remoteAddress || null,
            userAgent: req.headers["user-agent"] || null
          });
        } catch (auditError) {
          console.error("Failed to create audit log:", auditError);
        }

        // Force session save before responding
        req.session.save((saveErr: any) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.status(500).json({ message: "Error saving session" });
          }
          res.json({ success: true, user: { id: adminId, email: ADMIN_EMAIL, firstName: "Admin", lastName: "User", role: "admin" } });
        });
      });
    } catch (error) {
      console.error("Admin login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  // Logout via POST (for SPA - clears session without redirect)
  app.post("/api/auth/logout", async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (userId) {
        await storage.createAuditLog({
          userId,
          action: "user_logout",
          resource: "auth",
          details: {},
          ipAddress: req.ip || req.socket.remoteAddress || null,
          userAgent: req.headers["user-agent"] || null
        });
      }
      req.logout((err: any) => {
        if (err) {
          console.error("Logout error:", err);
        }
        if (req.session) {
          req.session.destroy((destroyErr: any) => {
            if (destroyErr) {
              console.error("Session destroy error:", destroyErr);
            }
            res.clearCookie("siragpt.sid");
            res.json({ success: true });
          });
          return;
        }
        res.clearCookie("siragpt.sid");
        res.json({ success: true });
      });
    } catch (error) {
      console.error("Logout error:", error);
      res.json({ success: true });
    }
  });

  // Get current authenticated user
  app.get("/api/auth/user", async (req: any, res) => {
    try {
      // Passport should populate req.user, but in some environments we observed
      // sessions persisted with `req.session.passport.user` while `req.user` is missing.
      // Fallback to the session payload so login persists.
      const sessionUser = req.session?.passport?.user;
      const effectiveUser = req.user || sessionUser;
      const userId =
        effectiveUser?.claims?.sub ||
        effectiveUser?.id ||
        req.session?.authUserId;

      if (!userId) {
        console.warn("[Auth] /api/auth/user unauthorized", {
          hasCookieHeader: !!req.headers.cookie,
          sessionID: req.sessionID,
          hasSession: !!req.session,
          sessionPassportKeys: req.session?.passport ? Object.keys(req.session.passport) : null,
          authUserId: req.session?.authUserId,
        });
        return res.status(401).json({ message: "Unauthorized" });
      }

      const user = await authStorage.getUser(userId);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      // Update device metadata for Security -> Trusted devices.
      if (updateSessionDevice(req)) {
        req.session?.save?.(() => undefined);
      }

      res.json(sanitizeUser(user));
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // List active sessions/devices for the current user.
  app.get("/api/auth/sessions", async (req: any, res) => {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const limitRaw = parseInt(String(req.query.limit || "25"), 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 25;

      const rows = await db
        .select({
          sid: sessionsTable.sid,
          sess: sessionsTable.sess,
          expire: sessionsTable.expire,
        })
        .from(sessionsTable)
        .where(sql`(
          ${sessionsTable.sess}->>'authUserId' = ${userId}
          OR ${sessionsTable.sess}->'passport'->'user'->'claims'->>'sub' = ${userId}
          OR ${sessionsTable.sess}->'passport'->'user'->>'id' = ${userId}
        )`)
        .orderBy(desc(sessionsTable.expire))
        .limit(limit);

      const currentSid = req.sessionID;
      const sessions = rows.map((row) => {
        const sess = row.sess as any;
        const device = sess?.device || {};
        return {
          sid: row.sid,
          expire: row.expire,
          isCurrent: row.sid === currentSid,
          device: {
            createdAtMs: device?.createdAtMs ?? null,
            lastSeenAtMs: device?.lastSeenAtMs ?? null,
            userAgent: device?.userAgent ?? null,
            ipAddress: device?.ipAddress ?? null,
          },
        };
      });

      res.json({ sessions });
    } catch (error) {
      console.error("[Auth] Failed to list sessions:", error);
      res.status(500).json({ message: "Failed to list sessions" });
    }
  });

  // Revoke a specific session by sid (must belong to the current user).
  app.post("/api/auth/sessions/revoke", async (req: any, res) => {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const sid = String(req.body?.sid || "").trim();
      if (!sid) return res.status(400).json({ message: "sid is required" });

      const [row] = await db
        .select({ sid: sessionsTable.sid, sess: sessionsTable.sess })
        .from(sessionsTable)
        .where(eq(sessionsTable.sid, sid))
        .limit(1);

      if (!row) return res.status(404).json({ message: "Session not found" });
      if (!sessionBelongsToUser(row.sess, userId)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Failed to revoke session:", error);
      res.status(500).json({ message: "Failed to revoke session" });
    }
  });

  // Logout everywhere: revoke all sessions belonging to the current user.
  app.post("/api/auth/logout-all", async (req: any, res) => {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const rows = await db
        .select({ sid: sessionsTable.sid })
        .from(sessionsTable)
        .where(sql`(
          ${sessionsTable.sess}->>'authUserId' = ${userId}
          OR ${sessionsTable.sess}->'passport'->'user'->'claims'->>'sub' = ${userId}
          OR ${sessionsTable.sess}->'passport'->'user'->>'id' = ${userId}
        )`);

      const sids = rows.map((r) => r.sid).filter(Boolean);
      if (sids.length > 0) {
        await db.delete(sessionsTable).where(inArray(sessionsTable.sid, sids));
      }

      res.json({ success: true, count: sids.length });
    } catch (error) {
      console.error("[Auth] Failed to logout-all:", error);
      res.status(500).json({ message: "Failed to logout all sessions" });
    }
  });

  // Magic Link - Request a magic link (passwordless login)
  app.post("/api/auth/magic-link/send", authRateLimiter, async (req: any, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email es requerido" });
      }

      // Dynamic import to avoid circular dependencies
      const { createMagicLink, getMagicLinkUrl } = await import("../../services/magicLink");

      const result = await createMagicLink(email);

      if (!result.success) {
        return res.status(500).json({ message: result.error });
      }

      // In production, send email. For development, return the URL directly
      const magicLinkUrl = getMagicLinkUrl(result.token!);

      if (process.env.NODE_ENV === "production") {
        // Send email with magic link
        const emailResult = await sendMagicLinkEmail(email, magicLinkUrl);
        if (!emailResult.success) {
          console.error(`[MagicLink] Failed to send email to ${email}:`, emailResult.error);
          // Still return success but log the error
        }
        console.log(`[MagicLink] Sent email to ${email}`);
        res.json({
          success: true,
          message: "Hemos enviado un enlace mágico a tu correo electrónico."
        });
      } else {
        // Development mode - return the URL for testing
        console.log(`[MagicLink] Development mode - returning link directly`);
        res.json({
          success: true,
          message: "Enlace mágico generado (modo desarrollo)",
          magicLinkUrl // Only in development!
        });
      }
    } catch (error) {
      console.error("[MagicLink] Send error:", error);
      res.status(500).json({ message: "Error al enviar el enlace mágico" });
    }
  });

  // Magic Link - Verify token and login
  app.get("/api/auth/magic-link/verify", async (req: any, res) => {
    try {
      const { token } = req.query;

      if (!token || typeof token !== "string") {
        return res.redirect("/login?error=invalid_token");
      }

      const { verifyMagicLink } = await import("../../services/magicLink");
      const result = await verifyMagicLink(token);

      if (!result.success) {
        return res.redirect(`/login?error=magic_link_expired`);
      }

      // Create session for the user
      const userClaims = {
        claims: {
          sub: result.user.id,
          email: result.user.email,
          first_name: result.user.firstName,
          last_name: result.user.lastName,
        },
        expires_at: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
      };

      req.login(userClaims, (err: any) => {
        if (err) {
          console.error("[MagicLink] Login error:", err);
          return res.redirect("/login?error=login_failed");
        }

        req.session.save((saveErr: any) => {
          if (saveErr) {
            console.error("[MagicLink] Session save error:", saveErr);
            return res.redirect("/login?error=session_error");
          }
          // Redirect to home on success
          res.redirect("/");
        });
      });
    } catch (error) {
      console.error("[MagicLink] Verify error:", error);
      res.redirect("/login?error=verification_failed");
    }
  });
}
