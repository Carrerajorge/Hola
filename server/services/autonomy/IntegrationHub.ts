/**
 * Integration Hub Service
 *
 * Webhooks, event sourcing, and API management.
 * Implements improvements 96-100: Integration and Sync
 */

import { EventEmitter } from "events";
import crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

interface WebhookConfig {
    id: string;
    url: string;
    events: string[];
    secret: string;
    enabled: boolean;
    retryCount: number;
    maxRetries: number;
    timeout: number;
    headers?: Record<string, string>;
    createdAt: Date;
    lastTriggered?: Date;
    successCount: number;
    failureCount: number;
}

interface WebhookDelivery {
    id: string;
    webhookId: string;
    event: string;
    payload: any;
    timestamp: Date;
    status: "pending" | "success" | "failed" | "retrying";
    attempts: number;
    lastAttempt?: Date;
    response?: { status: number; body: string };
    error?: string;
}

interface EventRecord {
    id: string;
    aggregateId: string;
    aggregateType: string;
    eventType: string;
    payload: any;
    metadata: {
        userId?: string;
        ip?: string;
        userAgent?: string;
        correlationId?: string;
    };
    timestamp: Date;
    version: number;
}

interface APIVersion {
    version: string;
    deprecated: boolean;
    deprecatedAt?: Date;
    sunsetDate?: Date;
    changes: string[];
}

interface SyncConfig {
    id: string;
    name: string;
    sourceType: string;
    targetType: string;
    enabled: boolean;
    syncInterval: number;
    lastSync?: Date;
    nextSync: Date;
    conflictResolution: "source_wins" | "target_wins" | "latest_wins" | "manual";
}

// ============================================================================
// WEBHOOK MANAGER (Improvement #96)
// ============================================================================

class WebhookManager extends EventEmitter {
    private webhooks: Map<string, WebhookConfig> = new Map();
    private deliveryQueue: WebhookDelivery[] = [];
    private processingInterval: NodeJS.Timeout | null = null;

    constructor() {
        super();
    }

    registerWebhook(config: Omit<WebhookConfig, "id" | "createdAt" | "successCount" | "failureCount" | "retryCount">): WebhookConfig {
        const webhook: WebhookConfig = {
            ...config,
            id: `webhook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            createdAt: new Date(),
            successCount: 0,
            failureCount: 0,
            retryCount: 0
        };

        this.webhooks.set(webhook.id, webhook);
        console.log(`[WebhookManager] Registered webhook: ${webhook.id} for events: ${webhook.events.join(", ")}`);

        return webhook;
    }

    unregisterWebhook(id: string): boolean {
        return this.webhooks.delete(id);
    }

    async trigger(event: string, payload: any): Promise<void> {
        const matchingWebhooks = Array.from(this.webhooks.values())
            .filter(w => w.enabled && (w.events.includes(event) || w.events.includes("*")));

        for (const webhook of matchingWebhooks) {
            const delivery: WebhookDelivery = {
                id: `delivery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                webhookId: webhook.id,
                event,
                payload,
                timestamp: new Date(),
                status: "pending",
                attempts: 0
            };

            this.deliveryQueue.push(delivery);
        }

