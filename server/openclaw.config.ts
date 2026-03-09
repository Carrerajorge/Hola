/**
 * ILIAGPT × OpenClaw Fusion — Unified Configuration
 * 
 * Central configuration that bridges ILIAGPT's Express/Drizzle backend
 * with OpenClaw's 6-stage agentic pipeline, Lane Queue, and Semantic Snapshots.
 * 
 * @version 2.2.0-fusion
 * @license MIT
 */

import { env } from './config/env';

/* ──────────────────────────────────────────────────
   Multi-Model Routing Configuration
   ────────────────────────────────────────────────── */

export interface ModelConfig {
  id: string;
  provider: 'anthropic' | 'google' | 'openai' | 'xai' | 'litellm' | 'ollama';
  model: string;
  role: 'brain' | 'researcher' | 'coder' | 'fast' | 'vision' | 'embedder';
  maxTokens: number;
  temperature: number;
  costPerMillionTokens: { input: number; output: number };
  capabilities: string[];
  priority: number;
  fallbackTo?: string;
}

export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  // Primary Brain — Claude Opus 4.6 for complex reasoning and orchestration
  'opus-brain': {
    id: 'opus-brain',
    provider: 'anthropic',
    model: 'claude-opus-4-20250603',
    role: 'brain',
    maxTokens: 32768,
    temperature: 0.3,
    costPerMillionTokens: { input: 15, output: 75 },
    capabilities: ['reasoning', 'planning', 'code-generation', 'analysis', 'orchestration'],
    priority: 1,
    fallbackTo: 'sonnet-coder',
  },

  // Deep Research — Gemini 2.5 Pro for comprehensive investigation
  'gemini-research': {
    id: 'gemini-research',
    provider: 'google',
    model: 'gemini-2.5-pro-preview-06-05',
    role: 'researcher',
    maxTokens: 65536,
    temperature: 0.2,
    costPerMillionTokens: { input: 3.5, output: 10.5 },
    capabilities: ['research', 'web-search', 'long-context', 'multimodal', 'analysis'],
    priority: 2,
    fallbackTo: 'gpt4-vision',
  },

  // Coding Specialist — Claude Sonnet 4.5 for implementation
  'sonnet-coder': {
    id: 'sonnet-coder',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20251022',
    role: 'coder',
    maxTokens: 16384,
    temperature: 0.1,
    costPerMillionTokens: { input: 3, output: 15 },
    capabilities: ['code-generation', 'debugging', 'refactoring', 'testing', 'documentation'],
    priority: 3,
    fallbackTo: 'gpt4-mini',
  },

  // Fast Operations — GPT-4o Mini for quick tasks
  'gpt4-mini': {
    id: 'gpt4-mini',
    provider: 'openai',
    model: 'gpt-4o-mini',
    role: 'fast',
    maxTokens: 8192,
    temperature: 0.5,
    costPerMillionTokens: { input: 0.15, output: 0.6 },
    capabilities: ['summarization', 'classification', 'quick-response', 'routing'],
    priority: 4,
    fallbackTo: 'grok-vision',
  },

  // Vision & Analysis — GPT-4o for visual tasks
  'gpt4-vision': {
    id: 'gpt4-vision',
    provider: 'openai',
    model: 'gpt-4o-2024-11-20',
    role: 'vision',
    maxTokens: 16384,
    temperature: 0.3,
    costPerMillionTokens: { input: 2.5, output: 10 },
    capabilities: ['vision', 'image-analysis', 'ocr', 'diagram-understanding'],
    priority: 5,
    fallbackTo: 'gemini-research',
  },

  // Uncensored Reasoning — Grok 3 for creative/edgy tasks
  'grok-vision': {
    id: 'grok-vision',
    provider: 'xai',
    model: 'grok-3-vision-beta',
    role: 'vision',
    maxTokens: 32768,
    temperature: 0.7,
    costPerMillionTokens: { input: 5, output: 25 },
    capabilities: ['vision', 'creative', 'uncensored', 'reasoning'],
    priority: 6,
    fallbackTo: 'gpt4-mini',
  },
};

/* ──────────────────────────────────────────────────
   OpenClaw Pipeline Configuration
   ────────────────────────────────────────────────── */

export interface PipelineStageConfig {
  name: string;
  model: string;
  systemPromptKey: string;
  maxRetries: number;
  timeoutMs: number;
  parallelizable: boolean;
}

export const PIPELINE_STAGES: PipelineStageConfig[] = [
  {
    name: 'intent-analysis',
    model: 'gpt4-mini',          // Fast routing decision
    systemPromptKey: 'INTENT_ANALYSIS_PROMPT',
    maxRetries: 2,
    timeoutMs: 5000,
    parallelizable: false,
  },
  {
    name: 'context-retrieval',
    model: 'gemini-research',    // Long context for RAG
    systemPromptKey: 'CONTEXT_RETRIEVAL_PROMPT',
    maxRetries: 3,
    timeoutMs: 15000,
    parallelizable: true,
  },
  {
    name: 'skill-selection',
    model: 'opus-brain',         // Complex skill matching
    systemPromptKey: 'SKILL_SELECTION_PROMPT',
    maxRetries: 2,
    timeoutMs: 10000,
    parallelizable: false,
  },
  {
    name: 'execution',
    model: 'sonnet-coder',       // Implementation
    systemPromptKey: 'EXECUTION_PROMPT',
    maxRetries: 3,
    timeoutMs: 60000,
    parallelizable: true,
  },
  {
    name: 'validation',
    model: 'opus-brain',         // Quality check
    systemPromptKey: 'VALIDATION_PROMPT',
    maxRetries: 2,
    timeoutMs: 20000,
    parallelizable: false,
  },
  {
    name: 'synthesis',
    model: 'sonnet-coder',       // Final assembly
    systemPromptKey: 'SYNTHESIS_PROMPT',
    maxRetries: 2,
    timeoutMs: 30000,
    parallelizable: false,
  },
];

