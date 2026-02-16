/**
 * Persistent User Memory Service
 * Long-term memory storage for user preferences and facts
 */

import { db } from '../db';
import { eq, and, desc, sql } from 'drizzle-orm';

// Memory types
export type MemoryCategory = 'preferences' | 'facts' | 'style' | 'context' | 'instructions';

export interface UserMemory {
    id: number;
    userId: number;
    category: MemoryCategory;
    key: string;
    value: string;
    confidence: number;
    source: 'extracted' | 'stated' | 'inferred';
    lastAccessed: Date;
    createdAt: Date;
}

interface MemoryInput {
    category: MemoryCategory;
    key: string;
    value: string;
    confidence?: number;
    source?: 'extracted' | 'stated' | 'inferred';
}

// In-memory cache for fast access
const memoryCache = new Map<number, Map<string, UserMemory>>();

/**
 * Save or update a memory for a user
 */
export async function saveMemory(
    userId: number,
    input: MemoryInput
): Promise<UserMemory> {
    const { category, key, value, confidence = 1.0, source = 'extracted' } = input;
    const memoryKey = `${category}:${key}`;

    try {
        // Check if memory exists
        const existing = await db.query.userMemories?.findFirst({
            where: and(
                eq(sql`user_id`, userId),
                eq(sql`category`, category),
                eq(sql`key`, key)
            )
        });

        if (existing) {
            // Update existing memory
            const updated = await db.update(sql`user_memories`)
                .set({
                    value,
                    confidence: Math.max(existing.confidence, confidence),
                    lastAccessed: new Date(),
                })
                .where(eq(sql`id`, existing.id))
                .returning();

            // Update cache
            const userCache = memoryCache.get(userId) || new Map();
            userCache.set(memoryKey, updated[0]);
            memoryCache.set(userId, userCache);

            return updated[0];
        } else {
            // Insert new memory
            const inserted = await db.insert(sql`user_memories`)
                .values({
                    userId,
                    category,
                    key,
                    value,
                    confidence,
                    source,
                    lastAccessed: new Date(),
                    createdAt: new Date(),
                })
                .returning();

            // Update cache
            const userCache = memoryCache.get(userId) || new Map();
            userCache.set(memoryKey, inserted[0]);
            memoryCache.set(userId, userCache);

            return inserted[0];
        }
    } catch (error) {
        console.error('Error saving memory:', error);
        // Fallback to in-memory only
        const memory: UserMemory = {
            id: Date.now(),
            userId,
            category,
            key,
            value,
            confidence,
            source,
            lastAccessed: new Date(),
            createdAt: new Date(),
        };

        const userCache = memoryCache.get(userId) || new Map();
        userCache.set(memoryKey, memory);
        memoryCache.set(userId, userCache);

        return memory;
    }
}

/**
 * Get all memories for a user
 */
export async function getMemories(
    userId: number,
    category?: MemoryCategory
): Promise<UserMemory[]> {
    // Check cache first
    const userCache = memoryCache.get(userId);
    if (userCache && userCache.size > 0) {
        const memories = Array.from(userCache.values());
        if (category) {
            return memories.filter(m => m.category === category);
        }
        return memories;
    }

    try {
        // Fetch from database
        let query = db.query.userMemories?.findMany({
            where: eq(sql`user_id`, userId),
            orderBy: desc(sql`last_accessed`),
        });

        if (category && query) {
            query = db.query.userMemories?.findMany({
                where: and(
                    eq(sql`user_id`, userId),
                    eq(sql`category`, category)
                ),
                orderBy: desc(sql`last_accessed`),
            });
        }

        const memories = await query || [];

        // Populate cache
        const newCache = new Map<string, UserMemory>();
        for (const memory of memories) {
            newCache.set(`${memory.category}:${memory.key}`, memory);
        }
        memoryCache.set(userId, newCache);

        return memories;
    } catch (error) {
        console.error('Error fetching memories:', error);
        return [];
    }
}

/**
 * Get relevant memories for a topic
 */
