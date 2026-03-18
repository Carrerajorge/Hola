import path from "node:path";
import { z } from "zod";
import { toolRegistry, type ToolDefinition, type ToolContext, type ToolResult } from "../../agent/toolRegistry";
import { policyEngine } from "../../agent/policyEngine";
import { getOpenClawConfig } from "../config";
import { initSkills } from "./skillLoader";
import { skillRegistry } from "./skillRegistry";

export async function initializeClawiSkills() {
  if (skillRegistry.list().length === 0) {
    await initSkills(getOpenClawConfig());
  }

  let loadedCount = 0;
  for (const skill of skillRegistry.list()) {
    if (toolRegistry.get(skill.id)) {
      continue;
    }

    const tool: ToolDefinition = {
      name: skill.id,
      description: skill.description || `OpenClaw Skill: ${skill.name}`,
      inputSchema: z.object({
        input: z.string().describe("Input parameters or query for the skill"),
      }),
      execute: async (inputParams: Record<string, any>, _context: ToolContext): Promise<ToolResult> => {
        const prompt = String(skill.prompt || "").trim();
        const skillPath = skill.filePath ? path.dirname(skill.filePath) : undefined;
        return {
          success: true,
          output: {
            skillId: skill.id,
            skillName: skill.name,
            skillPath,
            instructions: prompt || `Use the skill ${skill.name} to complete the requested task.`,
            input: inputParams.input,
          },
        };
      },
    };

    toolRegistry.register(tool);
    if (!policyEngine.getPolicy(skill.id)) {
      policyEngine.registerPolicy({
        toolName: skill.id,
        capabilities: [],
        allowedPlans: ["free", "pro", "admin"],
        requiresConfirmation: false,
        maxExecutionTimeMs: 60_000,
        maxRetries: 1,
        deniedByDefault: false,
      });
    }
    loadedCount += 1;
  }

  console.info(`[ClawiSkillAdapter] Registered ${loadedCount} compatibility skills in ToolRegistry`);
}
