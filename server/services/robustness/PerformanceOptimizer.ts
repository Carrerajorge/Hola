/**
 * Performance Optimizer Service
 *
 * Advanced performance optimization and monitoring.
 * Implements improvements 131-145: Performance Optimization
 */

import { EventEmitter } from "events";

// ============================================================================
// TYPES
// ============================================================================

interface PerformanceMetric {
    name: string;
    value: number;
    unit: string;
    timestamp: Date;
    tags?: Record<string, string>;
}

interface ProfileResult {
    functionName: string;
    duration: number;
    memoryDelta: number;
    callCount: number;
    avgDuration: number;
}

interface QueryPlan {
    query: string;
    estimatedCost: number;
    actualTime?: number;
    indexUsed: boolean;
    recommendations: string[];
}

interface CacheStrategy {
    name: string;
    hitRate: number;
    missRate: number;
    evictionRate: number;
    avgLatency: number;
}

// ============================================================================
// PERFORMANCE PROFILER (Improvements 131-133)
// ============================================================================

class PerformanceProfiler {
    private profiles: Map<string, ProfileResult[]> = new Map();
    private activeTimers: Map<string, { start: bigint; startMemory: number }> = new Map();
    private readonly maxSamples = 1000;

    startTimer(name: string): string {
        const id = `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.activeTimers.set(id, {
            start: process.hrtime.bigint(),
            startMemory: process.memoryUsage().heapUsed
        });
        return id;
    }

    endTimer(id: string): ProfileResult | null {
        const timer = this.activeTimers.get(id);
        if (!timer) return null;

        this.activeTimers.delete(id);

        const end = process.hrtime.bigint();
        const endMemory = process.memoryUsage().heapUsed;
        const duration = Number(end - timer.start) / 1_000_000; // Convert to ms
        const memoryDelta = endMemory - timer.startMemory;

        const name = id.split("_")[0];
        const result: ProfileResult = {
            functionName: name,
            duration,
            memoryDelta,
            callCount: 1,
            avgDuration: duration
        };

        // Store profile
        if (!this.profiles.has(name)) {
            this.profiles.set(name, []);
        }

        const profiles = this.profiles.get(name)!;
        profiles.push(result);

        if (profiles.length > this.maxSamples) {
            profiles.shift();
        }

        return result;
    }

    async profile<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const id = this.startTimer(name);
        try {
            return await fn();
        } finally {
            this.endTimer(id);
        }
    }

    getStats(name: string): {
        avgDuration: number;
        minDuration: number;
        maxDuration: number;
        p95Duration: number;
        p99Duration: number;
        callCount: number;
        avgMemoryDelta: number;
    } | null {
        const profiles = this.profiles.get(name);
        if (!profiles || profiles.length === 0) return null;

        const durations = profiles.map(p => p.duration).sort((a, b) => a - b);
        const memoryDeltas = profiles.map(p => p.memoryDelta);

        return {
            avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
            minDuration: durations[0],
            maxDuration: durations[durations.length - 1],
            p95Duration: durations[Math.floor(durations.length * 0.95)],
            p99Duration: durations[Math.floor(durations.length * 0.99)],
            callCount: profiles.length,
            avgMemoryDelta: memoryDeltas.reduce((a, b) => a + b, 0) / memoryDeltas.length
        };
    }

    getAllStats(): Record<string, any> {
        const stats: Record<string, any> = {};
        for (const name of this.profiles.keys()) {
            stats[name] = this.getStats(name);
        }
        return stats;
    }

    getSlowFunctions(thresholdMs: number = 100): string[] {
        const slow: string[] = [];

        for (const [name, profiles] of this.profiles) {
            const avg = profiles.reduce((sum, p) => sum + p.duration, 0) / profiles.length;
            if (avg > thresholdMs) {
                slow.push(name);
            }
        }

        return slow;
    }

    clear(): void {
        this.profiles.clear();
    }
}

// ============================================================================
// QUERY OPTIMIZER (Improvements 134-136)
// ============================================================================

class QueryOptimizer {
    private queryStats: Map<string, { count: number; totalTime: number; avgTime: number }> = new Map();
    private slowQueryThreshold = 1000; // 1 second

    recordQuery(query: string, durationMs: number): void {
        const normalized = this.normalizeQuery(query);
        const stats = this.queryStats.get(normalized) || { count: 0, totalTime: 0, avgTime: 0 };

        stats.count++;
        stats.totalTime += durationMs;
        stats.avgTime = stats.totalTime / stats.count;

        this.queryStats.set(normalized, stats);

        if (durationMs > this.slowQueryThreshold) {
            console.warn(`[QueryOptimizer] Slow query (${durationMs}ms): ${query.slice(0, 100)}...`);
        }
    }

    analyzeQuery(query: string): QueryPlan {
        const normalized = this.normalizeQuery(query);
        const stats = this.queryStats.get(normalized);
        const recommendations: string[] = [];

        // Check for common issues
        if (query.toLowerCase().includes("select *")) {
            recommendations.push("Evitar SELECT *, especificar columnas necesarias");
        }

        if (!query.toLowerCase().includes("where") && query.toLowerCase().includes("select")) {
            recommendations.push("Agregar cláusula WHERE para limitar resultados");
        }

        if (query.toLowerCase().includes("like '%")) {
            recommendations.push("Evitar LIKE con wildcard al inicio, no usa índices");
        }

        if (!query.toLowerCase().includes("limit") && query.toLowerCase().includes("select")) {
            recommendations.push("Considerar agregar LIMIT para paginar resultados");
        }

        if (query.toLowerCase().includes("order by") && !query.toLowerCase().includes("index")) {
            recommendations.push("Verificar que columnas de ORDER BY estén indexadas");
        }

        // Check for N+1 patterns
        if (this.detectNPlusOne(query)) {
            recommendations.push("Posible problema N+1, considerar JOIN o batch loading");
        }

        return {
            query: normalized,
            estimatedCost: this.estimateCost(query),
            actualTime: stats?.avgTime,
            indexUsed: this.checkIndexUsage(query),
            recommendations
        };
    }

    private normalizeQuery(query: string): string {
        // Remove specific values, keep structure
        return query
            .replace(/\d+/g, "?")
            .replace(/'[^']*'/g, "?")
            .replace(/"[^"]*"/g, "?")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    private estimateCost(query: string): number {
        let cost = 1;

        if (query.toLowerCase().includes("join")) cost *= 2;
        if (query.toLowerCase().includes("like")) cost *= 1.5;
        if (query.toLowerCase().includes("order by")) cost *= 1.3;
        if (query.toLowerCase().includes("group by")) cost *= 1.5;
        if (!query.toLowerCase().includes("where")) cost *= 3;
        if (query.toLowerCase().includes("select *")) cost *= 1.2;

        return cost;
    }

    private checkIndexUsage(query: string): boolean {
        // Simple heuristic - real implementation would use EXPLAIN
        const hasWhere = query.toLowerCase().includes("where");
        const hasIndex = query.toLowerCase().includes("id") ||
            query.toLowerCase().includes("_id") ||
            query.toLowerCase().includes("email");

        return hasWhere && hasIndex;
    }

    private detectNPlusOne(query: string): boolean {
        const normalized = this.normalizeQuery(query);
        const stats = this.queryStats.get(normalized);

        // If same query executed many times in short period
        return stats ? stats.count > 10 : false;
    }

    getSlowQueries(): Array<{ query: string; avgTime: number; count: number }> {
        const slow: Array<{ query: string; avgTime: number; count: number }> = [];

        for (const [query, stats] of this.queryStats) {
            if (stats.avgTime > this.slowQueryThreshold) {
                slow.push({ query, avgTime: stats.avgTime, count: stats.count });
            }
        }

        return slow.sort((a, b) => b.avgTime - a.avgTime);
    }

    getQueryStats(): Map<string, { count: number; totalTime: number; avgTime: number }> {
        return new Map(this.queryStats);
    }
}

// ============================================================================
// MEMORY OPTIMIZER (Improvements 137-139)
// ============================================================================

class MemoryOptimizer extends EventEmitter {
    private memoryHistory: Array<{ timestamp: Date; usage: NodeJS.MemoryUsage }> = [];
    private readonly historySize = 60; // 1 minute at 1 second intervals
    private checkInterval: NodeJS.Timeout | null = null;
    private readonly warningThreshold = 0.8; // 80%
    private readonly criticalThreshold = 0.9; // 90%

    start(): void {
        this.checkInterval = setInterval(() => {
            this.recordMemory();
            this.checkThresholds();
        }, 1000);
    }

    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    private recordMemory(): void {
        const usage = process.memoryUsage();
        this.memoryHistory.push({ timestamp: new Date(), usage });

        if (this.memoryHistory.length > this.historySize) {
            this.memoryHistory.shift();
        }
    }

    private checkThresholds(): void {
        const usage = process.memoryUsage();
        const percentUsed = usage.heapUsed / usage.heapTotal;

        if (percentUsed > this.criticalThreshold) {
            this.emit("critical", { percentUsed, usage });
            this.triggerCleanup();
        } else if (percentUsed > this.warningThreshold) {
            this.emit("warning", { percentUsed, usage });
        }
    }

    triggerCleanup(): void {
        console.log("[MemoryOptimizer] Triggering memory cleanup...");

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            console.log("[MemoryOptimizer] Garbage collection triggered");
        }

        this.emit("cleanup_triggered");
    }

    getMemoryTrend(): "increasing" | "decreasing" | "stable" {
        if (this.memoryHistory.length < 10) return "stable";

        const recent = this.memoryHistory.slice(-10);
        const first = recent[0].usage.heapUsed;
        const last = recent[recent.length - 1].usage.heapUsed;
        const diff = last - first;

        if (diff > first * 0.1) return "increasing";
        if (diff < -first * 0.1) return "decreasing";
        return "stable";
    }

    predictOOM(thresholdHours: number = 1): { willOOM: boolean; estimatedTime?: Date } {
        if (this.memoryHistory.length < 10) {
            return { willOOM: false };
        }

        const trend = this.getMemoryTrend();
        if (trend !== "increasing") {
            return { willOOM: false };
        }

        // Calculate growth rate
        const recent = this.memoryHistory.slice(-10);
        const first = recent[0];
        const last = recent[recent.length - 1];
        const timeElapsed = last.timestamp.getTime() - first.timestamp.getTime();
        const memoryGrowth = last.usage.heapUsed - first.usage.heapUsed;
        const growthRate = memoryGrowth / timeElapsed; // bytes per ms

        if (growthRate <= 0) return { willOOM: false };

        // Estimate time to reach heap total
        const remainingHeap = last.usage.heapTotal - last.usage.heapUsed;
        const timeToOOM = remainingHeap / growthRate;

        if (timeToOOM < thresholdHours * 3600000) {
            return {
                willOOM: true,
                estimatedTime: new Date(Date.now() + timeToOOM)
            };
        }

        return { willOOM: false };
    }

    getStats(): {
        current: NodeJS.MemoryUsage;
        trend: "increasing" | "decreasing" | "stable";
        percentUsed: number;
        oomPrediction: { willOOM: boolean; estimatedTime?: Date };
    } {
        const current = process.memoryUsage();
        return {
            current,
            trend: this.getMemoryTrend(),
            percentUsed: current.heapUsed / current.heapTotal,
            oomPrediction: this.predictOOM()
        };
    }
}

// ============================================================================
// RESPONSE TIME OPTIMIZER (Improvements 140-142)
// ============================================================================

class ResponseTimeOptimizer {
    private responseTimes: Map<string, number[]> = new Map();
    private slaTargets: Map<string, number> = new Map();
    private readonly maxSamples = 1000;

    recordResponseTime(endpoint: string, timeMs: number): void {
        if (!this.responseTimes.has(endpoint)) {
            this.responseTimes.set(endpoint, []);
        }

        const times = this.responseTimes.get(endpoint)!;
        times.push(timeMs);

        if (times.length > this.maxSamples) {
            times.shift();
        }
    }

    setSLATarget(endpoint: string, targetMs: number): void {
        this.slaTargets.set(endpoint, targetMs);
    }

    checkSLACompliance(endpoint: string): {
        compliant: boolean;
        target: number;
        p95: number;
        p99: number;
        complianceRate: number;
    } | null {
        const times = this.responseTimes.get(endpoint);
        const target = this.slaTargets.get(endpoint);

        if (!times || times.length === 0) return null;

        const sorted = [...times].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const p99 = sorted[Math.floor(sorted.length * 0.99)];

        const targetToUse = target || 1000; // Default 1 second
        const compliantCount = times.filter(t => t <= targetToUse).length;
        const complianceRate = compliantCount / times.length;

        return {
            compliant: p95 <= targetToUse,
            target: targetToUse,
            p95,
            p99,
            complianceRate
        };
    }

    getSlowEndpoints(thresholdMs: number = 500): Array<{
        endpoint: string;
        avgTime: number;
        p95: number;
    }> {
        const slow: Array<{ endpoint: string; avgTime: number; p95: number }> = [];

        for (const [endpoint, times] of this.responseTimes) {
            if (times.length === 0) continue;

            const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
            const sorted = [...times].sort((a, b) => a - b);
            const p95 = sorted[Math.floor(sorted.length * 0.95)];

            if (avgTime > thresholdMs || p95 > thresholdMs) {
                slow.push({ endpoint, avgTime, p95 });
            }
        }

        return slow.sort((a, b) => b.avgTime - a.avgTime);
    }

    getRecommendations(endpoint: string): string[] {
        const recommendations: string[] = [];
        const times = this.responseTimes.get(endpoint);

        if (!times || times.length === 0) return recommendations;

        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const sorted = [...times].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const variance = times.reduce((sum, t) => sum + Math.pow(t - avgTime, 2), 0) / times.length;
        const stdDev = Math.sqrt(variance);

        if (avgTime > 500) {
            recommendations.push("Considerar agregar caché para este endpoint");
        }

        if (stdDev > avgTime * 0.5) {
            recommendations.push("Alta variabilidad en tiempos de respuesta, investigar causa");
        }

        if (p95 > avgTime * 3) {
            recommendations.push("P95 muy alto, posibles outliers o problemas de escalabilidad");
        }

        return recommendations;
    }

    getAllStats(): Record<string, {
        avg: number;
        min: number;
        max: number;
        p50: number;
        p95: number;
        p99: number;
        count: number;
    }> {
        const stats: Record<string, any> = {};

        for (const [endpoint, times] of this.responseTimes) {
            if (times.length === 0) continue;

            const sorted = [...times].sort((a, b) => a - b);
            stats[endpoint] = {
                avg: times.reduce((a, b) => a + b, 0) / times.length,
                min: sorted[0],
                max: sorted[sorted.length - 1],
                p50: sorted[Math.floor(sorted.length * 0.5)],
                p95: sorted[Math.floor(sorted.length * 0.95)],
                p99: sorted[Math.floor(sorted.length * 0.99)],
                count: times.length
            };
        }

        return stats;
    }
}

// ============================================================================
// LAZY LOADER (Improvements 143-145)
// ============================================================================

class LazyLoader {
    private modules: Map<string, { loader: () => Promise<any>; instance?: any; loading?: Promise<any> }> = new Map();
    private preloadQueue: string[] = [];

    register(name: string, loader: () => Promise<any>): void {
        this.modules.set(name, { loader });
    }

    async load<T>(name: string): Promise<T> {
        const module = this.modules.get(name);
        if (!module) {
            throw new Error(`Module not registered: ${name}`);
        }

        if (module.instance) {
            return module.instance;
        }

        // Prevent duplicate loading
        if (module.loading) {
            return module.loading;
        }

        console.log(`[LazyLoader] Loading module: ${name}`);
        module.loading = module.loader();

        try {
            module.instance = await module.loading;
            return module.instance;
        } finally {
            module.loading = undefined;
        }
    }

    isLoaded(name: string): boolean {
        return !!this.modules.get(name)?.instance;
    }

    unload(name: string): boolean {
        const module = this.modules.get(name);
        if (module && module.instance) {
            module.instance = undefined;
            console.log(`[LazyLoader] Unloaded module: ${name}`);
            return true;
        }
        return false;
    }

    schedulePreload(names: string[], delayMs: number = 1000): void {
        setTimeout(async () => {
            for (const name of names) {
                if (!this.isLoaded(name)) {
                    await this.load(name).catch(console.error);
                }
            }
        }, delayMs);
    }

    getLoadedModules(): string[] {
        return Array.from(this.modules.entries())
            .filter(([_, m]) => m.instance)
            .map(([name]) => name);
    }
}

// ============================================================================
// PERFORMANCE OPTIMIZER SERVICE
// ============================================================================

export class PerformanceOptimizerService extends EventEmitter {
    public profiler: PerformanceProfiler;
    public queryOptimizer: QueryOptimizer;
    public memoryOptimizer: MemoryOptimizer;
    public responseOptimizer: ResponseTimeOptimizer;
    public lazyLoader: LazyLoader;

    private metricsHistory: PerformanceMetric[] = [];
    private readonly maxMetrics = 10000;

    constructor() {
        super();
        this.profiler = new PerformanceProfiler();
        this.queryOptimizer = new QueryOptimizer();
        this.memoryOptimizer = new MemoryOptimizer();
        this.responseOptimizer = new ResponseTimeOptimizer();
        this.lazyLoader = new LazyLoader();

        this.setupEventListeners();
        console.log("[PerformanceOptimizer] Service initialized");
    }

    private setupEventListeners(): void {
        this.memoryOptimizer.on("critical", (data) => {
            this.emit("memory_critical", data);
            console.warn("[PerformanceOptimizer] Memory critical:", data.percentUsed * 100, "%");
        });

        this.memoryOptimizer.on("warning", (data) => {
            this.emit("memory_warning", data);
        });
    }

    start(): void {
        this.memoryOptimizer.start();
        console.log("[PerformanceOptimizer] Started");
    }

    stop(): void {
        this.memoryOptimizer.stop();
        console.log("[PerformanceOptimizer] Stopped");
    }

    recordMetric(name: string, value: number, unit: string, tags?: Record<string, string>): void {
        this.metricsHistory.push({
            name,
            value,
            unit,
            timestamp: new Date(),
            tags
        });

        if (this.metricsHistory.length > this.maxMetrics) {
            this.metricsHistory.shift();
        }
    }

    getMetrics(name?: string, since?: Date): PerformanceMetric[] {
        let metrics = [...this.metricsHistory];

        if (name) {
            metrics = metrics.filter(m => m.name === name);
        }

        if (since) {
            metrics = metrics.filter(m => m.timestamp >= since);
        }

        return metrics;
    }

    getComprehensiveReport(): {
        profiler: Record<string, any>;
        memory: ReturnType<MemoryOptimizer["getStats"]>;
        slowQueries: ReturnType<QueryOptimizer["getSlowQueries"]>;
        slowEndpoints: ReturnType<ResponseTimeOptimizer["getSlowEndpoints"]>;
        recommendations: string[];
    } {
        const recommendations: string[] = [];

        // Check memory
        const memStats = this.memoryOptimizer.getStats();
        if (memStats.percentUsed > 0.8) {
            recommendations.push("Memoria alta, considerar aumentar RAM o optimizar uso");
        }
        if (memStats.oomPrediction.willOOM) {
            recommendations.push(`Posible OOM en ${memStats.oomPrediction.estimatedTime?.toISOString()}`);
        }

        // Check slow queries
        const slowQueries = this.queryOptimizer.getSlowQueries();
        if (slowQueries.length > 0) {
            recommendations.push(`${slowQueries.length} queries lentas detectadas`);
        }

        // Check slow endpoints
        const slowEndpoints = this.responseOptimizer.getSlowEndpoints();
        if (slowEndpoints.length > 0) {
            recommendations.push(`${slowEndpoints.length} endpoints lentos detectados`);
        }

        // Check slow functions
        const slowFunctions = this.profiler.getSlowFunctions();
        if (slowFunctions.length > 0) {
            recommendations.push(`${slowFunctions.length} funciones lentas: ${slowFunctions.slice(0, 3).join(", ")}`);
        }

        return {
            profiler: this.profiler.getAllStats(),
            memory: memStats,
            slowQueries,
            slowEndpoints,
            recommendations
        };
    }
}

// Singleton instance
export const performanceOptimizer = new PerformanceOptimizerService();

export default performanceOptimizer;
