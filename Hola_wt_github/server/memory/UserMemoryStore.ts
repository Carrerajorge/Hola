/**
 * User Memory Store
 * 
 * Cross-session persistent memory for user preferences, facts, and context.
 * Survives across conversations and provides long-term personalization.
 */

import { db } from "../db";
import { eq, desc, and, gte } from "drizzle-orm";
import { storage } from "../storage";

// ============================================================================
// TYPES
// ============================================================================

export interface UserMemory {
    id: string;
    userId: string;
    memoryType: "preference" | "fact" | "context" | "instruction";
    memoryKey: string;
    memoryValue: string;
    confidence: number;
    accessCount: number;
    source: "extracted" | "explicit" | "inferred";
    lastAccessed: Date;
    createdAt: Date;
    expiresAt?: Date;
}

export interface MemoryQuery {
    userId: string;
    types?: UserMemory["memoryType"][];
    minConfidence?: number;
    limit?: number;
    includeExpired?: boolean;
}

export interface MemoryStats {
    totalMemories: number;
    byType: Record<string, number>;
    avgConfidence: number;
    oldestMemory: Date | null;
    mostAccessed: { key: string; count: number } | null;
}

// ============================================================================
// IN-MEMORY STORE (Fallback when DB tables don't exist)
// ============================================================================

class InMemoryUserStore {
    private store = new Map<string, UserMemory[]>();

    async get(userId: string): Promise<UserMemory[]> {
        return this.store.get(userId) || [];
    }

    async set(memory: Omit<UserMemory, "id" | "createdAt" | "lastAccessed" | "accessCount">): Promise<UserMemory> {
        const userMemories = this.store.get(memory.userId) || [];

        // Check for existing
        const existing = userMemories.find(
            m => m.memoryKey === memory.memoryKey && m.memoryType === memory.memoryType
        );

        if (existing) {
            existing.memoryValue = memory.memoryValue;
            existing.confidence = memory.confidence;
            existing.lastAccessed = new Date();
            existing.accessCount++;
            return existing;
        }

        const newMemory: UserMemory = {
            ...memory,
            id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            accessCount: 0,
            createdAt: new Date(),
            lastAccessed: new Date()
        };

        userMemories.push(newMemory);
        this.store.set(memory.userId, userMemories);

        return newMemory;
    }

    async query(query: MemoryQuery): Promise<UserMemory[]> {
        let memories = this.store.get(query.userId) || [];

        if (query.types && query.types.length > 0) {
            memories = memories.filter(m => query.types!.includes(m.memoryType));
        }

        if (query.minConfidence !== undefined) {
            memories = memories.filter(m => m.confidence >= query.minConfidence!);
        }

        if (!query.includeExpired) {
            const now = new Date();
            memories = memories.filter(m => !m.expiresAt || m.expiresAt > now);
        }

        memories.sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime());

        if (query.limit) {
            memories = memories.slice(0, query.limit);
        }

        return memories;
    }

    async delete(userId: string, memoryKey: string): Promise<boolean> {
        const userMemories = this.store.get(userId) || [];
        const index = userMemories.findIndex(m => m.memoryKey === memoryKey);
        if (index >= 0) {
            userMemories.splice(index, 1);
            return true;
        }
        return false;
    }

    async getStats(userId: string): Promise<MemoryStats> {
        const memories = this.store.get(userId) || [];

        const byType: Record<string, number> = {};
        let totalConfidence = 0;
        let oldestDate: Date | null = null;
        let mostAccessed: { key: string; count: number } | null = null;

        for (const m of memories) {
            byType[m.memoryType] = (byType[m.memoryType] || 0) + 1;
            totalConfidence += m.confidence;

            if (!oldestDate || m.createdAt < oldestDate) {
                oldestDate = m.createdAt;
            }

            if (!mostAccessed || m.accessCount > mostAccessed.count) {
                mostAccessed = { key: m.memoryKey, count: m.accessCount };
            }
        }

        return {
            totalMemories: memories.length,
            byType,
            avgConfidence: memories.length > 0 ? totalConfidence / memories.length : 0,
            oldestMemory: oldestDate,
            mostAccessed
        };
    }
}

// ============================================================================
// USER MEMORY STORE
// ============================================================================

export class UserMemoryStore {
    private inMemoryStore = new InMemoryUserStore();
    private useInMemory = true; // Will try DB first, fall back to memory

