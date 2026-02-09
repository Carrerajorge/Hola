/**
 * Autonomous Agent Brain - Self-Initiative Decision Making
 *
 * The "brain" of ILIAGPT that enables true autonomous behavior:
 * - Goal decomposition into sub-tasks
 * - Self-initiated information gathering
 * - Proactive verification and error correction
 * - Multi-step planning with backtracking
 * - Learning from outcomes (reinforcement-style)
 * - Context-aware decision making
 * - Tool selection and chaining
 * - Self-reflection and improvement
 *
 * Implements a ReAct (Reasoning + Acting) loop with:
 * Think -> Plan -> Act -> Observe -> Reflect -> Repeat
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import OpenAI from "openai";

// ============================================
// Types
// ============================================

export type AgentState = "idle" | "thinking" | "planning" | "acting" | "observing" | "reflecting" | "completed" | "error" | "waiting_confirmation";

export interface AgentGoal {
  id: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  category: "research" | "browser_control" | "document_creation" | "data_analysis" | "communication" | "system_control" | "mixed";
  constraints: GoalConstraints;
  successCriteria: string[];
  parentGoalId?: string;
  subGoals?: AgentGoal[];
}

export interface GoalConstraints {
  maxDuration: number;      // ms
  maxActions: number;
  maxCost: number;          // estimated API cost
  requireConfirmation: boolean;
  allowedTools: string[];
  blockedTools: string[];
  safetyLevel: "strict" | "moderate" | "permissive";
}

export interface ThoughtProcess {
  id: string;
  timestamp: number;
  type: "reasoning" | "planning" | "reflection" | "observation" | "decision";
  content: string;
  confidence: number;
  metadata?: Record<string, any>;
}

export interface ActionPlan {
  id: string;
  goalId: string;
  steps: PlannedAction[];
  estimatedDuration: number;
  estimatedCost: number;
  alternativePlans: ActionPlan[];
  confidence: number;
  reasoning: string;
}

export interface PlannedAction {
  id: string;
  order: number;
  tool: string;
  parameters: Record<string, any>;
  description: string;
  expectedOutcome: string;
  fallbackTool?: string;
  fallbackParams?: Record<string, any>;
  isOptional: boolean;
  dependsOn: string[];    // ids of actions this depends on
  estimatedDuration: number;
}

export interface ActionOutcome {
  actionId: string;
  success: boolean;
  result: any;
  duration: number;
  error?: string;
  sideEffects?: string[];
  unexpectedChanges?: string[];
}

export interface ReflectionResult {
  assessment: "on_track" | "needs_adjustment" | "stuck" | "completed" | "failed";
  progress: number;          // 0-100
  lessonsLearned: string[];
  adjustments: string[];
  nextSteps: string[];
  shouldBacktrack: boolean;
  backtrackTo?: string;     // step id
  confidence: number;
}

export interface AgentMemory {
  shortTerm: MemoryItem[];   // Current session
  episodic: EpisodicMemory[]; // Past experiences
  semantic: SemanticKnowledge[]; // Learned facts
  procedural: ProceduralMemory[]; // Learned procedures
}

export interface MemoryItem {
  id: string;
  type: "thought" | "action" | "observation" | "feedback";
  content: string;
  timestamp: number;
  importance: number;    // 0-1
  decayRate: number;
}

export interface EpisodicMemory {
  id: string;
  goalDescription: string;
  actions: string[];
  outcome: "success" | "failure" | "partial";
  lessons: string[];
  timestamp: number;
  relevance: number;
}

export interface SemanticKnowledge {
  id: string;
  fact: string;
  source: string;
  confidence: number;
  lastVerified: number;
  category: string;
}

export interface ProceduralMemory {
  id: string;
  name: string;
  description: string;
  steps: string[];
  successRate: number;
  usageCount: number;
  lastUsed: number;
  applicableContexts: string[];
}

export interface ToolCapability {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  category: string;
  costEstimate: number;
  reliability: number;
  avgDuration: number;
}

export interface AgentContext {
  userId: string;
  sessionId: string;
  workspaceId?: string;
  conversationHistory: Array<{ role: string; content: string }>;
  availableTools: ToolCapability[];
  userPreferences: Record<string, any>;
  environmentInfo: Record<string, any>;
}

export interface BrainConfig {
  model: string;
  maxThinkingDepth: number;
  confidenceThreshold: number;
  maxActionsPerGoal: number;
  reflectionFrequency: number;
  learningEnabled: boolean;
  safetyChecksEnabled: boolean;
  parallelActionLimit: number;
}

// ============================================
// Autonomous Agent Brain
// ============================================

export class AutonomousAgentBrain extends EventEmitter {
  private llmClient: OpenAI;
  private config: BrainConfig;
  private state: AgentState = "idle";
  private currentGoal: AgentGoal | null = null;
  private currentPlan: ActionPlan | null = null;
  private memory: AgentMemory;
  private thoughtLog: ThoughtProcess[] = [];
  private actionHistory: ActionOutcome[] = [];
  private toolExecutors: Map<string, (params: any) => Promise<any>> = new Map();

  constructor(options?: {
    apiKey?: string;
    baseURL?: string;
    config?: Partial<BrainConfig>;
  }) {
    super();

    this.llmClient = new OpenAI({
      baseURL: options?.baseURL || (process.env.XAI_API_KEY ? "https://api.x.ai/v1" : "https://api.openai.com/v1"),
      apiKey: options?.apiKey || process.env.XAI_API_KEY || process.env.OPENAI_API_KEY || "missing",
    });

    this.config = {
      model: "grok-4-1-fast-non-reasoning",
      maxThinkingDepth: 10,
      confidenceThreshold: 0.7,
      maxActionsPerGoal: 50,
      reflectionFrequency: 5,
      learningEnabled: true,
      safetyChecksEnabled: true,
      parallelActionLimit: 3,
      ...options?.config,
    };

    this.memory = {
      shortTerm: [],
      episodic: [],
      semantic: [],
      procedural: [],
    };
  }

  // ============================================
  // Tool Registration
  // ============================================

  registerTool(name: string, executor: (params: any) => Promise<any>): void {
    this.toolExecutors.set(name, executor);
  }

  registerTools(tools: Record<string, (params: any) => Promise<any>>): void {
    for (const [name, executor] of Object.entries(tools)) {
      this.toolExecutors.set(name, executor);
    }
  }

  // ============================================
  // Main Execution Loop (ReAct)
  // ============================================

  async executeGoal(goal: AgentGoal, context: AgentContext, onProgress?: (event: {
    state: AgentState;
    thought?: ThoughtProcess;
    action?: PlannedAction;
    outcome?: ActionOutcome;
    reflection?: ReflectionResult;
    progress: number;
  }) => void): Promise<{
    success: boolean;
    result: any;
    thoughts: ThoughtProcess[];
    actions: ActionOutcome[];
    reflections: ReflectionResult[];
    summary: string;
    duration: number;
  }> {
    const startTime = Date.now();
    this.currentGoal = goal;
    this.thoughtLog = [];
    this.actionHistory = [];
    const reflections: ReflectionResult[] = [];
    let actionCount = 0;
    let result: any = null;

    try {
      // Phase 1: THINK - Understand the goal
      this.setState("thinking");
      const understanding = await this.think(goal, context);
      onProgress?.({ state: "thinking", thought: understanding, progress: 5 });

      // Phase 2: PLAN - Create execution plan
      this.setState("planning");
      const plan = await this.createPlan(goal, context, understanding);
      this.currentPlan = plan;
      onProgress?.({ state: "planning", progress: 15 });

      // Phase 3: ACT + OBSERVE + REFLECT loop
      for (const action of plan.steps) {
        if (actionCount >= goal.constraints.maxActions) break;
        if (Date.now() - startTime > goal.constraints.maxDuration) break;

        // Check dependencies
        const depsOk = action.dependsOn.every(depId =>
          this.actionHistory.some(a => a.actionId === depId && a.success)
        );
        if (!depsOk && !action.isOptional) {
          this.addThought("reasoning", `Skipping action "${action.description}" - dependencies not met`, 0.9);
          continue;
        }

        // Safety check
        if (this.config.safetyChecksEnabled) {
          const safe = await this.safetyCheck(action, context);
          if (!safe.approved) {
            this.addThought("reasoning", `Action blocked by safety: ${safe.reason}`, 0.95);
            if (goal.constraints.requireConfirmation) {
              this.setState("waiting_confirmation");
              onProgress?.({ state: "waiting_confirmation", action, progress: this.calculateProgress(actionCount, plan.steps.length) });
              continue;
            }
            continue;
          }
        }

        // ACT
        this.setState("acting");
        const outcome = await this.executeAction(action, context);
        this.actionHistory.push(outcome);
        actionCount++;

        onProgress?.({
          state: "acting",
          action,
          outcome,
          progress: this.calculateProgress(actionCount, plan.steps.length),
        });

        // OBSERVE
        this.setState("observing");
        await this.observe(outcome, action);

        // REFLECT (periodically)
        if (actionCount % this.config.reflectionFrequency === 0 || !outcome.success) {
          this.setState("reflecting");
          const reflection = await this.reflect(goal, context, plan, this.actionHistory);
          reflections.push(reflection);

          onProgress?.({
            state: "reflecting",
            reflection,
            progress: this.calculateProgress(actionCount, plan.steps.length),
          });

          // Handle reflection results
          if (reflection.assessment === "completed") {
            break;
          }
          if (reflection.shouldBacktrack && reflection.backtrackTo) {
            // Re-plan from backtrack point
            const newPlan = await this.replan(goal, context, reflection, plan);
            if (newPlan) {
              this.currentPlan = newPlan;
              // Replace remaining steps
              plan.steps.splice(actionCount);
              plan.steps.push(...newPlan.steps);
            }
          }
          if (reflection.assessment === "failed" && !action.isOptional) {
            // Try fallback
            if (action.fallbackTool) {
              const fallbackAction = { ...action, tool: action.fallbackTool, parameters: action.fallbackParams || action.parameters };
              const fallbackOutcome = await this.executeAction(fallbackAction, context);
              this.actionHistory.push(fallbackOutcome);
              actionCount++;
            }
          }
        }
      }

      // Phase 4: Final assessment
      const finalReflection = await this.reflect(goal, context, plan, this.actionHistory);
      reflections.push(finalReflection);

      // Compile result
      result = this.compileResult(goal, this.actionHistory);

      // Learn from this experience
      if (this.config.learningEnabled) {
        await this.learn(goal, this.actionHistory, reflections, finalReflection);
      }

      this.setState("completed");
      const success = finalReflection.assessment === "completed" || finalReflection.progress >= 80;

      return {
        success,
        result,
        thoughts: this.thoughtLog,
        actions: this.actionHistory,
        reflections,
        summary: await this.generateSummary(goal, this.actionHistory, success),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.setState("error");
      return {
        success: false,
        result: null,
        thoughts: this.thoughtLog,
        actions: this.actionHistory,
        reflections,
        summary: `Goal failed: ${error.message}`,
        duration: Date.now() - startTime,
      };
    }
  }

  // ============================================
  // THINK - Understanding and Reasoning
  // ============================================

  private async think(goal: AgentGoal, context: AgentContext): Promise<ThoughtProcess> {
    const relevantMemories = this.retrieveRelevantMemories(goal.description);
    const relevantProcedures = this.findRelevantProcedures(goal.category);

    const prompt = `You are an autonomous AI agent reasoning about a task.

GOAL: ${goal.description}
CATEGORY: ${goal.category}
PRIORITY: ${goal.priority}
SUCCESS CRITERIA: ${goal.successCriteria.join(", ")}
CONSTRAINTS: Max ${goal.constraints.maxActions} actions, ${goal.constraints.maxDuration / 1000}s timeout

AVAILABLE TOOLS: ${context.availableTools.map(t => `${t.name}: ${t.description}`).join("\n")}

RELEVANT PAST EXPERIENCES:
${relevantMemories.map(m => `- ${m.content} (importance: ${m.importance})`).join("\n") || "None"}

KNOWN PROCEDURES:
${relevantProcedures.map(p => `- ${p.name}: ${p.steps.join(" -> ")} (success rate: ${p.successRate})`).join("\n") || "None"}

CONVERSATION CONTEXT:
${context.conversationHistory.slice(-5).map(h => `${h.role}: ${h.content}`).join("\n")}

Think step by step about:
1. What exactly needs to be accomplished?
2. What information do I need that I don't have?
3. What tools will I need?
4. What could go wrong?
5. What's the most efficient approach?
6. Are there any safety concerns?

Respond in JSON:
{
  "understanding": "clear restatement of the goal",
  "informationGaps": ["what I need to find out"],
  "requiredTools": ["tool names"],
  "risks": ["potential problems"],
  "approach": "high-level strategy",
  "estimatedSteps": number,
  "confidence": 0-1,
  "shouldProceed": true/false,
  "reasoning": "detailed reasoning"
}`;

    const response = await this.llmClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: "You are a precise analytical AI that reasons about tasks. Respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.2,
    });

    const text = response.choices[0]?.message?.content || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let parsed: any = {};
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { /* use empty default */ }
    }

    const thought: ThoughtProcess = {
      id: randomUUID(),
      timestamp: Date.now(),
      type: "reasoning",
      content: parsed.reasoning || "Analyzed the goal",
      confidence: parsed.confidence || 0.5,
      metadata: parsed,
    };

    this.thoughtLog.push(thought);
    this.addMemory("thought", thought.content, thought.confidence);

    return thought;
  }

  // ============================================
  // PLAN - Creating Execution Plans
  // ============================================

  private async createPlan(goal: AgentGoal, context: AgentContext, understanding: ThoughtProcess): Promise<ActionPlan> {
    const metadata = understanding.metadata || {};

    const prompt = `Create a detailed execution plan for this goal.

GOAL: ${goal.description}
UNDERSTANDING: ${metadata.understanding || goal.description}
APPROACH: ${metadata.approach || "direct"}
REQUIRED TOOLS: ${(metadata.requiredTools || []).join(", ")}
INFORMATION GAPS: ${(metadata.informationGaps || []).join(", ")}

AVAILABLE TOOLS (with descriptions):
${context.availableTools.map(t => `- ${t.name}: ${t.description} [cost: ${t.costEstimate}, reliability: ${t.reliability}]`).join("\n")}

Create a step-by-step plan. Each step should have:
- tool: which tool to use
- parameters: input parameters
- description: what this step does
- expectedOutcome: what we expect
- fallbackTool: alternative if this fails
- isOptional: can we skip this?
- dependsOn: which step ids this depends on

Respond in JSON:
{
  "steps": [
    {
      "id": "step_1",
      "order": 1,
      "tool": "tool_name",
      "parameters": {},
      "description": "what this does",
      "expectedOutcome": "what we expect",
      "fallbackTool": "alternative_tool",
      "isOptional": false,
      "dependsOn": [],
      "estimatedDuration": 5000
    }
  ],
  "estimatedDuration": 30000,
  "estimatedCost": 0.01,
  "confidence": 0.85,
  "reasoning": "why this plan"
}`;

    const response = await this.llmClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: "You are a strategic planner. Create detailed, executable action plans. Respond only with valid JSON." },
        { role: "user", content: prompt },
      ],
      max_tokens: 4096,
      temperature: 0.2,
    });

    const text = response.choices[0]?.message?.content || "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let parsed: any = { steps: [] };
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { /* use empty default */ }
    }

    const plan: ActionPlan = {
      id: randomUUID(),
      goalId: goal.id,
      steps: (parsed.steps || []).map((s: any, i: number) => ({
        id: s.id || `step_${i + 1}`,
        order: s.order || i + 1,
        tool: s.tool || "unknown",
        parameters: s.parameters || {},
        description: s.description || "",
        expectedOutcome: s.expectedOutcome || "",
        fallbackTool: s.fallbackTool,
        fallbackParams: s.fallbackParams,
        isOptional: s.isOptional || false,
        dependsOn: s.dependsOn || [],
        estimatedDuration: s.estimatedDuration || 5000,
      })),
      estimatedDuration: parsed.estimatedDuration || 30000,
      estimatedCost: parsed.estimatedCost || 0,
      alternativePlans: [],
      confidence: parsed.confidence || 0.7,
      reasoning: parsed.reasoning || "",
    };

    this.addThought("planning", `Created plan with ${plan.steps.length} steps: ${plan.reasoning}`, plan.confidence);

    return plan;
  }

  // ============================================
  // ACT - Execute Actions
  // ============================================

  private async executeAction(action: PlannedAction, context: AgentContext): Promise<ActionOutcome> {
    const startTime = Date.now();

    const executor = this.toolExecutors.get(action.tool);
    if (!executor) {
      return {
        actionId: action.id,
        success: false,
        result: null,
        duration: Date.now() - startTime,
        error: `Tool not found: ${action.tool}`,
      };
    }

    try {
      const result = await executor(action.parameters);

      return {
        actionId: action.id,
        success: true,
        result,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        actionId: action.id,
        success: false,
        result: null,
        duration: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  // ============================================
  // OBSERVE - Analyze Outcomes
  // ============================================

  private async observe(outcome: ActionOutcome, action: PlannedAction): Promise<void> {
    const observation = outcome.success
      ? `Action "${action.description}" succeeded. Result: ${JSON.stringify(outcome.result).slice(0, 500)}`
      : `Action "${action.description}" failed: ${outcome.error}`;

    this.addThought("observation", observation, outcome.success ? 0.9 : 0.3);
    this.addMemory("observation", observation, outcome.success ? 0.8 : 0.6);
  }

  // ============================================
  // REFLECT - Self-Assessment
  // ============================================

  private async reflect(
    goal: AgentGoal,
    context: AgentContext,
    plan: ActionPlan,
    outcomes: ActionOutcome[]
  ): Promise<ReflectionResult> {
    const successCount = outcomes.filter(o => o.success).length;
    const failCount = outcomes.filter(o => !o.success).length;

    const prompt = `Reflect on the progress toward the goal.

GOAL: ${goal.description}
SUCCESS CRITERIA: ${goal.successCriteria.join(", ")}

ACTIONS TAKEN (${outcomes.length}):
${outcomes.map((o, i) => {
  const step = plan.steps[i];
  return `${i + 1}. [${o.success ? "SUCCESS" : "FAILED"}] ${step?.description || "unknown"}: ${o.success ? JSON.stringify(o.result).slice(0, 200) : o.error}`;
}).join("\n")}

STATS: ${successCount} succeeded, ${failCount} failed

Assess progress and decide next steps. Respond in JSON:
{
  "assessment": "on_track" | "needs_adjustment" | "stuck" | "completed" | "failed",
  "progress": 0-100,
  "lessonsLearned": ["lesson1", "lesson2"],
  "adjustments": ["what to change"],
  "nextSteps": ["next action"],
  "shouldBacktrack": false,
  "backtrackTo": null,
  "confidence": 0-1,
  "reasoning": "detailed analysis"
}`;

    try {
      const response = await this.llmClient.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: "system", content: "You are a self-reflective AI analyzing task progress. Be honest about failures. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
        max_tokens: 1024,
        temperature: 0.2,
      });

      const text = response.choices[0]?.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let parsed: any = {};
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* use empty default */ }
      }

      const reflection: ReflectionResult = {
        assessment: parsed.assessment || "on_track",
        progress: parsed.progress || Math.round((successCount / Math.max(outcomes.length, 1)) * 100),
        lessonsLearned: parsed.lessonsLearned || [],
        adjustments: parsed.adjustments || [],
        nextSteps: parsed.nextSteps || [],
        shouldBacktrack: parsed.shouldBacktrack || false,
        backtrackTo: parsed.backtrackTo,
        confidence: parsed.confidence || 0.5,
      };

      this.addThought("reflection", parsed.reasoning || "Reflected on progress", reflection.confidence);

      return reflection;
    } catch {
      return {
        assessment: "on_track",
        progress: Math.round((successCount / Math.max(outcomes.length, 1)) * 100),
        lessonsLearned: [],
        adjustments: [],
        nextSteps: [],
        shouldBacktrack: false,
        confidence: 0.3,
      };
    }
  }

  // ============================================
  // RE-PLAN - Adjust Strategy
  // ============================================

  private async replan(
    goal: AgentGoal,
    context: AgentContext,
    reflection: ReflectionResult,
    originalPlan: ActionPlan
  ): Promise<ActionPlan | null> {
    const prompt = `The original plan needs adjustment.

GOAL: ${goal.description}
ORIGINAL PLAN: ${originalPlan.steps.map(s => s.description).join(" -> ")}
REFLECTION: ${JSON.stringify(reflection)}
ADJUSTMENTS NEEDED: ${reflection.adjustments.join(", ")}

Create a revised plan from this point forward. Same JSON format as before.`;

    try {
      const response = await this.llmClient.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: "system", content: "You revise action plans based on reflection. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
        max_tokens: 2048,
        temperature: 0.3,
      });

      const text = response.choices[0]?.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let parsed: any = { steps: [] };
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* use empty default */ }
      }

      return {
        id: randomUUID(),
        goalId: goal.id,
        steps: (parsed.steps || []).map((s: any, i: number) => ({
          id: s.id || `revised_step_${i + 1}`,
          order: s.order || i + 1,
          tool: s.tool || "unknown",
          parameters: s.parameters || {},
          description: s.description || "",
          expectedOutcome: s.expectedOutcome || "",
          fallbackTool: s.fallbackTool,
          isOptional: s.isOptional || false,
          dependsOn: s.dependsOn || [],
          estimatedDuration: s.estimatedDuration || 5000,
        })),
        estimatedDuration: parsed.estimatedDuration || 30000,
        estimatedCost: parsed.estimatedCost || 0,
        alternativePlans: [],
        confidence: parsed.confidence || 0.6,
        reasoning: parsed.reasoning || "Revised plan",
      };
    } catch {
      return null;
    }
  }

  // ============================================
  // Safety Checks
  // ============================================

  private async safetyCheck(action: PlannedAction, context: AgentContext): Promise<{ approved: boolean; reason?: string }> {
    // Check blocked tools
    if (this.currentGoal?.constraints.blockedTools.includes(action.tool)) {
      return { approved: false, reason: `Tool ${action.tool} is blocked` };
    }

    // Check allowed tools
    if (this.currentGoal?.constraints.allowedTools.length &&
      !this.currentGoal.constraints.allowedTools.includes(action.tool)) {
      return { approved: false, reason: `Tool ${action.tool} is not in allowed list` };
    }

    // Dangerous action patterns
    const dangerousPatterns = [
      { pattern: /rm\s+-rf/i, reason: "Recursive file deletion" },
      { pattern: /drop\s+table/i, reason: "Database table deletion" },
      { pattern: /format\s+/i, reason: "Disk formatting" },
      { pattern: /shutdown|reboot/i, reason: "System shutdown/reboot" },
      { pattern: /DELETE\s+FROM.*WHERE\s+1/i, reason: "Mass data deletion" },
    ];

    const paramStr = JSON.stringify(action.parameters);
    for (const { pattern, reason } of dangerousPatterns) {
      if (pattern.test(paramStr)) {
        return { approved: false, reason: `Dangerous operation detected: ${reason}` };
      }
    }

    return { approved: true };
  }

  // ============================================
  // Learning
  // ============================================

  private async learn(
    goal: AgentGoal,
    outcomes: ActionOutcome[],
    reflections: ReflectionResult[],
    finalReflection: ReflectionResult
  ): Promise<void> {
    const success = finalReflection.assessment === "completed";
    const successRate = outcomes.filter(o => o.success).length / Math.max(outcomes.length, 1);

    // Store episodic memory
    this.memory.episodic.push({
      id: randomUUID(),
      goalDescription: goal.description,
      actions: outcomes.map(o => o.actionId),
      outcome: success ? "success" : successRate > 0.5 ? "partial" : "failure",
      lessons: reflections.flatMap(r => r.lessonsLearned),
      timestamp: Date.now(),
      relevance: 1.0,
    });

    // Extract semantic knowledge
    for (const reflection of reflections) {
      for (const lesson of reflection.lessonsLearned) {
        this.memory.semantic.push({
          id: randomUUID(),
          fact: lesson,
          source: `goal: ${goal.description}`,
          confidence: reflection.confidence,
          lastVerified: Date.now(),
          category: goal.category,
        });
      }
    }

    // Update or create procedural memory
    if (success && this.currentPlan) {
      const existingProc = this.memory.procedural.find(p =>
        p.applicableContexts.includes(goal.category)
      );

      if (existingProc) {
        existingProc.successRate = (existingProc.successRate * existingProc.usageCount + 1) / (existingProc.usageCount + 1);
        existingProc.usageCount++;
        existingProc.lastUsed = Date.now();
      } else {
        this.memory.procedural.push({
          id: randomUUID(),
          name: `Procedure for ${goal.category}`,
          description: goal.description,
          steps: this.currentPlan.steps.filter((_, i) => outcomes[i]?.success).map(s => s.description),
          successRate: 1.0,
          usageCount: 1,
          lastUsed: Date.now(),
          applicableContexts: [goal.category],
        });
      }
    }

    // Prune old memories (keep last 100 episodic)
    if (this.memory.episodic.length > 100) {
      this.memory.episodic = this.memory.episodic
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 100);
    }

    this.emit("learning:complete", {
      goalId: goal.id,
      success,
      lessonsLearned: reflections.flatMap(r => r.lessonsLearned).length,
    });
  }

  // ============================================
  // Self-Initiative: Proactive Task Generation
  // ============================================

  async generateProactiveTasks(context: AgentContext): Promise<AgentGoal[]> {
    const prompt = `Based on the conversation and available context, suggest proactive tasks the agent could take initiative on.

CONVERSATION:
${context.conversationHistory.slice(-10).map(h => `${h.role}: ${h.content}`).join("\n")}

USER PREFERENCES: ${JSON.stringify(context.userPreferences)}

AVAILABLE TOOLS: ${context.availableTools.map(t => t.name).join(", ")}

Suggest 1-3 proactive tasks that would be helpful. Respond in JSON:
{
  "tasks": [
    {
      "description": "task description",
      "category": "research|browser_control|document_creation|data_analysis|communication|system_control",
      "priority": "low|medium|high",
      "reasoning": "why this would be helpful",
      "confidence": 0-1
    }
  ]
}`;

    try {
      const response = await this.llmClient.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: "system", content: "You are a proactive AI assistant that identifies helpful tasks. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
        max_tokens: 1024,
        temperature: 0.4,
      });

      const text = response.choices[0]?.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let parsed: any = { tasks: [] };
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* use empty default */ }
      }

      return (parsed.tasks || [])
        .filter((t: any) => t.confidence >= this.config.confidenceThreshold)
        .map((t: any) => ({
          id: randomUUID(),
          description: t.description,
          priority: t.priority || "medium",
          category: t.category || "mixed",
          constraints: {
            maxDuration: 120000,
            maxActions: 20,
            maxCost: 0.1,
            requireConfirmation: true,
            allowedTools: [],
            blockedTools: [],
            safetyLevel: "moderate" as const,
          },
          successCriteria: [`Complete: ${t.description}`],
        }));
    } catch {
      return [];
    }
  }

  // ============================================
  // Goal Decomposition
  // ============================================

  async decomposeGoal(goal: AgentGoal, context: AgentContext): Promise<AgentGoal[]> {
    const prompt = `Decompose this complex goal into smaller sub-goals.

GOAL: ${goal.description}
CATEGORY: ${goal.category}

Break it down into 2-5 independent sub-goals that can be executed sequentially or in parallel.

Respond in JSON:
{
  "subGoals": [
    {
      "description": "sub-goal description",
      "category": "category",
      "priority": "high|medium|low",
      "successCriteria": ["criteria"],
      "dependsOn": [],
      "canRunParallel": true
    }
  ]
}`;

    try {
      const response = await this.llmClient.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: "system", content: "You decompose complex goals into manageable sub-goals. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
        max_tokens: 2048,
        temperature: 0.2,
      });

      const text = response.choices[0]?.message?.content || "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let parsed: any = { subGoals: [] };
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* use empty default */ }
      }

      return (parsed.subGoals || []).map((sg: any) => ({
        id: randomUUID(),
        description: sg.description,
        priority: sg.priority || goal.priority,
        category: sg.category || goal.category,
        constraints: { ...goal.constraints },
        successCriteria: sg.successCriteria || [`Complete: ${sg.description}`],
        parentGoalId: goal.id,
      }));
    } catch {
      return [goal]; // Return original if decomposition fails
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  private setState(state: AgentState): void {
    this.state = state;
    this.emit("state:changed", { state });
  }

  private addThought(type: ThoughtProcess["type"], content: string, confidence: number): void {
    this.thoughtLog.push({
      id: randomUUID(),
      timestamp: Date.now(),
      type,
      content,
      confidence,
    });
  }

  private addMemory(type: MemoryItem["type"], content: string, importance: number): void {
    this.memory.shortTerm.push({
      id: randomUUID(),
      type,
      content,
      timestamp: Date.now(),
      importance,
      decayRate: 0.95,
    });

    // Keep short-term memory manageable
    if (this.memory.shortTerm.length > 50) {
      this.memory.shortTerm = this.memory.shortTerm
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 50);
    }
  }

  private retrieveRelevantMemories(query: string): MemoryItem[] {
    const keywords = query.toLowerCase().split(/\s+/);
    return this.memory.shortTerm
      .filter(m => keywords.some(k => m.content.toLowerCase().includes(k)))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5);
  }

  private findRelevantProcedures(category: string): ProceduralMemory[] {
    return this.memory.procedural
      .filter(p => p.applicableContexts.includes(category))
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 3);
  }

  private calculateProgress(completed: number, total: number): number {
    if (total === 0) return 0;
    return Math.min(100, Math.round((completed / total) * 100));
  }

  private compileResult(goal: AgentGoal, outcomes: ActionOutcome[]): any {
    const successResults = outcomes.filter(o => o.success).map(o => o.result);
    if (successResults.length === 1) return successResults[0];
    return { results: successResults, totalActions: outcomes.length, successCount: successResults.length };
  }

  private async generateSummary(goal: AgentGoal, outcomes: ActionOutcome[], success: boolean): Promise<string> {
    const successCount = outcomes.filter(o => o.success).length;
    return `${success ? "Successfully" : "Partially"} completed "${goal.description}". ` +
      `${successCount}/${outcomes.length} actions succeeded.`;
  }

  getState(): AgentState { return this.state; }
  getMemory(): AgentMemory { return this.memory; }
  getThoughts(): ThoughtProcess[] { return this.thoughtLog; }
}

// Singleton
export const autonomousAgentBrain = new AutonomousAgentBrain();
