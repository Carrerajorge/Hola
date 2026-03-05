import { ToolDefinition, ExecutionContext, ToolResult } from "../pipeline/types";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * GUI Automation Tool using cliclick (macOS) or xdotool (Linux)
 * Permite al agente controlar el mouse y teclado de la máquina anfitriona
 */
export const guiAutomationTool: ToolDefinition = {
  id: "gui_automation",
  name: "GUI Automation",
  description: "Control the host mouse and keyboard. Dangerous tool, requires HITL escalation.",
  category: "advanced",
  capabilities: ["gui", "mouse", "keyboard", "automation", "destructive"],
  inputSchema: {
    action: { type: "string", enum: ["click", "type", "keypress"], required: true },
    x: { type: "number" },
    y: { type: "number" },
    text: { type: "string" },
    key: { type: "string" }
  },
  execute: async (context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> => {
    // Human In The Loop Gating Check
    if (!context.escalationGranted) {
      return {
        success: false,
        error: "PERMISSION_DENIED",
        data: { message: "This tool requires human confirmation. Please prompt the user to accept." }
      };
    }

    const { action, x, y, text, key } = params;

    try {
      // macOS implementation using cliclick or AppleScript
      if (action === "click") {
        await execAsync(`cliclick c:${x},${y}`);
        return { success: true, data: `Clicked at ${x},${y}` };
      }
      if (action === "type") {
        await execAsync(`cliclick t:"${text.replace(/"/g, '\\"')}"`);
        return { success: true, data: `Typed text` };
      }
      return { success: false, error: "Unsupported GUI action" };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
};
