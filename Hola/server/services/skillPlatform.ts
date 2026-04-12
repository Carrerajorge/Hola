/**
 * Skill Platform Service
 * Provides skill execution routing and management.
 */

import type { SkillScope } from "@shared/schema/skillPlatform";

export interface SkillExecutionResult {
  status: "ok" | "partial" | "blocked" | "failed";
  continueWithModel: boolean;
  outputText: string;
  autoCreated: boolean;
  requiresConfirmation: boolean;
  traces: Array<{ stage: string; status: string; message: string; details?: Record<string, unknown> }>;
  fallbackText?: string;
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
  output?: unknown;
  policyBreached?: {
    blockedScopes: string[];
  };
  selectedSkill?: {
    slug: string;
    name?: string;
  };
}

export interface SkillExecutionRequest {
  requestId: string;
  conversationId: string;
  runId: string;
  userId: string;
  userMessage: string;
  attachments: Array<unknown>;
  allowedScopes: SkillScope[];
  autoCreate?: boolean;
  maxRetries?: number;
  emitTrace?: (trace: { stage: string; status: string; message: string; details?: Record<string, unknown> }) => void;
  now?: Date;
}

export interface SkillPlatformService {
  executeFromMessage(request: SkillExecutionRequest): Promise<SkillExecutionResult>;
}

class DefaultSkillPlatformService implements SkillPlatformService {
  async executeFromMessage(request: SkillExecutionRequest): Promise<SkillExecutionResult> {
    return {
      status: "ok",
      continueWithModel: true,
      outputText: "",
      autoCreated: false,
      requiresConfirmation: false,
      traces: [],
    };
  }
}

let _instance: SkillPlatformService | null = null;

export function getSkillPlatformService(): SkillPlatformService {
  if (!_instance) {
    _instance = new DefaultSkillPlatformService();
  }
  return _instance;
}
