// server/agent/orchestrator/executor.ts
// ---------------------------------------------------------------------------
// SuperPlanner Executor — the brain that coordinates everything.
//
// orchestrate(goal, opts) → plans → schedules → executes → recovers → delivers
//
// Routes subtasks to REAL tools: file I/O, shell exec, code generation,
// scaffolding, fused modules (langchain-chains, flowise-nodes), and LLM.
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import path from "path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { decompose } from "./planner";
import { buildWaves, rebuildWaves, shouldReplan, skipDependents } from "./scheduler";
import {
  getOrCreateWorkspace,
  cleanupWorkspace,
  execWorkspaceTool,
  listWorkspaceFiles,
} from "./workspaceManager";
import { geminiCodeGen } from "./geminiCodeGen";
import type {
  SubTask,
  ExecutionPlan,
  ProcessMemory,
  OrchestratorOptions,
  OrchestratorResult,
} from "./types";

// ---------------------------------------------------------------------------
// SSE helper
// ---------------------------------------------------------------------------

function emitSSE(res: any, event: string, data: any): void {
  if (!res || typeof res.write !== "function") return;
  try {
    const streamMeta = res?.locals?.streamMeta;
    const enriched: Record<string, unknown> =
      typeof data === "object" && data !== null ? { ...data } : { value: data };
    if (streamMeta?.requestId) enriched.requestId = streamMeta.requestId;
    if (!enriched.conversationId && streamMeta?.conversationId) enriched.conversationId = streamMeta.conversationId;
    const amid = streamMeta?.assistantMessageId ||
      (typeof streamMeta?.getAssistantMessageId === "function" ? streamMeta.getAssistantMessageId() : undefined);
    if (!enriched.assistantMessageId && amid) enriched.assistantMessageId = amid;
    res.write(`event: ${event}\ndata: ${JSON.stringify(enriched)}\n\n`);
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// ProcessMemory helpers
// ---------------------------------------------------------------------------

function createMemory(goal: string): ProcessMemory {
  return {
    goal,
    completedResults: {},
    failedAttempts: [],
    context: {},
    timeline: [],
  };
}

function logEvent(memory: ProcessMemory, event: string, detail: string): void {
  memory.timeline.push({ ts: Date.now(), event, detail });
}

// ---------------------------------------------------------------------------
// Tool execution — routes a subtask to the right backend
// ---------------------------------------------------------------------------

async function executeSubTask(
  subtask: SubTask,
  memory: ProcessMemory,
  opts: OrchestratorOptions,
): Promise<any> {
  const { toolHint, args = {} } = subtask;

  // 1. Handle "synthesize" — LLM reasoning step
  if (toolHint === "synthesize") {
    return await executeSynthesize(subtask, memory);
  }

  // 2. Build context from completed dependencies
  const depContext: Record<string, any> = {};
  for (const depId of subtask.dependencies) {
    if (memory.completedResults[depId] !== undefined) {
      depContext[depId] = memory.completedResults[depId];
    }
  }

  // Inject dependency results and full memory into args for tool context
  const enrichedArgs = { ...args, _dependencyResults: depContext, _completedResults: memory.completedResults };

  // 3. Try built-in tools first (workspace tools, code gen, web search, etc.)
  try {
    const builtinResult = await executeBuiltinTool(toolHint, enrichedArgs, opts);
    if (builtinResult !== null) return builtinResult;
  } catch (err: any) {
    // Built-in failed — continue to other backends
    console.warn(`[Orchestrator] Built-in ${toolHint} failed:`, err.message);
  }

  // 4. Try toolRegistry
  try {
    const { toolRegistry } = await import("../registry/toolRegistry");
    const toolResult = await toolRegistry.execute(toolHint, enrichedArgs, {
      userId: opts.userId || "orchestrator",
      chatId: opts.chatId || opts.runId,
      runId: opts.runId,
    });
    if (toolResult.success) return toolResult.output;
    if (toolResult.error?.code !== "NOT_FOUND_ERROR") {
      throw new Error(toolResult.error?.message || "Tool execution failed");
    }
  } catch (err: any) {
    if (!err.message?.includes("NOT_FOUND")) {
      // Real error, not just missing tool
      console.warn(`[Orchestrator] toolRegistry ${toolHint} error:`, err.message);
    }
  }

  // 5. Try selfExpand — auto-discover and fuse the capability
  try {
    const { expandAndExecute } = await import("../selfExpand/capabilityExpander");
    const expanded = await expandAndExecute(
      toolHint,
      enrichedArgs,
      { userId: opts.userId, chatId: opts.chatId, runId: opts.runId, userMessage: subtask.description },
      opts.runId,
      opts.sseRes,
    );
    if (expanded) {
      emitSSE(opts.sseRes, "self_expanding", {
        subtaskId: subtask.id,
        tool: toolHint,
        status: "acquired",
      });
      return expanded.result;
    }
  } catch (err: any) {
    console.warn(`[Orchestrator] selfExpand ${toolHint} failed:`, err.message);
  }

  // 6. Last resort: use LLM to attempt the task directly
  return await executeSynthesize(subtask, memory);
}

// ---------------------------------------------------------------------------
// Built-in tool execution (direct imports, no registry)
// Now includes workspace tools, code gen, scaffolding, fused modules.
// ---------------------------------------------------------------------------

async function executeBuiltinTool(
  toolName: string,
  args: Record<string, any>,
  opts: OrchestratorOptions,
): Promise<any | null> {
  switch (toolName) {
    // ── Web tools ──────────────────────────────────────────────
    case "web_search": {
      const { searchWeb } = await import("../../services/webSearch");
      const result = await searchWeb(args.query, args.maxResults || 5);
      return result.results?.length > 0
        ? result.results.map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
          }))
        : { message: "No results found", query: args.query };
    }

    case "fetch_url": {
      const { fetchUrl } = await import("../../services/webSearch");
      return await fetchUrl(args.url, {
        extractText: args.extractText ?? true,
        maxLength: 50000,
      });
    }

    // ── Office document tools (fall through to registry) ──────
    case "create_document":
    case "create_presentation":
    case "create_spreadsheet": {
      return null;
    }

    // ── Data analysis ─────────────────────────────────────────
    case "analyze_data": {
      const ss = await import("simple-statistics");
      let data: any[] = [];
      if (typeof args.data === "string") {
        data = JSON.parse(args.data);
      } else if (Array.isArray(args.data)) {
        data = args.data;
      }
      if (data.length === 0) return { error: "No valid data" };

      const numKeys = Object.keys(data[0]).filter(
        (k) => typeof data[0][k] === "number",
      );
      const insights = numKeys.map((key) => {
        const values = data.map((d) => d[key]);
        return {
          field: key,
          mean: ss.mean(values),
          median: ss.median(values),
          min: ss.min(values),
          max: ss.max(values),
          stdDev: ss.standardDeviation(values),
        };
      });

      return {
        recordCount: data.length,
        fieldsAnalyzed: numKeys,
        insights,
      };
    }

    // ── Scaffold: project boilerplate from templates ──────────
    case "scaffold_project": {
      const { TEMPLATES } = await import("../pipeline/tools/webdev-scaffold");
      const templateKey = args.template || args.action || "init_express";
      const template = TEMPLATES[templateKey];
      if (!template) {
        return { error: `Unknown template: ${templateKey}`, available: Object.keys(TEMPLATES) };
      }

      const workspace = await getOrCreateWorkspace(opts.runId);
      const projectName = args.projectName || "my-app";
      const projectRoot = projectName;

      // Create directories
      for (const dir of template.directories) {
        await execWorkspaceTool(workspace, "openclaw_write", {
          path: path.join(projectRoot, dir, ".gitkeep"),
          content: "",
        });
      }

      // Write all template files
      const createdFiles: string[] = [];
      for (const [filePath, content] of Object.entries(template.files)) {
        const result = await execWorkspaceTool(workspace, "openclaw_write", {
          path: path.join(projectRoot, filePath),
          content,
        });
        if (result.success) createdFiles.push(filePath);
      }

      emitSSE(opts.sseRes, "scaffold_complete", {
        template: templateKey,
        projectName,
        fileCount: createdFiles.length,
      });

      return {
        scaffolded: true,
        template: templateKey,
        projectPath: projectRoot,
        files: createdFiles,
        directories: template.directories,
      };
    }

    // ── Code generation via Gemini ────────────────────────────
    case "generate_code": {
      const result = await geminiCodeGen({
        description: args.description || args.task,
        language: args.language,
        framework: args.framework,
        context: args.context,
        existingFiles: args.existingFiles || args._dependencyResults
          ? extractExistingFiles(args._dependencyResults)
          : undefined,
      });

      emitSSE(opts.sseRes, "code_generated", {
        fileCount: result.files.length,
        dependencies: result.dependencies,
      });

      return result;
    }

    // ── Write single file to workspace ────────────────────────
    case "write_file": {
      const workspace = await getOrCreateWorkspace(opts.runId);
      const result = await execWorkspaceTool(workspace, "openclaw_write", {
        path: args.path || args.filePath,
        content: args.content,
      });
      return result.success
        ? { written: true, path: args.path || args.filePath }
        : { error: result.error?.message };
    }

    // ── Write multiple files (from generate_code output) ──────
    case "write_multiple_files": {
      const workspace = await getOrCreateWorkspace(opts.runId);

      // Files come from dependency results (generate_code output) or direct args
      let files: Array<{ path: string; content: string }> = args.files || [];
      if (files.length === 0 && args._dependencyResults) {
        // Collect files from ALL dependency results (not just the first)
        for (const depResult of Object.values(args._dependencyResults)) {
          if (depResult && typeof depResult === "object" && Array.isArray((depResult as any).files)) {
            files = files.concat((depResult as any).files);
          }
        }
      }

      const results: string[] = [];

      // Infer baseDir from args, dependency results, or any prior scaffold result
      let baseDir = args.baseDir || args.projectPath || "";
      if (!baseDir) {
        // Check direct dependency results first
        const searchSources = [args._dependencyResults, args._completedResults];
        for (const source of searchSources) {
          if (baseDir) break;
          if (!source) continue;
          for (const depResult of Object.values(source)) {
            if (depResult && typeof depResult === "object" && (depResult as any).projectPath) {
              baseDir = (depResult as any).projectPath;
              break;
            }
          }
        }
      }

      for (const file of files) {
        const filePath = baseDir ? path.join(baseDir, file.path) : file.path;
        const writeResult = await execWorkspaceTool(workspace, "openclaw_write", {
          path: filePath,
          content: file.content,
        });
        if (writeResult.success) results.push(filePath);
      }

      emitSSE(opts.sseRes, "files_written", { count: results.length, files: results });
      return { written: results.length, files: results };
    }

    // ── Read file from workspace ──────────────────────────────
    case "read_file": {
      const workspace = await getOrCreateWorkspace(opts.runId);
      const result = await execWorkspaceTool(workspace, "openclaw_read", {
        path: args.path || args.filePath,
        offset: args.offset,
        limit: args.limit,
      });
      return result.success ? result.output : { error: result.error?.message };
    }

    // ── List files in workspace ───────────────────────────────
    case "list_files": {
      const workspace = await getOrCreateWorkspace(opts.runId);
      if (args.recursive) {
        return await listWorkspaceFiles(workspace);
      }
      const result = await execWorkspaceTool(workspace, "openclaw_list", {
        path: args.path || ".",
        recursive: args.recursive || false,
      });
      return result.success ? result.output : { error: result.error?.message };
    }

    // ── Shell execution in workspace ──────────────────────────
    case "shell_exec": {
      const workspace = await getOrCreateWorkspace(opts.runId);
      const result = await execWorkspaceTool(workspace, "openclaw_exec", {
        command: args.command,
        cwd: args.cwd,
        timeout: args.timeout,
        env: args.env,
      });

      emitSSE(opts.sseRes, "shell_exec", {
        command: args.command,
        success: result.success,
        exitCode: result.error?.details?.exitCode,
      });

      return result.success
        ? { output: result.output, success: true }
        : {
            output: result.output,
            success: false,
            error: result.error?.message,
            stderr: result.error?.details?.stderr,
          };
    }

    // ── Scopus: direct Scopus API search ──────────────────────
    case "scopus_search": {
      const { searchScopus, isScopusConfigured } = await import("../../services/scopusSearch");
      if (!isScopusConfigured()) {
        return { error: "Scopus API key not configured. Set SCOPUS_API_KEY in environment.", configured: false };
      }
      const result = await searchScopus(args.query, {
        maxResults: args.maxResults || args.count || 25,
        sortBy: args.sortBy || "relevance",
        yearFrom: args.yearFrom,
        yearTo: args.yearTo,
      });

      emitSSE(opts.sseRes, "scopus_search", {
        query: args.query,
        totalResults: result.totalResults,
        returned: result.articles.length,
      });

      return {
        articles: result.articles,
        totalResults: result.totalResults,
        query: result.query,
      };
    }

    // ── Academic search: unified multi-source search ─────────
    case "academic_search": {
      const { searchAllSources } = await import("../superAgent/unifiedArticleSearch");
      const result = await searchAllSources(args.query, {
        maxResults: args.maxResults || args.count || 50,
        maxPerSource: args.maxPerSource || 30,
        startYear: args.yearFrom || args.startYear,
        endYear: args.yearTo || args.endYear,
        sources: args.sources || ["scopus", "openalex", "pubmed", "scielo", "redalyc"],
        language: args.language,
        affilCountries: args.affilCountries || args.countries,
      });

      emitSSE(opts.sseRes, "academic_search", {
        query: args.query,
        totalArticles: result.articles.length,
        bySource: result.totalBySource,
        errors: result.errors,
      });

      return {
        articles: result.articles,
        totalBySource: result.totalBySource,
        searchTime: result.searchTime,
        errors: result.errors,
      };
    }

    // ── Academic export: full pipeline (search → Excel + Word) ─
    case "academic_export": {
      const { exportAcademicArticlesFromPrompt } = await import("../../services/academicArticlesExport");

      // Build a natural language prompt from args
      const prompt = args.prompt || args.query || args.description || "";
      const result = await exportAcademicArticlesFromPrompt(prompt);

      // Write Excel and Word files to workspace
      const workspace = await getOrCreateWorkspace(opts.runId);
      const excelPath = args.excelPath || "academic_articles.xlsx";
      const wordPath = args.wordPath || "citations_apa7.docx";

      await execWorkspaceTool(workspace, "openclaw_write", {
        path: excelPath,
        content: result.excelBuffer.toString("base64"),
        encoding: "base64",
      });
      await execWorkspaceTool(workspace, "openclaw_write", {
        path: wordPath,
        content: result.wordBuffer.toString("base64"),
        encoding: "base64",
      });

      emitSSE(opts.sseRes, "academic_export", {
        articlesCount: result.articles.length,
        excelPath,
        wordPath,
        stats: result.stats,
      });

      return {
        articlesCount: result.articles.length,
        excelPath,
        wordPath,
        stats: result.stats,
        plan: result.plan,
        articles: result.articles.map((a) => ({
          title: a.title,
          authors: a.authors,
          year: a.year,
          journal: a.journal,
          doi: a.doi,
          source: a.source,
          country: a.country,
          qualityStatus: a.qualityGate?.status,
          qualityScore: a.qualityGate?.score,
        })),
      };
    }

    // ── Format APA citations from article data ───────────────
    case "format_citations": {
      const { generateAPACitationsList } = await import("../superAgent/unifiedArticleSearch");
      // Articles can come from args directly or from dependency results
      let articles = args.articles || [];
      if (articles.length === 0 && args._dependencyResults) {
        for (const depResult of Object.values(args._dependencyResults)) {
          if (depResult && typeof depResult === "object" && Array.isArray((depResult as any).articles)) {
            articles = (depResult as any).articles;
            break;
          }
        }
      }
      const citationsText = generateAPACitationsList(articles);
      return { citations: citationsText, articleCount: articles.length };
    }

    // ── Fused module: langchain-chains (prompt chaining) ──────
    case "langchain_chain": {
      try {
        const chains = await import("../selfExpand/fused/langchain-chains/index");
        const template = args.template || args.prompt;
        const variables = args.variables || args.inputs || {};

        // Build and execute the chain
        const prompt = chains.createPrompt(template);
        const formatted = chains.formatPrompt(prompt, variables);

        if (args.steps && Array.isArray(args.steps)) {
          // Multi-step chain: each step feeds into the next
          const chainResult = await chains.executeChain(
            args.steps.map((s: any) => ({
              prompt: chains.createPrompt(s.template || s.prompt),
              variables: s.variables || {},
            })),
            variables,
          );
          return chainResult;
        }

        return { formatted, template, variables };
      } catch (err: any) {
        return null; // Fall through to other backends
      }
    }

    // ── Fused module: flowise-nodes (data flow graphs) ────────
    case "flowise_flow": {
      try {
        const flowise = await import("../selfExpand/fused/flowise-nodes/index");
        const flowDef = args.flow || args.definition;

        if (flowDef) {
          const result = await flowise.executeFlow(flowDef);
          return result;
        }

        // Build a flow from description
        if (args.nodes && args.edges) {
          const builder = new flowise.FlowBuilder();
          for (const node of args.nodes) {
            builder.addNode(node);
          }
          for (const edge of args.edges) {
            builder.addEdge(edge);
          }
          const flow = builder.build();
          return await flowise.executeFlow(flow);
        }

        return null;
      } catch (err: any) {
        return null; // Fall through
      }
    }

    default:
      return null; // Not a known built-in
  }
}

