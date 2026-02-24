/**
 * Multi-Agent Router
 *
 * Routes incoming requests to the appropriate agent based on configurable
 * bindings. Ported from OpenClaw's resolve-route.ts and bindings.ts,
 * adapted for ILIAGPT's PARE orchestrator.
 */

import { buildSessionKey } from './sessionManager';

export interface AgentConfig {
    id: string;
    name: string;
    modelPrimary: string;
    modelFallbacks: string[];
    skills: string[];
    toolPolicy: { allow?: string[]; deny?: string[] };
    maxRetries: number;
    timeoutMs: number;
}

export interface AgentBinding {
    id: string;
    agentId: string;
    priority: number;
    match: {
        source?: string;
        userId?: string;
        intentCategory?: string;
        tags?: string[];
    };
    agentConfig: AgentConfig;
    isActive: boolean;
}

export interface RouteInput {
    userId: string;
    source: string;
    intentCategory?: string;
    tags?: string[];
}

export interface AgentRoute {
    agentId: string;
    sessionKey: string;
    matchedBy: string;
    agentConfig: AgentConfig;
}

export class MultiAgentRouter {
    private defaultAgent: AgentConfig;
    private bindings: AgentBinding[] = [];
    private cache: Map<string, AgentRoute> = new Map();
    private readonly CACHE_LIMIT = 2000;

    constructor(defaultAgent: AgentConfig) {
        this.defaultAgent = defaultAgent;
    }

    addBinding(binding: AgentBinding): void {
        this.bindings.push(binding);
    }

    /**
     * Main routing function — adapted from OpenClaw's resolveAgentRoute.
     *
     * Matching tiers (in evaluation order):
     * 1. User-specific binding (highest specificity)
     * 2. Intent-specific binding
     * 3. Source-specific binding
     * 4. Tag-based binding
     * 5. Default agent (fallback)
     *
     * Within each tier, higher priority wins.
     */
    resolveRoute(input: RouteInput): AgentRoute {
        const cacheKey = this.buildCacheKey(input);
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        const active = this.bindings
            .filter(b => b.isActive)
            .sort((a, b) => b.priority - a.priority);

        let matched: { binding: AgentBinding; tier: string } | null = null;

        // Tier 1: User-specific
        for (const b of active) {
            if (b.match.userId && b.match.userId === input.userId) {
                matched = { binding: b, tier: 'userId' };
                break;
            }
        }

        // Tier 2: Intent-specific
        if (!matched && input.intentCategory) {
            for (const b of active) {
                if (b.match.intentCategory && b.match.intentCategory === input.intentCategory) {
                    matched = { binding: b, tier: 'intent' };
                    break;
                }
            }
        }

        // Tier 3: Source-specific
        if (!matched) {
            for (const b of active) {
                if (b.match.source && b.match.source === input.source) {
                    matched = { binding: b, tier: 'source' };
                    break;
                }
            }
        }

        // Tier 4: Tag-based (at least one tag overlap)
        if (!matched && input.tags && input.tags.length > 0) {
            const inputTagSet = new Set(input.tags);
            for (const b of active) {
                if (b.match.tags && b.match.tags.some(t => inputTagSet.has(t))) {
                    matched = { binding: b, tier: 'tags' };
                    break;
                }
            }
        }

        // Build route
        const agentConfig = matched?.binding.agentConfig ?? this.defaultAgent;
        const route: AgentRoute = {
            agentId: agentConfig.id,
            sessionKey: buildSessionKey({
                agentId: agentConfig.id,
                scope: 'direct',
                identifier: input.userId,
            }),
            matchedBy: matched?.tier ?? 'default',
            agentConfig,
        };

        // Cache with eviction
        if (this.cache.size >= this.CACHE_LIMIT) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) this.cache.delete(firstKey);
        }
        this.cache.set(cacheKey, route);

        return route;
    }

    clearCache(): void {
        this.cache.clear();
    }

    private buildCacheKey(input: RouteInput): string {
        return `${input.userId}:${input.source}:${input.intentCategory ?? ''}:${(input.tags ?? []).sort().join(',')}`;
    }
}