        // Process queue immediately
        await this.processQueue();
    }

    private async processQueue(): Promise<void> {
        const pending = this.deliveryQueue.filter(d => d.status === "pending" || d.status === "retrying");

        for (const delivery of pending) {
            await this.deliver(delivery);
        }
    }

    private async deliver(delivery: WebhookDelivery): Promise<void> {
        const webhook = this.webhooks.get(delivery.webhookId);
        if (!webhook) {
            delivery.status = "failed";
            delivery.error = "Webhook not found";
            return;
        }

        delivery.attempts++;
        delivery.lastAttempt = new Date();

        try {
            const signature = this.signPayload(delivery.payload, webhook.secret);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), webhook.timeout);

            const response = await fetch(webhook.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Webhook-Signature": signature,
                    "X-Webhook-Event": delivery.event,
                    "X-Webhook-Delivery": delivery.id,
                    ...(webhook.headers || {})
                },
                body: JSON.stringify(delivery.payload),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const responseBody = await response.text();

            delivery.response = {
                status: response.status,
                body: responseBody.slice(0, 1000)
            };

            if (response.ok) {
                delivery.status = "success";
                webhook.successCount++;
                webhook.lastTriggered = new Date();
                console.log(`[WebhookManager] Delivery success: ${delivery.id}`);
            } else {
                throw new Error(`HTTP ${response.status}: ${responseBody.slice(0, 100)}`);
            }
        } catch (error) {
            delivery.error = error instanceof Error ? error.message : "Unknown error";

            if (delivery.attempts < webhook.maxRetries) {
                delivery.status = "retrying";
                webhook.retryCount++;

                // Exponential backoff
                const delay = Math.pow(2, delivery.attempts) * 1000;
                setTimeout(() => this.deliver(delivery), delay);

                console.log(`[WebhookManager] Delivery retry scheduled: ${delivery.id} (attempt ${delivery.attempts})`);
            } else {
                delivery.status = "failed";
                webhook.failureCount++;
                console.error(`[WebhookManager] Delivery failed: ${delivery.id}`, delivery.error);
            }
        }
    }

    private signPayload(payload: any, secret: string): string {
        const hmac = crypto.createHmac("sha256", secret);
        hmac.update(JSON.stringify(payload));
        return `sha256=${hmac.digest("hex")}`;
    }

    getWebhooks(): WebhookConfig[] {
        return Array.from(this.webhooks.values());
    }

    getDeliveries(webhookId?: string, limit: number = 100): WebhookDelivery[] {
        let deliveries = [...this.deliveryQueue];

        if (webhookId) {
            deliveries = deliveries.filter(d => d.webhookId === webhookId);
        }

        return deliveries
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit);
    }

    startProcessing(): void {
        if (this.processingInterval) return;

        this.processingInterval = setInterval(() => {
            this.processQueue().catch(console.error);
        }, 5000);
    }

    stopProcessing(): void {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
    }
}

// ============================================================================
// EVENT SOURCING (Improvement #99)
// ============================================================================

class EventStore extends EventEmitter {
    private events: EventRecord[] = [];
    private snapshots: Map<string, { state: any; version: number; timestamp: Date }> = new Map();
    private readonly MAX_EVENTS = 100000;
    private readonly SNAPSHOT_INTERVAL = 100; // Snapshot every 100 events per aggregate

    append(
        aggregateId: string,
        aggregateType: string,
        eventType: string,
        payload: any,
        metadata: EventRecord["metadata"] = {}
    ): EventRecord {
        // Get current version for this aggregate
        const aggregateEvents = this.events.filter(e => e.aggregateId === aggregateId);
        const version = aggregateEvents.length + 1;

        const event: EventRecord = {
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            aggregateId,
            aggregateType,
            eventType,
            payload,
            metadata: {
                ...metadata,
                correlationId: metadata.correlationId || crypto.randomUUID()
            },
            timestamp: new Date(),
            version
        };

        this.events.push(event);

        // Trim if too many events
        if (this.events.length > this.MAX_EVENTS) {
            this.events = this.events.slice(-this.MAX_EVENTS);
        }

        // Check if we need a snapshot
        if (version % this.SNAPSHOT_INTERVAL === 0) {
            this.createSnapshot(aggregateId, aggregateType);
        }

        // Emit for subscribers
        this.emit("event", event);
        this.emit(eventType, event);

        return event;
    }

    getEvents(aggregateId: string, fromVersion?: number): EventRecord[] {
        let events = this.events.filter(e => e.aggregateId === aggregateId);

        if (fromVersion !== undefined) {
            events = events.filter(e => e.version > fromVersion);
        }

        return events.sort((a, b) => a.version - b.version);
    }

    getEventsByType(eventType: string, since?: Date): EventRecord[] {
        let events = this.events.filter(e => e.eventType === eventType);

        if (since) {
            events = events.filter(e => e.timestamp >= since);
        }

        return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }

