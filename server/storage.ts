import { 
  type User, type InsertUser, 
  type File, type InsertFile, 
  type FileChunk, type InsertFileChunk,
  type AgentRun, type InsertAgentRun,
  type AgentStep, type InsertAgentStep,
  type AgentAsset, type InsertAgentAsset,
  type DomainPolicy, type InsertDomainPolicy,
  type Chat, type InsertChat,
  type ChatMessage, type InsertChatMessage,
  files, fileChunks, agentRuns, agentSteps, agentAssets, domainPolicies, chats, chatMessages
} from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, sql, desc } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createFile(file: InsertFile): Promise<File>;
  getFile(id: string): Promise<File | undefined>;
  getFiles(userId?: string): Promise<File[]>;
  updateFileStatus(id: string, status: string): Promise<File | undefined>;
  deleteFile(id: string): Promise<void>;
  createFileChunks(chunks: InsertFileChunk[]): Promise<FileChunk[]>;
  getFileChunks(fileId: string): Promise<FileChunk[]>;
  searchSimilarChunks(embedding: number[], limit?: number): Promise<FileChunk[]>;
  // Agent CRUD operations
  createAgentRun(run: InsertAgentRun): Promise<AgentRun>;
  getAgentRun(id: string): Promise<AgentRun | undefined>;
  updateAgentRunStatus(id: string, status: string, error?: string): Promise<AgentRun | undefined>;
  createAgentStep(step: InsertAgentStep): Promise<AgentStep>;
  getAgentSteps(runId: string): Promise<AgentStep[]>;
  updateAgentStepStatus(id: string, success: string, error?: string): Promise<AgentStep | undefined>;
  createAgentAsset(asset: InsertAgentAsset): Promise<AgentAsset>;
  getAgentAssets(runId: string): Promise<AgentAsset[]>;
  getDomainPolicy(domain: string): Promise<DomainPolicy | undefined>;
  createDomainPolicy(policy: InsertDomainPolicy): Promise<DomainPolicy>;
  // Chat CRUD operations
  createChat(chat: InsertChat): Promise<Chat>;
  getChat(id: string): Promise<Chat | undefined>;
  getChats(): Promise<Chat[]>;
  updateChat(id: string, updates: Partial<InsertChat>): Promise<Chat | undefined>;
  deleteChat(id: string): Promise<void>;
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  getChatMessages(chatId: string): Promise<ChatMessage[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;

  constructor() {
    this.users = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createFile(insertFile: InsertFile): Promise<File> {
    const [file] = await db.insert(files).values(insertFile).returning();
    return file;
  }

  async getFile(id: string): Promise<File | undefined> {
    const [file] = await db.select().from(files).where(eq(files.id, id));
    return file;
  }

  async getFiles(userId?: string): Promise<File[]> {
    if (userId) {
      return db.select().from(files).where(eq(files.userId, userId)).orderBy(desc(files.createdAt));
    }
    return db.select().from(files).orderBy(desc(files.createdAt));
  }

  async updateFileStatus(id: string, status: string): Promise<File | undefined> {
    const [file] = await db.update(files).set({ status }).where(eq(files.id, id)).returning();
    return file;
  }

  async deleteFile(id: string): Promise<void> {
    await db.delete(files).where(eq(files.id, id));
  }

  async createFileChunks(chunks: InsertFileChunk[]): Promise<FileChunk[]> {
    if (chunks.length === 0) return [];
    const result = await db.insert(fileChunks).values(chunks).returning();
    return result;
  }

  async getFileChunks(fileId: string): Promise<FileChunk[]> {
    return db.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
  }

  async searchSimilarChunks(embedding: number[], limit: number = 5): Promise<FileChunk[]> {
    const embeddingStr = `[${embedding.join(",")}]`;
    const result = await db.execute(sql`
      SELECT fc.*, f.name as file_name,
        fc.embedding <=> ${embeddingStr}::vector AS distance
      FROM file_chunks fc
      JOIN files f ON fc.file_id = f.id
      WHERE fc.embedding IS NOT NULL
      ORDER BY fc.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `);
    return result.rows as FileChunk[];
  }

  async createAgentRun(run: InsertAgentRun): Promise<AgentRun> {
    const [result] = await db.insert(agentRuns).values(run).returning();
    return result;
  }

  async getAgentRun(id: string): Promise<AgentRun | undefined> {
    const [result] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
    return result;
  }

  async updateAgentRunStatus(id: string, status: string, error?: string): Promise<AgentRun | undefined> {
    const updates: Partial<AgentRun> = { status };
    if (status === "completed" || status === "failed" || status === "cancelled") {
      updates.completedAt = new Date();
    }
    if (error) {
      updates.error = error;
    }
    const [result] = await db.update(agentRuns).set(updates).where(eq(agentRuns.id, id)).returning();
    return result;
  }

  async createAgentStep(step: InsertAgentStep): Promise<AgentStep> {
    const [result] = await db.insert(agentSteps).values(step).returning();
    return result;
  }

  async getAgentSteps(runId: string): Promise<AgentStep[]> {
    return db.select().from(agentSteps).where(eq(agentSteps.runId, runId)).orderBy(agentSteps.stepIndex);
  }

  async updateAgentStepStatus(id: string, success: string, error?: string): Promise<AgentStep | undefined> {
    const updates: Partial<AgentStep> = { success, completedAt: new Date() };
    if (error) {
      updates.error = error;
    }
    const [result] = await db.update(agentSteps).set(updates).where(eq(agentSteps.id, id)).returning();
    return result;
  }

  async createAgentAsset(asset: InsertAgentAsset): Promise<AgentAsset> {
    const [result] = await db.insert(agentAssets).values(asset).returning();
    return result;
  }

  async getAgentAssets(runId: string): Promise<AgentAsset[]> {
    return db.select().from(agentAssets).where(eq(agentAssets.runId, runId));
  }

  async getDomainPolicy(domain: string): Promise<DomainPolicy | undefined> {
    const [result] = await db.select().from(domainPolicies).where(eq(domainPolicies.domain, domain));
    return result;
  }

  async createDomainPolicy(policy: InsertDomainPolicy): Promise<DomainPolicy> {
    const [result] = await db.insert(domainPolicies).values(policy).returning();
    return result;
  }

  async createChat(chat: InsertChat): Promise<Chat> {
    const [result] = await db.insert(chats).values(chat).returning();
    return result;
  }

  async getChat(id: string): Promise<Chat | undefined> {
    const [result] = await db.select().from(chats).where(eq(chats.id, id));
    return result;
  }

  async getChats(): Promise<Chat[]> {
    return db.select().from(chats).orderBy(desc(chats.updatedAt));
  }

  async updateChat(id: string, updates: Partial<InsertChat>): Promise<Chat | undefined> {
    const [result] = await db.update(chats).set({ ...updates, updatedAt: new Date() }).where(eq(chats.id, id)).returning();
    return result;
  }

  async deleteChat(id: string): Promise<void> {
    await db.delete(chats).where(eq(chats.id, id));
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [result] = await db.insert(chatMessages).values(message).returning();
    await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, message.chatId));
    return result;
  }

  async getChatMessages(chatId: string): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).where(eq(chatMessages.chatId, chatId)).orderBy(chatMessages.createdAt);
  }
}

export const storage = new MemStorage();
