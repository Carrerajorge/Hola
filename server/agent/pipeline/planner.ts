import OpenAI from "openai";
import crypto from "crypto";
import { toolRegistry } from "./registry";
import { ExecutionPlan, PlanStep, InterpretedIntent } from "./types";

const openai = new OpenAI({ 
  baseURL: "https://api.x.ai/v1", 
  apiKey: process.env.XAI_API_KEY 
});

export async function interpretIntent(userMessage: string): Promise<InterpretedIntent> {
  const tools = toolRegistry.getToolManifest();
  
  const response = await openai.chat.completions.create({
    model: "grok-3-fast",
    messages: [
      {
        role: "system",
        content: `You are an intent interpreter. Analyze the user's request and extract:
1. The main action they want to perform
2. Key entities (URLs, file names, data types, etc.)
3. Any constraints or requirements
4. What output format they expect

Respond in JSON format:
{
  "action": "brief action description",
  "entities": { "key": "value" },
  "constraints": ["constraint1", "constraint2"],
  "expectedOutput": "description of expected output",
  "confidence": 0.0-1.0
}`
      },
      {
        role: "user",
        content: userMessage
      }
    ],
    response_format: { type: "json_object" }
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    return {
      action: parsed.action || "unknown",
      entities: parsed.entities || {},
      constraints: parsed.constraints || [],
      expectedOutput: parsed.expectedOutput || "text response",
      confidence: parsed.confidence || 0.5
    };
  } catch {
    return {
      action: "process request",
      entities: {},
      constraints: [],
      expectedOutput: "text response",
      confidence: 0.3
    };
  }
}

export async function createPlan(
  runId: string,
  objective: string,
  intent: InterpretedIntent
): Promise<ExecutionPlan> {
  const tools = toolRegistry.getToolManifest();
  
  const toolDescriptions = tools.map(t => 
    `- ${t.id}: ${t.description} (capabilities: ${t.capabilities.join(", ")})`
  ).join("\n");

  const response = await openai.chat.completions.create({
    model: "grok-3-fast",
    messages: [
      {
        role: "system",
        content: `You are an execution planner. Given a user objective and available tools, create a step-by-step execution plan.

Available tools:
${toolDescriptions}

Create a plan as JSON array of steps:
[
  {
    "toolId": "tool_id",
    "description": "what this step does",
    "params": { "param1": "value1" },
    "dependsOn": ["previous_step_id"],
    "optional": false
  }
]

Rules:
- Use only available tools
- Each step should have a clear purpose
- Set dependencies between steps when outputs are needed
- Mark truly optional steps as optional: true
- Keep the plan minimal but complete
- Extract URLs, file names, and data from the entities provided`
      },
      {
        role: "user",
        content: `Objective: ${objective}

Interpreted intent:
- Action: ${intent.action}
- Entities: ${JSON.stringify(intent.entities)}
- Constraints: ${intent.constraints.join(", ")}
- Expected output: ${intent.expectedOutput}

Create an execution plan.`
      }
    ],
    response_format: { type: "json_object" }
  });

  let steps: PlanStep[] = [];
  
  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    const rawSteps = parsed.steps || parsed.plan || [];
    
    steps = rawSteps.map((step: any, index: number) => ({
      id: `step_${index}_${crypto.randomUUID().slice(0, 8)}`,
      toolId: step.toolId || step.tool || "respond",
      description: step.description || `Step ${index + 1}`,
      params: step.params || {},
      dependsOn: step.dependsOn || (index > 0 ? [steps[index - 1]?.id] : undefined),
      condition: step.condition,
      optional: step.optional || false,
      timeout: step.timeout,
      retryPolicy: step.retryPolicy
    }));
  } catch (e) {
    console.error("Failed to parse plan:", e);
    steps = [{
      id: `step_0_${crypto.randomUUID().slice(0, 8)}`,
      toolId: "respond",
      description: "Generate response",
      params: { objective }
    }];
  }

  if (steps.length === 0) {
    steps = [{
      id: `step_0_${crypto.randomUUID().slice(0, 8)}`,
      toolId: "respond",
      description: "Generate response",
      params: { objective }
    }];
  }

  return {
    id: `plan_${crypto.randomUUID()}`,
    runId,
    objective,
    interpretedIntent: intent,
    steps,
    createdAt: new Date(),
    estimatedDuration: steps.length * 5000
  };
}

export async function refinePlan(
  plan: ExecutionPlan,
  feedback: string
): Promise<ExecutionPlan> {
  const response = await openai.chat.completions.create({
    model: "grok-3-fast",
    messages: [
      {
        role: "system",
        content: `You are refining an execution plan based on feedback. Modify the plan to address the issues.
Return the complete updated plan in the same JSON format.`
      },
      {
        role: "user",
        content: `Current plan:
${JSON.stringify(plan.steps, null, 2)}

Feedback: ${feedback}

Provide the refined plan.`
      }
    ],
    response_format: { type: "json_object" }
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    const rawSteps = parsed.steps || parsed.plan || plan.steps;
    
    return {
      ...plan,
      id: `plan_${crypto.randomUUID()}`,
      steps: rawSteps.map((step: any, index: number) => ({
        id: step.id || `step_${index}_${crypto.randomUUID().slice(0, 8)}`,
        toolId: step.toolId,
        description: step.description,
        params: step.params || {},
        dependsOn: step.dependsOn,
        condition: step.condition,
        optional: step.optional || false,
        timeout: step.timeout,
        retryPolicy: step.retryPolicy
      })),
      createdAt: new Date()
    };
  } catch {
    return plan;
  }
}