export async function getRelevantMemories(
    userId: number,
    topic: string,
    limit: number = 10
): Promise<UserMemory[]> {
    const allMemories = await getMemories(userId);

    // Simple keyword matching (could be enhanced with embeddings)
    const topicWords = topic.toLowerCase().split(/\s+/);

    const scored = allMemories.map(memory => {
        let score = 0;
        const memoryText = `${memory.key} ${memory.value}`.toLowerCase();

        for (const word of topicWords) {
            if (memoryText.includes(word)) {
                score += 1;
            }
        }

        // Boost by recency and confidence
        const daysSinceAccess = (Date.now() - memory.lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
        score *= memory.confidence;
        score *= Math.exp(-daysSinceAccess / 30); // Decay over 30 days

        return { memory, score };
    });

    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(s => s.memory);
}

/**
 * Build context string from memories
 */
export async function buildMemoryContext(
    userId: number,
    currentTopic?: string
): Promise<string> {
    const [preferences, facts, instructions] = await Promise.all([
        getMemories(userId, 'preferences'),
        getMemories(userId, 'facts'),
        getMemories(userId, 'instructions'),
    ]);

    const relevantContext = currentTopic
        ? await getRelevantMemories(userId, currentTopic, 5)
        : [];

    const sections: string[] = [];

    if (preferences.length > 0) {
        sections.push(`## Preferencias del Usuario\n${preferences.map(p => `- ${p.key}: ${p.value}`).join('\n')}`);
    }

    if (facts.length > 0) {
        sections.push(`## Hechos Conocidos\n${facts.map(f => `- ${f.key}: ${f.value}`).join('\n')}`);
    }

    if (instructions.length > 0) {
        sections.push(`## Instrucciones Personalizadas\n${instructions.map(i => `- ${i.value}`).join('\n')}`);
    }

    if (relevantContext.length > 0 && currentTopic) {
        sections.push(`## Contexto Relevante para "${currentTopic}"\n${relevantContext.map(c => `- ${c.value}`).join('\n')}`);
    }

    return sections.join('\n\n');
}

/**
 * Extract memories from conversation
 */
export async function extractMemoriesFromMessage(
    userId: number,
    message: string,
    role: 'user' | 'assistant'
): Promise<void> {
    // Patterns to detect
    const patterns = [
        { regex: /(?:me llamo|mi nombre es|soy)\s+([A-Z][a-zA-Z]+)/i, category: 'facts' as MemoryCategory, key: 'nombre' },
        { regex: /(?:trabajo en|soy)\s+([^,.]+)(?:como|de)\s+(\w+)/i, category: 'facts' as MemoryCategory, key: 'trabajo' },
        { regex: /(?:prefiero|me gusta más)\s+(.+?)(?:\.|,|$)/i, category: 'preferences' as MemoryCategory, key: 'preference' },
        { regex: /(?:siempre|nunca)\s+(.+?)(?:\.|,|$)/i, category: 'instructions' as MemoryCategory, key: 'instruction' },
        { regex: /(?:mi empresa|nuestra empresa)\s+(.+?)(?:\.|,|$)/i, category: 'facts' as MemoryCategory, key: 'empresa' },
        { regex: /(?:mi correo|email)\s*(?:es)?\s*([^\s,]+@[^\s,]+)/i, category: 'facts' as MemoryCategory, key: 'email' },
    ];

    for (const pattern of patterns) {
        const match = message.match(pattern.regex);
        if (match) {
            const value = match[1].trim();
            if (value.length > 2 && value.length < 100) {
                await saveMemory(userId, {
                    category: pattern.category,
                    key: pattern.key,
                    value,
                    confidence: role === 'user' ? 0.9 : 0.7,
                    source: 'extracted',
                });
            }
        }
    }
}

/**
 * Delete a memory
 */
export async function deleteMemory(userId: number, memoryId: number): Promise<boolean> {
    try {
        await db.delete(sql`user_memories`)
            .where(and(
                eq(sql`id`, memoryId),
                eq(sql`user_id`, userId)
            ));

        // Clear cache for user
        memoryCache.delete(userId);

        return true;
    } catch (error) {
        console.error('Error deleting memory:', error);
        return false;
    }
}

/**
 * Clear all memories for a user
 */
export async function clearMemories(userId: number): Promise<void> {
    try {
        await db.delete(sql`user_memories`)
            .where(eq(sql`user_id`, userId));

        memoryCache.delete(userId);
    } catch (error) {
        console.error('Error clearing memories:', error);
    }
}
