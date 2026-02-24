// Agent Orchestration — Barrel Export
// 6 layers fused from OpenClaw into ILIAGPT

export { HookSystem, hookSystem } from './hookSystem';
export type { HookEvent, HookContext, HookResult, HookHandler, RegisteredHook } from './hookSystem';

export { SessionManager, sessionManager, buildSessionKey, parseSessionKey, deriveSessionScope } from './sessionManager';
export type { SessionKey, SessionMessage, CompactionResult } from './sessionManager';

export { ToolPolicyEngine, toolPolicyEngine, evaluateToolPolicy, matchesPattern, expandGroups } from './toolPolicy';
export type { ToolPolicy, ToolPolicyCheckResult } from './toolPolicy';

export { SkillDiscovery, skillDiscovery, shouldIncludeSkill, buildSkillSnapshot } from './skillDiscovery';
export type { SkillEntry, SkillSnapshot, SkillEligibilityContext } from './skillDiscovery';

export { MultiAgentRouter } from './multiAgentRouter';
export type { AgentConfig, RouteInput, AgentRoute, AgentBinding } from './multiAgentRouter';

export { EnhancedExecutor, enhancedExecutor, classifyError, truncateToolResult } from './enhancedExecutor';
export type { ExecutionResult, ExecutionAttempt, ExecutorConfig, ErrorKind, TokenUsage } from './enhancedExecutor';
