/**
 * Advanced Analytics Service
 *
 * Comprehensive analytics, reporting, and insights.
 * Implements improvements 161-175: Advanced Analytics
 */

import { EventEmitter } from "events";
import crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

interface AnalyticsEvent {
    id: string;
    name: string;
    category: string;
    properties: Record<string, any>;
    userId?: string;
    sessionId?: string;
    timestamp: Date;
    processed: boolean;
}

interface UserJourney {
    userId: string;
    sessionId: string;
    events: AnalyticsEvent[];
    startTime: Date;
    endTime?: Date;
    conversionGoals: string[];
    completedGoals: string[];
}

interface Cohort {
    name: string;
    criteria: (user: any) => boolean;
    users: Set<string>;
    metrics: Record<string, number>;
    createdAt: Date;
}

interface FunnelStep {
    name: string;
    event: string;
    count: number;
    conversionRate: number;
    dropOffRate: number;
    avgTimeToNext?: number;
}

interface Report {
    id: string;
    name: string;
    type: "daily" | "weekly" | "monthly" | "custom";
    metrics: string[];
    filters?: Record<string, any>;
    generatedAt: Date;
    data: any;
}

// ============================================================================
// EVENT TRACKER (Improvements 161-163)
// ============================================================================

class EventTracker {
    private events: AnalyticsEvent[] = [];
    private readonly maxEvents = 100000;
    private flushCallbacks: Array<(events: AnalyticsEvent[]) => Promise<void>> = [];

    track(name: string, category: string, properties: Record<string, any> = {}, userId?: string, sessionId?: string): AnalyticsEvent {
        const event: AnalyticsEvent = {
            id: crypto.randomUUID(),
            name,
            category,
            properties,
            userId,
            sessionId,
            timestamp: new Date(),
            processed: false
        };

        this.events.push(event);

        if (this.events.length > this.maxEvents) {
            this.events.shift();
        }

        return event;
    }

    trackPageView(path: string, userId?: string, sessionId?: string, referrer?: string): void {
        this.track("page_view", "navigation", { path, referrer }, userId, sessionId);
    }

    trackClick(element: string, userId?: string, sessionId?: string): void {
        this.track("click", "interaction", { element }, userId, sessionId);
    }

    trackError(error: string, stack?: string, userId?: string): void {
        this.track("error", "system", { error, stack }, userId);
    }

    trackConversion(goal: string, value?: number, userId?: string): void {
        this.track("conversion", "business", { goal, value }, userId);
    }

    getEvents(filters?: {
        name?: string;
        category?: string;
        userId?: string;
        since?: Date;
        until?: Date;
    }): AnalyticsEvent[] {
        let filtered = [...this.events];

        if (filters?.name) filtered = filtered.filter(e => e.name === filters.name);
        if (filters?.category) filtered = filtered.filter(e => e.category === filters.category);
        if (filters?.userId) filtered = filtered.filter(e => e.userId === filters.userId);
        if (filters?.since) filtered = filtered.filter(e => e.timestamp >= filters.since!);
        if (filters?.until) filtered = filtered.filter(e => e.timestamp <= filters.until!);

        return filtered;
    }

    getEventCounts(groupBy: "name" | "category" | "userId", since?: Date): Record<string, number> {
        const counts: Record<string, number> = {};
        const events = since ? this.events.filter(e => e.timestamp >= since) : this.events;

        for (const event of events) {
            const key = event[groupBy] || "unknown";
            counts[key] = (counts[key] || 0) + 1;
        }

        return counts;
    }

    onFlush(callback: (events: AnalyticsEvent[]) => Promise<void>): void {
        this.flushCallbacks.push(callback);
    }

    async flush(): Promise<void> {
        const unprocessed = this.events.filter(e => !e.processed);
        if (unprocessed.length === 0) return;

        for (const callback of this.flushCallbacks) {
            await callback(unprocessed);
        }

        for (const event of unprocessed) {
            event.processed = true;
        }
    }
}