    private createSnapshot(aggregateId: string, aggregateType: string): void {
        const events = this.getEvents(aggregateId);
        if (events.length === 0) return;

        // Build state from events (simple implementation)
        const state = events.reduce((acc, event) => {
            return { ...acc, ...event.payload, _version: event.version };
        }, {});

        this.snapshots.set(aggregateId, {
            state,
            version: events[events.length - 1].version,
            timestamp: new Date()
        });

        console.log(`[EventStore] Created snapshot for ${aggregateType}:${aggregateId} at version ${events.length}`);
    }

    getSnapshot(aggregateId: string): { state: any; version: number } | null {
        const snapshot = this.snapshots.get(aggregateId);
        return snapshot ? { state: snapshot.state, version: snapshot.version } : null;
    }

    replay(aggregateId: string, reducer: (state: any, event: EventRecord) => any, initialState: any = {}): any {
        // Start from snapshot if available
        const snapshot = this.snapshots.get(aggregateId);
        let state = snapshot ? snapshot.state : initialState;
        const fromVersion = snapshot ? snapshot.version : 0;

        // Apply events after snapshot
        const events = this.getEvents(aggregateId, fromVersion);

        for (const event of events) {
            state = reducer(state, event);
        }

        return state;
    }

    getStats(): {
        totalEvents: number;
        totalSnapshots: number;
        eventsByType: Record<string, number>;
    } {
        const eventsByType: Record<string, number> = {};

        for (const event of this.events) {
            eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
        }

        return {
            totalEvents: this.events.length,
            totalSnapshots: this.snapshots.size,
            eventsByType
        };
    }
}

// ============================================================================
// API VERSION MANAGER (Improvement #97)
// ============================================================================

class APIVersionManager {
    private versions: Map<string, APIVersion> = new Map();
    private currentVersion = "v1";

    constructor() {
        this.registerVersion({
            version: "v1",
            deprecated: false,
            changes: ["Initial API release"]
        });
    }

    registerVersion(config: APIVersion): void {
        this.versions.set(config.version, config);

        if (!config.deprecated) {
            this.currentVersion = config.version;
        }
    }

    deprecateVersion(version: string, sunsetDate: Date): void {
        const v = this.versions.get(version);
        if (v) {
            v.deprecated = true;
            v.deprecatedAt = new Date();
            v.sunsetDate = sunsetDate;
        }
    }

    getCurrentVersion(): string {
        return this.currentVersion;
    }

    getVersion(version: string): APIVersion | undefined {
        return this.versions.get(version);
    }

    isVersionSupported(version: string): boolean {
        const v = this.versions.get(version);
        if (!v) return false;

        if (v.sunsetDate && v.sunsetDate < new Date()) {
            return false;
        }

        return true;
    }

    getVersionHeaders(requestedVersion: string): Record<string, string> {
        const headers: Record<string, string> = {
            "X-API-Version": requestedVersion,
            "X-API-Current-Version": this.currentVersion
        };

        const v = this.versions.get(requestedVersion);
        if (v?.deprecated) {
            headers["X-API-Deprecated"] = "true";
            if (v.sunsetDate) {
                headers["X-API-Sunset"] = v.sunsetDate.toISOString();
            }
            headers["Warning"] = `299 - "API version ${requestedVersion} is deprecated"`;
        }

        return headers;
    }

    getAllVersions(): APIVersion[] {
        return Array.from(this.versions.values());
    }
}

// ============================================================================
// DATA SYNC MANAGER (Improvement #98)
// ============================================================================

class DataSyncManager extends EventEmitter {
    private syncConfigs: Map<string, SyncConfig> = new Map();
    private syncInterval: NodeJS.Timeout | null = null;
    private syncHandlers: Map<string, (config: SyncConfig) => Promise<void>> = new Map();

    registerSync(
        config: Omit<SyncConfig, "id" | "nextSync">,
        handler: (config: SyncConfig) => Promise<void>
    ): SyncConfig {
        const syncConfig: SyncConfig = {
            ...config,
            id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            nextSync: new Date(Date.now() + config.syncInterval)
        };

        this.syncConfigs.set(syncConfig.id, syncConfig);
        this.syncHandlers.set(syncConfig.id, handler);

        console.log(`[DataSyncManager] Registered sync: ${syncConfig.name}`);

        return syncConfig;
    }

