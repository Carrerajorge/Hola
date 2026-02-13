/**
 * AI Agent Core Service
 * Capabilities 801-850: Multi-LLM routing, agent orchestration, guardrails, memory
 */

import crypto from "crypto";

// ============================================================
// Types & Interfaces
// ============================================================

interface LLMProvider {
  name: string;
  model: string;
  costPer1kTokens: number;
  maxTokens: number;
  latencyMs: number; // avg
  available: boolean;
  priority: number;
}

interface RouterConfig {
  strategy: "cost" | "latency" | "quality" | "round_robin" | "fallback";
  providers: LLMProvider[];
  maxRetries: number;
  fallbackChain: string[];
  tokenBudget?: number;
}

interface AgentRole {
  name: string;
  description: string;
  tools: string[];
  systemPrompt: string;
  maxIterations: number;
}

interface AgentTask {
  id: string;
  description: string;
  assignedAgent?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  priority: number;
  dependencies: string[];
  result?: any;
  createdAt: Date;
}

interface GuardrailResult {
  passed: boolean;
  violations: Array<{
    rule: string;
    severity: "critical" | "high" | "medium" | "low";
    detail: string;
  }>;
  score: number; // 0-1, 1 = fully safe
}

interface MemoryEntry {
  id: string;
  type: "short_term" | "long_term" | "episodic" | "semantic" | "procedural";
  content: string;
  metadata: Record<string, any>;
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
  relevanceScore: number;
}

interface AgentMessage {
  from: string;
  to: string;
  content: string;
  timestamp: Date;
}

interface CacheEntry {
  response: string;
  expiresAt: number;
}

// ============================================================
// Module-level State
// ============================================================

const providers = new Map<string, LLMProvider>();
let routerConfig: RouterConfig = {
  strategy: "fallback",
  providers: [],
  maxRetries: 3,
  fallbackChain: [],
  tokenBudget: Infinity,
};
let totalTokensUsed = 0;
let tokenBudget = Infinity;
let roundRobinIndex = 0;

const agentRoles = new Map<string, AgentRole>();
const taskQueue: AgentTask[] = [];
const agentMessages: AgentMessage[] = [];

const memoryStore = new Map<string, MemoryEntry>();

const responseCache = new Map<string, CacheEntry>();

const providerTokenUsage = new Map<
  string,
  { inputTokens: number; outputTokens: number }
>();

// ============================================================
// Multi-LLM Router (Capabilities 801-810)
// ============================================================

/**
 * Configure the multi-LLM router with a strategy and provider list.
 */
export function configureRouter(config: Partial<RouterConfig>): RouterConfig {
  routerConfig = { ...routerConfig, ...config };

  if (config.providers) {
    providers.clear();
    for (const p of config.providers) {
      providers.set(p.name, p);
    }
  }

  if (config.tokenBudget !== undefined) {
    tokenBudget = config.tokenBudget;
  }

  console.log(
    `[AIAgentCore] Router configured: strategy=${routerConfig.strategy}, providers=${providers.size}, maxRetries=${routerConfig.maxRetries}`
  );
  return { ...routerConfig };
}

/**
 * Register a new LLM provider.
 */
export function registerProvider(provider: LLMProvider): void {
  providers.set(provider.name, { ...provider });
  providerTokenUsage.set(provider.name, { inputTokens: 0, outputTokens: 0 });
  console.log(
    `[AIAgentCore] Provider registered: ${provider.name} (model=${provider.model}, cost=$${provider.costPer1kTokens}/1k)`
  );
}

/**
 * Remove a provider by name.
 */
export function removeProvider(name: string): boolean {
  const existed = providers.delete(name);
  if (existed) {
    providerTokenUsage.delete(name);
    console.log(`[AIAgentCore] Provider removed: ${name}`);
  }
  return existed;
}

/**
 * List all registered providers.
 */
export function listProviders(): LLMProvider[] {
  return Array.from(providers.values()).map((p) => ({ ...p }));
}

/**
 * Select the best provider based on the current strategy and optional preferences.
 */
export function selectProvider(options?: {
  preferCost?: boolean;
  preferLatency?: boolean;
  minTokens?: number;
}): LLMProvider | null {
  const available = Array.from(providers.values()).filter((p) => {
    if (!p.available) return false;
    if (options?.minTokens && p.maxTokens < options.minTokens) return false;
    return true;
  });

  if (available.length === 0) return null;

  // Override strategy if explicit preferences given
  let strategy = routerConfig.strategy;
  if (options?.preferCost) strategy = "cost";
  if (options?.preferLatency) strategy = "latency";

  switch (strategy) {
    case "cost": {
      available.sort((a, b) => a.costPer1kTokens - b.costPer1kTokens);
      return { ...available[0] };
    }

    case "latency": {
      available.sort((a, b) => a.latencyMs - b.latencyMs);
      return { ...available[0] };
    }

    case "quality": {
      // Quality = lower priority number is higher quality
      available.sort((a, b) => a.priority - b.priority);
      return { ...available[0] };
    }

    case "round_robin": {
      const index = roundRobinIndex % available.length;
      roundRobinIndex++;
      return { ...available[index] };
    }

    case "fallback": {
      // Follow the fallback chain order
      if (routerConfig.fallbackChain.length > 0) {
        for (const name of routerConfig.fallbackChain) {
          const provider = available.find((p) => p.name === name);
          if (provider) return { ...provider };
        }
      }
      // If no fallback chain match, pick by priority
      available.sort((a, b) => a.priority - b.priority);
      return { ...available[0] };
    }

    default:
      return { ...available[0] };
  }
}

/**
 * Get the configured fallback chain.
 */
export function getFallbackChain(): string[] {
  return [...routerConfig.fallbackChain];
}

/**
 * Get current token budget usage.
 */
export function getTokenBudget(): {
  used: number;
  remaining: number;
  total: number;
} {
  return {
    used: totalTokensUsed,
    remaining: Math.max(0, tokenBudget - totalTokensUsed),
    total: tokenBudget,
  };
}

/**
 * Record token usage for a provider.
 */
export function recordTokenUsage(
  providerName: string,
  inputTokens: number,
  outputTokens: number
): void {
  const total = inputTokens + outputTokens;
  totalTokensUsed += total;

  const existing = providerTokenUsage.get(providerName);
  if (existing) {
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
  } else {
    providerTokenUsage.set(providerName, { inputTokens, outputTokens });
  }

  if (totalTokensUsed > tokenBudget) {
    console.warn(
      `[AIAgentCore] Token budget exceeded: ${totalTokensUsed}/${tokenBudget}`
    );
  }
}

