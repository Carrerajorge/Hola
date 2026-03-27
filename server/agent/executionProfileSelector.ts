import {
  DEFAULT_AGENT_EXECUTION_PROFILE,
  type AgentExecutionProfile,
  normalizeAgentExecutionProfile,
} from "@shared/agentExecutionProfile";
import { complexityAnalyzer } from "../services/complexityAnalyzer";

export interface AgentExecutionProfileSelection {
  profile: AgentExecutionProfile;
  source: "requested" | "default" | "auto";
  reason?: string;
}

const LONG_RUNNING_DEVELOPMENT_PATTERN =
  /\b(programa|programar|software|aplicaci[oó]n|app|sitio web|website|landing page|frontend|backend|full[- ]?stack|api|arquitectura|architecture|microservicio|microservice|refactor|integraci[oó]n|integration|deploy|despliegue|producci[oó]n|ci\/cd|testing|infraestructura|infrastructure)\b/i;
const LONG_RUNNING_ORCHESTRATION_PATTERN =
  /\b(orquesta(?:r|e|ción)?|orchestrate|orchestration|tareas largas|larga duraci[oó]n|durante muchas horas|muchas horas|por horas|sin detenerse|sin parar|aut[oó]nomo|autonomous|completo|end-to-end|de principio a fin)\b/i;

export function selectAgentExecutionProfile(input: {
  requestedProfile?: unknown;
  message: string;
  hasAttachments?: boolean;
}): AgentExecutionProfileSelection {
  const requestedProfile = normalizeAgentExecutionProfile(input.requestedProfile);
  const explicitRequested = input.requestedProfile !== undefined && input.requestedProfile !== null;
  const trimmedMessage = String(input.message || "").trim();

  if (!trimmedMessage) {
    return {
      profile: requestedProfile,
      source: explicitRequested ? "requested" : "default",
    };
  }

  const complexity = complexityAnalyzer.analyze(trimmedMessage, Boolean(input.hasAttachments));
  const isDevelopmentScope = LONG_RUNNING_DEVELOPMENT_PATTERN.test(trimmedMessage);
  const requestsLongRunningOrchestration = LONG_RUNNING_ORCHESTRATION_PATTERN.test(trimmedMessage);
  const shouldAutoEscalate =
    requestedProfile === DEFAULT_AGENT_EXECUTION_PROFILE &&
    (
      (
        complexity.agent_required &&
        (complexity.category === "complex" || complexity.category === "architectural") &&
        (isDevelopmentScope || complexity.dimensions.steps_required >= 5 || complexity.dimensions.technical_depth >= 7)
      ) ||
      (isDevelopmentScope && requestsLongRunningOrchestration)
    );

  if (!shouldAutoEscalate) {
    return {
      profile: requestedProfile,
      source: explicitRequested ? "requested" : "default",
    };
  }

  const profile: AgentExecutionProfile =
    complexity.category === "architectural" ||
    complexity.score >= 9 ||
    /\b(saas|arquitectura|architecture|infraestructura|infrastructure|microservicio|microservice|escalable|producci[oó]n)\b/i.test(trimmedMessage)
      ? "marathon_24h"
      : "marathon_12h";

  return {
    profile,
    source: "auto",
    reason:
      complexity.agent_reason ||
      (requestsLongRunningOrchestration
        ? "Long-running orchestrated delivery requested"
        : "Long-running complex build task detected"),
  };
}
