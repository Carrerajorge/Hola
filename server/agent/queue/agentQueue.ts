import { createQueue, createWorker, QUEUE_NAMES } from "../../lib/queueFactory";
import { agentManager } from "../agentOrchestrator";
import { agentModeRuns } from "@shared/schema";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { updateRunWithLock } from "../dbTransactions";
import type { AgentExecutionProfile } from "@shared/agentExecutionProfile";

export interface AgentJob {
    runId: string;
    chatId: string;
    userId: string | null;
    message: string;
    attachments?: any[];
    executionProfile?: AgentExecutionProfile;
    userPlan?: "free" | "pro" | "admin";
    modelId?: string;
}

// Create Queue
export const agentQueue = createQueue<AgentJob>(QUEUE_NAMES.AGENT_EXECUTION);

export async function processAgentExecutionJob(job: { data: AgentJob }): Promise<void> {
    const { runId, chatId, userId, message, attachments, executionProfile, userPlan, modelId } = job.data;

    console.log(`[AgentWorker] Processing run ${runId} for chat ${chatId}`);

    try {
        const [existingRun] = await db.select()
            .from(agentModeRuns)
            .where(eq(agentModeRuns.id, runId))
            .limit(1);

        const currentStatus = String(existingRun?.status || "queued");

        if (currentStatus !== "queued") {
            console.log(`[AgentWorker] Skipping run ${runId} because it is already ${currentStatus}`);
            return;
        }

        const lockResult = await updateRunWithLock(runId, "queued", {
            status: "planning",
            startedAt: existingRun?.startedAt || new Date(),
            error: null,
        });

        if (!lockResult.success) {
            console.warn(`[AgentWorker] Skipping run ${runId} because another process updated it first: ${lockResult.error}`);
            return;
        }

        await agentManager.executeRun(
            runId,
            chatId,
            userId,
            message,
            attachments,
            executionProfile,
            userPlan,
            modelId,
        );

        console.log(`[AgentWorker] Completed run ${runId}`);
    } catch (error: any) {
        console.error(`[AgentWorker] Failed run ${runId}:`, error);

        await db.update(agentModeRuns)
            .set({
                status: "failed",
                error: error.message
            })
            .where(eq(agentModeRuns.id, runId));

        throw error; // Let BullMQ handle retries
    }
}

export function createAgentExecutionWorker() {
    return createWorker<AgentJob, void>(QUEUE_NAMES.AGENT_EXECUTION, processAgentExecutionJob);
}
