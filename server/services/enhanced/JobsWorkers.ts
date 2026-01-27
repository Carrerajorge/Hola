/**
 * Jobs & Workers Enhancements (341-360)
 * Background job processing and worker management
 */

import { EventEmitter } from 'events';

// ============================================
// 341. Job Queue Manager
// ============================================
type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying' | 'cancelled';

interface Job<T = any> {
  id: string;
  name: string;
  data: T;
  priority: number;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: any;
  delay?: number;
  scheduledFor?: Date;
  progress?: number;
  metadata?: Record<string, any>;
}

interface JobOptions {
  priority?: number;
  maxAttempts?: number;
  delay?: number;
  scheduledFor?: Date;
  metadata?: Record<string, any>;
}

type JobHandler<T = any> = (job: Job<T>, progress: (percent: number) => void) => Promise<any>;

export class JobQueue {
  private jobs: Map<string, Job> = new Map();
  private handlers: Map<string, JobHandler> = new Map();
  private events = new EventEmitter();
  private processing = false;
  private concurrency: number;
  private activeJobs = 0;

  constructor(concurrency: number = 5) {
    this.concurrency = concurrency;
  }

  registerHandler(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  async add<T>(name: string, data: T, options: JobOptions = {}): Promise<Job<T>> {
    const job: Job<T> = {
      id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      data,
      priority: options.priority || 0,
      status: 'pending',
      attempts: 0,
      maxAttempts: options.maxAttempts || 3,
      createdAt: new Date(),
      delay: options.delay,
      scheduledFor: options.scheduledFor,
      metadata: options.metadata
    };

    this.jobs.set(job.id, job);
    this.events.emit('job:added', job);

    if (!this.processing) {
      this.process();
    }

    return job;
  }

  async addBulk<T>(name: string, items: T[], options: JobOptions = {}): Promise<Job<T>[]> {
    const jobs: Job<T>[] = [];

    for (const data of items) {
      const job = await this.add(name, data, options);
      jobs.push(job);
    }

    return jobs;
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.processing) {
      // Get next job
      const job = this.getNextJob();
      if (!job) {
        await this.sleep(100);
        continue;
      }

      // Check concurrency limit
      if (this.activeJobs >= this.concurrency) {
        await this.sleep(100);
        continue;
      }

      // Process job
      this.activeJobs++;
      this.processJob(job).finally(() => {
        this.activeJobs--;
      });
    }
  }

  private getNextJob(): Job | null {
    const now = new Date();
    const pendingJobs = Array.from(this.jobs.values())
      .filter(job => {
        if (job.status !== 'pending') return false;
        if (job.scheduledFor && job.scheduledFor > now) return false;
        return true;
      })
      .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime());

