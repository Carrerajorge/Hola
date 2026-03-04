import { BasePlane } from "../base_plane";
import { TerminalController, TerminalExecSchema } from "../../agent/tools/terminalControl";
import { z } from "zod";
import { YouTubeTranscriptTool, CsvSqlTool, WebCrawlerTool } from "./tools/data_tools";
import { EmailTool, PdfReportTool, PriceCheckTool } from "./tools/business_tools";
import { TemplateGalleryTool, UsageStatsTool } from "./tools/market_tools";

type ToolHandler = (params: any, context: { userId: string; role: string }) => Promise<any>;

interface RegisteredTool {
  name: string;
  description: string;
  schema: z.ZodSchema<any>;
  handler: ToolHandler;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export class ActionPlane extends BasePlane {
  private tools: Map<string, RegisteredTool> = new Map();
  private terminalController: TerminalController;

  constructor(os: any) {
    super(os);
    this.terminalController = new TerminalController();
  }

  async initialize() {
    console.log("[ActionPlane] Initializing Secure Tool Sandbox...");
    this.registerNativeTools();
    this.registerTool(YouTubeTranscriptTool);
    this.registerTool(CsvSqlTool);
    this.registerTool(WebCrawlerTool);
    this.registerTool(EmailTool);
    this.registerTool(PdfReportTool);
    this.registerTool(PriceCheckTool);
    this.registerTool(TemplateGalleryTool);
    this.registerTool(UsageStatsTool);
    console.log(`[ActionPlane] Sandbox Ready. ${this.tools.size} tools registered.`);
  }

  private registerNativeTools() {
    this.registerTool({
      name: "terminal_exec",
      description: "Execute safe shell commands on the host",
      schema: TerminalExecSchema.omit({ tool: true, userId: true, role: true, confirmed: true }),
      riskLevel: "high",
      handler: async (params, ctx) => {
        return await this.terminalController.execute({
          tool: "terminal.exec",
          command: params.command,
          cwd: params.cwd,
          env: params.env,
          timeout: params.timeout,
          userId: ctx.userId,
          role: ctx.role as any || "operator",
          confirmed: true 
        });
      }
    });

    this.registerTool({
        name: "file_read",
        description: "Read file contents",
        schema: z.object({ path: z.string() }),
        riskLevel: "medium",
        handler: async (params, ctx) => {
            return await this.terminalController.execute({
                tool: "terminal.exec",
                command: `cat "${params.path}"`,
                userId: ctx.userId,
                role: ctx.role as any || "operator",
                confirmed: true
            });
        }
    });
  }

  public registerTool(tool: RegisteredTool) {
    if (this.tools.has(tool.name)) {
      console.warn(`[ActionPlane] Overwriting tool: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  // Ejecución con Auto-Healing (Retry)
  async execute(
    toolName: string, 
    params: any, 
    context: { userId: string; role?: string },
    onLog?: (log: string) => void
  ) {
    const tool = this.tools.get(toolName);
    if (!tool) throw new Error(`Tool not found: ${toolName}`);

    const validation = tool.schema.safeParse(params);
    if (!validation.success) throw new Error(`Invalid params: ${validation.error.message}`);

    const policyResult = await this.os.control.validateAction(context.userId, {
        type: "tool_execution",
        tool: toolName,
        risk: tool.riskLevel,
        params: params
    });

    if (!policyResult.allowed) throw new Error(`Blocked by Policy: ${policyResult.reason}`);

    const startTime = Date.now();
    let attempt = 0;
    const maxRetries = 2; // Auto-Healing básico

    while (attempt <= maxRetries) {
        try {
            if (onLog) onLog(`[ActionPlane] Starting ${toolName} (Attempt ${attempt + 1})...`);
            
            const result = await tool.handler(params, { userId: context.userId, role: context.role || "operator" });
            
            if (onLog) onLog(`[ActionPlane] ${toolName} success.`);
            return {
                status: "success",
                data: result,
                duration: Date.now() - startTime
            };

        } catch (error: any) {
            attempt++;
            console.error(`[ActionPlane] Tool Error (${attempt}/${maxRetries + 1}): ${error.message}`);
            
            if (attempt > maxRetries) {
                if (onLog) onLog(`[ActionPlane] Failed after retries: ${error.message}`);
                throw error;
            }
            
            // Wait before retry (Exponential backoff)
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
  }
}
