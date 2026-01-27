/**
 * Data Processing Service
 *
 * Robust data handling, validation, and transformation.
 * Implements improvements 116-130: Data Processing
 */

import { EventEmitter } from "events";
import crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

interface ValidationRule {
    field: string;
    type: "required" | "type" | "pattern" | "range" | "custom";
    params?: any;
    message: string;
}

interface ValidationResult {
    valid: boolean;
    errors: Array<{ field: string; message: string }>;
    sanitized?: any;
}

interface TransformPipeline {
    name: string;
    steps: Array<(data: any) => any | Promise<any>>;
}

interface DataCheckpoint {
    id: string;
    timestamp: Date;
    data: any;
    hash: string;
    source: string;
}

interface StreamProcessor {
    name: string;
    buffer: any[];
    bufferSize: number;
    flushInterval: number;
    processor: (batch: any[]) => Promise<void>;
    lastFlush: Date;
}

// ============================================================================
// DATA VALIDATOR (Improvements 116-118)
// ============================================================================

class DataValidator {
    private schemas: Map<string, ValidationRule[]> = new Map();

    registerSchema(name: string, rules: ValidationRule[]): void {
        this.schemas.set(name, rules);
    }

    validate(data: any, schemaName: string): ValidationResult {
        const rules = this.schemas.get(schemaName);
        if (!rules) {
            return { valid: true, errors: [], sanitized: data };
        }

        const errors: Array<{ field: string; message: string }> = [];
        const sanitized = { ...data };

        for (const rule of rules) {
            const value = this.getNestedValue(data, rule.field);
            const error = this.validateField(value, rule);

            if (error) {
                errors.push({ field: rule.field, message: error });
            } else {
                // Sanitize the field
                const sanitizedValue = this.sanitizeField(value, rule);
                this.setNestedValue(sanitized, rule.field, sanitizedValue);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            sanitized: errors.length === 0 ? sanitized : undefined
        };
    }

    private validateField(value: any, rule: ValidationRule): string | null {
        switch (rule.type) {
            case "required":
                if (value === undefined || value === null || value === "") {
                    return rule.message;
                }
                break;

            case "type":
                if (value !== undefined && value !== null) {
                    const expectedType = rule.params?.type;
                    if (expectedType === "email" && !this.isValidEmail(value)) {
                        return rule.message;
                    } else if (expectedType === "url" && !this.isValidUrl(value)) {
                        return rule.message;
                    } else if (expectedType === "uuid" && !this.isValidUuid(value)) {
                        return rule.message;
                    } else if (typeof value !== expectedType && !["email", "url", "uuid"].includes(expectedType)) {
                        return rule.message;
                    }
                }
                break;

            case "pattern":
                if (value && rule.params?.regex) {
                    const regex = new RegExp(rule.params.regex);
                    if (!regex.test(String(value))) {
                        return rule.message;
                    }
                }
                break;

            case "range":
                if (value !== undefined && value !== null) {
                    const { min, max } = rule.params || {};
                    if (typeof value === "number") {
                        if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
                            return rule.message;
                        }
                    } else if (typeof value === "string") {
                        if ((min !== undefined && value.length < min) || (max !== undefined && value.length > max)) {
                            return rule.message;
                        }
                    }
                }
                break;

            case "custom":
                if (rule.params?.validator && typeof rule.params.validator === "function") {
                    if (!rule.params.validator(value)) {
                        return rule.message;
                    }
                }
                break;
        }

        return null;
    }

    private sanitizeField(value: any, rule: ValidationRule): any {
        if (value === undefined || value === null) return value;

        if (typeof value === "string") {
            // Trim strings
            value = value.trim();

            // Escape HTML if needed
            if (rule.params?.escapeHtml) {
                value = this.escapeHtml(value);
            }

            // Normalize unicode
            value = value.normalize("NFC");
        }

        return value;
    }