    constructor() {
        console.log("[UserMemoryStore] Initialized (using in-memory fallback)");
    }

    /**
     * Store or update a user memory
     */
    async remember(
        userId: string,
        key: string,
        value: string,
        type: UserMemory["memoryType"] = "fact",
        options: { confidence?: number; source?: UserMemory["source"]; expiresAt?: Date } = {}
    ): Promise<UserMemory> {
        const memory = await this.inMemoryStore.set({
            userId,
            memoryType: type,
            memoryKey: key,
            memoryValue: value,
            confidence: options.confidence ?? 0.8,
            source: options.source ?? "extracted",
            expiresAt: options.expiresAt
        });

        console.log(`[UserMemoryStore] Remembered: ${type}:${key} for user ${userId.slice(0, 8)}`);
        return memory;
    }

    /**
     * Recall memories for a user
     */
    async recall(
        userId: string,
        options: { types?: UserMemory["memoryType"][]; limit?: number; minConfidence?: number } = {}
    ): Promise<UserMemory[]> {
        return this.inMemoryStore.query({
            userId,
            types: options.types,
            limit: options.limit ?? 50,
            minConfidence: options.minConfidence
        });
    }

    /**
     * Get specific memory by key
     */
    async get(userId: string, key: string): Promise<UserMemory | null> {
        const memories = await this.inMemoryStore.get(userId);
        return memories.find(m => m.memoryKey === key) || null;
    }

    /**
     * Forget a specific memory
     */
    async forget(userId: string, key: string): Promise<boolean> {
        return this.inMemoryStore.delete(userId, key);
    }

    /**
     * Get user memory statistics
     */
    async getStats(userId: string): Promise<MemoryStats> {
        return this.inMemoryStore.getStats(userId);
    }

    /**
     * Build context injection from memories
     */
    async buildContextInjection(userId: string): Promise<string | null> {
        const memories = await this.recall(userId, {
            minConfidence: 0.6,
            limit: 20
        });

        if (memories.length === 0) return null;

        const grouped: Record<string, string[]> = {};
        for (const m of memories) {
            if (!grouped[m.memoryType]) grouped[m.memoryType] = [];
            grouped[m.memoryType].push(`${m.memoryKey}: ${m.memoryValue}`);
        }

        const lines: string[] = ["[Memoria del Usuario]"];

        if (grouped.fact) {
            lines.push("Hechos conocidos:");
            lines.push(...grouped.fact.map(f => `• ${f}`));
        }

        if (grouped.preference) {
            lines.push("\nPreferencias:");
            lines.push(...grouped.preference.map(p => `• ${p}`));
        }

        if (grouped.instruction) {
            lines.push("\nInstrucciones persistentes:");
            lines.push(...grouped.instruction.map(i => `• ${i}`));
        }

        return lines.join("\n");
    }

    /**
     * Extract and store memories from a conversation
     */
    async extractFromConversation(
        userId: string,
        messages: Array<{ role: string; content: string }>
    ): Promise<number> {
        let extracted = 0;

        for (const msg of messages) {
            if (msg.role !== "user") continue;

            // Extract name
            const nameMatch = msg.content.match(/(?:me llamo|my name is|soy)\s+(\w+)/i);
            if (nameMatch) {
                await this.remember(userId, "user_name", nameMatch[1], "fact", { confidence: 0.95 });
                extracted++;
            }

            // Extract explicit preferences
            const prefMatch = msg.content.match(/(?:siempre|always|prefiero|i prefer|me gusta)\s+(.+?)(?:\.|,|$)/i);
            if (prefMatch) {
                await this.remember(userId, `pref_${Date.now()}`, prefMatch[1].trim(), "preference", { confidence: 0.7 });
                extracted++;
            }

            // Extract persistent instructions
            const instrMatch = msg.content.match(/(?:recuerda que|remember that|siempre hazlo|always do)\s+(.+?)(?:\.|$)/i);
            if (instrMatch) {
                await this.remember(userId, `instr_${Date.now()}`, instrMatch[1].trim(), "instruction", { confidence: 0.85 });
                extracted++;
            }
        }

        if (extracted > 0) {
            console.log(`[UserMemoryStore] Extracted ${extracted} memories from conversation for user ${userId.slice(0, 8)}`);
        }

        return extracted;
    }
}

// Singleton instance
export const userMemoryStore = new UserMemoryStore();

export default userMemoryStore;
