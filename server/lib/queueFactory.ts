import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';

// Shared connection configuration - only connect if Redis is available
const REDIS_URL = process.env.REDIS_URL;
const connectionOpts: RedisOptions | null = REDIS_URL ? {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
} : null;

// Lazy connection - only create when needed and if Redis is configured
let sharedConnection: IORedis | null = null;
function getConnection(): IORedis | null {
    if (!connectionOpts) {
        console.warn('[QueueFactory] No REDIS_URL configured, queues disabled');
        return null;
    }
    if (!sharedConnection) {
        sharedConnection = new IORedis(connectionOpts);
        sharedConnection.on('error', (err) => console.warn('[QueueFactory] Redis error:', err.message));
    }
    return sharedConnection;
}

export const QUEUE_NAMES = {
    UPLOAD: 'upload-queue',
    PROCESSING: 'processing-queue',
};

// Registry for BullBoard
export const queues = new Map<string, Queue>();

/**
 * Creates a standard BullMQ Queue
 */
export function createQueue<T>(name: string): Queue<T> | null {
    const conn = getConnection();
    if (!conn) return null;

    const queue = new Queue<T>(name, {
        connection: conn,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 1000,
            },
            removeOnComplete: {
                age: 24 * 3600, // Keep for 24 hours
                count: 1000,
            },
            removeOnFail: {
                age: 7 * 24 * 3600, // Keep for 7 days
            }
        },
    });

    queues.set(name, queue);
    return queue;
}

/**
 * Creates a standard BullMQ Worker
 */
export function createWorker<T, R>(name: string, processor: (job: any) => Promise<R>): Worker<T, R> | null {
    const conn = getConnection();
    if (!conn) return null;

    return new Worker<T, R>(name, processor, {
        connection: conn,
        concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
    });
}

/**
 * Creates a QueueEvents listener for monitoring
 */
export function createQueueEvents(name: string): QueueEvents | null {
    const conn = getConnection();
    if (!conn) return null;

    return new QueueEvents(name, {
        connection: conn,
    });
}
