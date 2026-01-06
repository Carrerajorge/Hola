import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY,
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

interface AgentConfig {
  description: string;
  capabilities: string[];
}

const AVAILABLE_AGENTS: Record<string, AgentConfig> = {
  search: { description: "Web search specialist", capabilities: ["search queries", "find information online"] },
  browser: { description: "Web content extraction specialist", capabilities: ["extract web page content", "navigate websites"] },
  document: { description: "Document creation specialist", capabilities: ["create PPTX/DOCX/XLSX files"] },
  research: { description: "Deep research specialist", capabilities: ["comprehensive research", "data analysis"] },
  file: { description: "File operations specialist", capabilities: ["read/write files", "file management"] },
  generate: { description: "Content generation specialist", capabilities: ["create images", "generate content"] },
};

interface SubAgentResult {
  agent: string;
  success: boolean;
  result: any;
  latencyMs: number;
  error?: string;
}

interface WorkflowStepResult {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: any;
  error?: string;
  latencyMs?: number;
}

async function executeSubAgent(
  agentName: string,
  task: string
): Promise<SubAgentResult> {
  const startTime = Date.now();
  const agentConfig = AVAILABLE_AGENTS[agentName];

  if (!agentConfig) {
    return {
      agent: agentName,
      success: false,
      result: null,
      latencyMs: Date.now() - startTime,
      error: `Unknown agent: ${agentName}`,
    };
  }

  try {
    const response = await xaiClient.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a ${agentConfig.description} with capabilities: ${agentConfig.capabilities.join(", ")}.
Execute the given task and provide detailed results. Be thorough and accurate.
Return your response as JSON with keys: success (boolean), data (the result), message (brief summary).`,
        },
        {
          role: "user",
          content: `Task: ${task}`,
        },
      ],
      temperature: 0.3,
    });

    const content = response.choices[0].message.content || "";
    let result: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { success: true, data: content, message: "Task completed" };
    } catch {
      result = { success: true, data: content, message: "Task completed" };
    }

    return {
      agent: agentName,
      success: result.success !== false,
      result,
      latencyMs: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      agent: agentName,
      success: false,
      result: null,
      latencyMs: Date.now() - startTime,
      error: error.message,
    };
  }
}

async function aggregateResults(
  results: SubAgentResult[],
  task: string
): Promise<{ combined: any; conflicts: string[] }> {
  const successfulResults = results.filter((r) => r.success);
  const failedResults = results.filter((r) => !r.success);
  
  if (successfulResults.length === 0) {
    return {
      combined: null,
      conflicts: failedResults.map((r) => `${r.agent}: ${r.error}`),
    };
  }

  if (successfulResults.length === 1) {
    return {
      combined: successfulResults[0].result,
      conflicts: [],
    };
  }

  try {
    const aggregationPrompt = `Given multiple agent results for the task "${task}", combine and synthesize them into a coherent response.
    
Results:
${successfulResults.map((r) => `${r.agent}: ${JSON.stringify(r.result)}`).join("\n\n")}

Provide a unified response that combines the best insights from each agent. Return as JSON with keys:
- combined: the synthesized result
- conflicts: array of any conflicting information found`;

    const response = await xaiClient.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: "You are an expert at synthesizing information from multiple sources." },
        { role: "user", content: aggregationPrompt },
      ],
      temperature: 0.3,
    });

    const content = response.choices[0].message.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return {
      combined: successfulResults.map((r) => ({ agent: r.agent, data: r.result })),
      conflicts: [],
    };
  } catch (error) {
    return {
      combined: successfulResults.map((r) => ({ agent: r.agent, data: r.result })),
      conflicts: [],
    };
  }
}

export const orchestrateTool = tool(
  async (input) => {
    const { task, agents, strategy = "parallel" } = input;
    const startTime = Date.now();

    const selectedAgents: string[] = agents && agents.length > 0
      ? agents.filter((a) => a in AVAILABLE_AGENTS)
      : ["search", "research"];

    if (selectedAgents.length === 0) {
      return JSON.stringify({
        success: false,
        error: "No valid agents specified",
        availableAgents: Object.keys(AVAILABLE_AGENTS),
      });
    }

    let results: SubAgentResult[];

    switch (strategy) {
      case "parallel":
        results = await Promise.all(
          selectedAgents.map((agent) => executeSubAgent(agent, task))
        );
        break;

      case "sequential":
        results = [];
        let contextTask = task;
        for (const agent of selectedAgents) {
          const result = await executeSubAgent(agent, contextTask);
          results.push(result);
          if (result.success && result.result) {
            contextTask = `${task}\n\nPrevious findings: ${JSON.stringify(result.result)}`;
          }
        }
        break;

      case "supervisor":
        const supervisorResponse = await xaiClient.chat.completions.create({
          model: DEFAULT_MODEL,
          messages: [
            {
              role: "system",
              content: `You are a supervisor agent. Given a task and available agents, decide which agents to use and in what order.
Available agents: ${selectedAgents.map((a) => `${a}: ${AVAILABLE_AGENTS[a].description}`).join(", ")}
Return a JSON object: { "plan": [{ "agent": "name", "subtask": "specific task" }] }`,
            },
            { role: "user", content: `Task: ${task}` },
          ],
          temperature: 0.3,
        });

        const planContent = supervisorResponse.choices[0].message.content || "";
        let plan: Array<{ agent: string; subtask: string }>;
        try {
          const jsonMatch = planContent.match(/\{[\s\S]*\}/);
          const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { plan: [] };
          plan = parsed.plan || [];
        } catch {
          plan = selectedAgents.map((agent) => ({ agent, subtask: task }));
        }

        results = [];
        for (const step of plan) {
          if (step.agent in AVAILABLE_AGENTS) {
            const result = await executeSubAgent(step.agent, step.subtask);
            results.push(result);
          }
        }
        break;

      default:
        results = await Promise.all(
          selectedAgents.map((agent) => executeSubAgent(agent, task))
        );
    }

    const { combined, conflicts } = await aggregateResults(results, task);

    return JSON.stringify({
      success: true,
      strategy,
      agentsUsed: selectedAgents,
      results: results.map((r) => ({
        agent: r.agent,
        success: r.success,
        latencyMs: r.latencyMs,
        error: r.error,
      })),
      combined,
      conflicts,
      totalLatencyMs: Date.now() - startTime,
    });
  },
  {
    name: "orchestrate",
    description: "Coordinates multiple specialized sub-agents to accomplish complex tasks. Supports parallel, sequential, or supervisor-guided execution strategies. Use for tasks that benefit from multiple perspectives or capabilities.",
    schema: z.object({
      task: z.string().describe("The task to delegate to sub-agents"),
      agents: z.array(z.enum(["search", "browser", "document", "research", "file", "generate"]))
        .optional()
        .describe("Specific agents to use. If not specified, defaults to search and research."),
      strategy: z.enum(["parallel", "sequential", "supervisor"])
        .optional()
        .default("parallel")
        .describe("Execution strategy: parallel (all at once), sequential (one after another with context passing), or supervisor (AI-planned execution)"),
    }),
  }
);

interface WorkflowStep {
  id: string;
  action: string;
  dependsOn?: string[];
}

function buildDependencyGraph(steps: WorkflowStep[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  
  for (const step of steps) {
    if (!graph.has(step.id)) {
      graph.set(step.id, new Set());
    }
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        graph.get(step.id)!.add(dep);
      }
    }
  }
  
  return graph;
}

function getExecutableSteps(
  steps: WorkflowStep[],
  completed: Set<string>,
  running: Set<string>,
  failed: Set<string>,
  dependencyGraph: Map<string, Set<string>>
): WorkflowStep[] {
  return steps.filter((step) => {
    if (completed.has(step.id) || running.has(step.id) || failed.has(step.id)) {
      return false;
    }
    
    const deps = dependencyGraph.get(step.id) || new Set();
    for (const dep of deps) {
      if (failed.has(dep)) {
        return false;
      }
      if (!completed.has(dep)) {
        return false;
      }
    }
    
    return true;
  });
}

async function executeWorkflowStep(
  step: WorkflowStep,
  context: Record<string, any>,
  stepResults: Map<string, any>
): Promise<WorkflowStepResult> {
  const startTime = Date.now();

  try {
    const enrichedContext = {
      ...context,
      previousResults: Object.fromEntries(stepResults),
    };

    const response = await xaiClient.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "system",
          content: `You are executing a workflow step. Analyze the action and context, then provide the result.
Return a JSON object with the step result. Be concise and focused on the action.`,
        },
        {
          role: "user",
          content: `Step ID: ${step.id}
Action: ${step.action}
Context: ${JSON.stringify(enrichedContext)}

Execute this step and return the result as JSON.`,
        },
      ],
      temperature: 0.3,
    });

    const content = response.choices[0].message.content || "";
    let result: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { output: content };
    } catch {
      result = { output: content };
    }

    return {
      id: step.id,
      status: "completed",
      result,
      latencyMs: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      id: step.id,
      status: "failed",
      error: error.message,
      latencyMs: Date.now() - startTime,
    };
  }
}

export const workflowTool = tool(
  async (input) => {
    const { steps, context = {} } = input;
    const startTime = Date.now();

    if (!steps || steps.length === 0) {
      return JSON.stringify({
        success: false,
        error: "No workflow steps provided",
      });
    }

    const dependencyGraph = buildDependencyGraph(steps);
    const completed = new Set<string>();
    const running = new Set<string>();
    const failed = new Set<string>();
    const stepResults = new Map<string, any>();
    const results: WorkflowStepResult[] = [];

    const stepIds = new Set(steps.map((s) => s.id));
    for (const step of steps) {
      if (step.dependsOn) {
        for (const dep of step.dependsOn) {
          if (!stepIds.has(dep)) {
            return JSON.stringify({
              success: false,
              error: `Step "${step.id}" depends on non-existent step "${dep}"`,
            });
          }
        }
      }
    }

    const maxIterations = steps.length * 2;
    let iterations = 0;

    while (completed.size + failed.size < steps.length && iterations < maxIterations) {
      iterations++;

      const executableSteps = getExecutableSteps(steps, completed, running, failed, dependencyGraph);

      if (executableSteps.length === 0 && running.size === 0) {
        const remainingSteps = steps.filter(
          (s) => !completed.has(s.id) && !failed.has(s.id)
        );
        for (const step of remainingSteps) {
          results.push({
            id: step.id,
            status: "skipped",
            error: "Dependencies failed or circular dependency detected",
          });
          failed.add(step.id);
        }
        break;
      }

      for (const step of executableSteps) {
        running.add(step.id);
      }

      const stepPromises = executableSteps.map((step) =>
        executeWorkflowStep(step, context, stepResults)
      );

      const stepResultsArray = await Promise.all(stepPromises);

      for (const result of stepResultsArray) {
        running.delete(result.id);
        results.push(result);

        if (result.status === "completed") {
          completed.add(result.id);
          stepResults.set(result.id, result.result);
        } else {
          failed.add(result.id);
        }
      }
    }

    const successCount = results.filter((r) => r.status === "completed").length;
    const failedCount = results.filter((r) => r.status === "failed").length;
    const skippedCount = results.filter((r) => r.status === "skipped").length;

    return JSON.stringify({
      success: failedCount === 0 && skippedCount === 0,
      summary: {
        total: steps.length,
        completed: successCount,
        failed: failedCount,
        skipped: skippedCount,
      },
      results,
      finalContext: Object.fromEntries(stepResults),
      totalLatencyMs: Date.now() - startTime,
    });
  },
  {
    name: "workflow",
    description: "Executes a DAG-based workflow with dependency resolution. Steps are executed in parallel when their dependencies are satisfied. Use for complex multi-step processes that have interdependencies.",
    schema: z.object({
      steps: z.array(z.object({
        id: z.string().describe("Unique identifier for this step"),
        action: z.string().describe("Description of the action to perform"),
        dependsOn: z.array(z.string()).optional().describe("IDs of steps that must complete before this one"),
      })).describe("Array of workflow steps to execute"),
      context: z.record(z.any()).optional().describe("Initial context/data to pass to all steps"),
    }),
  }
);

export const ORCHESTRATION_TOOLS = [orchestrateTool, workflowTool];
