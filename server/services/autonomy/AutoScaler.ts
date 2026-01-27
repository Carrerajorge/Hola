/**
 * Auto Scaler Service
 *
 * Dynamic resource management and scaling.
 * Implements improvements 16-30: Auto-scaling
 */

import { EventEmitter } from "events";
import { db } from "../../db";
import { sql } from "drizzle-orm";

// ============================================================================
// TYPES
// ============================================================================

interface ScalingMetrics {
    cpu: number; // 0-100
    memory: number; // 0-100
    activeConnections: number;
    requestsPerSecond: number;
    avgResponseTime: number;
    queueDepth: number;
    errorRate: number;
}

interface ScalingPolicy {
    name: string;
    metric: keyof ScalingMetrics;
    scaleUpThreshold: number;
    scaleDownThreshold: number;
    cooldownSeconds: number;
    minInstances: number;
    maxInstances: number;
}

interface ResourcePool {
    name: string;
    currentSize: number;
    minSize: number;
    maxSize: number;
    targetUtilization: number;
}

interface RateLimitConfig {
    windowMs: number;
    maxRequests: number;
    currentLoad: number;
    adaptiveMultiplier: number;
}

// ============================================================================
// AUTO SCALER SERVICE
// ============================================================================

export class AutoScalerService extends EventEmitter {
    private metrics: ScalingMetrics;
    private policies: Map<string, ScalingPolicy> = new Map();
    private resourcePools: Map<string, ResourcePool> = new Map();
    private rateLimits: Map<string, RateLimitConfig> = new Map();
    private metricsHistory: ScalingMetrics[] = [];
    private checkInterval: NodeJS.Timeout | null = null;
    private readonly CHECK_INTERVAL_MS = 10000; // 10 seconds
    private readonly HISTORY_SIZE = 60; // 10 minutes of history

    constructor() {
        super();
        this.metrics = this.getDefaultMetrics();
        this.initializePolicies();
        this.initializeResourcePools();
        this.initializeRateLimits();
        console.log("[AutoScaler] Service initialized");
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    private getDefaultMetrics(): ScalingMetrics {
        return {
            cpu: 0,
            memory: 0,
            activeConnections: 0,
            requestsPerSecond: 0,
            avgResponseTime: 0,
            queueDepth: 0,
            errorRate: 0
        };
    }

    private initializePolicies(): void {
        // CPU-based scaling
        this.policies.set("cpu", {
            name: "cpu",
            metric: "cpu",
            scaleUpThreshold: 80,
            scaleDownThreshold: 30,
            cooldownSeconds: 300,
            minInstances: 1,
            maxInstances: 10
        });

        // Memory-based scaling
        this.policies.set("memory", {
            name: "memory",
            metric: "memory",
            scaleUpThreshold: 85,
            scaleDownThreshold: 40,
            cooldownSeconds: 300,
            minInstances: 1,
            maxInstances: 10
        });

        // Request rate scaling
        this.policies.set("requests", {
            name: "requests",
            metric: "requestsPerSecond",
            scaleUpThreshold: 100,
            scaleDownThreshold: 20,
            cooldownSeconds: 180,
            minInstances: 1,
            maxInstances: 20
        });

        // Response time scaling
        this.policies.set("latency", {
            name: "latency",
            metric: "avgResponseTime",
            scaleUpThreshold: 2000, // 2 seconds
            scaleDownThreshold: 500,
            cooldownSeconds: 120,
            minInstances: 1,
            maxInstances: 10
        });
    }

    private initializeResourcePools(): void {
        // Database connection pool
        this.resourcePools.set("database", {
            name: "database",
            currentSize: 10,
            minSize: 5,
            maxSize: 50,
            targetUtilization: 0.7
        });

        // Worker pool
        this.resourcePools.set("workers", {
            name: "workers",
            currentSize: 4,
            minSize: 2,
            maxSize: 16,
            targetUtilization: 0.8
        });

        // Cache pool
        this.resourcePools.set("cache", {
            name: "cache",
            currentSize: 100, // MB
            minSize: 50,
            maxSize: 500,
            targetUtilization: 0.75
        });
    }

    private initializeRateLimits(): void {
        // Global rate limit
        this.rateLimits.set("global", {
            windowMs: 60000,
            maxRequests: 1000,
            currentLoad: 0,
            adaptiveMultiplier: 1.0
        });

        // Per-user rate limit
        this.rateLimits.set("user", {
            windowMs: 60000,
            maxRequests: 60,
            currentLoad: 0,
            adaptiveMultiplier: 1.0
        });

        // API rate limit
        this.rateLimits.set("api", {
            windowMs: 60000,
            maxRequests: 100,
            currentLoad: 0,
            adaptiveMultiplier: 1.0
        });

        // AI requests rate limit
        this.rateLimits.set("ai", {
            windowMs: 60000,
            maxRequests: 30,
            currentLoad: 0,
            adaptiveMultiplier: 1.0
        });
    }

    // ========================================================================
    // MAIN LOOP
    // ========================================================================

    start(): void {
        console.log("[AutoScaler] Starting metrics collection...");

        this.checkInterval = setInterval(async () => {
            try {
                await this.collectMetrics();
                this.evaluateScaling();
                this.adjustRateLimits();
            } catch (error) {
                console.error("[AutoScaler] Error in main loop:", error);
            }
        }, this.CHECK_INTERVAL_MS);

        // Initial collection
        this.collectMetrics();
    }

    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        console.log("[AutoScaler] Service stopped");
    }

