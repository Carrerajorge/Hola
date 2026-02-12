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

import { users, userSettings, libraryStorage, type User } from "@shared/schema";
import { db } from "../../db";
import { eq, sql } from "drizzle-orm";
import { autoAcceptWorkspaceInvitationForUser } from "../../services/workspaceInvitationService";

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

function mapAuthUserRow(row: any): User {
  const firstName = row.first_name ?? row.firstName ?? null;
  const lastName = row.last_name ?? row.lastName ?? null;
  const fullName = row.full_name ?? row.fullName ?? [firstName, lastName].filter(Boolean).join(" ") || null;

  return {
    id: String(row.id),
    email: row.email ?? null,
    password: row.password ?? null,
    username: row.username ?? null,
    firstName,
    lastName,
    fullName,
    role: row.role ?? "user",
    status: row.status ?? "active",
    authProvider: row.auth_provider ?? row.authProvider ?? "email",
    emailVerified: row.email_verified ?? row.emailVerified ?? "false",
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    lastLoginAt: row.last_login_at ?? row.lastLoginAt ?? null,
    lastIp: row.last_ip ?? row.lastIp ?? null,
    userAgent: row.user_agent ?? row.userAgent ?? null,
    loginCount: row.login_count ?? row.loginCount ?? 0,
    orgId: row.org_id ?? row.orgId ?? "default",
  } as User;
}

