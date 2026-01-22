import { Queue, Worker, QueueEvents, ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';

// Shared connection configuration
const connection: ConnectionOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
};

// Reuse the connection for all queues to avoid file descriptor limit issues
const sharedConnection = new IORedis(connection);

export const QUEUE_NAMES = {
    UPLOAD: 'upload-queue',
    PROCESSING: 'processing-queue',
};

// Registry for BullBoard
export const queues = new Map<string, Queue>();

/**
 * Creates a standard BullMQ Queue
 */
export function createQueue<T>(name: string) {
    const queue = new Queue<T>(name, {
        connection: sharedConnection,
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
export function createWorker<T, R>(name: string, processor: (job: any) => Promise<R>) {
    return new Worker<T, R>(name, processor, {
        connection: sharedConnection,
        concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
    });
}

/**
 * Creates a QueueEvents listener for monitoring
 */
export function createQueueEvents(name: string) {
    return new QueueEvents(name, {
        connection: sharedConnection,
    });
}