    // ========================================================================
    // METRICS COLLECTION
    // ========================================================================

    async collectMetrics(): Promise<ScalingMetrics> {
        const memUsage = process.memoryUsage();

        this.metrics = {
            cpu: await this.getCPUUsage(),
            memory: (memUsage.heapUsed / memUsage.heapTotal) * 100,
            activeConnections: await this.getActiveConnections(),
            requestsPerSecond: this.calculateRequestRate(),
            avgResponseTime: this.calculateAvgResponseTime(),
            queueDepth: this.getQueueDepth(),
            errorRate: this.calculateErrorRate()
        };

        // Store in history
        this.metricsHistory.push({ ...this.metrics });
        if (this.metricsHistory.length > this.HISTORY_SIZE) {
            this.metricsHistory.shift();
        }

        return this.metrics;
    }

    private async getCPUUsage(): Promise<number> {
        // Simple CPU approximation using event loop lag
        return new Promise((resolve) => {
            const start = process.hrtime.bigint();
            setImmediate(() => {
                const end = process.hrtime.bigint();
                const lagMs = Number(end - start) / 1_000_000;
                // Map lag to approximate CPU (0-10ms = 0-100%)
                const cpuEstimate = Math.min(100, lagMs * 10);
                resolve(cpuEstimate);
            });
        });
    }

    private async getActiveConnections(): Promise<number> {
        try {
            const result = await db.execute(sql`
                SELECT count(*) as count FROM pg_stat_activity
                WHERE datname = current_database()
                AND state = 'active'
            `);
            return Number((result as any)[0]?.count || 0);
        } catch {
            return 0;
        }
    }

    private requestTimestamps: number[] = [];

    recordRequest(): void {
        this.requestTimestamps.push(Date.now());
        // Keep last minute only
        const oneMinuteAgo = Date.now() - 60000;
        this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    }

    private calculateRequestRate(): number {
        const oneSecondAgo = Date.now() - 1000;
        return this.requestTimestamps.filter(t => t > oneSecondAgo).length;
    }

    private responseTimes: number[] = [];

    recordResponseTime(ms: number): void {
        this.responseTimes.push(ms);
        if (this.responseTimes.length > 100) {
            this.responseTimes.shift();
        }
    }

    private calculateAvgResponseTime(): number {
        if (this.responseTimes.length === 0) return 0;
        const sum = this.responseTimes.reduce((a, b) => a + b, 0);
        return sum / this.responseTimes.length;
    }

    private errorTimestamps: number[] = [];

    recordError(): void {
        this.errorTimestamps.push(Date.now());
        const fiveMinutesAgo = Date.now() - 300000;
        this.errorTimestamps = this.errorTimestamps.filter(t => t > fiveMinutesAgo);
    }

    private calculateErrorRate(): number {
        const oneMinuteAgo = Date.now() - 60000;
        const recentErrors = this.errorTimestamps.filter(t => t > oneMinuteAgo).length;
        const recentRequests = this.requestTimestamps.filter(t => t > oneMinuteAgo).length;
        return recentRequests > 0 ? (recentErrors / recentRequests) * 100 : 0;
    }

    private queueDepth = 0;

    setQueueDepth(depth: number): void {
        this.queueDepth = depth;
    }

    private getQueueDepth(): number {
        return this.queueDepth;
    }

