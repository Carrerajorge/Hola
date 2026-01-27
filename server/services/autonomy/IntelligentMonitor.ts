/**
 * Intelligent Monitoring Service
 *
 * Predictive monitoring, anomaly detection, and alerting.
 * Implements improvements 31-45: Intelligent Monitoring
 */

import { EventEmitter } from "events";
import { db } from "../../db";
import { sql } from "drizzle-orm";

// ============================================================================
// TYPES
// ============================================================================

interface MetricPoint {
    value: number;
    timestamp: Date;
}

interface Alert {
    id: string;
    severity: "info" | "warning" | "error" | "critical";
    component: string;
    message: string;
    metric?: string;
    value?: number;
    threshold?: number;
    timestamp: Date;
    acknowledged: boolean;
    resolvedAt?: Date;
}

interface AnomalyResult {
    isAnomaly: boolean;
    score: number;
    expected: number;
    actual: number;
    deviation: number;
}

interface DependencyHealth {
    name: string;
    status: "healthy" | "degraded" | "down";
    responseTime: number;
    lastCheck: Date;
    errorRate: number;
}

interface PerformanceBaseline {
    metric: string;
    mean: number;
    stdDev: number;
    min: number;
    max: number;
    p95: number;
    p99: number;
    sampleSize: number;
    lastUpdated: Date;
}

// ============================================================================
// INTELLIGENT MONITOR SERVICE
// ============================================================================

export class IntelligentMonitorService extends EventEmitter {
    private metricsStore: Map<string, MetricPoint[]> = new Map();
    private alerts: Map<string, Alert> = new Map();
    private baselines: Map<string, PerformanceBaseline> = new Map();
    private dependencies: Map<string, DependencyHealth> = new Map();
    private checkInterval: NodeJS.Timeout | null = null;
    private alertHandlers: Map<string, (alert: Alert) => Promise<void>> = new Map();
    private readonly HISTORY_HOURS = 24;
    private readonly MAX_POINTS = 8640; // 24 hours at 10 second intervals
    private readonly ANOMALY_THRESHOLD = 3; // Standard deviations