    unregisterSync(id: string): boolean {
        this.syncHandlers.delete(id);
        return this.syncConfigs.delete(id);
    }

    async runSync(id: string): Promise<void> {
        const config = this.syncConfigs.get(id);
        const handler = this.syncHandlers.get(id);

        if (!config || !handler) {
            throw new Error(`Sync not found: ${id}`);
        }

        if (!config.enabled) {
            console.log(`[DataSyncManager] Sync disabled: ${config.name}`);
            return;
        }

        console.log(`[DataSyncManager] Running sync: ${config.name}`);

        try {
            await handler(config);
            config.lastSync = new Date();
            config.nextSync = new Date(Date.now() + config.syncInterval);

            this.emit("sync_success", { syncId: id, name: config.name });
        } catch (error) {
            console.error(`[DataSyncManager] Sync failed: ${config.name}`, error);
            this.emit("sync_failed", {
                syncId: id,
                name: config.name,
                error: error instanceof Error ? error.message : "Unknown error"
            });
        }
    }

    private async checkAndRunSyncs(): Promise<void> {
        const now = new Date();

        for (const [id, config] of this.syncConfigs) {
            if (config.enabled && config.nextSync <= now) {
                await this.runSync(id).catch(console.error);
            }
        }
    }

    startScheduler(): void {
        if (this.syncInterval) return;

        this.syncInterval = setInterval(() => {
            this.checkAndRunSyncs().catch(console.error);
        }, 60000); // Check every minute
    }

    stopScheduler(): void {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    getSyncs(): SyncConfig[] {
        return Array.from(this.syncConfigs.values());
    }
}

// ============================================================================
// API DOCUMENTATION GENERATOR (Improvement #100)
// ============================================================================

interface APIEndpoint {
    method: string;
    path: string;
    description: string;
    parameters?: Array<{
        name: string;
        type: string;
        required: boolean;
        description: string;
        location: "path" | "query" | "body" | "header";
    }>;
    responses?: Record<number, {
        description: string;
        schema?: any;
    }>;
    tags?: string[];
    deprecated?: boolean;
}

class APIDocGenerator {
    private endpoints: Map<string, APIEndpoint> = new Map();

    registerEndpoint(endpoint: APIEndpoint): void {
        const key = `${endpoint.method} ${endpoint.path}`;
        this.endpoints.set(key, endpoint);
    }

    generateOpenAPI(): any {
        const paths: Record<string, any> = {};

        for (const endpoint of this.endpoints.values()) {
            if (!paths[endpoint.path]) {
                paths[endpoint.path] = {};
            }

            const operation: any = {
                summary: endpoint.description,
                tags: endpoint.tags || [],
                deprecated: endpoint.deprecated || false,
                parameters: [],
                responses: {}
            };

            // Add parameters
            if (endpoint.parameters) {
                for (const param of endpoint.parameters) {
                    if (param.location === "body") {
                        operation.requestBody = {
                            required: param.required,
                            content: {
                                "application/json": {
                                    schema: { type: param.type }
                                }
                            }
                        };
                    } else {
                        operation.parameters.push({
                            name: param.name,
                            in: param.location,
                            required: param.required,
                            description: param.description,
                            schema: { type: param.type }
                        });
                    }
                }
            }

            // Add responses
            if (endpoint.responses) {
                for (const [status, response] of Object.entries(endpoint.responses)) {
                    operation.responses[status] = {
                        description: response.description,
                        content: response.schema
                            ? { "application/json": { schema: response.schema } }
                            : undefined
                    };
                }
            } else {
                operation.responses["200"] = { description: "Success" };
            }

            paths[endpoint.path][endpoint.method.toLowerCase()] = operation;
        }

        return {
            openapi: "3.0.0",
            info: {
                title: "ILIAGPT API",
                version: "1.0.0",
                description: "API documentation for ILIAGPT autonomous AI assistant"
            },
            servers: [
                {
                    url: process.env.APP_URL || "http://localhost:5000",
                    description: "Primary server"
                }
            ],
            paths
        };
    }

