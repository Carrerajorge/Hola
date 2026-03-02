import { ToolDefinition, ExecutionContext, ToolResult } from "../../pipeline/types";
import { hitlManager } from "./HitlManager";

/**
 * Higher-Order Function que envuelve cualquier ToolDefinition.
 * Si el tool requiere escalamiento (Tier-2), pausa la ejecución hasta que el humano la apruebe.
 */
export function withHitlGating(tool: ToolDefinition, riskReason: string = "This action modifies the system and requires human confirmation."): ToolDefinition {
  const originalExecute = tool.execute;

  return {
    ...tool,
    execute: async (context: ExecutionContext, params: Record<string, any>): Promise<ToolResult> => {
      // Si ya tiene el flag de escalamiento pre-aprobado internamente, pasamos de largo
      if (context.escalationGranted) {
        return originalExecute(context, params);
      }

      // Interceptar y pausar
      console.log(`[Tenaga:HITL] Intercepting tool ${tool.name} for human approval...`);
      
      const isApproved = await hitlManager.requestApproval(
        context.runId,
        tool.name,
        params,
        riskReason
      );

      if (!isApproved) {
        return {
          success: false,
          error: "PERMISSION_DENIED_BY_HUMAN: The user rejected the execution of this action."
        };
      }

      // Inyectar el permiso y ejecutar
      context.escalationGranted = true;
      return originalExecute(context, params);
    }
  };
}