    return pendingJobs[0] || null;
  }

  private async processJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      job.status = 'failed';
      job.error = `No handler registered for job type: ${job.name}`;
      this.events.emit('job:failed', job);
      return;
    }

    // Handle delay
    if (job.delay && job.attempts === 0) {
      await this.sleep(job.delay);
    }

    job.status = 'processing';
    job.startedAt = new Date();
    job.attempts++;
    this.events.emit('job:started', job);

    const progress = (percent: number) => {
      job.progress = percent;
      this.events.emit('job:progress', job);
    };

    try {
      job.result = await handler(job, progress);
      job.status = 'completed';
      job.completedAt = new Date();
      job.progress = 100;
      this.events.emit('job:completed', job);
    } catch (error) {
      job.error = (error as Error).message;

      if (job.attempts < job.maxAttempts) {
        job.status = 'retrying';
        const backoff = Math.pow(2, job.attempts) * 1000; // Exponential backoff
        job.scheduledFor = new Date(Date.now() + backoff);
        job.status = 'pending';
        this.events.emit('job:retrying', job);
      } else {
        job.status = 'failed';
        job.completedAt = new Date();
        this.events.emit('job:failed', job);
      }
    }
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status === 'processing') return false;

    job.status = 'cancelled';
    this.events.emit('job:cancelled', job);
    return true;
  }

  pause(): void {
    this.processing = false;
  }

  resume(): void {
    if (!this.processing) {
      this.process();
    }
  }

  getStats(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const jobs = Array.from(this.jobs.values());
    return {
      total: jobs.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length
    };
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup(olderThan: Date): Promise<number> {
    let count = 0;
    for (const [id, job] of this.jobs) {
      if (
        (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') &&
        job.completedAt && job.completedAt < olderThan
      ) {
        this.jobs.delete(id);
        count++;
      }
    }
    return count;
  }
}

// ============================================
// 342. Scheduled Tasks Manager (Cron-like)
// ============================================
interface ScheduledTask {
  id: string;
  name: string;
  schedule: string; // Cron expression
  handler: () => Promise<void>;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  errors: number;
}

export class ScheduledTaskManager {
  private tasks: Map<string, ScheduledTask> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private events = new EventEmitter();

  register(
    name: string,
    schedule: string,
    handler: () => Promise<void>
  ): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const task: ScheduledTask = {
      id,
      name,
      schedule,
      handler,
      enabled: true,
      runCount: 0,
      errors: 0
    };

    this.tasks.set(id, task);
    this.scheduleTask(task);

    return id;
  }

  private scheduleTask(task: ScheduledTask): void {
    // Simple interval parsing (supports: @hourly, @daily, @weekly, or milliseconds)
    let intervalMs: number;

    switch (task.schedule) {
      case '@minutely':
        intervalMs = 60 * 1000;
        break;
      case '@hourly':
        intervalMs = 60 * 60 * 1000;
        break;
      case '@daily':
        intervalMs = 24 * 60 * 60 * 1000;
        break;
      case '@weekly':
        intervalMs = 7 * 24 * 60 * 60 * 1000;
        break;
      default:
        intervalMs = parseInt(task.schedule) || 60000;
    }

    task.nextRun = new Date(Date.now() + intervalMs);

    const interval = setInterval(async () => {
      if (!task.enabled) return;

      try {
        task.lastRun = new Date();
        task.nextRun = new Date(Date.now() + intervalMs);
        task.runCount++;
        this.events.emit('task:started', task);

        await task.handler();

        this.events.emit('task:completed', task);
      } catch (error) {
        task.errors++;
        this.events.emit('task:error', { task, error });
      }
    }, intervalMs);

    this.intervals.set(task.id, interval);
  }

  enable(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.enabled = true;
    }
  }

  disable(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.enabled = false;
    }
  }

  remove(id: string): void {
    const interval = this.intervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(id);
    }
    this.tasks.delete(id);
  }

  runNow(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task) {
      return Promise.reject(new Error('Task not found'));
    }
    return task.handler();
  }

  getTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }

  shutdown(): void {
    for (const [id] of this.intervals) {
      this.remove(id);
    }
  }
}

// ============================================
// 343. Worker Pool
// ============================================
interface Worker {
  id: string;
  status: 'idle' | 'busy' | 'error';
  currentJob?: string;
  processedJobs: number;
  errors: number;
  startedAt: Date;
}

export class WorkerPool {
  private workers: Map<string, Worker> = new Map();
  private taskQueue: Array<{ task: () => Promise<any>; resolve: (value: any) => void; reject: (error: any) => void }> = [];
  private events = new EventEmitter();
  private minWorkers: number;
  private maxWorkers: number;
  private idleTimeout: number;

  constructor(options: { min?: number; max?: number; idleTimeout?: number } = {}) {
    this.minWorkers = options.min || 2;
    this.maxWorkers = options.max || 10;
    this.idleTimeout = options.idleTimeout || 30000;

    // Initialize minimum workers
    for (let i = 0; i < this.minWorkers; i++) {
      this.createWorker();
    }
  }