    private escapeHtml(str: string): string {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    private isValidEmail(value: string): boolean {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    private isValidUrl(value: string): boolean {
        try {
            new URL(value);
            return true;
        } catch {
            return false;
        }
    }

    private isValidUuid(value: string): boolean {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    }

    private getNestedValue(obj: any, path: string): any {
        return path.split(".").reduce((acc, key) => acc?.[key], obj);
    }

    private setNestedValue(obj: any, path: string, value: any): void {
        const keys = path.split(".");
        const lastKey = keys.pop()!;
        const target = keys.reduce((acc, key) => {
            if (!acc[key]) acc[key] = {};
            return acc[key];
        }, obj);
        target[lastKey] = value;
    }
}

// ============================================================================
// DATA TRANSFORMER (Improvements 119-121)
// ============================================================================

class DataTransformer {
    private pipelines: Map<string, TransformPipeline> = new Map();

    registerPipeline(name: string, steps: Array<(data: any) => any | Promise<any>>): void {
        this.pipelines.set(name, { name, steps });
    }

    async transform(data: any, pipelineName: string): Promise<any> {
        const pipeline = this.pipelines.get(pipelineName);
        if (!pipeline) {
            throw new Error(`Pipeline not found: ${pipelineName}`);
        }

        let result = data;

        for (const step of pipeline.steps) {
            try {
                result = await step(result);
            } catch (error) {
                console.error(`[DataTransformer] Pipeline ${pipelineName} failed at step:`, error);
                throw error;
            }
        }

        return result;
    }

    // Common transformations
    static flatten(data: any, prefix: string = ""): Record<string, any> {
        const result: Record<string, any> = {};

        for (const [key, value] of Object.entries(data)) {
            const newKey = prefix ? `${prefix}.${key}` : key;

            if (value && typeof value === "object" && !Array.isArray(value)) {
                Object.assign(result, DataTransformer.flatten(value, newKey));
            } else {
                result[newKey] = value;
            }
        }

        return result;
    }

    static unflatten(data: Record<string, any>): any {
        const result: any = {};

        for (const [key, value] of Object.entries(data)) {
            const keys = key.split(".");
            let current = result;

            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) {
                    current[keys[i]] = {};
                }
                current = current[keys[i]];
            }

            current[keys[keys.length - 1]] = value;
        }

        return result;
    }

    static pick(data: any, fields: string[]): any {
        const result: any = {};
        for (const field of fields) {
            const value = field.split(".").reduce((acc, key) => acc?.[key], data);
            if (value !== undefined) {
                result[field] = value;
            }
        }
        return result;
    }

    static omit(data: any, fields: string[]): any {
        const result = { ...data };
        for (const field of fields) {
            delete result[field];
        }
        return result;
    }

    static rename(data: any, mapping: Record<string, string>): any {
        const result: any = {};
        for (const [key, value] of Object.entries(data)) {
            const newKey = mapping[key] || key;
            result[newKey] = value;
        }
        return result;
    }

    static defaults(data: any, defaults: any): any {
        return { ...defaults, ...data };
    }

    static coerce(data: any, types: Record<string, "string" | "number" | "boolean" | "date">): any {
        const result = { ...data };

        for (const [field, type] of Object.entries(types)) {
            if (result[field] === undefined) continue;

            switch (type) {
                case "string":
                    result[field] = String(result[field]);
                    break;
                case "number":
                    result[field] = Number(result[field]);
                    break;
                case "boolean":
                    result[field] = Boolean(result[field]);
                    break;
                case "date":
                    result[field] = new Date(result[field]);
                    break;
            }
        }

        return result;
    }
}

// ============================================================================
// DATA INTEGRITY (Improvements 122-124)
// ============================================================================

class DataIntegrityManager {
    private checkpoints: Map<string, DataCheckpoint[]> = new Map();
    private readonly maxCheckpoints = 100;

    createCheckpoint(source: string, data: any): DataCheckpoint {
        const checkpoint: DataCheckpoint = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            data: this.deepClone(data),
            hash: this.hashData(data),
            source
        };

        if (!this.checkpoints.has(source)) {
            this.checkpoints.set(source, []);
        }

        const checkpoints = this.checkpoints.get(source)!;
        checkpoints.push(checkpoint);

        // Keep only recent checkpoints
        if (checkpoints.length > this.maxCheckpoints) {
            checkpoints.shift();
        }

        return checkpoint;
    }

    verifyIntegrity(source: string, data: any): boolean {
        const currentHash = this.hashData(data);
        const checkpoints = this.checkpoints.get(source);

        if (!checkpoints || checkpoints.length === 0) {
            return true; // No checkpoints to compare
        }

        const lastCheckpoint = checkpoints[checkpoints.length - 1];
        return lastCheckpoint.hash === currentHash;
    }

    restoreFromCheckpoint(source: string, checkpointId?: string): any | null {
        const checkpoints = this.checkpoints.get(source);
        if (!checkpoints || checkpoints.length === 0) {
            return null;
        }

        let checkpoint: DataCheckpoint | undefined;

        if (checkpointId) {
            checkpoint = checkpoints.find(c => c.id === checkpointId);
        } else {
            checkpoint = checkpoints[checkpoints.length - 1];
        }

        if (!checkpoint) return null;

        return this.deepClone(checkpoint.data);
    }

    getCheckpoints(source: string): DataCheckpoint[] {
        return this.checkpoints.get(source)?.map(c => ({
            ...c,
            data: "[REDACTED]" // Don't expose full data in listing
        })) as DataCheckpoint[] || [];
    }

    private hashData(data: any): string {
        const str = JSON.stringify(data);
        return crypto.createHash("sha256").update(str).digest("hex");
    }

    private deepClone<T>(data: T): T {
        return JSON.parse(JSON.stringify(data));
    }
}

