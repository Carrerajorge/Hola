import { EventEmitter } from "events";
import { z } from "zod";
import { randomUUID } from "crypto";

export const DialogueStateSchema = z.enum([
  "idle",
  "preprocessing",
  "analyzing",
  "retrieving",
  "generating",
  "clarifying",
  "success",
  "fallback",
  "error_degraded",
  "timeout"
]);
export type DialogueState = z.infer<typeof DialogueStateSchema>;

export const DialogueActionSchema = z.enum([
  "ANSWER",
  "ASK_CLARIFICATION",
  "FALLBACK_KB",
  "FALLBACK_GENERIC",
  "DEGRADED_TIMEOUT",
  "ESCALATE_HUMAN",
  "RETRY_SUGGESTION"
]);
export type DialogueAction = z.infer<typeof DialogueActionSchema>;

export const ErrorCodeSchema = z.enum([
  "NONE",
  "TIMEOUT_PREPROCESS",
  "TIMEOUT_NLU",
  "TIMEOUT_RETRIEVAL",
  "TIMEOUT_GENERATION",
  "UPSTREAM_429",
  "UPSTREAM_5XX",
  "EMPTY_RETRIEVAL",
  "LOW_CONFIDENCE",
  "GARBAGE_INPUT",
  "CIRCUIT_OPEN",
  "RATE_LIMITED"
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const DialogueContextSchema = z.object({
  sessionId: z.string(),
  requestId: z.string(),
  userId: z.string().optional(),
  turnCount: z.number().default(0),
  lastIntent: z.string().optional(),
  confirmedSlots: z.record(z.any()).default({}),
  pendingClarification: z.boolean().default(false),
  clarificationAttempts: z.number().default(0)
});
export type DialogueContext = z.infer<typeof DialogueContextSchema>;

export const TransitionEventSchema = z.object({
  fromState: DialogueStateSchema,
  toState: DialogueStateSchema,
  trigger: z.string(),
  timestamp: z.number(),
  metadata: z.record(z.any()).optional()
});
export type TransitionEvent = z.infer<typeof TransitionEventSchema>;

const VALID_TRANSITIONS: Record<DialogueState, DialogueState[]> = {
  idle: ["preprocessing", "error_degraded"],
  preprocessing: ["analyzing", "error_degraded", "timeout"],
  analyzing: ["retrieving", "generating", "clarifying", "fallback", "error_degraded", "timeout"],
  retrieving: ["generating", "clarifying", "fallback", "error_degraded", "timeout"],
  generating: ["success", "clarifying", "fallback", "error_degraded", "timeout"],
  clarifying: ["idle", "analyzing", "fallback", "timeout"],
  success: ["idle"],
  fallback: ["idle", "success"],
  error_degraded: ["idle"],
  timeout: ["idle", "fallback"]
};

const STATE_DESCRIPTIONS: Record<DialogueState, string> = {
  idle: "Esperando mensaje del usuario",
  preprocessing: "Normalizando y validando entrada",
  analyzing: "Analizando intenci\u00f3n y extrayendo entidades",
  retrieving: "Buscando informaci\u00f3n relevante",
  generating: "Generando respuesta",
  clarifying: "Pidiendo aclaraci\u00f3n al usuario",
  success: "Respuesta entregada exitosamente",
  fallback: "Usando respuesta de respaldo",
  error_degraded: "Error - modo degradado",
  timeout: "Tiempo de espera agotado"
};

interface FSMConfig {
  maxClarificationAttempts: number;
  confidenceThresholdOk: number;
  confidenceThresholdClarify: number;
}

const DEFAULT_FSM_CONFIG: FSMConfig = {
  maxClarificationAttempts: 3,
  confidenceThresholdOk: 0.70,
  confidenceThresholdClarify: 0.40
};

export class DialogueManager extends EventEmitter {
  private state: DialogueState = "idle";
  private context: DialogueContext;
  private history: TransitionEvent[] = [];
  private config: FSMConfig;
  private stateEnteredAt: number = Date.now();

  constructor(sessionId: string, config?: Partial<FSMConfig>) {
    super();
    this.config = { ...DEFAULT_FSM_CONFIG, ...config };
    this.context = {
      sessionId,
      requestId: randomUUID(),
      turnCount: 0,
      confirmedSlots: {},
      pendingClarification: false,
      clarificationAttempts: 0
    };
    this.setMaxListeners(50);
  }

  getState(): DialogueState {
    return this.state;
  }

  getContext(): DialogueContext {
    return { ...this.context };
  }

  getStateDescription(): string {
    return STATE_DESCRIPTIONS[this.state];
  }

  getStateDurationMs(): number {
    return Date.now() - this.stateEnteredAt;
  }

  canTransitionTo(targetState: DialogueState): boolean {
    const validTargets = VALID_TRANSITIONS[this.state];
    return validTargets.includes(targetState);
  }

  transition(targetState: DialogueState, trigger: string, metadata?: Record<string, any>): boolean {
    if (!this.canTransitionTo(targetState)) {
      this.emit("invalid_transition", {
        from: this.state,
        to: targetState,
        trigger,
        validTargets: VALID_TRANSITIONS[this.state]
      });
      console.warn(`[DialogueManager] Invalid transition: ${this.state} -> ${targetState} (trigger: ${trigger})`);
      return false;
    }

    const event: TransitionEvent = {
      fromState: this.state,
      toState: targetState,
      trigger,
      timestamp: Date.now(),
      metadata
    };

    this.history.push(event);
    const previousState = this.state;
    this.state = targetState;
    this.stateEnteredAt = Date.now();

    this.emit("state_changed", {
      previousState,
      currentState: this.state,
      trigger,
      metadata
    });

    console.log(`[DialogueManager] ${previousState} -> ${this.state} (${trigger})`);
    return true;
  }

  startNewTurn(requestId?: string): void {
    this.context.requestId = requestId || randomUUID();
    this.context.turnCount++;
    if (this.state !== "idle") {
      this.transition("idle", "new_turn_reset");
    }
    this.transition("preprocessing", "message_received");
  }

  handleConfidence(confidence: number, intent?: string): DialogueAction {
    this.context.lastIntent = intent;

    if (confidence >= this.config.confidenceThresholdOk) {
      return "ANSWER";
    }

    if (confidence >= this.config.confidenceThresholdClarify) {
      if (this.context.clarificationAttempts < this.config.maxClarificationAttempts) {
        this.context.pendingClarification = true;
        this.context.clarificationAttempts++;
        this.transition("clarifying", "low_confidence", { confidence, intent });
        return "ASK_CLARIFICATION";
      }
    }

    this.transition("fallback", "very_low_confidence", { confidence, intent });
    return "FALLBACK_GENERIC";
  }

  handleTimeout(stage: string): DialogueAction {
    this.transition("timeout", `timeout_${stage}`, { stage });
    return "DEGRADED_TIMEOUT";
  }

  handleError(errorCode: ErrorCode, message?: string): DialogueAction {
    this.transition("error_degraded", `error_${errorCode}`, { errorCode, message });
    
    if (errorCode === "EMPTY_RETRIEVAL") {
      return "FALLBACK_KB";
    }
    if (errorCode === "UPSTREAM_429" || errorCode === "UPSTREAM_5XX") {
      return "RETRY_SUGGESTION";
    }
    return "FALLBACK_GENERIC";
  }

  handleSuccess(): void {
    this.context.pendingClarification = false;
    this.transition("success", "response_delivered");
  }

  resetClarificationAttempts(): void {
    this.context.clarificationAttempts = 0;
    this.context.pendingClarification = false;
  }

  updateSlot(key: string, value: any): void {
    this.context.confirmedSlots[key] = value;
    this.emit("slot_updated", { key, value });
  }

  getSlot(key: string): any {
    return this.context.confirmedSlots[key];
  }

  clearSlots(): void {
    this.context.confirmedSlots = {};
  }

  getTransitionHistory(): TransitionEvent[] {
    return [...this.history];
  }

  getMetrics(): Record<string, any> {
    return {
      sessionId: this.context.sessionId,
      currentState: this.state,
      turnCount: this.context.turnCount,
      clarificationAttempts: this.context.clarificationAttempts,
      slotsCount: Object.keys(this.context.confirmedSlots).length,
      transitionCount: this.history.length,
      stateDurationMs: this.getStateDurationMs()
    };
  }

  reset(): void {
    this.state = "idle";
    this.context = {
      sessionId: this.context.sessionId,
      requestId: randomUUID(),
      turnCount: 0,
      confirmedSlots: {},
      pendingClarification: false,
      clarificationAttempts: 0
    };
    this.history = [];
    this.stateEnteredAt = Date.now();
  }
}

const dialogueManagers = new Map<string, DialogueManager>();

export function getDialogueManager(sessionId: string): DialogueManager {
  let manager = dialogueManagers.get(sessionId);
  if (!manager) {
    manager = new DialogueManager(sessionId);
    dialogueManagers.set(sessionId, manager);
  }
  return manager;
}

export function clearDialogueManager(sessionId: string): void {
  dialogueManagers.delete(sessionId);
}

export function getAllDialogueMetrics(): Record<string, any>[] {
  return Array.from(dialogueManagers.values()).map(m => m.getMetrics());
}
