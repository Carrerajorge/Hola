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
import { DEFAULT_GPT_CAPABILITIES, normalizeGptCapabilities } from "../lib/gptCapabilities";

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
    canvas: boolean;
    wordCreation: boolean;
    excelCreation: boolean;
    pptCreation: boolean;
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

interface ResolvedGptRuntimeConfig {
  systemPrompt: string;
  capabilities: {
    webBrowsing: boolean;
    codeInterpreter: boolean;
    imageGeneration: boolean;
    fileUpload: boolean;
    dataAnalysis: boolean;
    canvas: boolean;
    wordCreation: boolean;
    excelCreation: boolean;
    pptCreation: boolean;
  };
  toolPermissions: {
    mode: 'allowlist' | 'denylist';
    tools: string[];
    actionsEnabled: boolean;
  };
  runtimePolicy: {
    enforceModel: boolean;
    modelFallbacks: string[];
    maxTokensOverride?: number;
    temperatureOverride?: number;
    allowClientOverride: boolean;
  };
  preferredModel: string | null;
  temperature: number;
  topP: number;
  maxTokens: number;
}

const DEFAULT_CAPABILITIES = DEFAULT_GPT_CAPABILITIES;

const DEFAULT_TOOL_PERMISSIONS = {
  mode: 'allowlist' as const,
  tools: [] as string[],
  actionsEnabled: true,
};

const DEFAULT_RUNTIME_POLICY = {
  enforceModel: false,
  modelFallbacks: [] as string[],
  allowClientOverride: false,
};

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_TOP_P = 1;
const DEFAULT_MAX_TOKENS = 4096;
let missingGptSessionsRelationWarned = false;

function isMissingGptSessionsRelationError(error: unknown): boolean {
  const asAny = error as any;
  const code = asAny?.code || asAny?.cause?.code;
  const message = String(asAny?.message || "");
  const causeMessage = String(asAny?.cause?.message || "");
  return code === "42P01" || message.includes("gpt_sessions") || causeMessage.includes("gpt_sessions");
}

function warnMissingGptSessionsRelationOnce(): void {
  if (missingGptSessionsRelationWarned) return;
  missingGptSessionsRelationWarned = true;
  console.warn("[GPTSession] gpt_sessions relation is unavailable. Falling back to chat metadata only.");
}

async function resolveGptReference(gptRef: string): Promise<{ id: string; gpt: Gpt }> {
  const normalizedRef = typeof gptRef === "string" ? gptRef.trim() : "";
  if (!normalizedRef) {
    throw new Error("GPT reference is empty");
  }

  let gpt = await storage.getGpt(normalizedRef);
  if (!gpt) {
    gpt = await storage.getGptBySlug(normalizedRef);
  }

  if (!gpt) {
    throw new Error(`GPT not found: ${gptRef}`);
  }

  return { id: gpt.id, gpt };
}

