/**
 * Upload Queue Service - MICHAT PRO 3.0
 * 
 * Scalable document processing queue with rate limiting.
 * Designed for millions of users.
 */

import { EventEmitter } from "events";
import { Queue, QueueEvents } from "bullmq";
import { createQueue, createQueueEvents, QUEUE_NAMES } from "../lib/queueFactory";

// ============== Types ==============

export interface UploadJobData {
    id: string;
    userId: string;
    chatId: string;
    fileName: string;
    mimeType: string;
    size: number;
    fileData: string; // Base64 encoded for now, S3 key later
    priority: JobPriority;
    createdAt: string;
}

export type JobStatus =
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled";

export type JobPriority = "high" | "normal" | "low";

export interface RateLimitConfig {
    freeLimit: number;      // per minute
    proLimit: number;       // per minute
    adminLimit: number;     // per minute
    maxFileSize: number;    // bytes
    maxFilesPerBatch: number;
}

export interface QueueConfig {
    maxConcurrent?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    jobTimeoutMs?: number;
    rateLimits?: Partial<RateLimitConfig>;
}

// ============== Rate Limiter ==============

class RateLimiter {
    private requests: Map<string, number[]> = new Map();
    private config: RateLimitConfig;

    constructor(config: Partial<RateLimitConfig> = {}) {
        this.config = {
            freeLimit: config.freeLimit ?? 10,
            proLimit: config.proLimit ?? 50,
            adminLimit: config.adminLimit ?? 200,
            maxFileSize: config.maxFileSize ?? 25 * 1024 * 1024, // 25MB
            maxFilesPerBatch: config.maxFilesPerBatch ?? 10,
        };
    }

    getLimit(userPlan: "free" | "pro" | "admin"): number {
        switch (userPlan) {
            case "admin": return this.config.adminLimit;
            case "pro": return this.config.proLimit;
            default: return this.config.freeLimit;
        }
    }

    check(userId: string, userPlan: "free" | "pro" | "admin"): {
        allowed: boolean;
        remaining: number;
        resetIn: number;
    } {
        const now = Date.now();
        const windowMs = 60000; // 1 minute
        const limit = this.getLimit(userPlan);

        // Get existing requests
        const userRequests = this.requests.get(userId) || [];

        // Filter to only requests in current window
        const windowStart = now - windowMs;
        const recentRequests = userRequests.filter(t => t > windowStart);

        // Update stored requests
        this.requests.set(userId, recentRequests);

        const remaining = Math.max(0, limit - recentRequests.length);
        const oldestRequest = recentRequests[0] || now;
        const resetIn = Math.max(0, oldestRequest + windowMs - now);

        return {
            allowed: recentRequests.length < limit,
            remaining,
            resetIn,
        };
    }

    record(userId: string): void {
        const requests = this.requests.get(userId) || [];
        requests.push(Date.now());
        this.requests.set(userId, requests);
    }

    getMaxFileSize(): number {
        return this.config.maxFileSize;
    }

    getMaxFilesPerBatch(): number {
        return this.config.maxFilesPerBatch;
    }
}

// ============== Upload Queue Producer ==============

export class UploadQueue extends EventEmitter {
    private queue: Queue<UploadJobData>;
    private events: QueueEvents;
    private rateLimiter: RateLimiter;
    private config: Required<QueueConfig>;

    constructor(config: QueueConfig = {}) {
        super();
        this.config = {
            maxConcurrent: config.maxConcurrent ?? 5,
            maxRetries: config.maxRetries ?? 3,
            retryDelayMs: config.retryDelayMs ?? 1000,
            jobTimeoutMs: config.jobTimeoutMs ?? 120000, // 2 minutes
            rateLimits: config.rateLimits ?? {},
        };
        this.rateLimiter = new RateLimiter(this.config.rateLimits);

        // Initialize BullMQ Queue
        this.queue = createQueue<UploadJobData>(QUEUE_NAMES.UPLOAD);
        this.events = createQueueEvents(QUEUE_NAMES.UPLOAD);

        this.setupEventListeners();
    }

    private setupEventListeners() {
        this.events.on('completed', ({ jobId, returnvalue }) => {
            this.emit('jobCompleted', { id: jobId, result: returnvalue });
        });

        this.events.on('failed', ({ jobId, failedReason }) => {
            this.emit('jobFailed', { id: jobId, error: failedReason });
        });

        this.events.on('active', ({ jobId }) => {
            this.emit('jobStarted', { id: jobId });
        });
    }