// ============================================================================
// USER JOURNEY TRACKER (Improvements 164-166)
// ============================================================================

class UserJourneyTracker {
    private journeys: Map<string, UserJourney> = new Map();
    private conversionGoals: Set<string> = new Set();

    defineConversionGoal(goalName: string): void {
        this.conversionGoals.add(goalName);
    }

    startJourney(userId: string, sessionId: string): UserJourney {
        const journey: UserJourney = {
            userId,
            sessionId,
            events: [],
            startTime: new Date(),
            conversionGoals: Array.from(this.conversionGoals),
            completedGoals: []
        };

        this.journeys.set(sessionId, journey);
        return journey;
    }

    addEvent(sessionId: string, event: AnalyticsEvent): void {
        const journey = this.journeys.get(sessionId);
        if (!journey) return;

        journey.events.push(event);

        // Check for goal completion
        if (event.name === "conversion" && event.properties.goal) {
            const goal = event.properties.goal;
            if (journey.conversionGoals.includes(goal) && !journey.completedGoals.includes(goal)) {
                journey.completedGoals.push(goal);
            }
        }
    }

    endJourney(sessionId: string): UserJourney | null {
        const journey = this.journeys.get(sessionId);
        if (!journey) return null;

        journey.endTime = new Date();
        return journey;
    }

    getJourney(sessionId: string): UserJourney | null {
        return this.journeys.get(sessionId) || null;
    }

    getJourneysByUser(userId: string): UserJourney[] {
        return Array.from(this.journeys.values())
            .filter(j => j.userId === userId);
    }

    getConversionRate(goal: string): number {
        const journeys = Array.from(this.journeys.values()).filter(j => j.endTime);
        if (journeys.length === 0) return 0;

        const converted = journeys.filter(j => j.completedGoals.includes(goal)).length;
        return converted / journeys.length;
    }

    getAverageJourneyDuration(): number {
        const completed = Array.from(this.journeys.values())
            .filter(j => j.endTime)
            .map(j => j.endTime!.getTime() - j.startTime.getTime());

        if (completed.length === 0) return 0;
        return completed.reduce((a, b) => a + b, 0) / completed.length;
    }

