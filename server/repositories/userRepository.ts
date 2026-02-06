import { 
  type User, 
  type InsertUser, 
  users 
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, sql } from "drizzle-orm";
import { 
  validateUserId, 
  validateResourceId, 
  logRepositoryAction, 
  NotFoundError,
  ValidationError 
} from "./baseRepository";
import { hashPassword, isHashed } from "../utils/password";

export interface UserStats {
  total: number;
  active: number;
  newThisMonth: number;
}

export class UserRepository {
  async getUser(id: string): Promise<User | undefined> {
    validateResourceId(id, "User");
    logRepositoryAction({ action: "getUser", resourceId: id });
    
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    if (!username || typeof username !== "string") {
      throw new ValidationError("Valid username is required");
    }
    logRepositoryAction({ action: "getUserByUsername", metadata: { username } });
    
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    if (!email || typeof email !== "string") {
      throw new ValidationError("Valid email is required");
    }
    const normalizedEmail = email.toLowerCase().trim();
    logRepositoryAction({ action: "getUserByEmail", metadata: { email: normalizedEmail } });
    
    const [result] = await db.select().from(users).where(sql`LOWER(${users.email}) = ${normalizedEmail}`);
    return result;
  }

  async createUser(user: InsertUser): Promise<User> {
    if (!user.username) {
      throw new ValidationError("Username is required to create user");
    }
    logRepositoryAction({ action: "createUser", metadata: { username: user.username } });
    
    const userToInsert = { ...user };
    if (userToInsert.password && !isHashed(userToInsert.password)) {
      userToInsert.password = await hashPassword(userToInsert.password);
    }
    
    const [created] = await db.insert(users).values(userToInsert).returning();
    return created;
  }

  async getAllUsers(): Promise<User[]> {
    logRepositoryAction({ action: "getAllUsers" });
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    validateResourceId(id, "User");
    logRepositoryAction({ action: "updateUser", resourceId: id });
    
    const updatesToApply = { ...updates, updatedAt: new Date() };
    if (updatesToApply.password && !isHashed(updatesToApply.password)) {
      updatesToApply.password = await hashPassword(updatesToApply.password);
    }
    
    const [result] = await db.update(users)
      .set(updatesToApply)
      .where(eq(users.id, id))
      .returning();
    return result;
  }

  async deleteUser(id: string): Promise<void> {
    validateResourceId(id, "User");
    logRepositoryAction({ action: "deleteUser", resourceId: id });
    
    await db.delete(users).where(eq(users.id, id));
  }

  async getUserStats(): Promise<UserStats> {
    logRepositoryAction({ action: "getUserStats" });
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [row] = await db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where ${users.status} = 'active')`,
      newThisMonth: sql<number>`count(*) filter (where ${users.createdAt} >= ${monthStart})`,
    }).from(users);

    return {
      total: Number(row?.total || 0),
      active: Number(row?.active || 0),
      newThisMonth: Number(row?.newThisMonth || 0),
    };
  }

  async getUserOrThrow(id: string): Promise<User> {
    const user = await this.getUser(id);
    if (!user) {
      throw new NotFoundError("User", id);
    }
    return user;
  }

  async validateUserExists(userId: string): Promise<void> {
    validateUserId(userId);
    const user = await this.getUser(userId);
    if (!user) {
      throw new NotFoundError("User", userId);
    }
  }
}

export const userRepository = new UserRepository();
export default userRepository;
