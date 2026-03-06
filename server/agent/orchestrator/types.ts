// server/agent/orchestrator/types.ts
// ---------------------------------------------------------------------------
// SuperPlanner Orchestrator — Type definitions
// ---------------------------------------------------------------------------

import type { PlannerSkillContext } from "@shared/skills/skillOperationalCatalog";

export type SubTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type PlanStatus = 'planning' | 'executing' | 'replanning' | 'completed' | 'failed';
export type Priority = 'critical' | 'high' | 'normal';
export type Complexity = 'simple' | 'medium' | 'complex';

export interface SubTask {
  id: string;
  description: string;
  toolHint: string;
  args?: Record<string, any>;
  dependencies: string[];
  priority: Priority;
  estimatedComplexity: Complexity;
  status: SubTaskStatus;
  result?: any;
  error?: string;
  retryCount: number;
  maxRetries: number;
  alternateStrategy?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  subtasks: SubTask[];
  waves: string[][];
  status: PlanStatus;
  memory: ProcessMemory;
  createdAt: number;
  completedAt?: number;
}

export interface ProcessMemory {
  goal: string;
  completedResults: Record<string, any>;
  failedAttempts: Array<{
    subtaskId: string;
    error: string;
    strategy: string;
    attempt: number;
  }>;
  context: Record<string, any>;
  timeline: Array<{ ts: number; event: string; detail: string }>;
}

export interface PlannerOutput {
  subtasks: Array<{
    id: string;
    description: string;
    toolHint: string;
    args?: Record<string, any>;
    dependencies: string[];
    priority: Priority;
    estimatedComplexity: Complexity;
    alternateStrategy?: string;
  }>;
  reasoning: string;
}

export interface OrchestratorOptions {
  runId: string;
  userId?: string;
  chatId?: string;
  sseRes?: any;
  skillContext?: PlannerSkillContext | null;
  maxRetries?: number;
  maxReplanAttempts?: number;
  timeout?: number;
  workspaceRoot?: string;
  plannerOutput?: PlannerOutput;
}

export interface OrchestratorResult {
  planId: string;
  status: 'completed' | 'partial' | 'failed';
  results: Record<string, any>;
  errors?: Record<string, string>;
  finalOutput: any;
  timeline: ProcessMemory['timeline'];
  subtasks?: SubTask[];
  stats: {
    totalSubtasks: number;
    completed: number;
    failed: number;
    skipped: number;
    selfExpanded: number;
    replanned: number;
    totalDurationMs: number;
  };
  artifacts?: {
    workspacePath: string;
    files: string[];
  };
}
