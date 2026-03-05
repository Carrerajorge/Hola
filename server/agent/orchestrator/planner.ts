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

─── TOOL CATALOG (use these toolHint values and args) ───

FILE & PROJECT TOOLS:
- "scaffold_project" — Create project boilerplate
    args: { action: "init_react"|"init_vue"|"init_nextjs"|"init_express"|"init_fastapi", projectName: "my-app" }
- "generate_code" — AI-powered code generation (Gemini)
    args: { description: "what to generate", language?: "typescript", framework?: "express", context?: "extra context" }
- "write_file" — Write a single file to workspace
    args: { path: "relative/path.ts", content: "file content" }
- "write_multiple_files" — Batch-write files (usually from generate_code output)
    args: { files?: [{ path, content }] }  (or reads files from dependency results)
- "read_file" — Read a file from workspace
    args: { path: "relative/path.ts" }
- "list_files" — List files in workspace
    args: { directory?: "src", recursive?: true }
- "shell_exec" — Run shell commands (npm install, npm test, git, etc.)
    args: { command: "npm install", cwd?: ".", timeout?: 30000 }

RESEARCH TOOLS:
- "web_search" — Search the web for information
    args: { query: "search terms" }
- "fetch_url" — Fetch and extract text from a URL
    args: { url: "https://..." }

DOCUMENT TOOLS:
- "create_document" — Generate a DOCX document
    args: { title, sections, content }
- "create_presentation" — Generate a PPTX presentation
    args: { title, slides }
- "create_spreadsheet" — Generate an XLSX spreadsheet
    args: { title, sheets }
- "analyze_data" — Statistical analysis on data
    args: { data, operations }

ACADEMIC RESEARCH TOOLS:
- "scopus_search" — Search Scopus (Elsevier) for scientific articles
    args: { query: "circular economy supply chain", maxResults?: 25, sortBy?: "relevance"|"date"|"citedby", yearFrom?: 2020, yearTo?: 2025 }
- "academic_search" — Unified multi-source search (Scopus + OpenAlex + PubMed + SciELO + Redalyc + WoS + DuckDuckGo)
    args: { query: "search terms", maxResults?: 50, maxPerSource?: 30, yearFrom?: 2020, yearTo?: 2025, sources?: ["scopus","openalex","pubmed","scielo","redalyc"], language?: "es", affilCountries?: ["Mexico","Spain","Colombia"] }
- "academic_export" — Full academic pipeline: searches, deduplicates, generates Excel + Word with APA 7th citations
    args: { prompt: "buscar 50 articulos de economia circular en latinoamerica del 2021 al 2025", excelPath?: "articles.xlsx", wordPath?: "citations.docx" }
- "format_citations" — Generate APA 7th edition citations from article data
    args: { articles?: [...] }  (or reads articles from dependency results)

CHAIN & FLOW TOOLS:
- "langchain_chain" — Execute prompt template chains with context threading
    args: { template: "Analyze {input} and...", variables: { input: "data" }, chainType?: "sequential" }
- "flowise_flow" — Execute data flow graphs
    args: { nodes: [...], edges: [...] }

META TOOLS:
- "synthesize" — LLM reasoning to analyze/combine/summarize results from previous subtasks
    args: { task: "what to synthesize", format?: "markdown" }

IMPORTANT: You can also suggest tools that don't exist yet — if a tool is missing,
the system will auto-expand by discovering and fusing open-source code at runtime.

─── PROJECT CREATION PATTERN ───
When the goal involves creating a project/app/API, use this wave pattern:
  Wave 1: scaffold_project (create boilerplate)
  Wave 2: generate_code for each component (parallel — models, routes, auth, etc.)
  Wave 3: write_multiple_files (writes generated code to workspace)
  Wave 4: shell_exec "npm install" or "pip install -r requirements.txt"
  Wave 5: generate_code for tests → write_multiple_files → shell_exec "npm test"
  Wave 6: synthesize (assemble delivery summary with file listing)

─── ACADEMIC RESEARCH PATTERN ───
When the goal involves finding/searching scientific articles or academic research:
  Option A (simple): Use "academic_export" — single tool that handles everything (search → deduplicate → Excel + Word)
  Option B (custom):
    Wave 1: "academic_search" or "scopus_search" (fetch articles from databases)
    Wave 2: "format_citations" (generate APA 7th citations from search results)
    Wave 3: "write_file" or "write_multiple_files" (save output files)
    Wave 4: "synthesize" (assemble delivery summary)
  PREFER academic_export for most academic research tasks — it auto-detects region, year range, and article count from natural language.

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
10. PREFER real tools (scaffold, generate_code, write_file, shell_exec) over synthesize.
    Only use synthesize for reasoning/combining — NEVER for tasks a real tool can handle.

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