  private createWorker(): Worker {
    const worker: Worker = {
      id: `worker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'idle',
      processedJobs: 0,
      errors: 0,
      startedAt: new Date()
    };

    this.workers.set(worker.id, worker);
    this.events.emit('worker:created', worker);
    this.processNext(worker);

    return worker;
  }

  private async processNext(worker: Worker): Promise<void> {
    if (this.taskQueue.length === 0) {
      worker.status = 'idle';

      // Remove excess workers after idle timeout
      if (this.workers.size > this.minWorkers) {
        setTimeout(() => {
          if (worker.status === 'idle' && this.workers.size > this.minWorkers) {
            this.workers.delete(worker.id);
            this.events.emit('worker:removed', worker);
          }
        }, this.idleTimeout);
      }

      return;
    }

    const { task, resolve, reject } = this.taskQueue.shift()!;
    worker.status = 'busy';
    worker.currentJob = `job_${Date.now()}`;

    try {
      const result = await task();
      worker.processedJobs++;
      resolve(result);
      this.events.emit('task:completed', { worker, result });
    } catch (error) {
      worker.errors++;
      reject(error);
      this.events.emit('task:error', { worker, error });
    } finally {
      worker.currentJob = undefined;
      this.processNext(worker);
    }
  }

  execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ task, resolve, reject });

      // Scale up if needed
      const busyWorkers = Array.from(this.workers.values()).filter(w => w.status === 'busy').length;
      if (busyWorkers === this.workers.size && this.workers.size < this.maxWorkers) {
        this.createWorker();
      }

      // Assign to idle worker
      const idleWorker = Array.from(this.workers.values()).find(w => w.status === 'idle');
      if (idleWorker) {
        this.processNext(idleWorker);
      }
    });
  }

  getStats(): {
    totalWorkers: number;
    busyWorkers: number;
    idleWorkers: number;
    queueLength: number;
    totalProcessed: number;
    totalErrors: number;
  } {
    const workers = Array.from(this.workers.values());
    return {
      totalWorkers: workers.length,
      busyWorkers: workers.filter(w => w.status === 'busy').length,
      idleWorkers: workers.filter(w => w.status === 'idle').length,
      queueLength: this.taskQueue.length,
      totalProcessed: workers.reduce((sum, w) => sum + w.processedJobs, 0),
      totalErrors: workers.reduce((sum, w) => sum + w.errors, 0)
    };
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }

  async shutdown(): Promise<void> {
    // Wait for all tasks to complete
    while (this.taskQueue.length > 0 || Array.from(this.workers.values()).some(w => w.status === 'busy')) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    this.workers.clear();
  }
}

// ============================================
// 344. Priority Queue
// ============================================
interface PriorityQueueItem<T> {
  item: T;
  priority: number;
}

export class PriorityQueue<T> {
  private items: PriorityQueueItem<T>[] = [];

  enqueue(item: T, priority: number = 0): void {
    const queueItem: PriorityQueueItem<T> = { item, priority };

    // Find position based on priority (higher priority = earlier in queue)
    const index = this.items.findIndex(i => i.priority < priority);
    if (index === -1) {
      this.items.push(queueItem);
    } else {
      this.items.splice(index, 0, queueItem);
    }
  }

  dequeue(): T | undefined {
    return this.items.shift()?.item;
  }

  peek(): T | undefined {
    return this.items[0]?.item;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }

  toArray(): T[] {
    return this.items.map(i => i.item);
  }
}

// ============================================
// 345. Batch Processor
// ============================================
interface BatchConfig<T> {
  maxSize: number;
  maxWait: number;
  processor: (items: T[]) => Promise<void>;
}

export class BatchProcessor<T> {
  private batch: T[] = [];
  private timeout: NodeJS.Timeout | null = null;
  private config: BatchConfig<T>;
  private events = new EventEmitter();

  constructor(config: BatchConfig<T>) {
    this.config = config;
  }

  add(item: T): void {
    this.batch.push(item);

    if (this.batch.length >= this.config.maxSize) {
      this.flush();
    } else if (!this.timeout) {
      this.timeout = setTimeout(() => this.flush(), this.config.maxWait);
    }
  }

  async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    const items = [...this.batch];
    this.batch = [];

    try {
      this.events.emit('batch:processing', { count: items.length });
      await this.config.processor(items);
      this.events.emit('batch:completed', { count: items.length });
    } catch (error) {
      this.events.emit('batch:error', { count: items.length, error });
    }
  }

  size(): number {
    return this.batch.length;
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 346. Rate-Limited Task Executor
// ============================================
export class RateLimitedExecutor {
  private queue: Array<{ task: () => Promise<any>; resolve: (value: any) => void; reject: (error: any) => void }> = [];
  private tokensPerSecond: number;
  private tokens: number;
  private lastRefill: number;
  private processing = false;

  constructor(tokensPerSecond: number) {
    this.tokensPerSecond = tokensPerSecond;
    this.tokens = tokensPerSecond;
    this.lastRefill = Date.now();
  }

  execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      this.refillTokens();

      if (this.tokens < 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 / this.tokensPerSecond));
        continue;
      }

      this.tokens--;
      const { task, resolve, reject } = this.queue.shift()!;

      try {
        const result = await task();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }

    this.processing = false;
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.tokensPerSecond, this.tokens + elapsed * this.tokensPerSecond);
    this.lastRefill = now;
  }
}

// ============================================
// 347. Retry Manager
// ============================================
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryOn?: (error: Error) => boolean;
}

export class RetryManager {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      maxRetries: config.maxRetries || 3,
      baseDelay: config.baseDelay || 1000,
      maxDelay: config.maxDelay || 30000,
      backoffMultiplier: config.backoffMultiplier || 2,
      retryOn: config.retryOn
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt === this.config.maxRetries) {
          throw lastError;
        }

        if (this.config.retryOn && !this.config.retryOn(lastError)) {
          throw lastError;
        }

        const delay = Math.min(
          this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt),
          this.config.maxDelay
        );

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }
}

// ============================================
// 348. Dead Letter Queue
// ============================================
interface DeadLetterEntry<T> {
  id: string;
  originalJob: T;
  error: string;
  failedAt: Date;
  attempts: number;
  metadata?: Record<string, any>;
}

export class DeadLetterQueue<T> {
  private entries: Map<string, DeadLetterEntry<T>> = new Map();
  private events = new EventEmitter();

  add(job: T, error: Error, attempts: number, metadata?: Record<string, any>): string {
    const id = `dlq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const entry: DeadLetterEntry<T> = {
      id,
      originalJob: job,
      error: error.message,
      failedAt: new Date(),
      attempts,
      metadata
    };

    this.entries.set(id, entry);
    this.events.emit('entry:added', entry);

    return id;
  }

  get(id: string): DeadLetterEntry<T> | undefined {
    return this.entries.get(id);
  }

  getAll(): DeadLetterEntry<T>[] {
    return Array.from(this.entries.values());
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }

  replay(id: string, handler: (job: T) => Promise<void>): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) {
      return Promise.reject(new Error('Entry not found'));
    }