// ============================================================
// Agent Orchestration (Capabilities 811-825)
// ============================================================

/**
 * Define a new agent role.
 */
export function defineAgentRole(role: AgentRole): void {
  agentRoles.set(role.name, { ...role });
  console.log(
    `[AIAgentCore] Agent role defined: ${role.name} (tools: ${role.tools.join(", ")})`
  );
}

/**
 * List all defined agent roles.
 */
export function listAgentRoles(): AgentRole[] {
  return Array.from(agentRoles.values()).map((r) => ({ ...r }));
}

/**
 * Get a specific agent role by name.
 */
export function getAgentRole(name: string): AgentRole | null {
  const role = agentRoles.get(name);
  return role ? { ...role } : null;
}

/**
 * Decompose a high-level task into subtasks using heuristic analysis.
 * Splits by sentence/clause, identifies action verbs, and assigns to roles.
 */
export function decomposeTask(task: string): {
  subtasks: Array<{
    id: string;
    description: string;
    suggestedAgent: string;
    priority: number;
    dependencies: string[];
  }>;
} {
  const roleNames = Array.from(agentRoles.keys());
  const defaultAgent = roleNames.length > 0 ? roleNames[0] : "default";

  // Keyword-to-agent mapping heuristics
  const keywordAgentMap: Record<string, string[]> = {
    research: ["search", "find", "look up", "investigate", "analyze", "review"],
    writer: ["write", "compose", "draft", "create", "generate", "summarize"],
    coder: [
      "code",
      "implement",
      "build",
      "develop",
      "fix",
      "debug",
      "program",
    ],
    reviewer: [
      "review",
      "check",
      "verify",
      "validate",
      "test",
      "evaluate",
      "audit",
    ],
    planner: ["plan", "organize", "schedule", "prioritize", "design", "architect"],
  };

  // Split task into logical segments
  const segments = task
    .split(/[.;]\s*|\band\b\s+then\b|\bthen\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);

  // If task has no clear segments, treat the whole thing as one subtask
  const parts = segments.length > 0 ? segments : [task];

  const subtasks = parts.map((part, index) => {
    const id = `subtask_${crypto.randomUUID().slice(0, 8)}`;
    const lower = part.toLowerCase();

    // Find best matching agent
    let suggestedAgent = defaultAgent;
    let bestMatchCount = 0;

    // First, check defined roles
    for (const [roleName] of agentRoles) {
      const roleNameLower = roleName.toLowerCase();
      if (lower.includes(roleNameLower)) {
        suggestedAgent = roleName;
        bestMatchCount = 100; // exact name match wins
        break;
      }
    }

    // Then check keyword heuristics
    if (bestMatchCount < 100) {
      for (const [agentType, keywords] of Object.entries(keywordAgentMap)) {
        const matchCount = keywords.filter((kw) => lower.includes(kw)).length;
        if (matchCount > bestMatchCount) {
          bestMatchCount = matchCount;
          // Map the heuristic type to an actual defined role, or use the type name
          const matchedRole = roleNames.find(
            (r) => r.toLowerCase() === agentType
          );
          suggestedAgent = matchedRole || agentType;
        }
      }
    }

    // Priority: earlier steps are higher priority (lower number)
    const priority = index + 1;

    // Dependencies: each step depends on the previous (sequential by default)
    const dependencies: string[] = [];
    // We'll assign dependencies after generating all IDs

    return { id, description: part, suggestedAgent, priority, dependencies };
  });

  // Wire sequential dependencies
  for (let i = 1; i < subtasks.length; i++) {
    subtasks[i].dependencies.push(subtasks[i - 1].id);
  }

  return { subtasks };
}

/**
 * Add a task to the queue.
 */
export function enqueueTask(
  task: Omit<AgentTask, "id" | "status" | "createdAt">
): AgentTask {
  const newTask: AgentTask = {
    ...task,
    id: `task_${crypto.randomUUID().slice(0, 8)}`,
    status: "pending",
    createdAt: new Date(),
  };
  taskQueue.push(newTask);
  // Sort by priority (lower number = higher priority)
  taskQueue.sort((a, b) => a.priority - b.priority);
  console.log(
    `[AIAgentCore] Task enqueued: ${newTask.id} — "${newTask.description}" (priority: ${newTask.priority})`
  );
  return { ...newTask };
}

/**
 * Get the next available task for an agent.
 * Respects dependency resolution: a task is only available if all dependencies are completed.
 */
export function getNextTask(agentName?: string): AgentTask | null {
  for (const task of taskQueue) {
    if (task.status !== "pending") continue;

    // Check if assigned to a specific agent
    if (task.assignedAgent && agentName && task.assignedAgent !== agentName)
      continue;

    // Check dependency resolution
    const depsResolved = task.dependencies.every((depId) => {
      const dep = taskQueue.find((t) => t.id === depId);
      return dep && dep.status === "completed";
    });

    if (!depsResolved) continue;

    // Mark as in_progress
    task.status = "in_progress";
    if (agentName) task.assignedAgent = agentName;
    return { ...task };
  }

  return null;
}

/**
 * Mark a task as completed with a result.
 */
export function completeTask(taskId: string, result: any): boolean {
  const task = taskQueue.find((t) => t.id === taskId);
  if (!task || task.status !== "in_progress") return false;

  task.status = "completed";
  task.result = result;
  console.log(`[AIAgentCore] Task completed: ${taskId}`);
  return true;
}

/**
 * Mark a task as failed with an error.
 */
export function failTask(taskId: string, error: string): boolean {
  const task = taskQueue.find((t) => t.id === taskId);
  if (!task || task.status !== "in_progress") return false;

  task.status = "failed";
  task.result = { error };
  console.log(`[AIAgentCore] Task failed: ${taskId} — ${error}`);
  return true;
}

/**
 * Get the status of a specific task.
 */
export function getTaskStatus(taskId: string): AgentTask | null {
  const task = taskQueue.find((t) => t.id === taskId);
  return task ? { ...task } : null;
}

/**
 * List tasks, optionally filtered by status.
 */
export function listTasks(status?: AgentTask["status"]): AgentTask[] {
  const filtered = status
    ? taskQueue.filter((t) => t.status === status)
    : taskQueue;
  return filtered.map((t) => ({ ...t }));
}

/**
 * Send a message between agents.
 */
export function sendAgentMessage(
  from: string,
  to: string,
  content: string
): void {
  agentMessages.push({ from, to, content, timestamp: new Date() });
  console.log(`[AIAgentCore] Message: ${from} -> ${to}: ${content.slice(0, 80)}...`);
}