// ---------------------------------------------------------------------------
// Helper: extract existing files from dependency results for code gen context
// ---------------------------------------------------------------------------

function extractExistingFiles(
  depResults: Record<string, any> | undefined,
): Array<{ path: string; content: string }> | undefined {
  if (!depResults) return undefined;
  const files: Array<{ path: string; content: string }> = [];

  for (const result of Object.values(depResults)) {
    if (!result || typeof result !== "object") continue;

    // From scaffold_project result
    if ((result as any).scaffolded && (result as any).files) {
      for (const f of (result as any).files) {
        files.push({ path: f, content: `(scaffolded file: ${f})` });
      }
    }

    // From generate_code result
    if (Array.isArray((result as any).files)) {
      for (const f of (result as any).files) {
        if (f.path && f.content) files.push(f);
      }
    }
  }

  return files.length > 0 ? files : undefined;
}

// ---------------------------------------------------------------------------
// Synthesize — LLM reasoning/assembly step
// ---------------------------------------------------------------------------

async function executeSynthesize(
  subtask: SubTask,
  memory: ProcessMemory,
): Promise<string> {
  const { llmGateway } = await import("../../lib/llmGateway");
  const messages: ChatCompletionMessageParam[] = [];

  // Build context from all completed results
  let contextStr = "";
  for (const [id, result] of Object.entries(memory.completedResults)) {
    const preview =
      typeof result === "string"
        ? result.slice(0, 1000)
        : JSON.stringify(result, null, 2).slice(0, 1000);
    contextStr += `\n### ${id}\n${preview}\n`;
  }

  const prompt = `You are an expert analyst and writer.

ORIGINAL GOAL: ${memory.goal}

CURRENT TASK: ${subtask.description}

CONTEXT FROM COMPLETED STEPS:
${contextStr || "(no previous results)"}

${subtask.args?.instructions || ""}

Execute the current task using the context above. Provide a thorough, detailed response.
If the task asks you to create a report, document, or analysis — produce the FULL content, not a summary.
If the task asks you to combine results — integrate ALL available data.`;

  messages.push({ role: "system" as const, content: "You are an expert analyst and writer." });
  messages.push({ role: "user" as const, content: prompt });

  try {
    const result = await llmGateway.chat(messages, {
      temperature: 0.3,
      maxTokens: 8192,
      provider: "auto",
      enableFallback: true,
    });
    return result.content ?? "[No response from LLM]";
  } catch (err: any) {
    return `[Synthesize fallback] Task: ${subtask.description}\nContext keys: ${Object.keys(memory.completedResults).join(", ")}\nReason: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// orchestrate — Main entry point
// ---------------------------------------------------------------------------

/**
 * Takes an open-ended natural language goal and autonomously:
 * 1. Decomposes it into subtasks (Planner)
 * 2. Schedules execution waves (Scheduler)
 * 3. Executes each subtask with routing, retry, and selfExpand
 * 4. Handles errors with retry → alternate strategy → replan
 * 5. Delivers the assembled final result with workspace artifacts
 */
export async function orchestrate(
  goal: string,
  opts: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const planId = randomUUID();
  const maxRetries = opts.maxRetries ?? 2;
  const maxReplanAttempts = opts.maxReplanAttempts ?? 2;
  let replanCount = 0;
  const selfExpandCount = 0;

  const memory = createMemory(goal);
  logEvent(memory, "orchestration_start", goal);

  emitSSE(opts.sseRes, "orchestration_start", { planId, goal });

  // ── Phase 1: Plan ──
  emitSSE(opts.sseRes, "planning", { planId, status: "decomposing" });
  logEvent(memory, "planning", "Decomposing goal into subtasks");

  const plannerOutput = await decompose(goal);

  const subtasks: SubTask[] = plannerOutput.subtasks.map((st) => ({
    ...st,
    status: "pending" as const,
    retryCount: 0,
    maxRetries,
  }));

  const plan: ExecutionPlan = {
    id: planId,
    goal,
    subtasks,
    waves: [],
    status: "executing",
    memory,
    createdAt: Date.now(),
  };

  // ── Phase 2: Schedule ──
  plan.waves = buildWaves(subtasks);

  emitSSE(opts.sseRes, "plan_created", {
    planId,
    subtaskCount: subtasks.length,
    waveCount: plan.waves.length,
    reasoning: plannerOutput.reasoning,
    subtasks: subtasks.map((t) => ({
      id: t.id,
      description: t.description,
      toolHint: t.toolHint,
      dependencies: t.dependencies,
      priority: t.priority,
    })),
    waves: plan.waves,
  });

  logEvent(
    memory,
    "plan_created",
    `${subtasks.length} subtasks in ${plan.waves.length} waves`,
  );

  // ── Phase 3: Execute waves ──
  for (let waveIdx = 0; waveIdx < plan.waves.length; waveIdx++) {
    const wave = plan.waves[waveIdx];
    const waveTasks = wave
      .map((id) => subtasks.find((t) => t.id === id))
      .filter((t): t is SubTask => t !== undefined && t.status === "pending");

    if (waveTasks.length === 0) continue;

    emitSSE(opts.sseRes, "wave_start", {
      waveIndex: waveIdx,
      subtaskIds: wave,
      parallel: waveTasks.length > 1,
    });

    logEvent(memory, "wave_start", `Wave ${waveIdx}: [${wave.join(", ")}]`);

    // Execute all tasks in this wave in parallel
    const waveResults = await Promise.allSettled(
      waveTasks.map(async (task) => {
        task.status = "running";
        task.startedAt = Date.now();

        emitSSE(opts.sseRes, "subtask_start", {
          subtaskId: task.id,
          description: task.description,
          toolHint: task.toolHint,
        });

        try {
          const result = await executeSubTask(task, memory, opts);
          task.status = "completed";
          task.result = result;
          task.completedAt = Date.now();
          memory.completedResults[task.id] = result;

          logEvent(
            memory,
            "subtask_completed",
            `${task.id} (${task.toolHint}): ${typeof result === "string" ? result.slice(0, 100) : "ok"}`,
          );

          emitSSE(opts.sseRes, "subtask_result", {
            subtaskId: task.id,
            status: "completed",
            durationMs: task.completedAt - task.startedAt!,
            resultPreview:
              typeof result === "string"
                ? result.slice(0, 200)
                : JSON.stringify(result).slice(0, 200),
          });

          return { taskId: task.id, result };
        } catch (err: any) {
          return await handleSubTaskError(task, err, memory, opts, maxRetries);
        }
      }),
    );

    // Check for failures that need replanning
    for (const waveResult of waveResults) {
      if (waveResult.status === "rejected") continue;
      const { taskId } = waveResult.value as any;
      const task = subtasks.find((t) => t.id === taskId);
      if (task && task.status === "failed" && replanCount < maxReplanAttempts) {
        if (shouldReplan(task, subtasks)) {
          // ── Replan ──
          replanCount++;
          logEvent(memory, "replan", `Triggered by ${task.id} failure`);
          emitSSE(opts.sseRes, "replan", {
            reason: `Subtask ${task.id} failed: ${task.error}`,
            attempt: replanCount,
          });

          const newPlan = await decompose(goal, memory);
          const newSubtasks: SubTask[] = newPlan.subtasks.map((st) => ({
            ...st,
            status: "pending" as const,
            retryCount: 0,
            maxRetries,
          }));

          // Replace remaining subtasks
          const completedIds = new Set(
            subtasks.filter((t) => t.status === "completed").map((t) => t.id),
          );
          for (const nst of newSubtasks) {
            if (!completedIds.has(nst.id)) {
              const existing = subtasks.findIndex((t) => t.id === nst.id);
              if (existing >= 0) {
                subtasks[existing] = nst;
              } else {
                subtasks.push(nst);
              }
            }
          }

          plan.waves = rebuildWaves(subtasks);
          plan.status = "executing";

          emitSSE(opts.sseRes, "plan_updated", {
            newSubtaskCount: newSubtasks.length,
            newWaveCount: plan.waves.length,
          });

          // Restart wave execution from the new wave 0
          waveIdx = -1; // Will be incremented to 0 by the for loop
          break;
        } else {
          // Skip dependents of this non-critical failure
          const skipped = skipDependents(task.id, subtasks);
          if (skipped.length > 0) {
            logEvent(memory, "skipped", `Skipped ${skipped.join(", ")} due to ${task.id}`);
            emitSSE(opts.sseRes, "subtasks_skipped", {
              reason: `Dependency ${task.id} failed`,
              skippedIds: skipped,
            });
          }
        }
      }
    }
  }

  // ── Phase 4: Assemble final result ──
  const completed = subtasks.filter((t) => t.status === "completed");
  const failed = subtasks.filter((t) => t.status === "failed");
  const skipped = subtasks.filter((t) => t.status === "skipped");

  // The final output is the last completed subtask's result
  const lastCompleted = completed[completed.length - 1];
  const finalOutput = lastCompleted?.result ?? null;

  plan.status = failed.length === 0 ? "completed" : completed.length > 0 ? "completed" : "failed";
  plan.completedAt = Date.now();

  const resultStatus: OrchestratorResult["status"] =
    failed.length === 0
      ? "completed"
      : completed.length > 0
        ? "partial"
        : "failed";

  // ── Collect workspace artifacts ──
  let artifacts: OrchestratorResult["artifacts"] = undefined;
  try {
    const workspace = await getOrCreateWorkspace(opts.runId);
    const files = await listWorkspaceFiles(workspace);
    if (files.length > 0) {
      artifacts = { workspacePath: workspace.root, files };
    }
  } catch { /* no workspace created for this run */ }

  const orchestratorResult: OrchestratorResult = {
    planId,
    status: resultStatus,
    results: memory.completedResults,
    finalOutput,
    timeline: memory.timeline,
    stats: {
      totalSubtasks: subtasks.length,
      completed: completed.length,
      failed: failed.length,
      skipped: skipped.length,
      selfExpanded: selfExpandCount,
      replanned: replanCount,
      totalDurationMs: Date.now() - startTime,
    },
    artifacts,
  };

  logEvent(
    memory,
    "orchestration_done",
    `${resultStatus}: ${completed.length}/${subtasks.length} completed in ${orchestratorResult.stats.totalDurationMs}ms`,
  );

  emitSSE(opts.sseRes, "orchestration_done", {
    planId,
    status: resultStatus,
    stats: orchestratorResult.stats,
    artifacts: artifacts ? { path: artifacts.workspacePath, fileCount: artifacts.files.length } : null,
    finalOutputPreview:
      typeof finalOutput === "string"
        ? finalOutput.slice(0, 500)
        : JSON.stringify(finalOutput).slice(0, 500),
  });

  // Cleanup workspace after a delay (keep for debugging)
  setTimeout(() => cleanupWorkspace(opts.runId).catch(() => {}), 300_000);

  return orchestratorResult;
}

// ---------------------------------------------------------------------------
// Error handling with retry + alternate strategy
// ---------------------------------------------------------------------------

async function handleSubTaskError(
  task: SubTask,
  err: Error,
  memory: ProcessMemory,
  opts: OrchestratorOptions,
  maxRetries: number,
): Promise<{ taskId: string; result: any }> {
  task.retryCount++;

  memory.failedAttempts.push({
    subtaskId: task.id,
    error: err.message,
    strategy: task.toolHint,
    attempt: task.retryCount,
  });

  logEvent(
    memory,
    "subtask_error",
    `${task.id} attempt ${task.retryCount}: ${err.message}`,
  );

  emitSSE(opts.sseRes, "subtask_retry", {
    subtaskId: task.id,
    attempt: task.retryCount,
    maxRetries,
    error: err.message,
  });

  // Retry with same strategy
  if (task.retryCount < maxRetries) {
    try {
      const result = await executeSubTask(task, memory, opts);
      task.status = "completed";
      task.result = result;
      task.completedAt = Date.now();
      memory.completedResults[task.id] = result;
      return { taskId: task.id, result };
    } catch (retryErr: any) {
      task.retryCount++;
      memory.failedAttempts.push({
        subtaskId: task.id,
        error: retryErr.message,
        strategy: task.toolHint,
        attempt: task.retryCount,
      });
    }
  }

  // Try alternate strategy
  if (task.alternateStrategy && task.retryCount <= maxRetries + 1) {
    logEvent(memory, "alternate_strategy", `${task.id}: trying ${task.alternateStrategy}`);

    emitSSE(opts.sseRes, "subtask_alternate", {
      subtaskId: task.id,
      alternateStrategy: task.alternateStrategy,
    });

    const altTask: SubTask = {
      ...task,
      toolHint: "synthesize",
      args: {
        ...task.args,
        instructions: `Original approach (${task.toolHint}) failed. Alternate strategy: ${task.alternateStrategy}. ${task.description}`,
      },
    };

    try {
      const result = await executeSubTask(altTask, memory, opts);
      task.status = "completed";
      task.result = result;
      task.completedAt = Date.now();
      memory.completedResults[task.id] = result;
      return { taskId: task.id, result };
    } catch (altErr: any) {
      memory.failedAttempts.push({
        subtaskId: task.id,
        error: altErr.message,
        strategy: "alternate:" + task.alternateStrategy,
        attempt: task.retryCount + 1,
      });
    }
  }

  // Final failure
  task.status = "failed";
  task.error = err.message;
  task.completedAt = Date.now();

  emitSSE(opts.sseRes, "subtask_result", {
    subtaskId: task.id,
    status: "failed",
    error: err.message,
  });

  return { taskId: task.id, result: null };
}