    constructor() {
        super();
        this.initializeDependencies();
        console.log("[IntelligentMonitor] Service initialized");
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    private initializeDependencies(): void {
        // Database
        this.dependencies.set("database", {
            name: "database",
            status: "healthy",
            responseTime: 0,
            lastCheck: new Date(),
            errorRate: 0
        });

        // AI Providers
        const aiProviders = ["openai", "anthropic", "gemini", "xai"];
        for (const provider of aiProviders) {
            this.dependencies.set(`ai_${provider}`, {
                name: `ai_${provider}`,
                status: "healthy",
                responseTime: 0,
                lastCheck: new Date(),
                errorRate: 0
            });
        }

        // External services
        this.dependencies.set("smtp", {
            name: "smtp",
            status: "healthy",
            responseTime: 0,
            lastCheck: new Date(),
            errorRate: 0
        });
    }

    // ========================================================================
    // METRIC COLLECTION
    // ========================================================================

    recordMetric(name: string, value: number): void {
        if (!this.metricsStore.has(name)) {
            this.metricsStore.set(name, []);
        }

        const points = this.metricsStore.get(name)!;
        points.push({ value, timestamp: new Date() });

        // Keep history bounded
        if (points.length > this.MAX_POINTS) {
            points.shift();
        }

        // Check for anomalies
        this.detectAnomaly(name, value);

        // Update baseline periodically
        if (points.length % 100 === 0) {
            this.updateBaseline(name, points);
        }
    }

    getMetric(name: string, duration: number = 3600000): MetricPoint[] {
        const points = this.metricsStore.get(name) || [];
        const cutoff = Date.now() - duration;

        return points.filter(p => p.timestamp.getTime() > cutoff);
    }

    // ========================================================================
    // ANOMALY DETECTION (Improvement #32)
    // ========================================================================

    private detectAnomaly(metricName: string, value: number): AnomalyResult {
        const baseline = this.baselines.get(metricName);

        if (!baseline || baseline.sampleSize < 100) {
            return { isAnomaly: false, score: 0, expected: value, actual: value, deviation: 0 };
        }

        const deviation = Math.abs(value - baseline.mean) / (baseline.stdDev || 1);
        const isAnomaly = deviation > this.ANOMALY_THRESHOLD;

        if (isAnomaly) {
            console.log(`[IntelligentMonitor] Anomaly detected in ${metricName}: ${value} (expected: ${baseline.mean.toFixed(2)})`);

            this.createAlert({
                severity: deviation > 5 ? "error" : "warning",
                component: "metrics",
                message: `Anomalía detectada en ${metricName}: valor ${value.toFixed(2)} (esperado: ${baseline.mean.toFixed(2)})`,
                metric: metricName,
                value,
                threshold: baseline.mean + (this.ANOMALY_THRESHOLD * baseline.stdDev)
            });
        }

        return {
            isAnomaly,
            score: deviation,
            expected: baseline.mean,
            actual: value,
            deviation
        };
    }

    private updateBaseline(name: string, points: MetricPoint[]): void {
        const values = points.map(p => p.value);
        const sorted = [...values].sort((a, b) => a - b);

        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);

        const baseline: PerformanceBaseline = {
            metric: name,
            mean,
            stdDev,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)],
            sampleSize: values.length,
            lastUpdated: new Date()
        };

        this.baselines.set(name, baseline);
    }

    // ========================================================================
    // PREDICTIVE ALERTS (Improvement #31)
    // ========================================================================

    predictFailure(metricName: string): {
        willFail: boolean;
        estimatedTime: Date | null;
        confidence: number;
        trend: "increasing" | "decreasing" | "stable";
    } {
        const points = this.getMetric(metricName, 3600000); // Last hour

        if (points.length < 10) {
            return { willFail: false, estimatedTime: null, confidence: 0, trend: "stable" };
        }

        // Calculate trend using linear regression
        const n = points.length;
        const xValues = points.map((_, i) => i);
        const yValues = points.map(p => p.value);

        const xMean = xValues.reduce((a, b) => a + b, 0) / n;
        const yMean = yValues.reduce((a, b) => a + b, 0) / n;

        let numerator = 0;
        let denominator = 0;

        for (let i = 0; i < n; i++) {
            numerator += (xValues[i] - xMean) * (yValues[i] - yMean);
            denominator += Math.pow(xValues[i] - xMean, 2);
        }

        const slope = denominator !== 0 ? numerator / denominator : 0;
        const intercept = yMean - slope * xMean;

        // Determine trend
        let trend: "increasing" | "decreasing" | "stable" = "stable";
        if (slope > 0.1) trend = "increasing";
        else if (slope < -0.1) trend = "decreasing";

        // Get threshold from baseline
        const baseline = this.baselines.get(metricName);
        const threshold = baseline ? baseline.p99 : 100;

        // Predict when it will hit threshold
        let willFail = false;
        let estimatedTime: Date | null = null;
        let confidence = 0;

        if (slope > 0) {
            const currentValue = yValues[yValues.length - 1];
            const pointsToThreshold = (threshold - currentValue) / slope;

            if (pointsToThreshold > 0 && pointsToThreshold < 360) { // Within next hour
                willFail = true;
                const secondsToFailure = pointsToThreshold * 10; // Assuming 10 second intervals
                estimatedTime = new Date(Date.now() + secondsToFailure * 1000);
                confidence = Math.min(0.9, 1 - (pointsToThreshold / 360));
            }
        }

        if (willFail && confidence > 0.5) {
            this.createAlert({
                severity: "warning",
                component: "prediction",
                message: `Predicción: ${metricName} alcanzará nivel crítico en ${Math.round((estimatedTime!.getTime() - Date.now()) / 60000)} minutos`,
                metric: metricName,
                value: yValues[yValues.length - 1],
                threshold
            });
        }

        return { willFail, estimatedTime, confidence, trend };
    }

    // ========================================================================
    // DEPENDENCY MONITORING (Improvement #43)
    // ========================================================================

    async checkDependency(name: string, healthCheck: () => Promise<boolean>): Promise<DependencyHealth> {
        const dep = this.dependencies.get(name) || {
            name,
            status: "healthy" as const,
            responseTime: 0,
            lastCheck: new Date(),
            errorRate: 0
        };

        const start = Date.now();

        try {
            const isHealthy = await healthCheck();
            const responseTime = Date.now() - start;

            dep.responseTime = responseTime;
            dep.lastCheck = new Date();

            if (isHealthy) {
                dep.status = responseTime > 5000 ? "degraded" : "healthy";
                dep.errorRate = Math.max(0, dep.errorRate - 0.1);
            } else {
                dep.status = "down";
                dep.errorRate = Math.min(1, dep.errorRate + 0.2);
            }
        } catch (error) {
            dep.status = "down";
            dep.errorRate = Math.min(1, dep.errorRate + 0.2);
            dep.responseTime = Date.now() - start;
        }

        this.dependencies.set(name, dep);

        if (dep.status === "down") {
            this.createAlert({
                severity: "critical",
                component: name,
                message: `Dependencia ${name} no disponible`,
            });
        } else if (dep.status === "degraded") {
            this.createAlert({
                severity: "warning",
                component: name,
                message: `Dependencia ${name} degradada (${dep.responseTime}ms)`,
            });
        }

        return dep;
    }

    async checkAllDependencies(): Promise<Map<string, DependencyHealth>> {
        // Database check
        await this.checkDependency("database", async () => {
            await db.execute(sql`SELECT 1`);
            return true;
        });

        return new Map(this.dependencies);
    }

    // ========================================================================
    // ALERTING (Improvements #38, #39)
    // ========================================================================

    createAlert(params: Omit<Alert, "id" | "timestamp" | "acknowledged">): Alert {
        const alert: Alert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date(),
            acknowledged: false,
            ...params
        };

        this.alerts.set(alert.id, alert);

        console.log(`[IntelligentMonitor] Alert created: [${alert.severity}] ${alert.message}`);

        this.emit("alert", alert);

        // Trigger handlers based on severity
        this.dispatchAlert(alert);

        return alert;
    }

    private async dispatchAlert(alert: Alert): Promise<void> {
        const handler = this.alertHandlers.get(alert.severity);
        if (handler) {
            try {
                await handler(alert);
            } catch (error) {
                console.error("[IntelligentMonitor] Alert handler failed:", error);
            }
        }
    }

    registerAlertHandler(severity: Alert["severity"], handler: (alert: Alert) => Promise<void>): void {
        this.alertHandlers.set(severity, handler);
    }

    acknowledgeAlert(alertId: string): boolean {
        const alert = this.alerts.get(alertId);
        if (alert) {
            alert.acknowledged = true;
            return true;
        }
        return false;
    }

    resolveAlert(alertId: string): boolean {
        const alert = this.alerts.get(alertId);
        if (alert) {
            alert.resolvedAt = new Date();
            return true;
        }
        return false;
    }

    getActiveAlerts(): Alert[] {
        return Array.from(this.alerts.values())
            .filter(a => !a.resolvedAt)
            .sort((a, b) => {
                const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 };
                return severityOrder[a.severity] - severityOrder[b.severity];
            });
    }

    // ========================================================================
    // ERROR TRACKING (Improvement #37)
    // ========================================================================

    private errorGroups: Map<string, {
        fingerprint: string;
        message: string;
        count: number;
        firstSeen: Date;
        lastSeen: Date;
        samples: Array<{ stack?: string; context?: any }>;
    }> = new Map();

    recordError(error: Error, context?: any): void {
        const fingerprint = this.getErrorFingerprint(error);

        let group = this.errorGroups.get(fingerprint);

        if (!group) {
            group = {
                fingerprint,
                message: error.message,
                count: 0,
                firstSeen: new Date(),
                lastSeen: new Date(),
                samples: []
            };
            this.errorGroups.set(fingerprint, group);
        }

        group.count++;
        group.lastSeen = new Date();

        if (group.samples.length < 5) {
            group.samples.push({ stack: error.stack, context });
        }

        // Record metric
        this.recordMetric("error_rate", 1);

        // Alert on new error types
        if (group.count === 1) {
            this.createAlert({
                severity: "error",
                component: "errors",
                message: `Nuevo tipo de error: ${error.message.slice(0, 100)}`
            });
        }

        // Alert on error spikes
        if (group.count === 10 || group.count === 100 || group.count === 1000) {
            this.createAlert({
                severity: "warning",
                component: "errors",
                message: `Error recurrente (${group.count} veces): ${error.message.slice(0, 100)}`
            });
        }
    }

    private getErrorFingerprint(error: Error): string {
        // Create a fingerprint based on error type and first line of stack
        const stackLines = error.stack?.split("\n") || [];
        const firstFrame = stackLines[1] || "";

        return `${error.name}:${error.message.slice(0, 50)}:${firstFrame.slice(0, 50)}`;
    }

    getErrorGroups(): Array<{
        fingerprint: string;
        message: string;
        count: number;
        firstSeen: Date;
        lastSeen: Date;
    }> {
        return Array.from(this.errorGroups.values())
            .map(({ fingerprint, message, count, firstSeen, lastSeen }) => ({
                fingerprint, message, count, firstSeen, lastSeen
            }))
            .sort((a, b) => b.count - a.count);
    }

    // ========================================================================
    // COST MONITORING (Improvement #44)
    // ========================================================================

    private costs: Map<string, { amount: number; timestamp: Date }[]> = new Map();
    private costAlerts: Map<string, { daily: number; monthly: number }> = new Map();

    recordCost(provider: string, amount: number): void {
        if (!this.costs.has(provider)) {
            this.costs.set(provider, []);
        }

        const records = this.costs.get(provider)!;
        records.push({ amount, timestamp: new Date() });

        // Keep 30 days of history
        const thirtyDaysAgo = Date.now() - 30 * 24 * 3600000;
        this.costs.set(provider, records.filter(r => r.timestamp.getTime() > thirtyDaysAgo));

        // Check cost alerts
        this.checkCostAlerts(provider);
    }

    setCostAlert(provider: string, daily: number, monthly: number): void {
        this.costAlerts.set(provider, { daily, monthly });
    }

    private checkCostAlerts(provider: string): void {
        const limits = this.costAlerts.get(provider);
        if (!limits) return;

        const costs = this.costs.get(provider) || [];

        // Daily cost
        const oneDayAgo = Date.now() - 24 * 3600000;
        const dailyCost = costs
            .filter(r => r.timestamp.getTime() > oneDayAgo)
            .reduce((sum, r) => sum + r.amount, 0);

        if (dailyCost > limits.daily) {
            this.createAlert({
                severity: "warning",
                component: "costs",
                message: `Costo diario de ${provider} excedido: $${dailyCost.toFixed(2)} > $${limits.daily}`,
                value: dailyCost,
                threshold: limits.daily
            });
        }

        // Monthly cost
        const thirtyDaysAgo = Date.now() - 30 * 24 * 3600000;
        const monthlyCost = costs
            .filter(r => r.timestamp.getTime() > thirtyDaysAgo)
            .reduce((sum, r) => sum + r.amount, 0);

        if (monthlyCost > limits.monthly) {
            this.createAlert({
                severity: "error",
                component: "costs",
                message: `Costo mensual de ${provider} excedido: $${monthlyCost.toFixed(2)} > $${limits.monthly}`,
                value: monthlyCost,
                threshold: limits.monthly
            });
        }
    }

    getCostSummary(): {
        byProvider: Record<string, { daily: number; monthly: number }>;
        total: { daily: number; monthly: number };
    } {
        const byProvider: Record<string, { daily: number; monthly: number }> = {};
        let totalDaily = 0;
        let totalMonthly = 0;

        const oneDayAgo = Date.now() - 24 * 3600000;
        const thirtyDaysAgo = Date.now() - 30 * 24 * 3600000;

        for (const [provider, costs] of this.costs) {
            const daily = costs
                .filter(r => r.timestamp.getTime() > oneDayAgo)
                .reduce((sum, r) => sum + r.amount, 0);

            const monthly = costs
                .filter(r => r.timestamp.getTime() > thirtyDaysAgo)
                .reduce((sum, r) => sum + r.amount, 0);

            byProvider[provider] = { daily, monthly };
            totalDaily += daily;
            totalMonthly += monthly;
        }

        return {
            byProvider,
            total: { daily: totalDaily, monthly: totalMonthly }
        };
    }

    // ========================================================================
    // SLA TRACKING (Improvement #45)
    // ========================================================================

    private uptimeRecords: Array<{ timestamp: Date; status: "up" | "down" }> = [];
    private slaTarget = 99.9; // 99.9% uptime target

    recordUptime(isUp: boolean): void {
        this.uptimeRecords.push({
            timestamp: new Date(),
            status: isUp ? "up" : "down"
        });

        // Keep 30 days
        const thirtyDaysAgo = Date.now() - 30 * 24 * 3600000;
        this.uptimeRecords = this.uptimeRecords.filter(
            r => r.timestamp.getTime() > thirtyDaysAgo
        );
    }

    getUptime(hours: number = 24): number {
        const cutoff = Date.now() - hours * 3600000;
        const records = this.uptimeRecords.filter(r => r.timestamp.getTime() > cutoff);

        if (records.length === 0) return 100;

        const upCount = records.filter(r => r.status === "up").length;
        return (upCount / records.length) * 100;
    }

    getSLAStatus(): {
        currentUptime: number;
        target: number;
        isMeetingSLA: boolean;
        downtimeMinutes: number;
        allowedDowntimeMinutes: number;
    } {
        const uptime = this.getUptime(720); // 30 days
        const totalMinutes = 30 * 24 * 60;
        const allowedDowntime = totalMinutes * (1 - this.slaTarget / 100);
        const actualDowntime = totalMinutes * (1 - uptime / 100);

        return {
            currentUptime: uptime,
            target: this.slaTarget,
            isMeetingSLA: uptime >= this.slaTarget,
            downtimeMinutes: actualDowntime,
            allowedDowntimeMinutes: allowedDowntime
        };
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    start(): void {
        console.log("[IntelligentMonitor] Starting monitoring...");

        this.checkInterval = setInterval(async () => {
            await this.checkAllDependencies();

            // Predict failures for key metrics
            for (const metricName of this.metricsStore.keys()) {
                this.predictFailure(metricName);
            }
        }, 60000); // Every minute
    }

    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    getBaselines(): Map<string, PerformanceBaseline> {
        return new Map(this.baselines);
    }

    getDependencies(): Map<string, DependencyHealth> {
        return new Map(this.dependencies);
    }

    getDashboardData(): {
        metrics: Record<string, MetricPoint[]>;
        alerts: Alert[];
        dependencies: DependencyHealth[];
        baselines: PerformanceBaseline[];
        costs: ReturnType<typeof this.getCostSummary>;
        sla: ReturnType<typeof this.getSLAStatus>;
    } {
        return {
            metrics: Object.fromEntries(this.metricsStore),
            alerts: this.getActiveAlerts(),
            dependencies: Array.from(this.dependencies.values()),
            baselines: Array.from(this.baselines.values()),
            costs: this.getCostSummary(),
            sla: this.getSLAStatus()
        };
    }
}

// Singleton instance
export const intelligentMonitor = new IntelligentMonitorService();

export default intelligentMonitor;
