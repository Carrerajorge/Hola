import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../toolRegistry";
import { selfExpandCapability } from "../selfExpand/selfExpandService";
import { getSelfExpandToolDefinitions } from "../selfExpand/selfExpandRuntime";

const providerEnum = z.enum(["github", "gitlab", "npm", "pypi", "local"]);

const selfExpandSchema = z.object({
  capability: z.string().min(2).max(120).describe("Capability name to fuse (tool name)."),
  description: z.string().max(240).optional().describe("Optional description for the fused capability."),
  repoHints: z.array(z.string().min(2).max(400)).optional().describe("Optional repo hints (github:owner/repo, gitlab:owner/repo, npm:pkg, pypi:pkg, or URL)."),
  allowNetwork: z.boolean().optional().default(false).describe("Allow network search/clone (default false for offline)."),
  searchProviders: z.array(providerEnum).optional().describe("Providers to search when allowNetwork is true."),
  maxCandidates: z.number().int().min(1).max(20).optional().default(5).describe("Max candidates to consider."),
  exportName: z.string().min(1).max(120).optional().describe("Optional export name to invoke from fused module."),
  entryFile: z.string().min(1).max(300).optional().describe("Optional entry file path inside the repo."),
  dryRun: z.boolean().optional().default(false).describe("If true, only resolve candidates without cloning."),
});

export const selfExpandTool: ToolDefinition = {
  name: "self_expand",
  description: "Auto-fuse a missing capability by cloning and embedding open-source code into the monolith (no external services).",
  inputSchema: selfExpandSchema,
  capabilities: ["writes_files", "executes_code"],
  timeoutMs: 180000,
  execute: async (input: z.infer<typeof selfExpandSchema>, context: ToolContext): Promise<ToolResult> => {
    const startTime = Date.now();
    try {
      const result = await selfExpandCapability({
        capability: input.capability,
        description: input.description,
        repoHints: input.repoHints,
        allowNetwork: input.allowNetwork,
        searchProviders: input.searchProviders,
        maxCandidates: input.maxCandidates,
        exportName: input.exportName,
        entryFile: input.entryFile,
        dryRun: input.dryRun,
      }, context);

      const success = result.status === "expanded" || result.status === "already_available";
      return {
        success,
        output: result,
        error: success
          ? undefined
          : {
              code: "SELF_EXPAND_FAILED",
              message: `Self-expand status: ${result.status}`,
              retryable: result.status === "clone_failed",
            },
        metrics: { durationMs: Date.now() - startTime },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: {
          code: "SELF_EXPAND_ERROR",
          message: error?.message || "Self-expand failed",
          retryable: false,
        },
        metrics: { durationMs: Date.now() - startTime },
      };
    }
  },
};

export function loadSelfExpandToolDefinitions(): ToolDefinition[] {
  return getSelfExpandToolDefinitions();
}