    generateMarkdown(): string {
        let md = "# ILIAGPT API Documentation\n\n";
        md += "Auto-generated API documentation.\n\n";
        md += "## Endpoints\n\n";

        const grouped: Map<string, APIEndpoint[]> = new Map();

        for (const endpoint of this.endpoints.values()) {
            const tag = endpoint.tags?.[0] || "General";
            if (!grouped.has(tag)) {
                grouped.set(tag, []);
            }
            grouped.get(tag)!.push(endpoint);
        }

        for (const [tag, endpoints] of grouped) {
            md += `### ${tag}\n\n`;

            for (const ep of endpoints) {
                md += `#### \`${ep.method} ${ep.path}\`\n\n`;
                md += `${ep.description}\n\n`;

                if (ep.parameters && ep.parameters.length > 0) {
                    md += "**Parameters:**\n\n";
                    md += "| Name | Type | Required | Location | Description |\n";
                    md += "|------|------|----------|----------|-------------|\n";

                    for (const param of ep.parameters) {
                        md += `| ${param.name} | ${param.type} | ${param.required ? "Yes" : "No"} | ${param.location} | ${param.description} |\n`;
                    }
                    md += "\n";
                }

                if (ep.deprecated) {
                    md += "⚠️ **Deprecated**\n\n";
                }

                md += "---\n\n";
            }
        }

        return md;
    }

    getEndpoints(): APIEndpoint[] {
        return Array.from(this.endpoints.values());
    }
}

// ============================================================================
// INTEGRATION HUB SERVICE
// ============================================================================

export class IntegrationHubService extends EventEmitter {
    public webhooks: WebhookManager;
    public eventStore: EventStore;
    public apiVersions: APIVersionManager;
    public dataSync: DataSyncManager;
    public apiDocs: APIDocGenerator;

    constructor() {
        super();
        this.webhooks = new WebhookManager();
        this.eventStore = new EventStore();
        this.apiVersions = new APIVersionManager();
        this.dataSync = new DataSyncManager();
        this.apiDocs = new APIDocGenerator();

        this.wireEvents();
        console.log("[IntegrationHub] Service initialized");
    }

    private wireEvents(): void {
        // Forward event store events to webhooks
        this.eventStore.on("event", (event) => {
            this.webhooks.trigger(event.eventType, event).catch(console.error);
        });

        // Forward sync events
        this.dataSync.on("sync_success", (data) => {
            this.eventStore.append(
                data.syncId,
                "sync",
                "sync_completed",
                data,
                {}
            );
        });

        this.dataSync.on("sync_failed", (data) => {
            this.eventStore.append(
                data.syncId,
                "sync",
                "sync_failed",
                data,
                {}
            );
        });
    }

    start(): void {
        this.webhooks.startProcessing();
        this.dataSync.startScheduler();
        console.log("[IntegrationHub] Services started");
    }

    stop(): void {
        this.webhooks.stopProcessing();
        this.dataSync.stopScheduler();
        console.log("[IntegrationHub] Services stopped");
    }

    // Convenience methods
    async emitEvent(
        aggregateId: string,
        aggregateType: string,
        eventType: string,
        payload: any,
        metadata?: EventRecord["metadata"]
    ): Promise<void> {
        this.eventStore.append(aggregateId, aggregateType, eventType, payload, metadata);
    }

    getStatus(): {
        webhooks: { count: number; pendingDeliveries: number };
        eventStore: ReturnType<EventStore["getStats"]>;
        syncs: { count: number; active: number };
        apiVersions: { current: string; total: number };
    } {
        const syncs = this.dataSync.getSyncs();

        return {
            webhooks: {
                count: this.webhooks.getWebhooks().length,
                pendingDeliveries: this.webhooks.getDeliveries().filter(d => d.status === "pending").length
            },
            eventStore: this.eventStore.getStats(),
            syncs: {
                count: syncs.length,
                active: syncs.filter(s => s.enabled).length
            },
            apiVersions: {
                current: this.apiVersions.getCurrentVersion(),
                total: this.apiVersions.getAllVersions().length
            }
        };
    }
}

// Singleton instance
export const integrationHub = new IntegrationHubService();

export default integrationHub;
