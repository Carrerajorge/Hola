import { users, type User } from "@shared/schema";
import { db } from "../../db";

export type UpsertUser = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  role?: string | null;
};
import { eq } from "drizzle-orm";

// Interface for auth storage operations
// (IMPORTANT) These user operations are mandatory for Replit Auth.
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserLogin(id: string, loginData: { ipAddress?: string | null; userAgent?: string | null }): Promise<void>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async updateUserLogin(id: string, loginData: { ipAddress?: string | null; userAgent?: string | null }): Promise<void> {
    await db.update(users).set({
      lastLoginAt: new Date(),
      lastIp: loginData.ipAddress,
      userAgent: loginData.userAgent,
      updatedAt: new Date()
    }).where(eq(users.id, id));
  }
}

export const authStorage = new AuthStorage();
