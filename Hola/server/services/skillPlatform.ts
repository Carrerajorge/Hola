/**
 * Skill Platform Service
 *
 * Provides a lightweight skill execution layer that can route user messages
 * to matching skills before (or instead of) sending them to the LLM.
 */

import type { SkillScope } from "@shared/schema/skillPlatform";
import { Logger } from "../lib/logger";

export interface SkillExecutionRequest {
  requestId: string;
  conversationId: string;
  runId: string;
  userId: string;
  userMessage: string;
  attachments?: Array<{ type: string; url?: string; name?: string }>;
  allowedScopes?: SkillScope[];
  autoCreate?: boolean;
  maxRetries?: number;
  emitTrace?: (trace: { stage: string; status: string; message: string; details?: Record<string, unknown> }) => void;
  now?: Date;
}

export interface SkillExecutionResult {
  status: "ok" | "partial" | "blocked" | "failed" | "skipped";
  outputText: string;
  fallbackText?: string;
  continueWithModel: boolean;
  autoCreated?: boolean;
  requiresConfirmation?: boolean;
  selectedSkill?: { slug: string; name?: string } | null;
  error?: { code: string; message: string };
  policyBreached?: { blockedScopes: string[] };
}

class SkillPlatformService {
  /**
   * Attempt to execute a skill that matches the user message.
   * Returns a result indicating whether the skill handled the request
   * or the LLM should take over.
   */
  async executeFromMessage(request: SkillExecutionRequest): Promise<SkillExecutionResult> {
    const { emitTrace } = request;

    try {
      // For now, the skill platform is a pass-through that always defers to the model.
      // This provides the interface for future skill routing without blocking the chat flow.
      emitTrace?.({
        stage: "planner",
        status: "ok",
        message: "no_matching_skill",
        details: { reason: "skill_platform_passthrough" },
      });

      return {
        status: "skipped",
        outputText: "",
        continueWithModel: true,
        selectedSkill: null,
      };
    } catch (err: any) {
      Logger.warn("[SkillPlatform] executeFromMessage error", {
        requestId: request.requestId,
        error: err?.message || err,
      });

      return {
        status: "failed",
        outputText: "",
        continueWithModel: true,
        error: { code: "SKILL_ERROR", message: err?.message || "Unknown skill error" },
      };
    }
  }
}

let _instance: SkillPlatformService | null = null;

export function getSkillPlatformService(): SkillPlatformService {
  if (!_instance) {
    _instance = new SkillPlatformService();
  }
  return _instance;
}