    // ========================================================================
    // SCALING DECISIONS
    // ========================================================================

    private lastScaleAction: Map<string, Date> = new Map();

    private evaluateScaling(): void {
        for (const [name, policy] of this.policies) {
            const value = this.metrics[policy.metric];
            const lastAction = this.lastScaleAction.get(name);

            // Check cooldown
            if (lastAction) {
                const elapsed = Date.now() - lastAction.getTime();
                if (elapsed < policy.cooldownSeconds * 1000) continue;
            }

            if (value > policy.scaleUpThreshold) {
                this.recommendScaleUp(policy, value);
            } else if (value < policy.scaleDownThreshold) {
                this.recommendScaleDown(policy, value);
            }
        }
    }

    private recommendScaleUp(policy: ScalingPolicy, currentValue: number): void {
        console.log(`[AutoScaler] Scale UP recommended - ${policy.name}: ${currentValue} > ${policy.scaleUpThreshold}`);

        this.lastScaleAction.set(policy.name, new Date());

        this.emit("scale_up", {
            policy: policy.name,
            metric: policy.metric,
            currentValue,
            threshold: policy.scaleUpThreshold,
            timestamp: new Date()
        });

        // Auto-adjust resources
        this.autoAdjustResources("up");
    }

    private recommendScaleDown(policy: ScalingPolicy, currentValue: number): void {
        console.log(`[AutoScaler] Scale DOWN possible - ${policy.name}: ${currentValue} < ${policy.scaleDownThreshold}`);

        this.lastScaleAction.set(policy.name, new Date());

        this.emit("scale_down", {
            policy: policy.name,
            metric: policy.metric,
            currentValue,
            threshold: policy.scaleDownThreshold,
            timestamp: new Date()
        });

        // Auto-adjust resources
        this.autoAdjustResources("down");
    }

    // ========================================================================
    // RESOURCE POOL MANAGEMENT
    // ========================================================================

    private autoAdjustResources(direction: "up" | "down"): void {
        for (const [name, pool] of this.resourcePools) {
            if (direction === "up") {
                const newSize = Math.min(
                    pool.maxSize,
                    Math.ceil(pool.currentSize * 1.5)
                );

                if (newSize !== pool.currentSize) {
                    console.log(`[AutoScaler] Scaling ${name} pool: ${pool.currentSize} -> ${newSize}`);
                    pool.currentSize = newSize;
                    this.emit("pool_scaled", { pool: name, newSize, direction });
                }
            } else {
                const newSize = Math.max(
                    pool.minSize,
                    Math.floor(pool.currentSize * 0.75)
                );

                if (newSize !== pool.currentSize) {
                    console.log(`[AutoScaler] Scaling ${name} pool: ${pool.currentSize} -> ${newSize}`);
                    pool.currentSize = newSize;
                    this.emit("pool_scaled", { pool: name, newSize, direction });
                }
            }
        }
    }

    adjustPoolSize(poolName: string, newSize: number): boolean {
        const pool = this.resourcePools.get(poolName);
        if (!pool) return false;

        const clampedSize = Math.max(pool.minSize, Math.min(pool.maxSize, newSize));
        pool.currentSize = clampedSize;

        console.log(`[AutoScaler] Pool ${poolName} manually set to ${clampedSize}`);
        return true;
    }

    // ========================================================================
    // ADAPTIVE RATE LIMITING (Improvement #22)
    // ========================================================================

    private adjustRateLimits(): void {
        for (const [name, config] of this.rateLimits) {
            // Increase limits when load is low
            if (this.metrics.cpu < 50 && this.metrics.errorRate < 1) {
                config.adaptiveMultiplier = Math.min(2.0, config.adaptiveMultiplier * 1.1);
            }
            // Decrease limits when under pressure
            else if (this.metrics.cpu > 80 || this.metrics.errorRate > 5) {
                config.adaptiveMultiplier = Math.max(0.5, config.adaptiveMultiplier * 0.9);
            }
        }
    }

    getEffectiveRateLimit(limitName: string): number {
        const config = this.rateLimits.get(limitName);
        if (!config) return Infinity;

        return Math.floor(config.maxRequests * config.adaptiveMultiplier);
    }

    checkRateLimit(limitName: string, currentCount: number): boolean {
        const effectiveLimit = this.getEffectiveRateLimit(limitName);
        return currentCount < effectiveLimit;
    }