/* ──────────────────────────────────────────────────
   Lane Queue Configuration
   ────────────────────────────────────────────────── */

export interface LaneConfig {
  name: 'express' | 'standard' | 'bulk';
  maxConcurrent: number;
  timeoutMs: number;
  retryLimit: number;
  priority: number;
  costBudgetPerRequest: number;  // USD
}

export const LANE_CONFIGS: LaneConfig[] = [
  {
    name: 'express',
    maxConcurrent: 5,
    timeoutMs: 30000,
    retryLimit: 1,
    priority: 1,
    costBudgetPerRequest: 0.50,
  },
  {
    name: 'standard',
    maxConcurrent: 10,
    timeoutMs: 120000,
    retryLimit: 3,
    priority: 2,
    costBudgetPerRequest: 2.00,
  },
  {
    name: 'bulk',
    maxConcurrent: 20,
    timeoutMs: 600000,
    retryLimit: 5,
    priority: 3,
    costBudgetPerRequest: 10.00,
  },
];

/* ──────────────────────────────────────────────────
   Semantic Snapshot Configuration
   ────────────────────────────────────────────────── */

export interface SnapshotConfig {
  enabled: boolean;
  storageBackend: 'postgres' | 'redis' | 'memory';
  ttlSeconds: number;
  maxSnapshots: number;
  compressionEnabled: boolean;
  embeddingModel: string;
}

export const SNAPSHOT_CONFIG: SnapshotConfig = {
  enabled: true,
  storageBackend: 'postgres',
  ttlSeconds: 86400 * 7,   // 7 days
  maxSnapshots: 1000,
  compressionEnabled: true,
  embeddingModel: 'text-embedding-3-large',
};

/* ──────────────────────────────────────────────────
   ILIAGPT Integration Configuration
   ────────────────────────────────────────────────── */

export interface ILIAGPTConfig {
  sessionManagement: {
    enabled: boolean;
    maxSessionAge: number;
    cleanupInterval: number;
  };
  drizzleIntegration: {
    enabled: boolean;
    schemaPath: string;
    migrationsPath: string;
  };
  expressMiddleware: {
    corsOrigins: string[];
    rateLimitWindow: number;
    rateLimitMax: number;
  };
}

export const ILIAGPT_CONFIG: ILIAGPTConfig = {
  sessionManagement: {
    enabled: true,
    maxSessionAge: 86400 * 30,  // 30 days
    cleanupInterval: 3600,       // hourly
  },
  drizzleIntegration: {
    enabled: true,
    schemaPath: './db/schema',
    migrationsPath: './db/migrations',
  },
  expressMiddleware: {
    corsOrigins: [
      env.FRONTEND_URL || 'http://localhost:5173',
      'https://iliagpt.com',
      'https://openclaw.ai',
    ],
    rateLimitWindow: 900000,  // 15 minutes
    rateLimitMax: 100,
  },
};

/* ──────────────────────────────────────────────────
   Feature Flags
   ────────────────────────────────────────────────── */

export const FEATURE_FLAGS = {
  // OpenClaw Features
  ENABLE_LANE_QUEUE: true,
  ENABLE_SEMANTIC_SNAPSHOTS: true,
  ENABLE_6_STAGE_PIPELINE: true,
  ENABLE_PARALLEL_EXECUTION: true,
  ENABLE_COST_TRACKING: true,

  // ILIAGPT Features
  ENABLE_SESSION_PERSISTENCE: true,
  ENABLE_DRIZZLE_ORM: true,
  ENABLE_WEBSOCKET_STREAMING: true,
  ENABLE_FILE_UPLOAD: true,

  // Fusion Features
  ENABLE_CROSS_SESSION_MEMORY: false,    // Coming in v2.3
  ENABLE_MULTI_AGENT_COORDINATION: false, // Coming in v2.4
  ENABLE_AUTONOMOUS_SKILL_CREATION: false, // Experimental
} as const;

/* ──────────────────────────────────────────────────
   Export unified config
   ────────────────────────────────────────────────── */

export const OPENCLAW_CONFIG = {
  models: MODEL_REGISTRY,
  pipeline: PIPELINE_STAGES,
  lanes: LANE_CONFIGS,
  snapshots: SNAPSHOT_CONFIG,
  iliagpt: ILIAGPT_CONFIG,
  features: FEATURE_FLAGS,
  version: '2.2.0-fusion',
  buildDate: new Date('2026-03-05').toISOString(),
} as const;

export default OPENCLAW_CONFIG;