    getCommonPaths(limit: number = 10): Array<{ path: string[]; count: number }> {
        const pathCounts: Map<string, number> = new Map();

        for (const journey of this.journeys.values()) {
            const path = journey.events
                .filter(e => e.category === "navigation")
                .map(e => e.properties.path || e.name)
                .slice(0, 5); // First 5 steps

            const pathKey = path.join(" -> ");
            pathCounts.set(pathKey, (pathCounts.get(pathKey) || 0) + 1);
        }

        return Array.from(pathCounts.entries())
            .map(([path, count]) => ({ path: path.split(" -> "), count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }
}

// ============================================================================
// COHORT ANALYZER (Improvements 167-169)
// ============================================================================

class CohortAnalyzer {
    private cohorts: Map<string, Cohort> = new Map();
    private userAttributes: Map<string, any> = new Map();

    setUserAttributes(userId: string, attributes: any): void {
        this.userAttributes.set(userId, attributes);
        this.updateCohortMembership(userId, attributes);
    }

    defineCohort(name: string, criteria: (user: any) => boolean): Cohort {
        const cohort: Cohort = {
            name,
            criteria,
            users: new Set(),
            metrics: {},
            createdAt: new Date()
        };

        this.cohorts.set(name, cohort);

        // Evaluate existing users
        for (const [userId, attributes] of this.userAttributes) {
            if (criteria(attributes)) {
                cohort.users.add(userId);
            }
        }

        return cohort;
    }

    private updateCohortMembership(userId: string, attributes: any): void {
        for (const cohort of this.cohorts.values()) {
            if (cohort.criteria(attributes)) {
                cohort.users.add(userId);
            } else {
                cohort.users.delete(userId);
            }
        }
    }

    getCohort(name: string): Cohort | null {
        return this.cohorts.get(name) || null;
    }

    getCohortUsers(name: string): string[] {
        const cohort = this.cohorts.get(name);
        return cohort ? Array.from(cohort.users) : [];
    }

    updateCohortMetric(name: string, metric: string, value: number): void {
        const cohort = this.cohorts.get(name);
        if (cohort) {
            cohort.metrics[metric] = value;
        }
    }

    compareCohorts(cohort1: string, cohort2: string): Record<string, { cohort1: number; cohort2: number; diff: number }> {
        const c1 = this.cohorts.get(cohort1);
        const c2 = this.cohorts.get(cohort2);

        if (!c1 || !c2) return {};

        const comparison: Record<string, any> = {};
        const allMetrics = new Set([...Object.keys(c1.metrics), ...Object.keys(c2.metrics)]);

        for (const metric of allMetrics) {
            const v1 = c1.metrics[metric] || 0;
            const v2 = c2.metrics[metric] || 0;
            comparison[metric] = {
                cohort1: v1,
                cohort2: v2,
                diff: v1 - v2
            };
        }

        return comparison;
    }

    getCohortRetention(name: string, periods: number = 7): number[] {
        // Simplified retention calculation
        const retention: number[] = [];
        const cohort = this.cohorts.get(name);
        if (!cohort) return retention;

        const baseSize = cohort.users.size;
        for (let i = 0; i < periods; i++) {
            // In a real implementation, this would check actual user activity
            const retainedRate = Math.pow(0.8, i); // 80% retention decay simulation
            retention.push(retainedRate * baseSize);
        }

        return retention;
    }
}

// ============================================================================
// FUNNEL ANALYZER (Improvements 170-172)
// ============================================================================

class FunnelAnalyzer {
    private funnels: Map<string, string[]> = new Map();
    private journeyTracker: UserJourneyTracker;

    constructor(journeyTracker: UserJourneyTracker) {
        this.journeyTracker = journeyTracker;
    }

    defineFunnel(name: string, steps: string[]): void {
        this.funnels.set(name, steps);
    }

    analyzeFunnel(name: string): FunnelStep[] {
        const steps = this.funnels.get(name);
        if (!steps) return [];

        const journeys = Array.from((this.journeyTracker as any).journeys.values()) as UserJourney[];
        const results: FunnelStep[] = [];

        let previousCount = journeys.length;

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const reachedStep = journeys.filter(j =>
                j.events.some(e => e.name === step)
            ).length;

            const conversionRate = previousCount > 0 ? reachedStep / previousCount : 0;
            const dropOffRate = 1 - conversionRate;

            results.push({
                name: step,
                event: step,
                count: reachedStep,
                conversionRate,
                dropOffRate,
                avgTimeToNext: this.calculateAvgTimeBetweenSteps(journeys, step, steps[i + 1])
            });

            previousCount = reachedStep;
        }

        return results;
    }

    private calculateAvgTimeBetweenSteps(journeys: UserJourney[], step1: string, step2?: string): number | undefined {
        if (!step2) return undefined;

        const times: number[] = [];

        for (const journey of journeys) {
            const event1 = journey.events.find(e => e.name === step1);
            const event2 = journey.events.find(e => e.name === step2);

            if (event1 && event2 && event2.timestamp > event1.timestamp) {
                times.push(event2.timestamp.getTime() - event1.timestamp.getTime());
            }
        }

        return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : undefined;
    }

    getDropOffPoints(name: string): Array<{ step: string; dropOffRate: number }> {
        const analysis = this.analyzeFunnel(name);
        return analysis
            .filter(s => s.dropOffRate > 0.3) // More than 30% drop-off
            .map(s => ({ step: s.name, dropOffRate: s.dropOffRate }))
            .sort((a, b) => b.dropOffRate - a.dropOffRate);
    }
}

// ============================================================================
// REPORT GENERATOR (Improvements 173-175)
// ============================================================================

class ReportGenerator {
    private reports: Map<string, Report> = new Map();
    private eventTracker: EventTracker;
    private journeyTracker: UserJourneyTracker;
    private cohortAnalyzer: CohortAnalyzer;

    constructor(eventTracker: EventTracker, journeyTracker: UserJourneyTracker, cohortAnalyzer: CohortAnalyzer) {
        this.eventTracker = eventTracker;
        this.journeyTracker = journeyTracker;
        this.cohortAnalyzer = cohortAnalyzer;
    }

    async generateReport(name: string, type: Report["type"], metrics: string[], filters?: Record<string, any>): Promise<Report> {
        const data: any = {};
        const now = new Date();

        // Date range based on type
        let since: Date;
        switch (type) {
            case "daily":
                since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case "weekly":
                since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case "monthly":
                since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                since = filters?.since || new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }

        // Calculate requested metrics
        for (const metric of metrics) {
            switch (metric) {
                case "total_events":
                    data.total_events = this.eventTracker.getEvents({ since }).length;
                    break;

                case "unique_users":
                    const events = this.eventTracker.getEvents({ since });
                    data.unique_users = new Set(events.map(e => e.userId).filter(Boolean)).size;
                    break;

                case "events_by_category":
                    data.events_by_category = this.eventTracker.getEventCounts("category", since);
                    break;

                case "conversion_rate":
                    data.conversion_rate = this.journeyTracker.getConversionRate(filters?.goal || "purchase");
                    break;

                case "avg_journey_duration":
                    data.avg_journey_duration = this.journeyTracker.getAverageJourneyDuration();
                    break;

                case "common_paths":
                    data.common_paths = this.journeyTracker.getCommonPaths();
                    break;

                case "error_count":
                    data.error_count = this.eventTracker.getEvents({ category: "system", name: "error", since }).length;
                    break;
            }
        }

        const report: Report = {
            id: crypto.randomUUID(),
            name,
            type,
            metrics,
            filters,
            generatedAt: now,
            data
        };

        this.reports.set(report.id, report);

        return report;
    }

    getReport(id: string): Report | null {
        return this.reports.get(id) || null;
    }

    getReports(): Report[] {
        return Array.from(this.reports.values());
    }

    async generateDashboard(): Promise<{
        summary: {
            totalEvents: number;
            uniqueUsers: number;
            avgJourneyDuration: number;
            conversionRate: number;
        };
        trends: {
            eventsByHour: Record<number, number>;
            topEvents: Array<{ name: string; count: number }>;
        };
        alerts: string[];
    }> {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const events = this.eventTracker.getEvents({ since });

        // Calculate hourly distribution
        const eventsByHour: Record<number, number> = {};
        for (const event of events) {
            const hour = event.timestamp.getHours();
            eventsByHour[hour] = (eventsByHour[hour] || 0) + 1;
        }

        // Top events
        const eventCounts = this.eventTracker.getEventCounts("name", since);
        const topEvents = Object.entries(eventCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // Generate alerts
        const alerts: string[] = [];
        const errorCount = this.eventTracker.getEvents({ category: "system", name: "error", since }).length;
        if (errorCount > 100) {
            alerts.push(`Alto número de errores: ${errorCount} en las últimas 24 horas`);
        }

        return {
            summary: {
                totalEvents: events.length,
                uniqueUsers: new Set(events.map(e => e.userId).filter(Boolean)).size,
                avgJourneyDuration: this.journeyTracker.getAverageJourneyDuration(),
                conversionRate: this.journeyTracker.getConversionRate("purchase")
            },
            trends: {
                eventsByHour,
                topEvents
            },
            alerts
        };
    }
}

// ============================================================================
// ADVANCED ANALYTICS SERVICE
// ============================================================================

export class AdvancedAnalyticsService extends EventEmitter {
    public eventTracker: EventTracker;
    public journeyTracker: UserJourneyTracker;
    public cohortAnalyzer: CohortAnalyzer;
    public funnelAnalyzer: FunnelAnalyzer;
    public reportGenerator: ReportGenerator;

    private flushInterval: NodeJS.Timeout | null = null;

    constructor() {
        super();
        this.eventTracker = new EventTracker();
        this.journeyTracker = new UserJourneyTracker();
        this.cohortAnalyzer = new CohortAnalyzer();
        this.funnelAnalyzer = new FunnelAnalyzer(this.journeyTracker);
        this.reportGenerator = new ReportGenerator(
            this.eventTracker,
            this.journeyTracker,
            this.cohortAnalyzer
        );

        this.setupDefaults();
        console.log("[AdvancedAnalytics] Service initialized");
    }

    private setupDefaults(): void {
        // Default conversion goals
        this.journeyTracker.defineConversionGoal("signup");
        this.journeyTracker.defineConversionGoal("purchase");
        this.journeyTracker.defineConversionGoal("subscription");

        // Default funnels
        this.funnelAnalyzer.defineFunnel("signup_flow", [
            "page_view_landing",
            "click_signup",
            "form_started",
            "form_completed",
            "email_verified"
        ]);

        this.funnelAnalyzer.defineFunnel("purchase_flow", [
            "page_view_product",
            "add_to_cart",
            "view_cart",
            "checkout_started",
            "payment_completed"
        ]);

        // Default cohorts
        this.cohortAnalyzer.defineCohort("new_users", (user) =>
            user.createdAt && (Date.now() - new Date(user.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000
        );

        this.cohortAnalyzer.defineCohort("power_users", (user) =>
            user.sessionsLast30Days && user.sessionsLast30Days > 20
        );
    }

    start(): void {
        // Flush events every 5 minutes
        this.flushInterval = setInterval(() => {
            this.eventTracker.flush().catch(console.error);
        }, 300000);

        console.log("[AdvancedAnalytics] Started");
    }

    stop(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }

        // Final flush
        this.eventTracker.flush().catch(console.error);

        console.log("[AdvancedAnalytics] Stopped");
    }

    // High-level convenience methods

    trackUserAction(userId: string, action: string, properties: Record<string, any> = {}): void {
        this.eventTracker.track(action, "user_action", properties, userId);
    }

    trackSystemEvent(event: string, properties: Record<string, any> = {}): void {
        this.eventTracker.track(event, "system", properties);
    }

    async getDashboard(): Promise<ReturnType<ReportGenerator["generateDashboard"]>> {
        return this.reportGenerator.generateDashboard();
    }

    getStats(): {
        events: { total: number; categories: Record<string, number> };
        journeys: { active: number; completed: number; avgDuration: number };
        cohorts: { count: number; totalUsers: number };
    } {
        const eventCounts = this.eventTracker.getEventCounts("category");
        const cohorts = Array.from((this.cohortAnalyzer as any).cohorts.values());

        return {
            events: {
                total: Object.values(eventCounts).reduce((a, b) => a + b, 0),
                categories: eventCounts
            },
            journeys: {
                active: Array.from((this.journeyTracker as any).journeys.values())
                    .filter((j: any) => !j.endTime).length,
                completed: Array.from((this.journeyTracker as any).journeys.values())
                    .filter((j: any) => j.endTime).length,
                avgDuration: this.journeyTracker.getAverageJourneyDuration()
            },
            cohorts: {
                count: cohorts.length,
                totalUsers: cohorts.reduce((sum, c: any) => sum + c.users.size, 0)
            }
        };
    }
}

// Singleton instance
export const advancedAnalytics = new AdvancedAnalyticsService();

export default advancedAnalytics;