    // ========================================================================
    // LOAD BALANCING (Improvement #17)
    // ========================================================================

    private serverWeights: Map<string, number> = new Map();

    registerServer(serverId: string, weight: number = 1): void {
        this.serverWeights.set(serverId, weight);
    }

    getServerWeight(serverId: string): number {
        return this.serverWeights.get(serverId) || 1;
    }

    selectServer(servers: string[]): string {
        if (servers.length === 0) throw new Error("No servers available");
        if (servers.length === 1) return servers[0];

        // Weighted random selection
        const totalWeight = servers.reduce((sum, s) => sum + this.getServerWeight(s), 0);
        let random = Math.random() * totalWeight;

        for (const server of servers) {
            random -= this.getServerWeight(server);
            if (random <= 0) return server;
        }

        return servers[0];
    }

    adjustServerWeight(serverId: string, success: boolean): void {
        const current = this.serverWeights.get(serverId) || 1;

        if (success) {
            this.serverWeights.set(serverId, Math.min(2, current * 1.1));
        } else {
            this.serverWeights.set(serverId, Math.max(0.1, current * 0.9));
        }
    }

    // ========================================================================
    // QUEUE MANAGEMENT (Improvement #21)
    // ========================================================================

    private queues: Map<string, any[]> = new Map();
    private queueProcessors: Map<string, (item: any) => Promise<void>> = new Map();

    registerQueue(name: string, processor: (item: any) => Promise<void>): void {
        this.queues.set(name, []);
        this.queueProcessors.set(name, processor);
    }

    async enqueue(queueName: string, item: any): Promise<void> {
        const queue = this.queues.get(queueName);
        if (!queue) throw new Error(`Queue ${queueName} not found`);

        queue.push(item);
        this.setQueueDepth(this.getTotalQueueDepth());

        // Auto-process if queue getting large
        if (queue.length > 100) {
            await this.processQueue(queueName, 10);
        }
    }

    private async processQueue(queueName: string, batchSize: number): Promise<void> {
        const queue = this.queues.get(queueName);
        const processor = this.queueProcessors.get(queueName);

        if (!queue || !processor) return;

        const batch = queue.splice(0, batchSize);

        await Promise.allSettled(
            batch.map(item => processor(item))
        );

        this.setQueueDepth(this.getTotalQueueDepth());
    }

    private getTotalQueueDepth(): number {
        let total = 0;
        for (const queue of this.queues.values()) {
            total += queue.length;
        }
        return total;
    }

    // ========================================================================
    // COMPRESSION (Improvement #18)
    // ========================================================================

    shouldCompress(contentSize: number): boolean {
        // Compress if under memory pressure or content is large
        if (this.metrics.memory > 70) return true;
        if (contentSize > 1024) return true;
        return false;
    }

    getCompressionLevel(): number {
        // Higher compression when under pressure
        if (this.metrics.cpu > 80) return 1; // Fast compression
        if (this.metrics.cpu > 50) return 5; // Balanced
        return 9; // Maximum compression
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    getMetrics(): ScalingMetrics {
        return { ...this.metrics };
    }

    getMetricsHistory(): ScalingMetrics[] {
        return [...this.metricsHistory];
    }

    getPolicies(): Map<string, ScalingPolicy> {
        return new Map(this.policies);
    }

    getResourcePools(): Map<string, ResourcePool> {
        return new Map(this.resourcePools);
    }

    getRateLimits(): Map<string, RateLimitConfig> {
        return new Map(this.rateLimits);
    }

    getStatus(): {
        healthy: boolean;
        metrics: ScalingMetrics;
        recommendations: string[];
    } {
        const recommendations: string[] = [];

        if (this.metrics.cpu > 80) {
            recommendations.push("High CPU: Consider scaling up instances");
        }
        if (this.metrics.memory > 85) {
            recommendations.push("High memory: Consider adding RAM or restarting");
        }
        if (this.metrics.errorRate > 5) {
            recommendations.push("High error rate: Check logs for issues");
        }
        if (this.metrics.avgResponseTime > 2000) {
            recommendations.push("Slow responses: Consider caching or optimization");
        }

        return {
            healthy: this.metrics.cpu < 90 && this.metrics.memory < 90 && this.metrics.errorRate < 10,
            metrics: this.metrics,
            recommendations
        };
    }
}

// Singleton instance
export const autoScaler = new AutoScalerService();

export default autoScaler;
