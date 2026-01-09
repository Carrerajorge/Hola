import { RobustIntent, IntentResult } from "./robustIntentClassifier";
import { ContextSignals } from "./contextDetector";
import { ToolSelection, AGENT_REQUIRED_TOOLS, toolsIntersectAgentRequired } from "./toolSelector";

export type RouteType = "chat" | "agent";

export interface RobustRouteDecision {
  route: RouteType;
  intent: RobustIntent;
  confidence: number;
  tools: string[];
  reason: string;
  ruleApplied: string;
}

export function deterministicRoute(
  intentResult: IntentResult,
  context: ContextSignals,
  toolSelection: ToolSelection
): RobustRouteDecision {
  const { intent, confidence } = intentResult;
  const { tools, requiresAgent } = toolSelection;

  if (context.hasAttachments && (intent === "analysis" || intent === "artifact")) {
    return {
      route: "agent",
      intent,
      confidence: 1.0,
      tools,
      reason: "Archivo adjunto requiere procesamiento (lectura/análisis) por agente.",
      ruleApplied: "RULE_1_ATTACHMENT_ANALYSIS"
    };
  }

  if (intent === "analysis" && toolsIntersectAgentRequired(tools)) {
    return {
      route: "agent",
      intent,
      confidence: 0.9,
      tools,
      reason: "Intención de análisis activa herramientas de procesamiento; se enruta a agente.",
      ruleApplied: "RULE_2_ANALYSIS_TOOLS"
    };
  }

  if (intent === "artifact") {
    return {
      route: "agent",
      intent,
      confidence: 0.9,
      tools,
      reason: "Creación de artefactos (Word/Excel/PPT) requiere planificación y validación en agente.",
      ruleApplied: "RULE_3_ARTIFACT"
    };
  }

  if (intent === "nav" && context.hasUrls) {
    return {
      route: "agent",
      intent,
      confidence: 0.85,
      tools,
      reason: "Navegación con URLs detectadas requiere agente para browsing.",
      ruleApplied: "RULE_4_NAV_URLS"
    };
  }

  if (intent === "code") {
    return {
      route: "agent",
      intent,
      confidence: 0.85,
      tools,
      reason: "Solicitud de código requiere ejecución/análisis por agente.",
      ruleApplied: "RULE_5_CODE"
    };
  }

  if (intent === "automation") {
    return {
      route: "agent",
      intent,
      confidence: 0.85,
      tools,
      reason: "Automatización requiere planificación por agente.",
      ruleApplied: "RULE_6_AUTOMATION"
    };
  }

  if (confidence < 0.5) {
    return {
      route: "agent",
      intent,
      confidence: 0.7,
      tools,
      reason: "Baja confianza en clasificación; se enruta a agente por seguridad.",
      ruleApplied: "RULE_7_LOW_CONFIDENCE_FALLBACK"
    };
  }

  if (context.hasAttachments) {
    return {
      route: "agent",
      intent,
      confidence: 0.8,
      tools: [...tools, "file_read"],
      reason: "Adjuntos presentes requieren procesamiento por agente.",
      ruleApplied: "RULE_8_HAS_ATTACHMENTS"
    };
  }

  if (requiresAgent) {
    return {
      route: "agent",
      intent,
      confidence: 0.8,
      tools,
      reason: "Herramientas seleccionadas requieren agente.",
      ruleApplied: "RULE_9_REQUIRES_AGENT_TOOLS"
    };
  }

  return {
    route: "chat",
    intent,
    confidence: intent === "chat" ? 0.85 : 0.7,
    tools,
    reason: "Solicitud conversacional sin adjuntos ni procesamiento intensivo.",
    ruleApplied: "RULE_DEFAULT_CHAT"
  };
}

export class DeterministicRouter {
  route(
    intentResult: IntentResult,
    context: ContextSignals,
    toolSelection: ToolSelection
  ): RobustRouteDecision {
    const startTime = Date.now();
    const decision = deterministicRoute(intentResult, context, toolSelection);
    const duration = Date.now() - startTime;

    console.log(
      `[DeterministicRouter] Routed in ${duration}ms: ` +
      `route=${decision.route}, ` +
      `intent=${decision.intent}, ` +
      `confidence=${decision.confidence.toFixed(2)}, ` +
      `rule=${decision.ruleApplied}`
    );

    return decision;
  }
}
