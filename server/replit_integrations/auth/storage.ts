/**
 * FIX: Auth Storage - Guardar todos los campos correctamente
 * 
 * PROBLEMA: El upsertUser no guardaba:
 * - authProvider
 * - username
 * - fullName
 * - emailVerified
 * 
 * SOLUCIÓN: Actualizar el tipo UpsertUser y la función upsertUser
 */

import { users, type User } from "@shared/schema";
import { db } from "../../db";
import { eq, sql } from "drizzle-orm";

export type UpsertUser = {
  id: string;
  email?: string | null;
  username?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: string | null;
  authProvider?: string | null;
  emailVerified?: string | null;
};

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserLogin(id: string, loginData: { ipAddress?: string | null; userAgent?: string | null }): Promise<void>;
}

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_ROLES = new Set(["admin", "superadmin"]);
const ALLOWED_ROLES = new Set(["user", "admin", "superadmin", "editor", "viewer", "api_only"]);

function normalizeEmail(email: unknown): string | null {
  const raw = String(email || "").trim();
  if (!raw) return null;
  return raw.toLowerCase();
}

function computeNextRole(opts: {
  existingRole?: string | null;
  providedRole?: string | null;
  email?: string | null;
}): string | null {
  const existingNorm = String(opts.existingRole || "").trim().toLowerCase();
  if (ADMIN_ROLES.has(existingNorm)) return existingNorm;

  const emailNorm = normalizeEmail(opts.email);
  if (ADMIN_EMAIL && emailNorm && emailNorm === ADMIN_EMAIL) return "admin";

  const providedNorm = String(opts.providedRole || "").trim().toLowerCase();
  if (providedNorm && ALLOWED_ROLES.has(providedNorm)) return providedNorm;

  return existingNorm || null;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      return user;
    } catch (error: any) {
      console.error(`[AuthStorage] getUser failed for id=${id}:`, error.message);
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    try {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) return undefined;

      const [user] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${normalizedEmail}`)
        .limit(1);
      return user;
    } catch (error: any) {
      console.error(`[AuthStorage] getUserByEmail failed for email=${email}:`, error.message);
      throw error;
    }
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const startTime = Date.now();
    const logContext = { id: userData.id, email: userData.email };
    
    try {
      const existingById = await this.getUser(userData.id);
      
      if (existingById) {
        const nextRole = computeNextRole({
          existingRole: existingById.role,
          providedRole: userData.role,
          email: userData.email ?? existingById.email,
        });

        const [updatedUser] = await db
          .update(users)
          .set({
            email: userData.email ?? existingById.email,
            username: userData.username ?? existingById.username,
            fullName: userData.fullName ?? existingById.fullName,
            firstName: userData.firstName ?? existingById.firstName,
            lastName: userData.lastName ?? existingById.lastName,
            profileImageUrl: userData.profileImageUrl ?? existingById.profileImageUrl,
            authProvider: userData.authProvider ?? existingById.authProvider,
            emailVerified: userData.emailVerified ?? existingById.emailVerified,
            role: nextRole ?? existingById.role,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userData.id))
          .returning();
        
        console.log(JSON.stringify({
          event: "user_updated",
          userId: updatedUser.id,
          email: updatedUser.email,
          authProvider: updatedUser.authProvider,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        }));
        
        return updatedUser;
      }
      
      if (userData.email) {
        const existingByEmail = await this.getUserByEmail(userData.email);
        if (existingByEmail) {
          const nextRole = computeNextRole({
            existingRole: existingByEmail.role,
            providedRole: userData.role,
            email: userData.email ?? existingByEmail.email,
          });

          const [updatedUser] = await db
            .update(users)
            .set({
              id: userData.id,
              username: userData.username ?? existingByEmail.username,
              fullName: userData.fullName ?? existingByEmail.fullName,
              firstName: userData.firstName ?? existingByEmail.firstName,
              lastName: userData.lastName ?? existingByEmail.lastName,
              profileImageUrl: userData.profileImageUrl ?? existingByEmail.profileImageUrl,
              authProvider: userData.authProvider ?? existingByEmail.authProvider,
              emailVerified: userData.emailVerified ?? existingByEmail.emailVerified,
              role: nextRole ?? existingByEmail.role,
              updatedAt: new Date(),
            })
            .where(sql`lower(${users.email}) = ${normalizeEmail(userData.email)}`)
            .returning();
          
          console.log(JSON.stringify({
            event: "user_updated_by_email",
            userId: updatedUser.id,
            email: updatedUser.email,
            authProvider: updatedUser.authProvider,
            previousId: existingByEmail.id,
            durationMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          }));
          
          return updatedUser;
        }
      }
      
      const [newUser] = await db
        .insert(users)
        .values({
          id: userData.id,
          email: userData.email,
          username: userData.username ?? (userData.email ? userData.email.split("@")[0] : null),
          fullName: userData.fullName,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          authProvider: userData.authProvider ?? "email",
          emailVerified: userData.emailVerified ?? "false",
          role: computeNextRole({ existingRole: null, providedRole: userData.role, email: userData.email }) || "user",
          plan: "free",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      
      console.log(JSON.stringify({
        event: "user_created",
        userId: newUser.id,
        email: newUser.email,
        authProvider: newUser.authProvider,
        role: newUser.role,
        plan: newUser.plan,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }));
      
      return newUser;
    } catch (error: any) {
      console.error(JSON.stringify({
        event: "user_upsert_failed",
        error: error.message,
        code: error.code,
        context: logContext,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      }));
      
      throw new Error(`Failed to upsert user: ${error.message}`);
    }
  }

  async updateUserLogin(id: string, loginData: { ipAddress?: string | null; userAgent?: string | null }): Promise<void> {
    try {
      const result = await db.update(users).set({
        lastLoginAt: new Date(),
        lastIp: loginData.ipAddress,
        userAgent: loginData.userAgent,
        updatedAt: new Date()
      }).where(eq(users.id, id)).returning();
      
      if (result.length === 0) {
        console.warn(`[AuthStorage] updateUserLogin: No user found with id=${id}`);
      }
    } catch (error: any) {
      console.error(`[AuthStorage] updateUserLogin failed for id=${id}:`, error.message);
      throw error;
    }
  }
}

export const authStorage = new AuthStorage();
