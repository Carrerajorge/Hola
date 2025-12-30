import { users, type User } from "@shared/schema";
import { db } from "../../db";
import { eq, or } from "drizzle-orm";

export type UpsertUser = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: string | null;
};

// Interface for auth storage operations
// (IMPORTANT) These user operations are mandatory for Replit Auth.
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserLogin(id: string, loginData: { ipAddress?: string | null; userAgent?: string | null }): Promise<void>;
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
      const [user] = await db.select().from(users).where(eq(users.email, email));
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
      // First check if user exists by ID
      const existingById = await this.getUser(userData.id);
      
      if (existingById) {
        // User exists, update
        const [updatedUser] = await db
          .update(users)
          .set({
            email: userData.email ?? existingById.email,
            firstName: userData.firstName ?? existingById.firstName,
            lastName: userData.lastName ?? existingById.lastName,
            profileImageUrl: userData.profileImageUrl ?? existingById.profileImageUrl,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userData.id))
          .returning();
        
        console.log(JSON.stringify({
          event: "user_updated",
          userId: updatedUser.id,
          email: updatedUser.email,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        }));
        
        return updatedUser;
      }
      
      // User doesn't exist, check by email to prevent duplicates
      if (userData.email) {
        const existingByEmail = await this.getUserByEmail(userData.email);
        if (existingByEmail) {
          // Update existing user with new ID (Replit ID)
          const [updatedUser] = await db
            .update(users)
            .set({
              id: userData.id,
              firstName: userData.firstName ?? existingByEmail.firstName,
              lastName: userData.lastName ?? existingByEmail.lastName,
              profileImageUrl: userData.profileImageUrl ?? existingByEmail.profileImageUrl,
              updatedAt: new Date(),
            })
            .where(eq(users.email, userData.email))
            .returning();
          
          console.log(JSON.stringify({
            event: "user_updated_by_email",
            userId: updatedUser.id,
            email: updatedUser.email,
            previousId: existingByEmail.id,
            durationMs: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          }));
          
          return updatedUser;
        }
      }
      
      // Create new user
      const [newUser] = await db
        .insert(users)
        .values({
          id: userData.id,
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          role: "user",
          plan: "free",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      
      console.log(JSON.stringify({
        event: "user_created",
        userId: newUser.id,
        email: newUser.email,
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
      
      // Re-throw to ensure the caller knows the operation failed
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