function parseNumber(value: unknown, fallback: number): number;
function parseNumber(value: unknown, fallback: undefined): number | undefined;
function parseNumber(value: unknown, fallback: number | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

function toRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function normalizeToolPermissions(value: unknown): ResolvedGptRuntimeConfig["toolPermissions"] {
  const source = toRecord(value) ?? {};
  return {
    mode: source.mode === "denylist" ? "denylist" : DEFAULT_TOOL_PERMISSIONS.mode,
    tools: Array.isArray(source.tools) ? source.tools.filter((tool) => typeof tool === "string") : DEFAULT_TOOL_PERMISSIONS.tools,
    actionsEnabled: parseBoolean(source.actionsEnabled, DEFAULT_TOOL_PERMISSIONS.actionsEnabled),
  };
}

function normalizeRuntimePolicy(value: unknown): ResolvedGptRuntimeConfig["runtimePolicy"] {
  const source = toRecord(value) ?? {};
  return {
    enforceModel: parseBoolean(source.enforceModel, DEFAULT_RUNTIME_POLICY.enforceModel),
    modelFallbacks: Array.isArray(source.modelFallbacks) ? source.modelFallbacks.filter((name) => typeof name === "string") : DEFAULT_RUNTIME_POLICY.modelFallbacks,
    maxTokensOverride: parseNumber(source.maxTokensOverride, undefined),
    temperatureOverride: parseNumber(source.temperatureOverride, undefined),
    allowClientOverride: parseBoolean(source.allowClientOverride, DEFAULT_RUNTIME_POLICY.allowClientOverride),
  };
}

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

function buildFrozenCapabilities(capabilities: ResolvedGptRuntimeConfig["capabilities"]) {
  return {
    webBrowsing: capabilities.webBrowsing ?? false,
    codeInterpreter: capabilities.codeInterpreter ?? false,
    imageGeneration: capabilities.imageGeneration ?? false,
    fileUpload: capabilities.fileUpload ?? false,
    dataAnalysis: capabilities.dataAnalysis ?? false,
    canvas: capabilities.canvas ?? false,
    wordCreation: capabilities.wordCreation ?? false,
    excelCreation: capabilities.excelCreation ?? false,
    pptCreation: capabilities.pptCreation ?? false,
  };
}

function buildFrozenToolPermissions(toolPermissions: ResolvedGptRuntimeConfig["toolPermissions"]) {
  return {
    mode: toolPermissions.mode || "allowlist",
    tools: toolPermissions.tools || [],
    actionsEnabled: toolPermissions.actionsEnabled ?? true,
  };
}

function buildFrozenRuntimePolicy(runtimePolicy: ResolvedGptRuntimeConfig["runtimePolicy"]) {
  return {
    enforceModel: runtimePolicy.enforceModel ?? false,
    modelFallbacks: runtimePolicy.modelFallbacks || [],
    maxTokensOverride: runtimePolicy.maxTokensOverride,
    temperatureOverride: runtimePolicy.temperatureOverride,
    allowClientOverride: runtimePolicy.allowClientOverride ?? false,
  };
}

async function refreshSessionSnapshotIfNeeded(
  session: GptSession,
  gpt: Gpt,
): Promise<{ session: GptSession; runtimeConfig: ResolvedGptRuntimeConfig; knowledgeItems: GptKnowledge[] }> {
  const latestConfigVersion = parseNumber(gpt.version, session.configVersion) || session.configVersion;
  const latestRuntimeConfig = await resolveGptRuntimeConfig(gpt, latestConfigVersion);
  const latestKnowledgeItems = await storage.getGptKnowledge(session.gptId);
  const latestKnowledgeContextIds = latestKnowledgeItems
    .filter(k => k.isActive === "true")
    .map(k => k.id);

  const nextFrozenCapabilities = buildFrozenCapabilities(latestRuntimeConfig.capabilities);
  const nextFrozenToolPermissions = buildFrozenToolPermissions(latestRuntimeConfig.toolPermissions);
  const nextFrozenRuntimePolicy = buildFrozenRuntimePolicy(latestRuntimeConfig.runtimePolicy);
  const currentKnowledgeIdsSorted = [...(session.knowledgeContextIds || [])].sort();
  const nextKnowledgeIdsSorted = [...latestKnowledgeContextIds].sort();
  const needsRefresh =
    latestConfigVersion !== session.configVersion ||
    session.frozenSystemPrompt !== latestRuntimeConfig.systemPrompt ||
    JSON.stringify(session.frozenCapabilities || {}) !== JSON.stringify(nextFrozenCapabilities) ||
    JSON.stringify(session.frozenToolPermissions || {}) !== JSON.stringify(nextFrozenToolPermissions) ||
    JSON.stringify(session.frozenRuntimePolicy || {}) !== JSON.stringify(nextFrozenRuntimePolicy) ||
    JSON.stringify(currentKnowledgeIdsSorted) !== JSON.stringify(nextKnowledgeIdsSorted);

  if (!needsRefresh) {
    return {
      session,
      runtimeConfig: latestRuntimeConfig,
      knowledgeItems: latestKnowledgeItems,
    };
  }

  const enforcedModelId =
    latestRuntimeConfig.runtimePolicy.enforceModel
      ? (latestRuntimeConfig.preferredModel || latestRuntimeConfig.runtimePolicy.modelFallbacks[0] || DEFAULT_MODEL)
      : null;

  const [updatedSession] = await db
    .update(gptSessions)
    .set({
      configVersion: latestConfigVersion,
      frozenSystemPrompt: latestRuntimeConfig.systemPrompt,
      frozenCapabilities: nextFrozenCapabilities,
      frozenToolPermissions: nextFrozenToolPermissions,
      frozenRuntimePolicy: nextFrozenRuntimePolicy,
      enforcedModelId,
      knowledgeContextIds: latestKnowledgeContextIds,
    })
    .where(eq(gptSessions.id, session.id))
    .returning();

  return {
    session: updatedSession ?? session,
    runtimeConfig: latestRuntimeConfig,
    knowledgeItems: latestKnowledgeItems,
  };
}

async function resolveGptRuntimeConfig(gpt: Gpt, configVersion: number): Promise<ResolvedGptRuntimeConfig> {
  const version = await storage.getGptVersionByNumber(gpt.id, configVersion);
  const definitionSnapshot = toRecord(version?.definitionSnapshot) ?? toRecord(gpt.definition);

  const gptCapabilities = normalizeGptCapabilities(gpt.capabilities, DEFAULT_CAPABILITIES);
  const definitionCapabilities = definitionSnapshot?.capabilities
    ? normalizeGptCapabilities(definitionSnapshot.capabilities, gptCapabilities)
    : null;
  const capabilities = definitionCapabilities || gptCapabilities;

  const runtimePolicy = {
    ...DEFAULT_RUNTIME_POLICY,
    ...normalizeRuntimePolicy(gpt.runtimePolicy),
    ...normalizeRuntimePolicy(definitionSnapshot?.policies),
  };

  const toolPermissions = {
    ...DEFAULT_TOOL_PERMISSIONS,
    ...normalizeToolPermissions(gpt.toolPermissions),
  };

  const baseTemperature = parseNumber(version?.temperature ?? gpt.temperature, parseNumber(gpt.temperature, DEFAULT_TEMPERATURE)!);
  const baseTopP = parseNumber(version?.topP ?? gpt.topP, parseNumber(gpt.topP, DEFAULT_TOP_P)!);
  const baseMaxTokens = parseNumber(
    version?.maxTokens ?? gpt.maxTokens,
    parseNumber(gpt.maxTokens, DEFAULT_MAX_TOKENS)!
  );

  return {
    systemPrompt: typeof definitionSnapshot?.instructions === "string" && definitionSnapshot.instructions.length > 0
      ? definitionSnapshot.instructions
      : gpt.systemPrompt,
    capabilities,
    toolPermissions,
    runtimePolicy,
    preferredModel: typeof definitionSnapshot?.model === "string" && definitionSnapshot.model.length > 0
      ? definitionSnapshot.model
      : gpt.recommendedModel || null,
    temperature: parseNumber(runtimePolicy.temperatureOverride, baseTemperature),
    topP: baseTopP,
    maxTokens: parseNumber(runtimePolicy.maxTokensOverride, baseMaxTokens),
  };
}

function mapDbSessionToContract(session: GptSession, runtimeConfig: ResolvedGptRuntimeConfig, knowledgeContext: string): GptSessionContract {
  const capabilities = runtimeConfig.capabilities;
  const runtimePolicy = runtimeConfig.runtimePolicy;

  return {
    sessionId: session.id,
    gptId: session.gptId,
    configVersion: session.configVersion,
    systemPrompt: runtimeConfig.systemPrompt,
    enforcedModelId: session.enforcedModelId || runtimeConfig.preferredModel,
    modelFallbacks: runtimePolicy.modelFallbacks || [],
    capabilities: {
      webBrowsing: capabilities.webBrowsing ?? false,
      codeInterpreter: capabilities.codeInterpreter ?? false,
      imageGeneration: capabilities.imageGeneration ?? false,
      fileUpload: capabilities.fileUpload ?? false,
      dataAnalysis: capabilities.dataAnalysis ?? false,
      canvas: capabilities.canvas ?? false,
      wordCreation: capabilities.wordCreation ?? false,
      excelCreation: capabilities.excelCreation ?? false,
      pptCreation: capabilities.pptCreation ?? false,
    },
    toolPermissions: {
      mode: runtimeConfig.toolPermissions.mode || 'allowlist',
      allowedTools: runtimeConfig.toolPermissions.tools || [],
      actionsEnabled: runtimeConfig.toolPermissions.actionsEnabled ?? true,
    },
    runtimePolicy: {
      enforceModel: runtimePolicy.enforceModel ?? false,
      modelFallbacks: runtimePolicy.modelFallbacks || [],
      maxTokensOverride: runtimePolicy.maxTokensOverride,
      temperatureOverride: runtimePolicy.temperatureOverride,
      allowClientOverride: runtimePolicy.allowClientOverride ?? false,
    },
    knowledgeContext,
    temperature: runtimeConfig.temperature,
    topP: runtimeConfig.topP,
    maxTokens: runtimeConfig.maxTokens,
  };
}

export async function createGptSession(chatId: string | null, gptId: string): Promise<GptSessionContract> {
  const { id: resolvedGptId, gpt } = await resolveGptReference(gptId);

  const knowledgeItems = await storage.getGptKnowledge(resolvedGptId);
  const knowledgeContext = buildKnowledgeContext(knowledgeItems);
  const knowledgeContextIds = knowledgeItems
    .filter(k => k.isActive === "true")
    .map(k => k.id);

  const configVersion = parseNumber(gpt.version, 1) || 1;
  const runtimeConfig = await resolveGptRuntimeConfig(gpt, configVersion);

  let enforcedModelId: string | null = null;
  if (runtimeConfig.runtimePolicy.enforceModel) {
    enforcedModelId = runtimeConfig.preferredModel || runtimeConfig.runtimePolicy.modelFallbacks[0] || DEFAULT_MODEL;
  }

  const sessionData: InsertGptSession = {
    chatId: chatId || null,
    gptId: resolvedGptId,
    configVersion,
    frozenSystemPrompt: runtimeConfig.systemPrompt,
    frozenCapabilities: {
      webBrowsing: runtimeConfig.capabilities.webBrowsing ?? false,
      codeInterpreter: runtimeConfig.capabilities.codeInterpreter ?? false,
      imageGeneration: runtimeConfig.capabilities.imageGeneration ?? false,
      fileUpload: runtimeConfig.capabilities.fileUpload ?? false,
      dataAnalysis: runtimeConfig.capabilities.dataAnalysis ?? false,
      canvas: runtimeConfig.capabilities.canvas ?? false,
      wordCreation: runtimeConfig.capabilities.wordCreation ?? false,
      excelCreation: runtimeConfig.capabilities.excelCreation ?? false,
      pptCreation: runtimeConfig.capabilities.pptCreation ?? false,
    },
    frozenToolPermissions: {
      mode: runtimeConfig.toolPermissions.mode || 'allowlist',
      tools: runtimeConfig.toolPermissions.tools || [],
      actionsEnabled: runtimeConfig.toolPermissions.actionsEnabled ?? true,
    },
    frozenRuntimePolicy: {
      enforceModel: runtimeConfig.runtimePolicy.enforceModel ?? false,
      modelFallbacks: runtimeConfig.runtimePolicy.modelFallbacks || [],
      maxTokensOverride: runtimeConfig.runtimePolicy.maxTokensOverride,
      temperatureOverride: runtimeConfig.runtimePolicy.temperatureOverride,
      allowClientOverride: runtimeConfig.runtimePolicy.allowClientOverride ?? false,
    },
    enforcedModelId,
    knowledgeContextIds,
  };

  const [insertedSession] = await db.insert(gptSessions).values(sessionData).returning();
  
  return mapDbSessionToContract(insertedSession, runtimeConfig, knowledgeContext);
}

export async function getOrCreateSession(chatId: string, gptId: string): Promise<GptSessionContract> {
  const { id: resolvedGptId, gpt } = await resolveGptReference(gptId);

  if (!chatId || chatId.trim() === "" || chatId.startsWith("pending-")) {
    return createGptSession(null, resolvedGptId);
  }

  const [existingSession] = await db
    .select()
    .from(gptSessions)
    .where(and(eq(gptSessions.chatId, chatId), eq(gptSessions.gptId, resolvedGptId)));

  if (existingSession) {
    const refreshed = await refreshSessionSnapshotIfNeeded(existingSession, gpt);
    const filteredKnowledgeItems = refreshed.knowledgeItems.filter(k => refreshed.session.knowledgeContextIds?.includes(k.id));
    const knowledgeContext = buildKnowledgeContext(filteredKnowledgeItems);
    return mapDbSessionToContract(refreshed.session, refreshed.runtimeConfig, knowledgeContext);
  }

  return createGptSession(chatId, resolvedGptId);
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
  
  if (enforceModel && !allowClientOverride) {
    if (contract.enforcedModelId) {
      return contract.enforcedModelId;
    }
    if (contract.modelFallbacks.length > 0) {
      return contract.modelFallbacks[0];
    }
    return DEFAULT_MODEL;
  }
  
  if (requestedModel) {
    if (contract.modelFallbacks.length > 0) {
      if (contract.modelFallbacks.includes(requestedModel)) {
        return requestedModel;
      }
      return contract.modelFallbacks[0];
    }
    return requestedModel;
  }
  
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
  if (contract.capabilities.canvas) {
    enabledCapabilities.push("interactive canvas");
  }
  if (contract.capabilities.wordCreation) {
    enabledCapabilities.push("word document creation");
  }
  if (contract.capabilities.excelCreation) {
    enabledCapabilities.push("excel spreadsheet creation");
  }
  if (contract.capabilities.pptCreation) {
    enabledCapabilities.push("powerpoint presentation creation");
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
  try {
    const [session] = await db
      .select()
      .from(gptSessions)
      .where(eq(gptSessions.chatId, chatId));

    return session || null;
  } catch (error) {
    if (isMissingGptSessionsRelationError(error)) {
      warnMissingGptSessionsRelationOnce();
      return null;
    }
    throw error;
  }
}

export async function getSessionById(sessionId: string): Promise<GptSessionContract | null> {
  let session: GptSession | undefined;
  try {
    [session] = await db
      .select()
      .from(gptSessions)
      .where(eq(gptSessions.id, sessionId))
      .limit(1);
  } catch (error) {
    if (isMissingGptSessionsRelationError(error)) {
      warnMissingGptSessionsRelationOnce();
      return null;
    }
    throw error;
  }
  
  if (!session) return null;
  
  const gpt = await storage.getGpt(session.gptId);
  if (!gpt) return null;
  
  const refreshed = await refreshSessionSnapshotIfNeeded(session, gpt);
  const knowledgeContext = buildKnowledgeContext(
    refreshed.knowledgeItems.filter(k => refreshed.session.knowledgeContextIds?.includes(k.id))
  );

  return mapDbSessionToContract(refreshed.session, refreshed.runtimeConfig, knowledgeContext);
}

export async function deleteSessionByChatId(chatId: string): Promise<void> {
  try {
    await db.delete(gptSessions).where(eq(gptSessions.chatId, chatId));
  } catch (error) {
    if (isMissingGptSessionsRelationError(error)) {
      warnMissingGptSessionsRelationOnce();
      return;
    }
    throw error;
  }
}