// ============================================================================
// STREAM PROCESSOR (Improvements 125-127)
// ============================================================================

class StreamProcessorManager extends EventEmitter {
    private processors: Map<string, StreamProcessor> = new Map();
    private intervals: Map<string, NodeJS.Timeout> = new Map();

    registerProcessor(
        name: string,
        processor: (batch: any[]) => Promise<void>,
        options: { bufferSize?: number; flushInterval?: number } = {}
    ): void {
        const streamProcessor: StreamProcessor = {
            name,
            buffer: [],
            bufferSize: options.bufferSize || 100,
            flushInterval: options.flushInterval || 5000,
            processor,
            lastFlush: new Date()
        };

        this.processors.set(name, streamProcessor);

        // Setup auto-flush
        const interval = setInterval(() => {
            this.flush(name).catch(console.error);
        }, streamProcessor.flushInterval);

        this.intervals.set(name, interval);
    }

    async push(name: string, data: any): Promise<void> {
        const processor = this.processors.get(name);
        if (!processor) {
            throw new Error(`Stream processor not found: ${name}`);
        }

        processor.buffer.push(data);

        // Flush if buffer is full
        if (processor.buffer.length >= processor.bufferSize) {
            await this.flush(name);
        }
    }

    async pushBatch(name: string, items: any[]): Promise<void> {
        for (const item of items) {
            await this.push(name, item);
        }
    }

    async flush(name: string): Promise<void> {
        const processor = this.processors.get(name);
        if (!processor || processor.buffer.length === 0) return;

        const batch = [...processor.buffer];
        processor.buffer = [];
        processor.lastFlush = new Date();

        try {
            await processor.processor(batch);
            this.emit("flush_success", { name, count: batch.length });
        } catch (error) {
            // Re-add to buffer on failure
            processor.buffer.unshift(...batch);
            this.emit("flush_error", { name, error, count: batch.length });
            throw error;
        }
    }

    async flushAll(): Promise<void> {
        for (const name of this.processors.keys()) {
            await this.flush(name).catch(console.error);
        }
    }

    getStats(): Record<string, { buffered: number; lastFlush: Date }> {
        const stats: Record<string, any> = {};

        for (const [name, processor] of this.processors) {
            stats[name] = {
                buffered: processor.buffer.length,
                lastFlush: processor.lastFlush
            };
        }

        return stats;
    }

    stop(): void {
        for (const interval of this.intervals.values()) {
            clearInterval(interval);
        }
        this.intervals.clear();
    }
}

// ============================================================================
// DATA DEDUPLICATOR (Improvements 128-130)
// ============================================================================