    return handler(entry.originalJob).then(() => {
      this.remove(id);
    });
  }

  replayAll(handler: (job: T) => Promise<void>): Promise<{ success: number; failed: number }> {
    return Promise.all(
      Array.from(this.entries.values()).map(async entry => {
        try {
          await handler(entry.originalJob);
          this.remove(entry.id);
          return true;
        } catch {
          return false;
        }
      })
    ).then(results => ({
      success: results.filter(r => r).length,
      failed: results.filter(r => !r).length
    }));
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 349-360: Additional Job/Worker Utilities
// ============================================

// 349. Job Dependencies
export class JobDependencyManager {
  private dependencies: Map<string, Set<string>> = new Map();
  private completed: Set<string> = new Set();

  addDependency(jobId: string, dependsOn: string): void {
    if (!this.dependencies.has(jobId)) {
      this.dependencies.set(jobId, new Set());
    }
    this.dependencies.get(jobId)!.add(dependsOn);
  }

  markCompleted(jobId: string): void {
    this.completed.add(jobId);
  }

  canRun(jobId: string): boolean {
    const deps = this.dependencies.get(jobId);
    if (!deps || deps.size === 0) return true;

    for (const dep of deps) {
      if (!this.completed.has(dep)) return false;
    }
    return true;
  }

  getPendingDependencies(jobId: string): string[] {
    const deps = this.dependencies.get(jobId);
    if (!deps) return [];

    return Array.from(deps).filter(d => !this.completed.has(d));
  }

  clear(): void {
    this.dependencies.clear();
    this.completed.clear();
  }
}

// 350. Job Throttling
export class JobThrottler {
  private running: Map<string, number> = new Map();
  private limits: Map<string, number> = new Map();

  setLimit(jobType: string, limit: number): void {
    this.limits.set(jobType, limit);
  }

  canStart(jobType: string): boolean {
    const limit = this.limits.get(jobType) || Infinity;
    const running = this.running.get(jobType) || 0;
    return running < limit;
  }

  start(jobType: string): void {
    this.running.set(jobType, (this.running.get(jobType) || 0) + 1);
  }

  complete(jobType: string): void {
    const current = this.running.get(jobType) || 0;
    this.running.set(jobType, Math.max(0, current - 1));
  }

  getStats(): { type: string; running: number; limit: number }[] {
    return Array.from(this.limits.entries()).map(([type, limit]) => ({
      type,
      running: this.running.get(type) || 0,
      limit
    }));
  }
}

// 351. Job Progress Tracker
export class JobProgressTracker {
  private progress: Map<string, { percent: number; message?: string; updatedAt: Date }> = new Map();
  private events = new EventEmitter();

  update(jobId: string, percent: number, message?: string): void {
    this.progress.set(jobId, {
      percent: Math.max(0, Math.min(100, percent)),
      message,
      updatedAt: new Date()
    });
    this.events.emit('progress', { jobId, percent, message });
  }

  get(jobId: string): { percent: number; message?: string; updatedAt: Date } | undefined {
    return this.progress.get(jobId);
  }

  remove(jobId: string): void {
    this.progress.delete(jobId);
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// 352. Workflow Engine
interface WorkflowStep {
  id: string;
  name: string;
  handler: (context: any) => Promise<any>;
  onError?: 'fail' | 'continue' | 'retry';
  retries?: number;
}

export class WorkflowEngine {
  private workflows: Map<string, WorkflowStep[]> = new Map();
  private events = new EventEmitter();

  define(name: string, steps: WorkflowStep[]): void {
    this.workflows.set(name, steps);
  }

  async execute(name: string, initialContext: any = {}): Promise<any> {
    const steps = this.workflows.get(name);
    if (!steps) throw new Error(`Workflow ${name} not found`);

    let context = { ...initialContext };

    for (const step of steps) {
      this.events.emit('step:started', { workflow: name, step: step.name });

      try {
        const result = await step.handler(context);
        context = { ...context, [step.id]: result };
        this.events.emit('step:completed', { workflow: name, step: step.name, result });
      } catch (error) {
        this.events.emit('step:error', { workflow: name, step: step.name, error });

        if (step.onError === 'continue') {
          continue;
        } else if (step.onError === 'retry' && step.retries) {
          // Simple retry logic
          let retries = step.retries;
          while (retries > 0) {
            try {
              const result = await step.handler(context);
              context = { ...context, [step.id]: result };
              break;
            } catch {
              retries--;
              if (retries === 0) throw error;
              await new Promise(r => setTimeout(r, 1000));
            }
          }
        } else {
          throw error;
        }
      }
    }

    this.events.emit('workflow:completed', { workflow: name, context });
    return context;
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// 353. Async Generator for Large Jobs
export async function* processLargeDataset<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize: number = 100
): AsyncGenerator<R[], void, unknown> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(processor));
    yield results;
  }
}

// 354. Job Metrics Collector
export class JobMetricsCollector {
  private metrics: Map<string, {
    totalJobs: number;
    successfulJobs: number;
    failedJobs: number;
    totalDuration: number;
    minDuration: number;
    maxDuration: number;
  }> = new Map();

  recordStart(jobType: string): () => void {
    const startTime = Date.now();
    return () => this.recordComplete(jobType, startTime);
  }

  private recordComplete(jobType: string, startTime: number, success: boolean = true): void {
    const duration = Date.now() - startTime;
    let metrics = this.metrics.get(jobType);

    if (!metrics) {
      metrics = {
        totalJobs: 0,
        successfulJobs: 0,
        failedJobs: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0
      };
      this.metrics.set(jobType, metrics);
    }

    metrics.totalJobs++;
    if (success) {
      metrics.successfulJobs++;
    } else {
      metrics.failedJobs++;
    }
    metrics.totalDuration += duration;
    metrics.minDuration = Math.min(metrics.minDuration, duration);
    metrics.maxDuration = Math.max(metrics.maxDuration, duration);
  }

  recordFailure(jobType: string, startTime: number): void {
    this.recordComplete(jobType, startTime, false);
  }

  getMetrics(jobType: string): {
    totalJobs: number;
    successRate: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
  } | null {
    const metrics = this.metrics.get(jobType);
    if (!metrics) return null;

    return {
      totalJobs: metrics.totalJobs,
      successRate: metrics.totalJobs > 0 ? metrics.successfulJobs / metrics.totalJobs : 0,
      avgDuration: metrics.totalJobs > 0 ? metrics.totalDuration / metrics.totalJobs : 0,
      minDuration: metrics.minDuration === Infinity ? 0 : metrics.minDuration,
      maxDuration: metrics.maxDuration
    };
  }

  getAllMetrics(): Map<string, any> {
    const result = new Map();
    for (const [jobType] of this.metrics) {
      result.set(jobType, this.getMetrics(jobType));
    }
    return result;
  }
}

// 355-360: More utilities
// 355. Concurrent Task Limiter
export function createConcurrencyLimiter(maxConcurrent: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (running >= maxConcurrent) {
      await new Promise<void>(resolve => queue.push(resolve));
    }

    running++;
    try {
      return await fn();
    } finally {
      running--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

// 356. Job Chain Builder
export class JobChainBuilder<T = any> {
  private chain: Array<(input: any) => Promise<any>> = [];

  then<R>(fn: (input: T) => Promise<R>): JobChainBuilder<R> {
    this.chain.push(fn);
    return this as unknown as JobChainBuilder<R>;
  }

  async execute(initialValue: any): Promise<T> {
    let result = initialValue;
    for (const fn of this.chain) {
      result = await fn(result);
    }
    return result;
  }
}

// 357. Parallel Executor with Results
export async function executeParallel<T, R>(
  items: T[],
  executor: (item: T) => Promise<R>,
  options: { concurrency?: number; stopOnError?: boolean } = {}
): Promise<{ results: R[]; errors: Array<{ item: T; error: Error }> }> {
  const { concurrency = 5, stopOnError = false } = options;
  const results: R[] = [];
  const errors: Array<{ item: T; error: Error }> = [];
  const limiter = createConcurrencyLimiter(concurrency);

  await Promise.all(
    items.map(async (item, index) => {
      try {
        const result = await limiter(() => executor(item));
        results[index] = result;
      } catch (error) {
        errors.push({ item, error: error as Error });
        if (stopOnError) throw error;
      }
    })
  );

  return { results: results.filter(r => r !== undefined), errors };
}

// 358. Debounced Job Executor
export class DebouncedJobExecutor {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private delay: number;

  constructor(delay: number = 1000) {
    this.delay = delay;
  }

  execute(key: string, job: () => Promise<void>): void {
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
      this.timers.delete(key);
      await job();
    }, this.delay);

    this.timers.set(key, timer);
  }

  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  cancelAll(): void {
    for (const [key] of this.timers) {
      this.cancel(key);
    }
  }
}

// 359. Job Scheduler with Timezone Support
export function getNextRunTime(schedule: string, timezone: string = 'UTC'): Date {
  // Simple implementation for common schedules
  const now = new Date();
  const result = new Date(now);

  switch (schedule) {
    case 'hourly':
      result.setHours(result.getHours() + 1, 0, 0, 0);
      break;
    case 'daily':
      result.setDate(result.getDate() + 1);
      result.setHours(0, 0, 0, 0);
      break;
    case 'weekly':
      result.setDate(result.getDate() + (7 - result.getDay()));
      result.setHours(0, 0, 0, 0);
      break;
    case 'monthly':
      result.setMonth(result.getMonth() + 1, 1);
      result.setHours(0, 0, 0, 0);
      break;
    default:
      // Assume it's a time string like "14:30"
      const [hours, minutes] = schedule.split(':').map(Number);
      result.setHours(hours, minutes, 0, 0);
      if (result <= now) {
        result.setDate(result.getDate() + 1);
      }
  }

  return result;
}

// 360. Job State Machine
type JobState = 'created' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

const validTransitions: Record<JobState, JobState[]> = {
  created: ['queued', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'],
  completed: [],
  failed: ['queued'], // retry
  cancelled: []
};

export class JobStateMachine {
  private state: JobState;
  private events = new EventEmitter();

  constructor(initialState: JobState = 'created') {
    this.state = initialState;
  }

  transition(newState: JobState): boolean {
    const allowed = validTransitions[this.state];
    if (!allowed.includes(newState)) {
      return false;
    }

    const oldState = this.state;
    this.state = newState;
    this.events.emit('transition', { from: oldState, to: newState });
    return true;
  }

  getState(): JobState {
    return this.state;
  }

  canTransitionTo(state: JobState): boolean {
    return validTransitions[this.state].includes(state);
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// Export all types
export type {
  Job,
  JobStatus,
  JobOptions,
  JobHandler,
  ScheduledTask,
  Worker,
  BatchConfig,
  RetryConfig,
  DeadLetterEntry,
  WorkflowStep,
  JobState
};
