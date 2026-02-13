import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { queues, createQueue, QUEUE_NAMES } from './queueFactory';

export function setupBullBoard() {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/api/admin/queues');

    // Ensure all queues are registered (even those not explicitly used in API but exist in system)
    // For example, processing-queue might be used via FlowProducer, but we want to monitor it.
    if (!queues.has(QUEUE_NAMES.PROCESSING)) {
        createQueue(QUEUE_NAMES.PROCESSING);
    }

    const adapters = Array.from(queues.values()).map(queue => new BullMQAdapter(queue));

    createBullBoard({
        queues: adapters,
        serverAdapter,
    });

    return serverAdapter.getRouter();
}