class DataDeduplicator {
    private seen: Map<string, { timestamp: Date; count: number }> = new Map();
    private readonly ttlMs: number;
    private readonly maxEntries: number;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
        this.ttlMs = options.ttlMs || 3600000; // 1 hour default
        this.maxEntries = options.maxEntries || 100000;
        this.startCleanup();
    }

    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60000); // Every minute
    }

    isDuplicate(data: any, key?: string): boolean {
        const hash = key || this.hashData(data);
        const entry = this.seen.get(hash);

        if (entry) {
            entry.count++;
            entry.timestamp = new Date();
            return true;
        }

        return false;
    }

    markSeen(data: any, key?: string): void {
        const hash = key || this.hashData(data);

        // Enforce max entries
        if (this.seen.size >= this.maxEntries) {
            this.evictOldest();
        }

        this.seen.set(hash, {
            timestamp: new Date(),
            count: 1
        });
    }

    deduplicate<T>(items: T[], keyFn?: (item: T) => string): T[] {
        const unique: T[] = [];

        for (const item of items) {
            const key = keyFn ? keyFn(item) : this.hashData(item);

            if (!this.isDuplicate(item, key)) {
                this.markSeen(item, key);
                unique.push(item);
            }
        }

        return unique;
    }

    private hashData(data: any): string {
        const str = JSON.stringify(data);
        return crypto.createHash("md5").update(str).digest("hex");
    }

    private cleanup(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [hash, entry] of this.seen) {
            if (now - entry.timestamp.getTime() > this.ttlMs) {
                this.seen.delete(hash);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`[DataDeduplicator] Cleaned ${cleaned} expired entries`);
        }
    }

    private evictOldest(): void {
        let oldest: { hash: string; timestamp: Date } | null = null;

        for (const [hash, entry] of this.seen) {
            if (!oldest || entry.timestamp < oldest.timestamp) {
                oldest = { hash, timestamp: entry.timestamp };
            }
        }

        if (oldest) {
            this.seen.delete(oldest.hash);
        }
    }

    getStats(): { entries: number; duplicatesBlocked: number } {
        let duplicatesBlocked = 0;
        for (const entry of this.seen.values()) {
            duplicatesBlocked += entry.count - 1;
        }

        return {
            entries: this.seen.size,
            duplicatesBlocked
        };
    }

    stop(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// ============================================================================
// DATA PROCESSING SERVICE
// ============================================================================

export class DataProcessingService extends EventEmitter {
    public validator: DataValidator;
    public transformer: DataTransformer;
    public integrity: DataIntegrityManager;
    public stream: StreamProcessorManager;
    public deduplicator: DataDeduplicator;

    constructor() {
        super();
        this.validator = new DataValidator();
        this.transformer = new DataTransformer();
        this.integrity = new DataIntegrityManager();
        this.stream = new StreamProcessorManager();
        this.deduplicator = new DataDeduplicator();

        this.setupDefaultSchemas();
        this.setupDefaultPipelines();

        console.log("[DataProcessing] Service initialized");
    }

    private setupDefaultSchemas(): void {
        // User schema
        this.validator.registerSchema("user", [
            { field: "email", type: "required", message: "Email es requerido" },
            { field: "email", type: "type", params: { type: "email" }, message: "Email inválido" },
            { field: "name", type: "range", params: { min: 2, max: 100 }, message: "Nombre debe tener 2-100 caracteres" }
        ]);

        // Message schema
        this.validator.registerSchema("message", [
            { field: "content", type: "required", message: "Contenido requerido" },
            { field: "content", type: "range", params: { max: 100000 }, message: "Mensaje muy largo" }
        ]);

        // Chat schema
        this.validator.registerSchema("chat", [
            { field: "title", type: "range", params: { max: 200 }, message: "Título muy largo" }
        ]);
    }

    private setupDefaultPipelines(): void {
        // Sanitize user input
        this.transformer.registerPipeline("sanitize_input", [
            (data) => {
                if (typeof data === "string") {
                    return data.trim();
                }
                return data;
            },
            (data) => {
                if (typeof data === "object" && data !== null) {
                    const result: any = {};
                    for (const [key, value] of Object.entries(data)) {
                        if (typeof value === "string") {
                            result[key] = value.trim();
                        } else {
                            result[key] = value;
                        }
                    }
                    return result;
                }
                return data;
            }
        ]);

        // Prepare for storage
        this.transformer.registerPipeline("prepare_storage", [
            (data) => ({
                ...data,
                updatedAt: new Date().toISOString()
            }),
            (data) => DataTransformer.omit(data, ["password", "token", "secret"])
        ]);
    }

    /**
     * Validate and transform data in one step
     */
    async process(data: any, options: {
        schema?: string;
        pipeline?: string;
        checkpoint?: string;
        deduplicate?: boolean;
    } = {}): Promise<{ valid: boolean; data: any; errors?: any[] }> {
        let processedData = data;

        // Deduplicate check
        if (options.deduplicate && this.deduplicator.isDuplicate(data)) {
            return { valid: false, data: null, errors: [{ message: "Duplicate data" }] };
        }

        // Validate
        if (options.schema) {
            const validation = this.validator.validate(data, options.schema);
            if (!validation.valid) {
                return { valid: false, data: null, errors: validation.errors };
            }
            processedData = validation.sanitized || data;
        }

        // Transform
        if (options.pipeline) {
            processedData = await this.transformer.transform(processedData, options.pipeline);
        }

        // Checkpoint
        if (options.checkpoint) {
            this.integrity.createCheckpoint(options.checkpoint, processedData);
        }

        // Mark as seen for deduplication
        if (options.deduplicate) {
            this.deduplicator.markSeen(data);
        }

        return { valid: true, data: processedData };
    }

    getStats(): {
        deduplicator: ReturnType<DataDeduplicator["getStats"]>;
        stream: ReturnType<StreamProcessorManager["getStats"]>;
    } {
        return {
            deduplicator: this.deduplicator.getStats(),
            stream: this.stream.getStats()
        };
    }

    stop(): void {
        this.stream.stop();
        this.deduplicator.stop();
    }
}

// Singleton instance
export const dataProcessing = new DataProcessingService();

export default dataProcessing;
