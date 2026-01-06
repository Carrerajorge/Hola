import { z } from "zod";
import OpenAI from "openai";
import { BaseAgent, BaseAgentConfig, AgentTask, AgentResult, AgentCapability, AGENT_REGISTRY } from "./types";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY,
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

export class OrchestratorAgent extends BaseAgent {
  constructor() {
    const config: BaseAgentConfig = {
      name: "OrchestratorAgent",
      description: "Super agent that coordinates and delegates tasks to specialized agents. Analyzes requests, creates execution plans, and orchestrates multi-agent workflows.",
      model: DEFAULT_MODEL,
      temperature: 0.3,
      maxTokens: 4096,
      systemPrompt: `You are the OrchestratorAgent - a super-intelligent coordinator for a multi-agent system.

Your responsibilities:
1. Analyze complex user requests and break them into subtasks
2. Route tasks to the most appropriate specialized agents
3. Coordinate multi-agent workflows and handle dependencies
4. Aggregate results from multiple agents
5. Handle errors and implement retry strategies
6. Optimize execution order for efficiency

Available specialized agents:
- ResearchAgent: Web research, information gathering, fact-checking
- CodeAgent: Code generation, review, refactoring, debugging
- DataAgent: Data analysis, transformation, visualization
- ContentAgent: Content creation, document generation
- CommunicationAgent: Email, notifications, messaging
- BrowserAgent: Autonomous web navigation and interaction
- DocumentAgent: Document processing and manipulation
- QAAgent: Testing, validation, quality assurance
- SecurityAgent: Security audits, encryption, compliance

When delegating tasks, provide clear instructions and context. Monitor progress and handle failures gracefully.`,
      tools: ["plan", "orchestrate", "decide", "reflect"],
      timeout: 300000,
      maxIterations: 50,
    };
    super(config);
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();
    this.updateState({ status: "running", currentTask: task.description, startedAt: new Date().toISOString() });

    try {
      const plan = await this.createPlan(task);
      const results = await this.executePlan(plan);
      const aggregatedResult = await this.aggregateResults(results);

      this.updateState({ status: "completed", progress: 100, completedAt: new Date().toISOString() });

      return {
        taskId: task.id,
        agentId: this.state.id,
        success: true,
        output: aggregatedResult,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.updateState({ status: "failed", error: error.message });
      return {
        taskId: task.id,
        agentId: this.state.id,
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  private async createPlan(task: AgentTask): Promise<ExecutionPlan> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        {
          role: "user",
          content: `Create an execution plan for this task:
${JSON.stringify(task, null, 2)}

Return a JSON plan with:
{
  "analysis": "Brief analysis of the request",
  "steps": [
    {
      "id": "step_1",
      "agent": "AgentName",
      "action": "what to do",
      "input": {},
      "dependencies": [],
      "priority": "high|medium|low"
    }
  ],
  "parallelGroups": [["step_1", "step_2"], ["step_3"]],
  "estimatedDuration": "time estimate",
  "fallbackStrategy": "what to do if steps fail"
}`,
        },
      ],
      temperature: this.config.temperature,
    });

    const content = response.choices[0].message.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as ExecutionPlan;
    }

    return {
      analysis: "Direct execution",
      steps: [{
        id: "step_1",
        agent: "OrchestratorAgent",
        action: task.description,
        input: task.input,
        dependencies: [],
        priority: "high",
      }],
      parallelGroups: [["step_1"]],
      estimatedDuration: "unknown",
      fallbackStrategy: "retry with alternative approach",
    };
  }

  private async executePlan(plan: ExecutionPlan): Promise<StepResult[]> {
    const results: StepResult[] = [];
    const completedSteps = new Set<string>();

    for (const group of plan.parallelGroups) {
      const groupSteps = plan.steps.filter(s => group.includes(s.id));
      
      const groupPromises = groupSteps.map(async (step) => {
        const canExecute = step.dependencies.every(d => completedSteps.has(d));
        if (!canExecute) {
          return { stepId: step.id, success: false, error: "Dependencies not met" };
        }

        const agent = AGENT_REGISTRY.get(step.agent);
        if (agent) {
          const result = await agent.execute({
            id: step.id,
            type: step.action,
            description: step.action,
            input: step.input,
            priority: step.priority as any,
          });
          completedSteps.add(step.id);
          return { stepId: step.id, success: result.success, output: result.output, error: result.error };
        }
        
        const directResult = await this.executeDirectly(step);
        completedSteps.add(step.id);
        return directResult;
      });

      const groupResults = await Promise.all(groupPromises);
      results.push(...groupResults);
      
      this.updateState({ progress: Math.round((completedSteps.size / plan.steps.length) * 100) });
    }

    return results;
  }

  private async executeDirectly(step: PlanStep): Promise<StepResult> {
    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        { role: "system", content: "Execute this task directly and provide a detailed result." },
        { role: "user", content: `Task: ${step.action}\nInput: ${JSON.stringify(step.input)}` },
      ],
      temperature: 0.2,
    });

    return {
      stepId: step.id,
      success: true,
      output: response.choices[0].message.content,
    };
  }

  private async aggregateResults(results: StepResult[]): Promise<any> {
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    if (failedResults.length > 0 && successfulResults.length === 0) {
      throw new Error(`All steps failed: ${failedResults.map(r => r.error).join(", ")}`);
    }

    const response = await xaiClient.chat.completions.create({
      model: this.config.model,
      messages: [
        {
          role: "system",
          content: "Aggregate and synthesize the results from multiple agent executions into a coherent final output.",
        },
        {
          role: "user",
          content: `Aggregate these results:
${JSON.stringify(results, null, 2)}

Provide a unified response that combines all successful outputs.`,
        },
      ],
      temperature: 0.2,
    });

    return {
      aggregatedOutput: response.choices[0].message.content,
      stepResults: results,
      summary: {
        total: results.length,
        successful: successfulResults.length,
        failed: failedResults.length,
      },
    };
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: "plan_execution",
        description: "Create and execute multi-step plans",
        inputSchema: z.object({ task: z.string(), context: z.record(z.any()).optional() }),
        outputSchema: z.object({ plan: z.any(), results: z.array(z.any()) }),
      },
      {
        name: "delegate_task",
        description: "Delegate tasks to specialized agents",
        inputSchema: z.object({ agent: z.string(), task: z.any() }),
        outputSchema: z.object({ result: z.any() }),
      },
      {
        name: "coordinate_workflow",
        description: "Coordinate complex multi-agent workflows",
        inputSchema: z.object({ workflow: z.any() }),
        outputSchema: z.object({ results: z.array(z.any()) }),
      },
    ];
  }
}

interface PlanStep {
  id: string;
  agent: string;
  action: string;
  input: Record<string, any>;
  dependencies: string[];
  priority: string;
}

interface ExecutionPlan {
  analysis: string;
  steps: PlanStep[];
  parallelGroups: string[][];
  estimatedDuration: string;
  fallbackStrategy: string;
}

interface StepResult {
  stepId: string;
  success: boolean;
  output?: any;
  error?: string;
}

export const orchestratorAgent = new OrchestratorAgent();