/**
 * Get messages for a specific agent.
 */
export function getAgentMessages(
  agentName: string,
  limit: number = 50
): AgentMessage[] {
  return agentMessages
    .filter((m) => m.to === agentName || m.from === agentName)
    .slice(-limit)
    .map((m) => ({ ...m }));
}

// ============================================================
// Guardrails (Capabilities 826-835)
// ============================================================

// Common harmful/toxic patterns (regex-based heuristic detection)
const TOXIC_PATTERNS: Array<{ pattern: RegExp; category: string; weight: number }> = [
  { pattern: /\b(kill|murder|attack|destroy|eliminate)\s+(you|them|him|her|people|everyone)\b/i, category: "violence", weight: 0.9 },
  { pattern: /\b(hate|despise|loathe)\s+(all|every)\s+\w+/i, category: "hate_speech", weight: 0.8 },
  { pattern: /\b(stupid|idiot|moron|dumb|retard)\b/i, category: "insult", weight: 0.5 },
  { pattern: /\b(n[i1]gg|f[a@]gg|k[i1]ke|sp[i1]c)\b/i, category: "slur", weight: 1.0 },
  { pattern: /\bgo\s+(die|kill\s+yourself)\b/i, category: "self_harm_encouragement", weight: 1.0 },
  { pattern: /\b(bomb|explosive|weapon)\s+(make|build|create|how\s+to)\b/i, category: "dangerous_instructions", weight: 0.95 },
  { pattern: /\b(how\s+to)\s+(hack|steal|phish|scam)\b/i, category: "malicious_intent", weight: 0.85 },
];

// Bias indicator patterns
const BIAS_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\b(all|every|no)\s+(men|women|blacks|whites|asians|jews|muslims|christians)\s+(are|is|always|never)\b/i, type: "group_generalization" },
  { pattern: /\b(naturally|inherently|genetically)\s+(superior|inferior|better|worse|smarter|dumber)\b/i, type: "biological_essentialism" },
  { pattern: /\b(boys|girls|men|women)\s+(should|must|need\s+to|have\s+to)\s+(stay|be|remain)\b/i, type: "gender_role_prescription" },
  { pattern: /\b(third\s+world|primitive|uncivilized|backwards)\s+(country|countries|people|culture)\b/i, type: "cultural_prejudice" },
  { pattern: /\b(typical|classic|expected)\s+(of|for|from)\s+(a|an)?\s*(man|woman|black|white|asian|latino|immigrant)\b/i, type: "stereotyping" },
];

// PII detection patterns
const PII_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/, type: "ssn" },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, type: "email" },
  { pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, type: "phone" },
  { pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/, type: "credit_card" },
  { pattern: /\b[A-Z]{1,2}\d{6,9}\b/, type: "passport" },
];

// Profanity list (simplified — a real system would have a much larger list)
const PROFANITY_TERMS = [
  "fuck", "shit", "damn", "ass", "bitch", "bastard", "crap", "dick", "piss", "cock",
];

/**
 * Validate input text against configurable rules.
 */
export function validateInput(
  input: string,
  rules?: {
    maxLength?: number;
    blockedPatterns?: RegExp[];
    requiredPatterns?: RegExp[];
    allowedLanguages?: string[];
  }
): GuardrailResult {
  const violations: GuardrailResult["violations"] = [];

  // Length check
  if (rules?.maxLength && input.length > rules.maxLength) {
    violations.push({
      rule: "max_length",
      severity: "medium",
      detail: `Input length ${input.length} exceeds maximum ${rules.maxLength}`,
    });
  }

  // Blocked patterns
  if (rules?.blockedPatterns) {
    for (const pattern of rules.blockedPatterns) {
      if (pattern.test(input)) {
        violations.push({
          rule: "blocked_pattern",
          severity: "high",
          detail: `Input matches blocked pattern: ${pattern.source}`,
        });
      }
    }
  }

  // Required patterns
  if (rules?.requiredPatterns) {
    for (const pattern of rules.requiredPatterns) {
      if (!pattern.test(input)) {
        violations.push({
          rule: "required_pattern_missing",
          severity: "medium",
          detail: `Input does not match required pattern: ${pattern.source}`,
        });
      }
    }
  }

  // Allowed languages check (basic heuristic: check character ranges)
  if (rules?.allowedLanguages && rules.allowedLanguages.length > 0) {
    const langCharRanges: Record<string, RegExp> = {
      en: /[a-zA-Z]/,
      es: /[\u00C0-\u024F]/,
      zh: /[\u4E00-\u9FFF]/,
      ja: /[\u3040-\u30FF\u4E00-\u9FFF]/,
      ko: /[\uAC00-\uD7AF]/,
      ar: /[\u0600-\u06FF]/,
      ru: /[\u0400-\u04FF]/,
      hi: /[\u0900-\u097F]/,
    };

    // Check if the text contains characters outside the allowed ranges
    const allowedRanges = rules.allowedLanguages
      .map((lang) => langCharRanges[lang])
      .filter(Boolean);

    if (allowedRanges.length > 0) {
      // Strip whitespace, digits, and punctuation, then check remaining chars
      const textOnly = input.replace(/[\s\d\p{P}\p{S}]/gu, "");
      if (textOnly.length > 0) {
        const hasAllowedChars = allowedRanges.some((r) => r.test(textOnly));
        if (!hasAllowedChars) {
          violations.push({
            rule: "language_not_allowed",
            severity: "low",
            detail: `Input may contain characters outside allowed languages: ${rules.allowedLanguages.join(", ")}`,
          });
        }
      }
    }
  }

  // Check for prompt injection attempts
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts|rules)/i,
    /you\s+are\s+now\s+(a|an|the)\s+\w+/i,
    /system\s*:\s*/i,
    /\[\s*INST\s*\]/i,
    /\<\|im_start\|>/i,
    /jailbreak/i,
    /DAN\s+mode/i,
  ];

  for (const pattern of injectionPatterns) {
    if (pattern.test(input)) {
      violations.push({
        rule: "prompt_injection_detected",
        severity: "critical",
        detail: `Possible prompt injection attempt detected: ${pattern.source}`,
      });
    }
  }

  const criticalCount = violations.filter((v) => v.severity === "critical").length;
  const highCount = violations.filter((v) => v.severity === "high").length;
  const mediumCount = violations.filter((v) => v.severity === "medium").length;
  const lowCount = violations.filter((v) => v.severity === "low").length;

  const penalty =
    criticalCount * 0.5 + highCount * 0.3 + mediumCount * 0.15 + lowCount * 0.05;
  const score = Math.max(0, Math.min(1, 1 - penalty));

  return {
    passed: violations.length === 0,
    violations,
    score,
  };
}