    /**
     * No-op for compatibility, Queue is always "running" in Redis
     */
    start(): void {
        this.emit("started");
    }

    /**
     * Closes the queue connection
     */
    async stop(): Promise<void> {
        await this.queue.close();
        await this.events.close();
        this.emit("stopped");
    }

    /**
     * Add job to queue
     */
    async add(
        userId: string,
        chatId: string,
        file: { name: string; type: string; buffer: Buffer },
        options: { priority?: JobPriority; userPlan?: "free" | "pro" | "admin" } = {}
    ): Promise<{ jobId: string } | { error: string; retryAfter?: number }> {
        const { priority = "normal", userPlan = "free" } = options;

        // Check rate limit
        const rateCheck = this.rateLimiter.check(userId, userPlan);
        if (!rateCheck.allowed) {
            return {
                error: "Rate limit exceeded",
                retryAfter: rateCheck.resetIn,
            };
        }

        // Check file size
        if (file.buffer.length > this.rateLimiter.getMaxFileSize()) {
            return {
                error: `File too large. Max size: ${this.rateLimiter.getMaxFileSize() / 1024 / 1024}MB`,
            };
        }

        // Create job data
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const jobData: UploadJobData = {
            id: jobId,
            userId,
            chatId,
            fileName: file.name,
            mimeType: file.type,
            size: file.buffer.length,
            fileData: file.buffer.toString('base64'), // Temporary until S3
            priority,
            createdAt: new Date().toISOString(),
        };

        // Record rate limit
        this.rateLimiter.record(userId);

        // Add to BullMQ
        await this.queue.add('process-file', jobData, {
            jobId: jobId,
            priority: priority === 'high' ? 1 : (priority === 'low' ? 3 : 2),
            attempts: this.config.maxRetries,
        });

        this.emit("jobAdded", jobData);

        return { jobId };
    }

    /**
     * Add batch of files
     */
    async addBatch(
        userId: string,
        chatId: string,
        files: Array<{ name: string; type: string; buffer: Buffer }>,
        options: { priority?: JobPriority; userPlan?: "free" | "pro" | "admin" } = {}
    ): Promise<{ jobIds: string[] } | { error: string }> {
        if (files.length > this.rateLimiter.getMaxFilesPerBatch()) {
            return {
                error: `Too many files. Max: ${this.rateLimiter.getMaxFilesPerBatch()} per batch`,
            };
        }

        const jobIds: string[] = [];

        for (const file of files) {
            const result = await this.add(userId, chatId, file, options);
            if ("error" in result) {
                return result;
            }
            jobIds.push(result.jobId);
        }

        return { jobIds };
    }

    /**
     * Get job status
     */
    async getJob(jobId: string) {
        return await this.queue.getJob(jobId);
    }

    /**
     * Get all jobs for user (Expensive in Redis, simplified for now)
     */
    async getUserJobs(userId: string): Promise<UploadJobData[]> {
        // limitation: BullMQ doesn't easily query by payload content without extra indexing
        return [];
    }

    /**
     * Cancel job
     */
    async cancel(jobId: string): Promise<boolean> {
        const job = await this.queue.getJob(jobId);
        if (job) {
            await job.remove();
            return true;
        }
        return false;
    }

    /**
     * Get queue stats
     */
    async getStats() {
        const counts = await this.queue.getJobCounts();
        return {
            pending: counts.waiting || 0,
            processing: counts.active || 0,
            completed: counts.completed || 0,
            failed: counts.failed || 0,
            totalSize: 0,
        };
    }

    /**
     * Clear completed/failed jobs
     */
    async cleanup(maxAgeMs: number = 3600000): Promise<number> {
        const cleaned = await this.queue.clean(maxAgeMs, 1000, 'completed');
        return cleaned.length;
    }
}

// ============== Singleton ==============

let queueInstance: UploadQueue | null = null;

export function getUploadQueue(config?: QueueConfig): UploadQueue {
    if (!queueInstance) {
        queueInstance = new UploadQueue(config);
        queueInstance.start();
    }
    return queueInstance;
}

export default UploadQueue;
