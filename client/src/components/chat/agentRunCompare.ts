import { type AgentRunData } from "@/hooks/use-chats";

function normalizeAgentRunSteps(agentRun?: AgentRunData | null): string {
  if (!agentRun?.steps?.length) return "";

  return agentRun.steps
    .map((step) =>
      [
        step.stepIndex,
        step.toolName,
        step.status,
        step.error || "",
        step.startedAt || "",
        step.completedAt || "",
      ].join(":"),
    )
    .join("|");
}

export function areAgentRunsEqual(
  previous?: AgentRunData | null,
  next?: AgentRunData | null,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;

  return (
    previous.runId === next.runId &&
    previous.status === next.status &&
    previous.summary === next.summary &&
    previous.error === next.error &&
    previous.userMessage === next.userMessage &&
    previous.eventStream.length === next.eventStream.length &&
    normalizeAgentRunSteps(previous) === normalizeAgentRunSteps(next)
  );
}