function getSqlCode(error: any): string | undefined {
  return error?.cause?.code || error?.code;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    try {
      const result = await db.execute(sql`
        SELECT id, email, password, username, first_name, last_name, role, status,
               auth_provider, email_verified, created_at, updated_at, last_login_at,
               last_ip, user_agent, login_count, org_id
        FROM users
        WHERE id = ${id}
        LIMIT 1
      `);
      const row = (result as any)?.rows?.[0];
      if (!row) return undefined;
      return mapAuthUserRow(row);
    } catch (error: any) {
      const sqlCode = getSqlCode(error);
      if (sqlCode === "42703") {
        // Legacy schema fallback: read only ultra-stable columns.
        const fallbackResult = await db.execute(sql`
          SELECT id, email, password
          FROM users
          WHERE id = ${id}
          LIMIT 1
        `);
        const fallbackRow = (fallbackResult as any)?.rows?.[0];
        if (!fallbackRow) return undefined;
        return mapAuthUserRow(fallbackRow);
      }
      if (sqlCode === "42P01") {
        return undefined;
      }
      console.error(`[AuthStorage] getUser failed for id=${id}:`, error?.message || error);
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const normalizedEmail = email.toLowerCase().trim();
    try {
      const result = await db.execute(sql`
        SELECT id, email, password, username, first_name, last_name, role, status,
               auth_provider, email_verified, created_at, updated_at, last_login_at,
               last_ip, user_agent, login_count, org_id
        FROM users
        WHERE email ILIKE ${normalizedEmail}
        LIMIT 1
      `);
      const row = (result as any)?.rows?.[0];
      if (!row) return undefined;
      return mapAuthUserRow(row);
    } catch (error: any) {
      const sqlCode = getSqlCode(error);

      if (sqlCode === "42703") {
        try {
          const result = await db.execute(sql`
            SELECT id, email, password
            FROM users
            WHERE email ILIKE ${normalizedEmail}
            LIMIT 1
          `);
          const row = (result as any)?.rows?.[0];
          if (!row) return undefined;
          return mapAuthUserRow(row);
        } catch (fallbackError: any) {
          console.error(
            `[AuthStorage] getUserByEmail fallback failed for email=${email}:`,
            fallbackError?.message || fallbackError
          );
          throw fallbackError;
        }
      }
      if (sqlCode === "42P01") {
        return undefined;
      }

      console.error(`[AuthStorage] getUserByEmail failed for email=${email}:`, error?.message || error);
      throw error;
    }
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const startTime = Date.now();
    const logContext = { id: userData.id, email: userData.email };
    
    try {
      const existingById = await this.getUser(userData.id);
      
      if (existingById) {
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
            updatedAt: new Date(),
          })
          .where(eq(users.id, userData.id))
          .returning({
            id: users.id,
            email: users.email,
            username: users.username,
            fullName: users.fullName,
            firstName: users.firstName,
            lastName: users.lastName,
            profileImageUrl: users.profileImageUrl,
            role: users.role,
            status: users.status,
            authProvider: users.authProvider,
            emailVerified: users.emailVerified,
            plan: users.plan,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
            orgId: users.orgId,
          });
        
        console.log(JSON.stringify({
          event: "user_updated",
          userId: updatedUser.id,
          email: updatedUser.email,
          authProvider: updatedUser.authProvider,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        }));
        
        // Best-effort: bind org/role if the user has a pending workspace invitation.
        try {
          await autoAcceptWorkspaceInvitationForUser(updatedUser.id);
        } catch (e: any) {
          console.warn(`[AuthStorage] Failed to auto-accept workspace invitation for user=${updatedUser.id}:`, e?.message || e);
        }

        return updatedUser;
      }
      
      if (userData.email) {
        const existingByEmail = await this.getUserByEmail(userData.email);
        if (existingByEmail) {
          // IMPORTANT: Never update the primary key (users.id) when merging by email.
          // Many tables reference users.id; changing it would break referential integrity.
          const [updatedUser] = await db
            .update(users)
            .set({
              username: userData.username ?? existingByEmail.username,
              fullName: userData.fullName ?? existingByEmail.fullName,
              firstName: userData.firstName ?? existingByEmail.firstName,
              lastName: userData.lastName ?? existingByEmail.lastName,
              profileImageUrl: userData.profileImageUrl ?? existingByEmail.profileImageUrl,
              authProvider: userData.authProvider ?? existingByEmail.authProvider,
              emailVerified: userData.emailVerified ?? existingByEmail.emailVerified,
              updatedAt: new Date(),
            })
            .where(eq(users.email, userData.email))
            .returning({
              id: users.id,
              email: users.email,
              username: users.username,
              fullName: users.fullName,
              firstName: users.firstName,
              lastName: users.lastName,
              profileImageUrl: users.profileImageUrl,
              role: users.role,
              status: users.status,
              authProvider: users.authProvider,
              emailVerified: users.emailVerified,
              plan: users.plan,
              createdAt: users.createdAt,
              updatedAt: users.updatedAt,
              orgId: users.orgId,
            });
          
          console.log(JSON.stringify({
            event: "user_updated_by_email",
            userId: updatedUser.id,
            email: updatedUser.email,
            authProvider: updatedUser.authProvider,
            // Persisting the old/new external id mapping is out of scope for this storage layer,
            // but we keep observability for debugging.
            attemptedId: userData.id,
            existingId: existingByEmail.id,
            durationMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          }));
          
          try {
            await autoAcceptWorkspaceInvitationForUser(updatedUser.id);
          } catch (e: any) {
            console.warn(`[AuthStorage] Failed to auto-accept workspace invitation for user=${updatedUser.id}:`, e?.message || e);
          }

          return updatedUser;
        }
      }
      
      const [newUser] = await db
        .insert(users)
        .values({
          id: userData.id,
          orgId: userData.id,
          email: userData.email,
          username: userData.username ?? (userData.email ? userData.email.split("@")[0] : null),
          fullName: userData.fullName,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          authProvider: userData.authProvider ?? "email",
          emailVerified: userData.emailVerified ?? "false",
          // Use a builtin workspace admin role by default so RBAC + workspace settings work out of the box.
          role: userData.role ?? "team_admin",
          plan: "free",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({
          id: users.id,
          email: users.email,
          username: users.username,
          fullName: users.fullName,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
          role: users.role,
          status: users.status,
          authProvider: users.authProvider,
          emailVerified: users.emailVerified,
          plan: users.plan,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          orgId: users.orgId,
        });
      
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
      
      try {
        await autoAcceptWorkspaceInvitationForUser(newUser.id);
      } catch (e: any) {
        console.warn(`[AuthStorage] Failed to auto-accept workspace invitation for user=${newUser.id}:`, e?.message || e);
      }

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
      const now = new Date();
      const result = await db.update(users).set({
        lastLoginAt: now,
        lastIp: loginData.ipAddress,
        userAgent: loginData.userAgent,
        loginCount: sql<number>`COALESCE(${users.loginCount}, 0) + 1`,
        updatedAt: now,
      }).where(eq(users.id, id)).returning({ id: users.id });
      
      if (result.length === 0) {
        console.warn(`[AuthStorage] updateUserLogin: No user found with id=${id}`);
      }

      // Ensure per-user dependent rows exist (minimal bootstrap on first login).
      // These are safe no-ops for existing users due to unique constraints.
      try {
        await db.insert(userSettings).values({ userId: id }).onConflictDoNothing();
      } catch (e: any) {
        console.warn(`[AuthStorage] Failed to ensure user_settings for user=${id}:`, e?.message || e);
      }
      try {
        await db.insert(libraryStorage).values({ userId: id }).onConflictDoNothing();
      } catch (e: any) {
        console.warn(`[AuthStorage] Failed to ensure library_storage for user=${id}:`, e?.message || e);
      }
    } catch (error: any) {
      console.error(`[AuthStorage] updateUserLogin failed for id=${id}:`, error.message);
      throw error;
    }
  }
}

export const authStorage = new AuthStorage();