/**
 * Validate output text against configurable rules.
 */
export function validateOutput(
  output: string,
  rules?: {
    maxLength?: number;
    blockedPatterns?: RegExp[];
    requireSourceAttribution?: boolean;
    checkToxicity?: boolean;
    checkBias?: boolean;
  }
): GuardrailResult {
  const violations: GuardrailResult["violations"] = [];

  // Length check
  if (rules?.maxLength && output.length > rules.maxLength) {
    violations.push({
      rule: "max_length",
      severity: "medium",
      detail: `Output length ${output.length} exceeds maximum ${rules.maxLength}`,
    });
  }

  // Blocked patterns
  if (rules?.blockedPatterns) {
    for (const pattern of rules.blockedPatterns) {
      if (pattern.test(output)) {
        violations.push({
          rule: "blocked_pattern",
          severity: "high",
          detail: `Output matches blocked pattern: ${pattern.source}`,
        });
      }
    }
  }

  // Source attribution check
  if (rules?.requireSourceAttribution) {
    const attributionPatterns = [
      /\bsource[s]?\s*:/i,
      /\breference[s]?\s*:/i,
      /\bcitation[s]?\s*:/i,
      /\baccording\s+to\b/i,
      /\[\d+\]/,
      /\(.*?\d{4}.*?\)/,
      /https?:\/\/\S+/,
    ];
    const hasAttribution = attributionPatterns.some((p) => p.test(output));
    if (!hasAttribution) {
      violations.push({
        rule: "missing_source_attribution",
        severity: "medium",
        detail: "Output does not contain source attribution",
      });
    }
  }

  // Toxicity check
  if (rules?.checkToxicity) {
    const toxResult = detectToxicity(output);
    if (toxResult.toxic) {
      const topCategories = Object.entries(toxResult.categories)
        .filter(([, score]) => score > 0.5)
        .map(([cat]) => cat);
      violations.push({
        rule: "toxicity_detected",
        severity: toxResult.score > 0.8 ? "critical" : "high",
        detail: `Toxic content detected (score: ${toxResult.score.toFixed(2)}, categories: ${topCategories.join(", ")})`,
      });
    }
  }

  // Bias check
  if (rules?.checkBias) {
    const biasResult = detectBias(output);
    if (biasResult.biased) {
      for (const b of biasResult.types) {
        violations.push({
          rule: "bias_detected",
          severity: b.confidence > 0.8 ? "high" : "medium",
          detail: `Bias detected — type: ${b.type}, example: "${b.example}"`,
        });
      }
    }
  }

  const criticalCount = violations.filter((v) => v.severity === "critical").length;
  const highCount = violations.filter((v) => v.severity === "high").length;
  const mediumCount = violations.filter((v) => v.severity === "medium").length;
  const lowCount = violations.filter((v) => v.severity === "low").length;

  const penalty =
    criticalCount * 0.5 + highCount * 0.3 + mediumCount * 0.15 + lowCount * 0.05;
  const score = Math.max(0, Math.min(1, 1 - penalty));

  return {
    passed: violations.length === 0,
    violations,
    score,
  };
}

/**
 * Detect toxicity in text using regex-based heuristic patterns.
 * Returns a toxicity score and per-category breakdown.
 */
export function detectToxicity(text: string): {
  toxic: boolean;
  score: number;
  categories: Record<string, number>;
} {
  const categories: Record<string, number> = {};
  let maxScore = 0;

  for (const { pattern, category, weight } of TOXIC_PATTERNS) {
    const matches = text.match(new RegExp(pattern.source, "gi"));
    if (matches) {
      const categoryScore = Math.min(1, matches.length * weight);
      categories[category] = Math.max(categories[category] || 0, categoryScore);
      maxScore = Math.max(maxScore, categoryScore);
    }
  }

  // Also check for ALL-CAPS shouting (indicator of aggression)
  const words = text.split(/\s+/);
  const capsWords = words.filter(
    (w) => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w)
  );
  if (words.length > 3 && capsWords.length / words.length > 0.5) {
    categories["aggressive_tone"] = 0.4;
    maxScore = Math.max(maxScore, 0.4);
  }

  // Check for excessive exclamation marks
  const exclamCount = (text.match(/!/g) || []).length;
  if (exclamCount > 5) {
    categories["aggressive_tone"] = Math.max(
      categories["aggressive_tone"] || 0,
      0.3
    );
    maxScore = Math.max(maxScore, 0.3);
  }

  return {
    toxic: maxScore > 0.5,
    score: Math.min(1, maxScore),
    categories,
  };
}

/**
 * Detect bias in text using regex-based pattern matching.
 */
export function detectBias(text: string): {
  biased: boolean;
  types: Array<{ type: string; confidence: number; example: string }>;
} {
  const types: Array<{ type: string; confidence: number; example: string }> = [];

  for (const { pattern, type } of BIAS_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      types.push({
        type,
        confidence: 0.8,
        example: match[0],
      });
    }
  }

  // Check for one-sided language in comparative contexts
  const comparativePatterns = [
    { pattern: /\b(always|never|every\s+time)\b/gi, type: "absolute_language" },
    {
      pattern: /\b(obviously|clearly|everyone\s+knows)\b/gi,
      type: "assumed_consensus",
    },
  ];

  for (const { pattern: p, type } of comparativePatterns) {
    const matches = text.match(p);
    if (matches && matches.length >= 2) {
      types.push({
        type,
        confidence: 0.5,
        example: matches[0],
      });
    }
  }

  return {
    biased: types.length > 0,
    types,
  };
}

/**
 * Check if a claim is grounded in the provided source texts.
 * Uses keyword overlap heuristic.
 */
export function checkFactualGrounding(
  claim: string,
  sources: string[]
): { grounded: boolean; confidence: number; matchingSources: number[] } {
  if (sources.length === 0) {
    return { grounded: false, confidence: 0, matchingSources: [] };
  }

  const claimWords = extractKeywords(claim);
  if (claimWords.length === 0) {
    return { grounded: false, confidence: 0, matchingSources: [] };
  }

  const matchingSources: number[] = [];
  let bestOverlap = 0;

  for (let i = 0; i < sources.length; i++) {
    const sourceWords = new Set(extractKeywords(sources[i]));
    const overlapCount = claimWords.filter((w) => sourceWords.has(w)).length;
    const overlapRatio = overlapCount / claimWords.length;

    if (overlapRatio > 0.3) {
      matchingSources.push(i);
    }

    bestOverlap = Math.max(bestOverlap, overlapRatio);
  }

  // Confidence is based on keyword overlap, with diminishing returns
  const confidence = Math.min(1, bestOverlap * 1.2);

  return {
    grounded: confidence > 0.4,
    confidence: Math.round(confidence * 100) / 100,
    matchingSources,
  };
}

