// server/agent/orchestrator/planner.ts
// ---------------------------------------------------------------------------
// SuperPlanner — LLM-powered task decomposition into a dependency DAG
// Uses Gemini to reason about how to break down an open-ended NL task.
// ---------------------------------------------------------------------------

import { getGeminiClient, GEMINI_MODELS } from "../../lib/gemini";
import type { PlannerOutput, ProcessMemory, Priority, Complexity } from "./types";

// ---------------------------------------------------------------------------
// Tool discovery — builds the list of everything the agent can do
// ---------------------------------------------------------------------------

async function getAvailableTools(): Promise<string[]> {
  const tools: string[] = [];

  // 1. Built-in tools from agentTools config
  try {
    const { AGENT_TOOLS } = await import("../../config/agentTools");
    tools.push(...AGENT_TOOLS.map((t: any) => t.name));
  } catch { /* config not available */ }

  // 2. Tools registered in toolRegistry
  try {
    const { toolRegistry } = await import("../registry/toolRegistry");
    const allTools = toolRegistry.getAll();
    for (const [name] of allTools) {
      if (!tools.includes(name)) tools.push(name);
    }
  } catch { /* registry not available */ }

  // 3. Fused modules from selfExpand
  try {
    const { readdir, readFile } = await import("fs/promises");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const selfExpandDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "selfExpand",
      "fused",
    );
    const entries = await readdir(selfExpandDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(
          await readFile(join(selfExpandDir, entry.name, "manifest.json"), "utf-8"),
        );
        const fusedTools = manifest.registeredTools || [entry.name.replace(/-/g, "_")];
        tools.push(...fusedTools);
      } catch { /* skip invalid entries */ }
    }
  } catch { /* fused dir doesn't exist yet */ }

  // Always include the meta-capability "synthesize" (LLM reasoning step)
  if (!tools.includes("synthesize")) tools.push("synthesize");

  return [...new Set(tools)];
}

// ---------------------------------------------------------------------------
// System prompt for the Planner LLM
// ---------------------------------------------------------------------------

function buildSystemPrompt(tools: string[]): string {
  return `You are SuperPlanner, an elite autonomous task decomposition engine.

AVAILABLE TOOLS: [${tools.join(", ")}]

SPECIAL TOOLS:
- "synthesize" = use LLM reasoning to analyze/combine/summarize results from previous subtasks
- "web_search" = search the web for information
- "fetch_url" = fetch and extract text from a URL
- "create_document" = generate a DOCX document
- "create_presentation" = generate a PPTX presentation
- "create_spreadsheet" = generate an XLSX spreadsheet
- "analyze_data" = perform statistical analysis on data
- "generate_chart" = generate chart configurations
- "browse_and_act" = automate a real browser to interact with websites

IMPORTANT: You can also suggest tools that don't exist yet — if a tool is missing,
the system will auto-expand by discovering and fusing open-source code at runtime.

Given a user's goal in natural language, decompose it into concrete, atomic subtasks.

RULES:
1. Each subtask MUST have a toolHint — which tool to execute
2. Dependencies are subtask IDs that must complete before this subtask can start
3. MAXIMIZE PARALLELISM: independent subtasks MUST NOT depend on each other
4. For critical subtasks, provide an alternateStrategy (a different approach if the first fails)
5. Keep subtasks ATOMIC: one tool call each
6. Use "synthesize" for tasks that combine/analyze/reason about results from other subtasks
7. The LAST subtask should typically be "synthesize" to assemble the final deliverable
8. Generate between 3 and 12 subtasks depending on complexity
9. Each subtask's args should contain the specific parameters for its tool

Return ONLY valid JSON matching this exact schema:
{
  "subtasks": [
    {
      "id": "step_N",
      "description": "what to do in this step",
      "toolHint": "tool_name",
      "args": { "specific": "tool arguments" },
      "dependencies": ["step_M"],
      "priority": "critical" | "high" | "normal",
      "estimatedComplexity": "simple" | "medium" | "complex",
      "alternateStrategy": "optional: what to try if this fails"
    }
  ],
  "reasoning": "brief explanation of your decomposition strategy"
}`;
}

// ---------------------------------------------------------------------------
// Build user prompt (includes context from previous execution for replanning)
// ---------------------------------------------------------------------------

function buildUserPrompt(goal: string, memory?: ProcessMemory): string {
  let prompt = `GOAL: ${goal}`;

  if (memory && Object.keys(memory.completedResults).length > 0) {
    prompt += "\n\nCONTEXT FROM PREVIOUS EXECUTION:";
    for (const [id, result] of Object.entries(memory.completedResults)) {
      const preview =
        typeof result === "string"
          ? result.slice(0, 300)
          : JSON.stringify(result).slice(0, 300);
      prompt += `\n- ${id} (completed): ${preview}`;
    }

    if (memory.failedAttempts.length > 0) {
      prompt += "\n\nFAILED ATTEMPTS (avoid these strategies):";
      for (const fa of memory.failedAttempts) {
        prompt += `\n- ${fa.subtaskId}: ${fa.error} (tried: ${fa.strategy})`;
      }
    }

    prompt +=
      "\n\nREPLAN: decompose ONLY the remaining work. " +
      "Reference completed results by their step IDs in args where needed.";
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// decompose — Main entry point
// ---------------------------------------------------------------------------

/**
 * Uses Gemini to decompose a natural language goal into a DAG of subtasks.
 * If memory is provided (replanning), only decomposes remaining work.
 */
export async function decompose(
  goal: string,
  memory?: ProcessMemory,
): Promise<PlannerOutput> {
  const tools = await getAvailableTools();
  const systemPrompt = buildSystemPrompt(tools);
  const userPrompt = buildUserPrompt(goal, memory);

  const client = getGeminiClient();
  if (!client) {
    return fallbackDecompose(goal);
  }

  try {
    const result = await client.models.generateContent({
      model: GEMINI_MODELS.FLASH,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    });

    const text = result.text ?? "";
    const parsed = JSON.parse(text) as PlannerOutput;

    // Validate basic structure
    if (!parsed.subtasks || !Array.isArray(parsed.subtasks) || parsed.subtasks.length === 0) {
      return fallbackDecompose(goal);
    }

    // Ensure all subtasks have required fields with defaults
    for (const st of parsed.subtasks) {
      st.dependencies = st.dependencies || [];
      st.priority = st.priority || "normal";
      st.estimatedComplexity = st.estimatedComplexity || "medium";
    }

    return parsed;
  } catch (err: any) {
    console.error("[SuperPlanner] Decomposition failed:", err?.message);
    return fallbackDecompose(goal);
  }
}

// ---------------------------------------------------------------------------
// Fallback decomposer (no LLM needed)
// ---------------------------------------------------------------------------

function fallbackDecompose(goal: string): PlannerOutput {
  // Deterministic fallback: research → synthesize
  return {
    subtasks: [
      {
        id: "step_1",
        description: `Search the web for information about: ${goal}`,
        toolHint: "web_search",
        args: { query: goal },
        dependencies: [],
        priority: "high" as Priority,
        estimatedComplexity: "simple" as Complexity,
        alternateStrategy: "Try rephrasing the search query",
      },
      {
        id: "step_2",
        description: `Synthesize findings into a complete response for: ${goal}`,
        toolHint: "synthesize",
        args: { task: goal },
        dependencies: ["step_1"],
        priority: "critical" as Priority,
        estimatedComplexity: "medium" as Complexity,
      },
    ],
    reasoning: "Fallback: LLM unavailable. Using search → synthesize pipeline.",
  };
}
