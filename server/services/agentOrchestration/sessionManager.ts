/**
 * Session Manager
 *
 * Manages agent sessions with multi-dimensional keys, lane concurrency control,
 * and automatic compaction. Ported from OpenClaw's session-key.ts,
 * session-key-utils.ts, and server-lanes.ts.
 */

export interface SessionKey {
    agentId: string;
    scope: 'direct' | 'group' | 'channel' | 'api';
    identifier: string;
}

export interface SessionMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    timestamp: Date;
    tokenEstimate?: number;
}

export interface CompactionResult {
    messages: SessionMessage[];
    originalTokens: number;
    compactedTokens: number;
    messagesRemoved: number;
    summaryAdded: boolean;
}

const VALID_SCOPES = new Set(['direct', 'group', 'channel', 'api']);
const RECENT_MESSAGES_TO_KEEP = 6;

/**
 * Build a session key string from components.
 * Format: agent:{agentId}:{scope}:{identifier}
 *
 * If identityLinks are provided, resolves alternate IDs to canonical.
 */
export function buildSessionKey(params: {
    agentId: string;
    scope: SessionKey['scope'];
    identifier: string;
    identityLinks?: Record<string, string[]>;
}): string {
    let resolvedId = params.identifier;

    if (params.identityLinks) {
        for (const [canonical, alternates] of Object.entries(params.identityLinks)) {
            if (alternates.includes(params.identifier)) {
                resolvedId = canonical;
                break;
            }
        }
    }

    return `agent:${params.agentId}:${params.scope}:${resolvedId}`;
}

/**
 * Parse a session key string back into components.
 */
export function parseSessionKey(key: string): SessionKey | null {
    const parts = key.split(':');
    if (parts.length !== 4 || parts[0] !== 'agent') return null;

    const scope = parts[2];
    if (!VALID_SCOPES.has(scope)) return null;

    return {
        agentId: parts[1],
        scope: scope as SessionKey['scope'],
        identifier: parts[3],
    };
}

/**
 * Extract just the scope from a session key.
 */
export function deriveSessionScope(key: string): SessionKey['scope'] | 'unknown' {
    const parsed = parseSessionKey(key);
    return parsed?.scope ?? 'unknown';
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export class SessionManager {
    private lanes: Map<string, Promise<void>> = new Map();

    /**
     * Lane concurrency: ensures one execution at a time per session key.
     * New calls queue behind the current one via chained promises.
     */
    async withLane<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
        const currentLane = this.lanes.get(sessionKey) ?? Promise.resolve();

        let resolve!: () => void;
        const nextLane = new Promise<void>(r => { resolve = r; });
        this.lanes.set(sessionKey, nextLane);

        await currentLane;

        try {
            return await fn();
        } finally {
            resolve();
            // Clean up if this is the last in queue
            if (this.lanes.get(sessionKey) === nextLane) {
                this.lanes.delete(sessionKey);
            }
        }
    }

    /**
     * Compact session history when it exceeds token limit.
     *
     * Algorithm (ported from OpenClaw):
     * 1. Keep system messages (always)
     * 2. Keep last N messages (recent context)
     * 3. Summarize removed messages into a single context summary
     */
    async compactHistory(
        messages: SessionMessage[],
        maxTokens: number,
    ): Promise<CompactionResult> {
        const originalTokens = messages.reduce(
            (sum, m) => sum + (m.tokenEstimate ?? estimateTokens(m.content)),
            0,
        );

        if (originalTokens <= maxTokens) {
            return {
                messages: [...messages],
                originalTokens,
                compactedTokens: originalTokens,
                messagesRemoved: 0,
                summaryAdded: false,
            };
        }

        // Separate system messages, recent, and middle
        const systemMessages = messages.filter(m => m.role === 'system');
        const nonSystem = messages.filter(m => m.role !== 'system');
        const recentCount = Math.min(RECENT_MESSAGES_TO_KEEP, nonSystem.length);
        const recent = nonSystem.slice(-recentCount);
        const toSummarize = nonSystem.slice(0, nonSystem.length - recentCount);

        if (toSummarize.length === 0) {
            return {
                messages: [...messages],
                originalTokens,
                compactedTokens: originalTokens,
                messagesRemoved: 0,
                summaryAdded: false,
            };
        }

        // Build summary of removed messages
        const summaryParts = toSummarize.map(m => `[${m.role}]: ${m.content.slice(0, 80)}`);
        const summaryContent = `[Context Summary — ${toSummarize.length} earlier messages compressed]\n${summaryParts.join('\n')}`;

        const summaryMessage: SessionMessage = {
            role: 'assistant',
            content: summaryContent,
            timestamp: new Date(),
            tokenEstimate: estimateTokens(summaryContent),
        };

        const compactedMessages = [...systemMessages, summaryMessage, ...recent];
        const compactedTokens = compactedMessages.reduce(
            (sum, m) => sum + (m.tokenEstimate ?? estimateTokens(m.content)),
            0,
        );

        return {
            messages: compactedMessages,
            originalTokens,
            compactedTokens,
            messagesRemoved: toSummarize.length,
            summaryAdded: true,
        };
    }
}

export const sessionManager = new SessionManager();