/**
 * Score the confidence of a response based on hedging language.
 */
export function scoreConfidence(response: string): {
  confidence: number;
  uncertaintyMarkers: string[];
  hedgingPhrases: string[];
} {
  const uncertaintyPatterns = [
    /\bI('m| am) not (sure|certain|confident)\b/gi,
    /\bI (don't|do not) know\b/gi,
    /\bunsure\b/gi,
    /\bunclear\b/gi,
    /\buncertain\b/gi,
    /\bI (think|believe|guess|suppose)\b/gi,
    /\b(may|might|could|possibly|perhaps|maybe)\b/gi,
    /\bprobably\b/gi,
    /\bapproximately\b/gi,
    /\broughly\b/gi,
  ];

  const hedgingPatterns = [
    /\bit (seems|appears|looks) (like|as if|that)\b/gi,
    /\bto (some|a certain) (extent|degree)\b/gi,
    /\bin (my|general) (opinion|view)\b/gi,
    /\bgenerally (speaking|said)\b/gi,
    /\btend(s)? to\b/gi,
    /\bas far as I (know|can tell)\b/gi,
    /\bif I('m| am) not mistaken\b/gi,
    /\bit('s| is) (possible|likely|probable) that\b/gi,
    /\bfor the most part\b/gi,
    /\bmore or less\b/gi,
  ];

  const uncertaintyMarkers: string[] = [];
  const hedgingPhrases: string[] = [];

  for (const pattern of uncertaintyPatterns) {
    const matches = response.match(pattern);
    if (matches) {
      uncertaintyMarkers.push(...matches);
    }
  }

  for (const pattern of hedgingPatterns) {
    const matches = response.match(pattern);
    if (matches) {
      hedgingPhrases.push(...matches);
    }
  }

  // Base confidence is 1.0, reduced by markers found
  const totalMarkers = uncertaintyMarkers.length + hedgingPhrases.length;
  const wordCount = response.split(/\s+/).length;
  const markerDensity = totalMarkers / Math.max(1, wordCount / 50);

  // Each marker reduces confidence; density matters more than raw count
  const confidence = Math.max(
    0,
    Math.min(1, 1 - markerDensity * 0.15 - totalMarkers * 0.03)
  );

  return {
    confidence: Math.round(confidence * 100) / 100,
    uncertaintyMarkers: [...new Set(uncertaintyMarkers)],
    hedgingPhrases: [...new Set(hedgingPhrases)],
  };
}

// ============================================================
// Content Filtering (Capabilities 836-838)
// ============================================================

/**
 * Filter content by removing or blocking profanity, PII, harmful content, and custom patterns.
 */
export function filterContent(
  text: string,
  config?: {
    blockProfanity?: boolean;
    blockPII?: boolean;
    blockHarmful?: boolean;
    customBlocklist?: string[];
  }
): { filtered: string; blocked: boolean; reasons: string[] } {
  let filtered = text;
  const reasons: string[] = [];
  let blocked = false;

  // Block profanity
  if (config?.blockProfanity) {
    for (const term of PROFANITY_TERMS) {
      const testRegex = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
      if (testRegex.test(filtered)) {
        reasons.push(`profanity: ${term}`);
        const replaceRegex = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
        filtered = filtered.replace(replaceRegex, (match) => "*".repeat(match.length));
      }
    }
  }

  // Block PII
  if (config?.blockPII) {
    for (const { pattern, type } of PII_PATTERNS) {
      const testRegex = new RegExp(pattern.source, pattern.flags);
      if (testRegex.test(filtered)) {
        reasons.push(`pii: ${type}`);
        filtered = filtered.replace(new RegExp(pattern.source, "g"), `[REDACTED_${type.toUpperCase()}]`);
      }
    }
  }

  // Block harmful content
  if (config?.blockHarmful) {
    for (const { pattern, category, weight } of TOXIC_PATTERNS) {
      if (weight >= 0.8 && pattern.test(filtered)) {
        reasons.push(`harmful: ${category}`);
        blocked = true;
      }
    }
  }

  // Custom blocklist
  if (config?.customBlocklist) {
    for (const term of config.customBlocklist) {
      const testRegex = new RegExp(escapeRegex(term), "gi");
      if (testRegex.test(filtered)) {
        reasons.push(`custom_blocked: ${term}`);
        const replaceRegex = new RegExp(escapeRegex(term), "gi");
        filtered = filtered.replace(replaceRegex, "[BLOCKED]");
      }
    }
  }

  return { filtered, blocked, reasons };
}

// ============================================================
// Memory Management (Capabilities 839-845)
// ============================================================

/**
 * Store a memory entry.
 */
export function storeMemory(
  content: string,
  type: MemoryEntry["type"],
  metadata?: Record<string, any>
): MemoryEntry {
  const id = `mem_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();

  const entry: MemoryEntry = {
    id,
    type,
    content,
    metadata: metadata || {},
    createdAt: now,
    lastAccessed: now,
    accessCount: 0,
    relevanceScore: 1.0,
  };

  memoryStore.set(id, entry);
  console.log(
    `[AIAgentCore] Memory stored: ${id} (type=${type}, len=${content.length})`
  );
  return { ...entry };
}

/**
 * Retrieve memories matching a query using keyword overlap scoring.
 */
export function retrieveMemory(
  query: string,
  type?: MemoryEntry["type"],
  limit: number = 10
): MemoryEntry[] {
  const queryKeywords = extractKeywords(query);
  if (queryKeywords.length === 0) return [];

  const scored: Array<{ entry: MemoryEntry; score: number }> = [];

  for (const entry of memoryStore.values()) {
    if (type && entry.type !== type) continue;

    const contentKeywords = extractKeywords(entry.content);
    const metadataStr = Object.values(entry.metadata)
      .filter((v) => typeof v === "string")
      .join(" ");
    const metadataKeywords = extractKeywords(metadataStr);
    const allKeywords = new Set([...contentKeywords, ...metadataKeywords]);

    // Keyword overlap score
    const overlapCount = queryKeywords.filter((kw) => allKeywords.has(kw)).length;
    const overlapScore = overlapCount / queryKeywords.length;

    // Recency boost (exponential decay, halves every 24h)
    const ageMs = Date.now() - entry.createdAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    const recencyBoost = Math.exp(-ageHours / 24);

    // Access frequency boost (logarithmic)
    const accessBoost = Math.log2(entry.accessCount + 1) * 0.05;

    const totalScore = overlapScore * 0.7 + recencyBoost * 0.2 + accessBoost * 0.1;

    if (totalScore > 0.05) {
      scored.push({ entry, score: totalScore });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Update access metadata for retrieved entries
  const results = scored.slice(0, limit);
  for (const { entry } of results) {
    const stored = memoryStore.get(entry.id);
    if (stored) {
      stored.lastAccessed = new Date();
      stored.accessCount++;
      stored.relevanceScore = results.find((r) => r.entry.id === entry.id)?.score || stored.relevanceScore;
    }
  }

  return results.map(({ entry, score }) => ({
    ...entry,
    relevanceScore: Math.round(score * 1000) / 1000,
  }));
}

/**
 * Update an existing memory entry.
 */
export function updateMemory(
  id: string,
  updates: Partial<MemoryEntry>
): MemoryEntry | null {
  const entry = memoryStore.get(id);
  if (!entry) return null;

  // Apply updates (protect id and createdAt from being overwritten)
  if (updates.content !== undefined) entry.content = updates.content;
  if (updates.type !== undefined) entry.type = updates.type;
  if (updates.metadata !== undefined)
    entry.metadata = { ...entry.metadata, ...updates.metadata };
  if (updates.relevanceScore !== undefined)
    entry.relevanceScore = updates.relevanceScore;

  entry.lastAccessed = new Date();

  return { ...entry };
}

/**
 * Delete a memory entry by ID.
 */
export function deleteMemory(id: string): boolean {
  return memoryStore.delete(id);
}

/**
 * Get aggregate stats about the memory store.
 */
export function getMemoryStats(): {
  total: number;
  byType: Record<string, number>;
  oldestEntry: Date;
  newestEntry: Date;
} {
  const byType: Record<string, number> = {};
  let oldest: Date | null = null;
  let newest: Date | null = null;

  for (const entry of memoryStore.values()) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;
    if (!oldest || entry.createdAt < oldest) oldest = entry.createdAt;
    if (!newest || entry.createdAt > newest) newest = entry.createdAt;
  }

  return {
    total: memoryStore.size,
    byType,
    oldestEntry: oldest || new Date(),
    newestEntry: newest || new Date(),
  };
}

/**
 * Remove stale or excess memory entries.
 * Returns the count of deleted entries.
 */
export function pruneMemory(
  maxAge?: number,
  maxEntries?: number
): number {
  let deleted = 0;
  const now = Date.now();

  // Prune by age
  if (maxAge !== undefined) {
    for (const [id, entry] of memoryStore.entries()) {
      const ageMs = now - entry.createdAt.getTime();
      if (ageMs > maxAge) {
        memoryStore.delete(id);
        deleted++;
      }
    }
  }

  // Prune by max entries (keep the most recently accessed)
  if (maxEntries !== undefined && memoryStore.size > maxEntries) {
    const entries = Array.from(memoryStore.entries()).sort(
      (a, b) => b[1].lastAccessed.getTime() - a[1].lastAccessed.getTime()
    );

    // Keep the top N, delete the rest
    const toDelete = entries.slice(maxEntries);
    for (const [id] of toDelete) {
      memoryStore.delete(id);
      deleted++;
    }
  }

  if (deleted > 0) {
    console.log(
      `[AIAgentCore] Memory pruned: ${deleted} entries removed, ${memoryStore.size} remaining`
    );
  }

  return deleted;
}

/**
 * Summarize a conversation into a concise synopsis.
 * Extracts key topics, decisions, and action items.
 */
export function summarizeConversation(
  messages: Array<{ role: string; content: string }>
): string {
  if (messages.length === 0) return "Empty conversation.";

  // Extract key information
  const allContent = messages.map((m) => m.content).join(" ");
  const keywords = extractKeywords(allContent);
  const topKeywords = getTopKeywords(keywords, 10);

  // Identify questions asked
  const questions = messages
    .filter((m) => m.content.includes("?"))
    .map((m) => {
      const sentences = m.content.split(/[.!?]+/).filter((s) => s.includes("?"));
      return sentences.map((s) => s.trim()).filter(Boolean);
    })
    .flat();

  // Identify action-oriented statements
  const actionPatterns =
    /\b(will|should|must|need to|going to|plan to|let's|let us|we'll|I'll)\b.*?[.!]/gi;
  const actions: string[] = [];
  let actionMatch: RegExpExecArray | null;
  while ((actionMatch = actionPatterns.exec(allContent)) !== null) {
    const actionText = actionMatch[0].trim();
    if (actionText.length > 10 && actionText.length < 200) {
      actions.push(actionText);
    }
  }

  // Build summary
  const parts: string[] = [];

  parts.push(
    `Conversation with ${messages.length} messages between ${[...new Set(messages.map((m) => m.role))].join(" and ")}.`
  );

  if (topKeywords.length > 0) {
    parts.push(`Key topics: ${topKeywords.join(", ")}.`);
  }

  if (questions.length > 0) {
    const displayQuestions = questions.slice(0, 3);
    parts.push(
      `Questions raised: ${displayQuestions.map((q) => `"${q.slice(0, 80)}"`).join("; ")}.`
    );
  }

  if (actions.length > 0) {
    const displayActions = actions.slice(0, 3);
    parts.push(
      `Action items: ${displayActions.map((a) => a.slice(0, 80)).join("; ")}.`
    );
  }

  // Last message as context
  const lastMsg = messages[messages.length - 1];
  const lastSnippet = lastMsg.content.slice(0, 100);
  parts.push(
    `Last message (${lastMsg.role}): "${lastSnippet}${lastMsg.content.length > 100 ? "..." : ""}"`
  );

  return parts.join(" ");
}

// ============================================================
// Streaming & Response (Capabilities 846-848)
// ============================================================

/**
 * Create a streaming handler that buffers chunks.
 */
export function createStreamHandler(): {
  write: (chunk: string) => void;
  end: () => void;
  getBuffer: () => string;
  getChunkCount: () => number;
} {
  let buffer = "";
  let chunkCount = 0;
  let ended = false;

  return {
    write(chunk: string): void {
      if (ended) {
        console.warn("[AIAgentCore] StreamHandler: write called after end()");
        return;
      }
      buffer += chunk;
      chunkCount++;
    },
    end(): void {
      ended = true;
    },
    getBuffer(): string {
      return buffer;
    },
    getChunkCount(): number {
      return chunkCount;
    },
  };
}

/**
 * Cache a response with an optional TTL.
 */
export function cacheResponse(
  key: string,
  response: string,
  ttlMs: number = 5 * 60 * 1000
): void {
  responseCache.set(key, {
    response,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Retrieve a cached response. Returns null if not found or expired.
 */
export function getCachedResponse(key: string): string | null {
  const entry = responseCache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }

  return entry.response;
}

/**
 * Detect and remove duplicate content between a response and previous responses.
 * Uses sentence-level deduplication.
 */
export function deduplicateResponse(
  response: string,
  previousResponses: string[]
): { deduplicated: string; duplicateRatio: number } {
  if (previousResponses.length === 0) {
    return { deduplicated: response, duplicateRatio: 0 };
  }

  // Break all previous responses into sentence-level fragments
  const previousSentences = new Set<string>();
  for (const prev of previousResponses) {
    const sentences = prev
      .split(/[.!?]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 10);
    for (const s of sentences) {
      previousSentences.add(s);
    }
  }

  // Split current response into sentences
  const responseSentences = response
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);

  let duplicateCount = 0;
  const keptSentences: string[] = [];

  for (const sentence of responseSentences) {
    const normalized = sentence.trim().toLowerCase().replace(/[.!?]+$/, "");
    if (normalized.length <= 10) {
      keptSentences.push(sentence);
      continue;
    }

    // Check if this sentence (or something very similar) appeared before
    let isDuplicate = false;
    for (const prev of previousSentences) {
      const similarity = computeJaccardSimilarity(normalized, prev);
      if (similarity > 0.8) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      duplicateCount++;
    } else {
      keptSentences.push(sentence);
    }
  }

  const totalSentences = responseSentences.length;
  const duplicateRatio =
    totalSentences > 0
      ? Math.round((duplicateCount / totalSentences) * 100) / 100
      : 0;

  return {
    deduplicated: keptSentences.join(" ").trim(),
    duplicateRatio,
  };
}

// ============================================================
// Tool Execution (Capabilities 849-850)
// ============================================================

// Known tool catalog for capability discovery
const TOOL_CATALOG: Record<
  string,
  {
    description: string;
    inputSchema: Record<string, any>;
    category: string;
  }
> = {
  web_search: {
    description: "Search the web for information using a query string",
    inputSchema: {
      query: { type: "string", required: true },
      maxResults: { type: "number", required: false },
    },
    category: "search",
  },
  read_file: {
    description: "Read the contents of a file from the filesystem",
    inputSchema: {
      path: { type: "string", required: true },
      encoding: { type: "string", required: false },
    },
    category: "filesystem",
  },
  write_file: {
    description: "Write content to a file on the filesystem",
    inputSchema: {
      path: { type: "string", required: true },
      content: { type: "string", required: true },
    },
    category: "filesystem",
  },
  execute_code: {
    description: "Execute code in a sandboxed environment",
    inputSchema: {
      language: { type: "string", required: true },
      code: { type: "string", required: true },
      timeout: { type: "number", required: false },
    },
    category: "execution",
  },
  data_analyze: {
    description: "Analyze structured data and compute statistics",
    inputSchema: {
      data: { type: "array", required: true },
      operation: { type: "string", required: true },
    },
    category: "analysis",
  },
  memory_store: {
    description: "Store information in the agent memory system",
    inputSchema: {
      content: { type: "string", required: true },
      type: { type: "string", required: false },
    },
    category: "memory",
  },
  memory_retrieve: {
    description: "Retrieve relevant information from agent memory",
    inputSchema: {
      query: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    category: "memory",
  },
  api_call: {
    description: "Make an HTTP API call to an external service",
    inputSchema: {
      url: { type: "string", required: true },
      method: { type: "string", required: true },
      headers: { type: "object", required: false },
      body: { type: "object", required: false },
    },
    category: "network",
  },
  summarize: {
    description: "Summarize a long text into a concise form",
    inputSchema: {
      text: { type: "string", required: true },
      maxLength: { type: "number", required: false },
    },
    category: "text",
  },
  translate: {
    description: "Translate text from one language to another",
    inputSchema: {
      text: { type: "string", required: true },
      targetLang: { type: "string", required: true },
      sourceLang: { type: "string", required: false },
    },
    category: "text",
  },
};

/**
 * Create a tool execution plan by analyzing the task and mapping it to tools.
 * Uses keyword heuristics to determine which tools are needed and in what order.
 */
export function createToolExecutionPlan(
  tools: string[],
  task: string
): Array<{
  step: number;
  tool: string;
  input: Record<string, any>;
  dependsOn: number[];
  parallel: boolean;
}> {
  const lower = task.toLowerCase();
  const plan: Array<{
    step: number;
    tool: string;
    input: Record<string, any>;
    dependsOn: number[];
    parallel: boolean;
  }> = [];

  let stepNum = 1;

  // Keyword-to-tool mapping with input extraction heuristics
  const toolTriggers: Array<{
    tool: string;
    keywords: string[];
    extractInput: (task: string) => Record<string, any>;
    phase: number; // lower = earlier in plan
  }> = [
    {
      tool: "web_search",
      keywords: ["search", "find", "look up", "google", "web"],
      extractInput: (t: string) => ({
        query: t.replace(/\b(search|find|look up|google)\b/gi, "").trim(),
        maxResults: 5,
      }),
      phase: 1,
    },
    {
      tool: "read_file",
      keywords: ["read", "open", "load", "file", "import"],
      extractInput: (t: string) => {
        const pathMatch = t.match(/['"]([^'"]+)['"]/);
        return { path: pathMatch ? pathMatch[1] : "unknown", encoding: "utf-8" };
      },
      phase: 1,
    },
    {
      tool: "memory_retrieve",
      keywords: ["remember", "recall", "memory", "previous", "history"],
      extractInput: (t: string) => ({ query: t, limit: 5 }),
      phase: 1,
    },
    {
      tool: "data_analyze",
      keywords: ["analyze", "statistics", "compute", "calculate", "chart"],
      extractInput: (t: string) => ({ data: [], operation: "summary" }),
      phase: 2,
    },
    {
      tool: "execute_code",
      keywords: ["run", "execute", "code", "script", "program"],
      extractInput: (t: string) => ({
        language: "javascript",
        code: "",
        timeout: 30000,
      }),
      phase: 2,
    },
    {
      tool: "summarize",
      keywords: ["summarize", "summary", "brief", "condense", "tldr"],
      extractInput: (t: string) => ({ text: "", maxLength: 500 }),
      phase: 3,
    },
    {
      tool: "translate",
      keywords: ["translate", "translation", "language", "convert to"],
      extractInput: (t: string) => {
        const langMatch = t.match(
          /\b(to|into)\s+(english|spanish|french|german|chinese|japanese|korean|arabic|russian|hindi)\b/i
        );
        return {
          text: "",
          targetLang: langMatch ? langMatch[2].toLowerCase() : "english",
        };
      },
      phase: 3,
    },
    {
      tool: "write_file",
      keywords: ["write", "save", "export", "output", "create file"],
      extractInput: (t: string) => {
        const pathMatch = t.match(/['"]([^'"]+)['"]/);
        return { path: pathMatch ? pathMatch[1] : "output.txt", content: "" };
      },
      phase: 4,
    },
    {
      tool: "memory_store",
      keywords: ["store", "save memory", "remember this", "memorize"],
      extractInput: (t: string) => ({ content: t, type: "episodic" }),
      phase: 4,
    },
    {
      tool: "api_call",
      keywords: ["api", "http", "request", "endpoint", "fetch url"],
      extractInput: (t: string) => {
        const urlMatch = t.match(/https?:\/\/\S+/);
        return {
          url: urlMatch ? urlMatch[0] : "",
          method: "GET",
        };
      },
      phase: 2,
    },
  ];

  // Determine which tools match the task
  const matchedTriggers = toolTriggers
    .filter(
      (trigger) =>
        tools.includes(trigger.tool) &&
        trigger.keywords.some((kw) => lower.includes(kw))
    )
    .sort((a, b) => a.phase - b.phase);

  // If no matches, create a single step with the first available tool
  if (matchedTriggers.length === 0 && tools.length > 0) {
    plan.push({
      step: 1,
      tool: tools[0],
      input: { task },
      dependsOn: [],
      parallel: false,
    });
    return plan;
  }

  // Build the plan with phase-based dependencies
  let prevPhase = 0;
  const phaseSteps = new Map<number, number[]>();

  for (const trigger of matchedTriggers) {
    const step = stepNum++;
    const dependsOn: number[] = [];

    // Steps in later phases depend on all steps in the immediately preceding phase
    if (trigger.phase > prevPhase && phaseSteps.has(prevPhase)) {
      dependsOn.push(...(phaseSteps.get(prevPhase) || []));
    }

    const parallel =
      phaseSteps.has(trigger.phase) &&
      (phaseSteps.get(trigger.phase)?.length || 0) > 0;

    if (!phaseSteps.has(trigger.phase)) {
      phaseSteps.set(trigger.phase, []);
    }
    phaseSteps.get(trigger.phase)!.push(step);

    plan.push({
      step,
      tool: trigger.tool,
      input: trigger.extractInput(task),
      dependsOn,
      parallel,
    });

    prevPhase = trigger.phase;
  }

  return plan;
}

/**
 * Given a set of execution steps with dependency info, determine which groups of
 * steps can run in parallel. Returns arrays of step numbers that form parallel groups.
 */
export function canExecuteInParallel(
  steps: Array<{ step: number; dependsOn: number[] }>
): number[][] {
  if (steps.length === 0) return [];

  // Build a map of step -> dependencies
  const stepMap = new Map<number, Set<number>>();
  const allSteps = new Set<number>();

  for (const s of steps) {
    stepMap.set(s.step, new Set(s.dependsOn));
    allSteps.add(s.step);
  }

  const groups: number[][] = [];
  const completed = new Set<number>();

  // Topological sort with level grouping (Kahn's algorithm)
  while (completed.size < allSteps.size) {
    const ready: number[] = [];

    for (const step of allSteps) {
      if (completed.has(step)) continue;

      const deps = stepMap.get(step) || new Set();
      const allDepsCompleted = [...deps].every((d) => completed.has(d));

      if (allDepsCompleted) {
        ready.push(step);
      }
    }

    // Safety: if no steps are ready but we haven't completed all, break (cycle detection)
    if (ready.length === 0) {
      // Add remaining steps as a final group
      const remaining = [...allSteps].filter((s) => !completed.has(s));
      if (remaining.length > 0) groups.push(remaining.sort((a, b) => a - b));
      break;
    }

    ready.sort((a, b) => a - b);
    groups.push(ready);

    for (const step of ready) {
      completed.add(step);
    }
  }

  return groups;
}

/**
 * Discover capabilities of given tools from the catalog.
 */
export function discoverToolCapabilities(
  toolNames: string[]
): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  category: string;
}> {
  const results: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, any>;
    category: string;
  }> = [];

  for (const name of toolNames) {
    const catalogEntry = TOOL_CATALOG[name];
    if (catalogEntry) {
      results.push({
        name,
        description: catalogEntry.description,
        inputSchema: { ...catalogEntry.inputSchema },
        category: catalogEntry.category,
      });
    } else {
      // Unknown tool: return a minimal description
      results.push({
        name,
        description: `Tool "${name}" — no catalog entry found`,
        inputSchema: {},
        category: "unknown",
      });
    }
  }

  return results;
}

// ============================================================
// Internal Helpers
// ============================================================

/**
 * Extract meaningful keywords from text (stopword-filtered, lowercased).
 */
function extractKeywords(text: string): string[] {
  const STOP_WORDS = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "about", "between",
    "through", "during", "before", "after", "above", "below", "up", "down",
    "and", "but", "or", "nor", "not", "no", "so", "if", "then", "else",
    "when", "while", "where", "how", "what", "which", "who", "whom",
    "this", "that", "these", "those", "it", "its", "i", "me", "my",
    "we", "our", "you", "your", "he", "him", "his", "she", "her",
    "they", "them", "their", "just", "also", "very", "too", "only",
    "more", "most", "some", "any", "all", "each", "every", "both",
    "few", "many", "much", "such", "than", "well", "back", "even",
    "still", "here", "there", "now", "then", "once", "over", "out",
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Get the top N most frequent keywords.
 */
function getTopKeywords(keywords: string[], n: number): string[] {
  const freq = new Map<string, number>();
  for (const kw of keywords) {
    freq.set(kw, (freq.get(kw) || 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word]) => word);
}

/**
 * Compute Jaccard similarity between two strings (word-level).
 */
function computeJaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));

  let intersectionSize = 0;
  for (const word of setA) {
    if (setB.has(word)) intersectionSize++;
  }

  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

/**
 * Escape a string for use in a RegExp constructor.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
