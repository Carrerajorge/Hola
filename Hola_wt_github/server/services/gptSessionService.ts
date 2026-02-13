import { storage } from "../storage";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import {
  gptSessions,
  type Gpt,
  type GptKnowledge,
  type GptSession,
  type InsertGptSession,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface GptSessionContract {
  sessionId: string;
  gptId: string;
  configVersion: number;
  systemPrompt: string;
  enforcedModelId: string | null;
  modelFallbacks: string[];
  capabilities: {
    webBrowsing: boolean;
    codeInterpreter: boolean;
    imageGeneration: boolean;
    fileUpload: boolean;
    dataAnalysis: boolean;
  };
  toolPermissions: {
    mode: 'allowlist' | 'denylist';
    allowedTools: string[];
    actionsEnabled: boolean;
  };
  runtimePolicy?: {
    enforceModel: boolean;
    modelFallbacks: string[];
    maxTokensOverride?: number;
    temperatureOverride?: number;
    allowClientOverride: boolean;
  };
  knowledgeContext: string;
  temperature: number;
  topP: number;
  maxTokens: number;
}

const DEFAULT_CAPABILITIES = {
  webBrowsing: false,
  codeInterpreter: false,
  imageGeneration: false,
  fileUpload: false,
  dataAnalysis: false,
};

const DEFAULT_TOOL_PERMISSIONS = {
  mode: 'allowlist' as const,
  allowedTools: [] as string[],
  actionsEnabled: true,
};

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

function buildKnowledgeContext(knowledgeItems: GptKnowledge[]): string {
  const activeItems = knowledgeItems.filter(k => k.isActive === "true" && k.extractedText);
  if (activeItems.length === 0) return "";

  const contextParts = activeItems.map(item => {
    const header = `=== Knowledge: ${item.fileName} ===`;
    const content = item.extractedText || "";
    return `${header}\n${content}`;
  });

  return contextParts.join("\n\n");
}

function mapDbSessionToContract(session: GptSession, gpt: Gpt, knowledgeContext: string): GptSessionContract {
  const capabilities = session.frozenCapabilities || DEFAULT_CAPABILITIES;
  const toolPerms = session.frozenToolPermissions || { mode: 'allowlist' as const, tools: [], actionsEnabled: true };
  const runtimePolicy = session.frozenRuntimePolicy || { enforceModel: false, modelFallbacks: [], allowClientOverride: false };

  return {
    sessionId: session.id,
    gptId: session.gptId,
    configVersion: session.configVersion,
    systemPrompt: session.frozenSystemPrompt,
    enforcedModelId: session.enforcedModelId || null,
    modelFallbacks: runtimePolicy.modelFallbacks || [],
    capabilities: {
      webBrowsing: capabilities.webBrowsing ?? false,
      codeInterpreter: capabilities.codeInterpreter ?? false,
      imageGeneration: capabilities.imageGeneration ?? false,
      fileUpload: capabilities.fileUpload ?? false,
      dataAnalysis: capabilities.dataAnalysis ?? false,
    },
    toolPermissions: {
      mode: toolPerms.mode || 'allowlist',
      allowedTools: toolPerms.tools || [],
      actionsEnabled: toolPerms.actionsEnabled ?? true,
    },
    runtimePolicy: {
      enforceModel: runtimePolicy.enforceModel ?? false,
      modelFallbacks: runtimePolicy.modelFallbacks || [],
      maxTokensOverride: runtimePolicy.maxTokensOverride,
      temperatureOverride: runtimePolicy.temperatureOverride,
      allowClientOverride: runtimePolicy.allowClientOverride ?? false,
    },
    knowledgeContext,
    temperature: parseFloat(gpt.temperature || "0.7"),
    topP: parseFloat(gpt.topP || "1"),
    maxTokens: gpt.maxTokens || 4096,
  };
}

export async function createGptSession(chatId: string | null, gptId: string): Promise<GptSessionContract> {
  const gpt = await storage.getGpt(gptId);
  if (!gpt) {
    throw new Error(`GPT not found: ${gptId}`);
  }

  const knowledgeItems = await storage.getGptKnowledge(gptId);
  const knowledgeContext = buildKnowledgeContext(knowledgeItems);
  const knowledgeContextIds = knowledgeItems
    .filter(k => k.isActive === "true")
    .map(k => k.id);

  const capabilities = (gpt.capabilities as any) || DEFAULT_CAPABILITIES;
  const toolPermissions = gpt.toolPermissions || { mode: 'allowlist' as const, tools: [], actionsEnabled: true };
  const runtimePolicy = gpt.runtimePolicy || { enforceModel: false, modelFallbacks: [] };

  let enforcedModelId: string | null = null;
  if (runtimePolicy.enforceModel && gpt.recommendedModel) {
    enforcedModelId = gpt.recommendedModel;
  }

  const configVersion = gpt.version || 1;

  const sessionData: InsertGptSession = {
    chatId: chatId || null,
    gptId,
    configVersion,
    frozenSystemPrompt: gpt.systemPrompt,
    frozenCapabilities: {
      webBrowsing: capabilities.webBrowsing ?? false,
      codeInterpreter: capabilities.codeInterpreter ?? false,
      imageGeneration: capabilities.imageGeneration ?? false,
      fileUpload: capabilities.fileUpload ?? false,
      dataAnalysis: capabilities.dataAnalysis ?? false,
    },
    frozenToolPermissions: {
      mode: toolPermissions.mode || 'allowlist',
      tools: toolPermissions.tools || [],
      actionsEnabled: toolPermissions.actionsEnabled ?? true,
    },
    frozenRuntimePolicy: {
      enforceModel: runtimePolicy.enforceModel ?? false,
      modelFallbacks: runtimePolicy.modelFallbacks || [],
      maxTokensOverride: runtimePolicy.maxTokensOverride,
      temperatureOverride: runtimePolicy.temperatureOverride,
      allowClientOverride: runtimePolicy.allowClientOverride ?? false,
    },
    enforcedModelId,
    knowledgeContextIds,
  };

  const [insertedSession] = await db.insert(gptSessions).values(sessionData).returning();
  
  return mapDbSessionToContract(insertedSession, gpt, knowledgeContext);
}

export async function getOrCreateSession(chatId: string, gptId: string): Promise<GptSessionContract> {
  // If chatId is empty or invalid, always create a new session
  // The client should use session_id from response to reuse the session
  if (!chatId || chatId.trim() === "" || chatId.startsWith("pending-")) {
    return createGptSession(null, gptId);
  }

  // Try to find existing session for this chatId + gptId combination
  const [existingSession] = await db
    .select()
    .from(gptSessions)
    .where(and(eq(gptSessions.chatId, chatId), eq(gptSessions.gptId, gptId)));

  if (existingSession) {
    const gpt = await storage.getGpt(gptId);
    if (!gpt) {
      throw new Error(`GPT not found: ${gptId}`);
    }

    const knowledgeItems = await storage.getGptKnowledge(gptId);
    const knowledgeContext = buildKnowledgeContext(
      knowledgeItems.filter(k => existingSession.knowledgeContextIds?.includes(k.id))
    );

    return mapDbSessionToContract(existingSession, gpt, knowledgeContext);
  }

  return createGptSession(chatId, gptId);
}

export function isToolAllowed(contract: GptSessionContract, toolName: string): boolean {
  const { mode, allowedTools, actionsEnabled } = contract.toolPermissions;

  if (!actionsEnabled) {
    return false;
  }

  if (mode === 'allowlist') {
    if (allowedTools.length === 0) {
      return true;
    }
    return allowedTools.includes(toolName);
  }

  if (mode === 'denylist') {
    return !allowedTools.includes(toolName);
  }

  return true;
}

export function getEnforcedModel(contract: GptSessionContract, requestedModel?: string): string {
  const policy = contract.runtimePolicy;
  const enforceModel = policy?.enforceModel ?? false;
  const allowClientOverride = policy?.allowClientOverride ?? false;
  
  // When enforceModel is true and overrides are not allowed, backend is fully authoritative
  if (enforceModel && !allowClientOverride) {
    // Use enforced model if available
    if (contract.enforcedModelId) {
      return contract.enforcedModelId;
    }
    // Fall back to first allowed model
    if (contract.modelFallbacks.length > 0) {
      return contract.modelFallbacks[0];
    }
    // If no model specified in config, use safe default - do NOT allow client override
    return DEFAULT_MODEL;
  }
  
  // If client override is allowed OR enforcement is off
  if (requestedModel) {
    // If there are allowed models, validate the request
    if (contract.modelFallbacks.length > 0) {
      if (contract.modelFallbacks.includes(requestedModel)) {
        return requestedModel;
      }
      // Client model not in allowed list - use first allowed
      return contract.modelFallbacks[0];
    }
    // No restrictions - allow client model
    return requestedModel;
  }
  
  // No client request - use contract defaults
  return contract.enforcedModelId || contract.modelFallbacks[0] || DEFAULT_MODEL;
}

export function buildSystemPromptWithContext(contract: GptSessionContract): string {
  const parts: string[] = [];

  parts.push(contract.systemPrompt);

  const enabledCapabilities: string[] = [];
  if (contract.capabilities.webBrowsing) {
    enabledCapabilities.push("web browsing and search");
  }
  if (contract.capabilities.codeInterpreter) {
    enabledCapabilities.push("code interpretation and execution");
  }
  if (contract.capabilities.imageGeneration) {
    enabledCapabilities.push("image generation");
  }
  if (contract.capabilities.fileUpload) {
    enabledCapabilities.push("file upload handling");
  }
  if (contract.capabilities.dataAnalysis) {
    enabledCapabilities.push("data analysis");
  }

  if (enabledCapabilities.length > 0) {
    parts.push(`\n\n[Enabled Capabilities: ${enabledCapabilities.join(", ")}]`);
  }

  if (contract.knowledgeContext) {
    parts.push(`\n\n[Knowledge Base]\n${contract.knowledgeContext}`);
  }

  return parts.join("");
}

export async function getSessionByChatId(chatId: string): Promise<GptSession | null> {
  const [session] = await db
    .select()
    .from(gptSessions)
    .where(eq(gptSessions.chatId, chatId));
  
  return session || null;
}

export async function getSessionById(sessionId: string): Promise<GptSessionContract | null> {
  const [session] = await db
    .select()
    .from(gptSessions)
    .where(eq(gptSessions.id, sessionId))
    .limit(1);
  
  if (!session) return null;
  
  const gpt = await storage.getGpt(session.gptId);
  if (!gpt) return null;
  
  const knowledgeItems = await storage.getGptKnowledge(session.gptId);
  const knowledgeContext = buildKnowledgeContext(
    knowledgeItems.filter(k => session.knowledgeContextIds?.includes(k.id))
  );
  
  return mapDbSessionToContract(session, gpt, knowledgeContext);
}

export async function deleteSessionByChatId(chatId: string): Promise<void> {
  await db.delete(gptSessions).where(eq(gptSessions.chatId, chatId));
}
