/**
 * Upload Queue Service - MICHAT PRO 3.0
 * 
 * Scalable document processing queue with rate limiting.
 * Designed for millions of users.
 */

import { EventEmitter } from "events";

// ============== Types ==============

export interface UploadJob {
    id: string;
    userId: string;
    chatId: string;
    fileName: string;
    mimeType: string;
    size: number;
    buffer: Buffer;
    status: JobStatus;
    priority: JobPriority;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    result?: ProcessingResult;
    error?: string;
    retryCount: number;
}

export type JobStatus =
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled";

export type JobPriority = "high" | "normal" | "low";

export interface ProcessingResult {
    content: string;
    chunks: string[];
    embeddings?: number[][];
    metadata: {
        pageCount?: number;
        wordCount: number;
        language?: string;
        hasImages: boolean;
        hasTables: boolean;
    };
    visionAnalysis?: any;
}

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

// ============== Upload Queue ==============

export class UploadQueue extends EventEmitter {
    private queue: Map<string, UploadJob> = new Map();
    private processing: Set<string> = new Set();
    private rateLimiter: RateLimiter;
    private config: Required<QueueConfig>;
    private isRunning = false;
    private processInterval?: NodeJS.Timeout;

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
    }

    /**
     * Start processing queue
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.processInterval = setInterval(() => this.processNext(), 100);
        this.emit("started");
    }

    /**
     * Stop processing queue
     */
    stop(): void {
        if (!this.isRunning) return;
        this.isRunning = false;
        if (this.processInterval) {
            clearInterval(this.processInterval);
        }
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

        // Create job
        const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const job: UploadJob = {
            id: jobId,
            userId,
            chatId,
            fileName: file.name,
            mimeType: file.type,
            size: file.buffer.length,
            buffer: file.buffer,
            status: "pending",
            priority,
            createdAt: new Date(),
            retryCount: 0,
        };

        // Record rate limit
        this.rateLimiter.record(userId);

        // Add to queue
        this.queue.set(jobId, job);
        this.emit("jobAdded", job);

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
    getJob(jobId: string): UploadJob | undefined {
        return this.queue.get(jobId);
    }

    /**
     * Get all jobs for user
     */
    getUserJobs(userId: string): UploadJob[] {
        return Array.from(this.queue.values())
            .filter(j => j.userId === userId);
    }

    /**
     * Cancel job
     */
    cancel(jobId: string): boolean {
        const job = this.queue.get(jobId);
        if (!job || job.status === "processing" || job.status === "completed") {
            return false;
        }
        job.status = "cancelled";
        this.emit("jobCancelled", job);
        return true;
    }

    /**
     * Process next job in queue
     */
    private async processNext(): Promise<void> {
        if (this.processing.size >= this.config.maxConcurrent) {
            return;
        }

        // Find next pending job (prioritize high priority)
        const pendingJobs = Array.from(this.queue.values())
            .filter(j => j.status === "pending")
            .sort((a, b) => {
                const priorityOrder = { high: 0, normal: 1, low: 2 };
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            });

        const job = pendingJobs[0];
        if (!job) return;

        // Start processing
        this.processing.add(job.id);
        job.status = "processing";
        job.startedAt = new Date();
        this.emit("jobStarted", job);

        try {
            // Process with timeout
            const result = await Promise.race([
                this.processJob(job),
                this.createTimeout(this.config.jobTimeoutMs),
            ]) as ProcessingResult;

            job.status = "completed";
            job.completedAt = new Date();
            job.result = result;
            this.emit("jobCompleted", job);
        } catch (error) {
            job.retryCount++;

            if (job.retryCount < this.config.maxRetries) {
                job.status = "pending";
                job.error = error instanceof Error ? error.message : "Unknown error";

                // Delay before retry
                await this.delay(this.config.retryDelayMs * job.retryCount);
            } else {
                job.status = "failed";
                job.completedAt = new Date();
                job.error = error instanceof Error ? error.message : "Unknown error";
                this.emit("jobFailed", job);
            }
        } finally {
            this.processing.delete(job.id);
        }
    }

    /**
     * Process a single job (to be overridden with actual processing)
     */
    private async processJob(job: UploadJob): Promise<ProcessingResult> {
        // This is a placeholder - actual processing would be injected
        // In production, this would call documentIngestion, RAG, etc.

        await this.delay(100); // Simulate processing

        return {
            content: `Processed: ${job.fileName}`,
            chunks: [],
            metadata: {
                wordCount: 0,
                hasImages: false,
                hasTables: false,
            },
        };
    }

    /**
     * Set custom processor
     */
    setProcessor(processor: (job: UploadJob) => Promise<ProcessingResult>): void {
        (this as any).processJob = processor;
    }

    /**
     * Get queue stats
     */
    getStats(): {
        pending: number;
        processing: number;
        completed: number;
        failed: number;
        totalSize: number;
    } {
        const jobs = Array.from(this.queue.values());
        return {
            pending: jobs.filter(j => j.status === "pending").length,
            processing: this.processing.size,
            completed: jobs.filter(j => j.status === "completed").length,
            failed: jobs.filter(j => j.status === "failed").length,
            totalSize: jobs.reduce((sum, j) => sum + j.size, 0),
        };
    }

    /**
     * Clear completed/failed jobs
     */
    cleanup(maxAgeMs: number = 3600000): number {
        const cutoff = Date.now() - maxAgeMs;
        let removed = 0;

        for (const [id, job] of Array.from(this.queue.entries())) {
            if (
                (job.status === "completed" || job.status === "failed" || job.status === "cancelled") &&
                job.completedAt &&
                job.completedAt.getTime() < cutoff
            ) {
                this.queue.delete(id);
                removed++;
            }
        }

        return removed;
    }

    private createTimeout(ms: number): Promise<never> {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Job timeout")), ms);
        });
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
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
