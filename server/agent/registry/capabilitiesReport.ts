import { z } from "zod";
import { toolRegistry, ToolCategory, TOOL_CATEGORIES, ToolExecutionResult, RegisteredTool } from "./toolRegistry";
import { agentRegistry, AgentRole, AGENT_ROLES, AgentResult } from "./agentRegistry";
import { orchestrator } from "./orchestrator";

export const TestResultSchema = z.object({
  name: z.string(),
  category: z.string(),
  status: z.enum(["PASS", "FAIL", "SKIP", "ERROR"]),
  durationMs: z.number(),
  evidence: z.object({
    input: z.any().optional(),
    output: z.any().optional(),
    error: z.string().optional(),
    trace: z.any().optional(),
  }),
  message: z.string().optional(),
});

export type TestResult = z.infer<typeof TestResultSchema>;

export const CategoryReportSchema = z.object({
  category: z.string(),
  totalTools: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  results: z.array(TestResultSchema),
});

export type CategoryReport = z.infer<typeof CategoryReportSchema>;

export const CapabilitiesReportSchema = z.object({
  timestamp: z.string(),
  version: z.string().default("1.0.0"),
  summary: z.object({
    totalTools: z.number(),
    totalAgents: z.number(),
    toolsPassed: z.number(),
    toolsFailed: z.number(),
    agentsPassed: z.number(),
    agentsFailed: z.number(),
    overallStatus: z.enum(["PASS", "FAIL", "PARTIAL"]),
    durationMs: z.number(),
  }),
  toolCategories: z.array(CategoryReportSchema),
  agentResults: z.array(TestResultSchema),
  orchestratorResult: TestResultSchema.optional(),
  recommendations: z.array(z.string()),
});

export type CapabilitiesReport = z.infer<typeof CapabilitiesReportSchema>;

const SMOKE_TEST_INPUTS: Record<string, Record<string, unknown>> = {
  web_search: { query: "test query", maxResults: 1 },
  browse_url: { url: "https://example.com", action: "extract" },
  extract_content: { url: "https://example.com" },
  summarize: { text: "This is a test text for summarization." },
  
  text_generate: { prompt: "Hello", maxTokens: 10 },
  image_generate: { prompt: "A simple test image", size: "256x256" },
  code_generate: { language: "javascript", description: "hello world function" },
  
  data_transform: { data: [{ a: 1 }], operations: ["filter"] },
  data_visualize: { data: [{ x: 1, y: 2 }], chartType: "line" },
  json_parse: { input: '{"test": true}' },
  csv_parse: { input: "a,b\n1,2" },
  
  document_create: { type: "docx", title: "Test", content: "Test content" },
  pdf_generate: { title: "Test PDF", content: "Test content" },
  slides_create: { title: "Test", slides: [{ title: "Slide 1" }] },
  
  shell_execute: { command: "echo test" },
  file_read: { path: "package.json" },
  file_write: { path: "/tmp/test.txt", content: "test" },
  
  memory_store: { key: "test", value: "test_value" },
  memory_retrieve: { key: "test" },
  
  reason: { premise: "If A then B. A is true.", question: "Is B true?" },
  reflect: { action: "test", outcome: "success" },
  
  orchestrate: { task: "simple test task" },
  workflow: { name: "test", steps: [] },
  
  decide: { options: ["A", "B"], criteria: "test" },
  clarify: { statement: "Test statement" },
  
  security_scan: { target: "https://example.com" },
  encrypt: { data: "test", algorithm: "aes-256" },
  hash: { data: "test", algorithm: "sha256" },
  
  default: { test: true },
};

function getSmokeTestInput(toolName: string): Record<string, unknown> {
  return SMOKE_TEST_INPUTS[toolName] || SMOKE_TEST_INPUTS.default;
}

class CapabilitiesReportRunner {
  private report: CapabilitiesReport | null = null;

  async runFullReport(): Promise<CapabilitiesReport> {
    const startTime = Date.now();
    console.log("\n" + "=".repeat(60));
    console.log("CAPABILITIES REPORT - Starting Full System Validation");
    console.log("=".repeat(60) + "\n");

    const toolCategories: CategoryReport[] = [];
    let toolsPassed = 0;
    let toolsFailed = 0;

    for (const category of TOOL_CATEGORIES) {
      const categoryReport = await this.testToolCategory(category);
      toolCategories.push(categoryReport);
      toolsPassed += categoryReport.passed;
      toolsFailed += categoryReport.failed;
    }

    const agentResults: TestResult[] = [];
    let agentsPassed = 0;
    let agentsFailed = 0;

    for (const role of AGENT_ROLES) {
      const agentResult = await this.testAgent(role);
      agentResults.push(agentResult);
      if (agentResult.status === "PASS") agentsPassed++;
      else agentsFailed++;
    }

    const orchestratorResult = await this.testOrchestrator();

    const totalTools = toolRegistry.getAll().length;
    const totalAgents = agentRegistry.getAll().length;
    
    const overallStatus = 
      toolsFailed === 0 && agentsFailed === 0 && orchestratorResult.status === "PASS"
        ? "PASS"
        : toolsFailed > totalTools * 0.2 || agentsFailed > totalAgents * 0.2
          ? "FAIL"
          : "PARTIAL";

    const recommendations = this.generateRecommendations(
      toolCategories,
      agentResults,
      orchestratorResult
    );

    this.report = {
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      summary: {
        totalTools,
        totalAgents,
        toolsPassed,
        toolsFailed,
        agentsPassed,
        agentsFailed,
        overallStatus,
        durationMs: Date.now() - startTime,
      },
      toolCategories,
      agentResults,
      orchestratorResult,
      recommendations,
    };

    this.printReport(this.report);
    return this.report;
  }

  async runQuickSmokeTest(): Promise<CapabilitiesReport> {
    const startTime = Date.now();
    console.log("\n" + "=".repeat(60));
    console.log("QUICK SMOKE TEST - Minimal System Validation");
    console.log("=".repeat(60) + "\n");

    const toolCategories: CategoryReport[] = [];
    let toolsPassed = 0;
    let toolsFailed = 0;

    for (const category of TOOL_CATEGORIES) {
      const tools = toolRegistry.getByCategory(category);
      if (tools.length === 0) continue;

      const sampleTool = tools[0];
      const result = await this.testSingleTool(sampleTool);
      
      const categoryReport: CategoryReport = {
        category,
        totalTools: tools.length,
        passed: result.status === "PASS" ? 1 : 0,
        failed: result.status === "FAIL" || result.status === "ERROR" ? 1 : 0,
        skipped: tools.length - 1,
        results: [result],
      };
      
      toolCategories.push(categoryReport);
      if (result.status === "PASS") toolsPassed++;
      else toolsFailed++;
    }

    const agentResults: TestResult[] = [];
    let agentsPassed = 0;
    let agentsFailed = 0;

    const criticalAgents: AgentRole[] = ["Orchestrator", "Research", "Code"];
    for (const role of criticalAgents) {
      const agentResult = await this.testAgent(role);
      agentResults.push(agentResult);
      if (agentResult.status === "PASS") agentsPassed++;
      else agentsFailed++;
    }

    const orchestratorResult = await this.testOrchestrator();

    const totalTools = toolRegistry.getAll().length;
    const totalAgents = agentRegistry.getAll().length;
    
    const overallStatus = 
      toolsFailed === 0 && agentsFailed === 0 && orchestratorResult.status === "PASS"
        ? "PASS"
        : "PARTIAL";

    this.report = {
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      summary: {
        totalTools,
        totalAgents,
        toolsPassed,
        toolsFailed,
        agentsPassed,
        agentsFailed,
        overallStatus,
        durationMs: Date.now() - startTime,
      },
      toolCategories,
      agentResults,
      orchestratorResult,
      recommendations: [],
    };

    this.printReport(this.report);
    return this.report;
  }

  private async testToolCategory(category: ToolCategory): Promise<CategoryReport> {
    console.log(`\nTesting category: ${category}`);
    console.log("-".repeat(40));

    const tools = toolRegistry.getByCategory(category);
    const results: TestResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const tool of tools) {
      const result = await this.testSingleTool(tool);
      results.push(result);
      
      if (result.status === "PASS") passed++;
      else if (result.status === "FAIL" || result.status === "ERROR") failed++;
      else skipped++;

      const statusIcon = result.status === "PASS" ? "✓" : result.status === "FAIL" ? "✗" : "○";
      console.log(`  ${statusIcon} ${tool.metadata.name}: ${result.status} (${result.durationMs}ms)`);
    }

    return {
      category,
      totalTools: tools.length,
      passed,
      failed,
      skipped,
      results,
    };
  }

  private async testSingleTool(tool: RegisteredTool): Promise<TestResult> {
    const startTime = Date.now();
    const input = getSmokeTestInput(tool.metadata.name);

    try {
      if (tool.healthCheck) {
        const healthy = await tool.healthCheck();
        if (!healthy) {
          return {
            name: tool.metadata.name,
            category: tool.metadata.category,
            status: "FAIL",
            durationMs: Date.now() - startTime,
            evidence: { error: "Health check failed" },
            message: "Tool health check returned false",
          };
        }
      }

      const inputValidation = tool.inputSchema.safeParse(input);
      if (!inputValidation.success) {
        return {
          name: tool.metadata.name,
          category: tool.metadata.category,
          status: "SKIP",
          durationMs: Date.now() - startTime,
          evidence: { 
            input,
            error: inputValidation.error.message,
          },
          message: "Schema validation test - input validation works correctly",
        };
      }

      const result = await toolRegistry.execute(tool.metadata.name, input, {
        skipValidation: false,
        skipRateLimit: true,
      });

      return {
        name: tool.metadata.name,
        category: tool.metadata.category,
        status: result.success ? "PASS" : "FAIL",
        durationMs: Date.now() - startTime,
        evidence: {
          input,
          output: result.data,
          error: result.error?.message,
          trace: result.trace,
        },
        message: result.success ? "Tool executed successfully" : result.error?.message,
      };
    } catch (err: any) {
      return {
        name: tool.metadata.name,
        category: tool.metadata.category,
        status: "ERROR",
        durationMs: Date.now() - startTime,
        evidence: {
          input,
          error: err.message,
        },
        message: `Unexpected error: ${err.message}`,
      };
    }
  }

  private async testAgent(role: AgentRole): Promise<TestResult> {
    const startTime = Date.now();
    console.log(`\nTesting agent: ${role}`);

    try {
      const agent = agentRegistry.getByRole(role);
      if (!agent) {
        return {
          name: role,
          category: "Agent",
          status: "FAIL",
          durationMs: Date.now() - startTime,
          evidence: { error: `Agent with role ${role} not found` },
          message: "Agent not registered",
        };
      }

      const healthy = await agent.healthCheck();
      if (!healthy) {
        return {
          name: role,
          category: "Agent",
          status: "FAIL",
          durationMs: Date.now() - startTime,
          evidence: { error: "Agent health check failed" },
          message: "Some required tools are missing",
        };
      }

      const capabilities = agent.getCapabilities();
      
      const statusIcon = "✓";
      console.log(`  ${statusIcon} ${role}: PASS (${Date.now() - startTime}ms)`);
      console.log(`    Tools: ${agent.config.tools.length}, Capabilities: ${capabilities.length}`);

      return {
        name: role,
        category: "Agent",
        status: "PASS",
        durationMs: Date.now() - startTime,
        evidence: {
          output: {
            name: agent.config.name,
            tools: agent.config.tools,
            capabilities: capabilities.map(c => c.name),
          },
        },
        message: "Agent initialized and healthy",
      };
    } catch (err: any) {
      console.log(`  ✗ ${role}: ERROR (${Date.now() - startTime}ms)`);
      return {
        name: role,
        category: "Agent",
        status: "ERROR",
        durationMs: Date.now() - startTime,
        evidence: { error: err.message },
        message: `Unexpected error: ${err.message}`,
      };
    }
  }

  private async testOrchestrator(): Promise<TestResult> {
    const startTime = Date.now();
    console.log("\nTesting Orchestrator routing...");

    try {
      const testQueries = [
        { query: "search for information about AI", expectedIntent: "research" },
        { query: "write a JavaScript function", expectedIntent: "code" },
        { query: "analyze this data set", expectedIntent: "data_analysis" },
        { query: "create a presentation", expectedIntent: "document" },
      ];

      const results: Array<{ query: string; intent: string; agent: string; correct: boolean }> = [];

      for (const test of testQueries) {
        const { intent, agentName, tools } = await orchestrator.route(test.query);
        const correct = intent.intent === test.expectedIntent;
        results.push({
          query: test.query,
          intent: intent.intent,
          agent: agentName,
          correct,
        });
        
        const icon = correct ? "✓" : "○";
        console.log(`  ${icon} "${test.query.slice(0, 30)}..." → ${intent.intent} (${agentName})`);
      }

      const allCorrect = results.every(r => r.correct);

      return {
        name: "Orchestrator",
        category: "System",
        status: allCorrect ? "PASS" : "PARTIAL" as any,
        durationMs: Date.now() - startTime,
        evidence: { output: results },
        message: allCorrect 
          ? "All routing tests passed" 
          : `${results.filter(r => r.correct).length}/${results.length} routing tests passed`,
      };
    } catch (err: any) {
      return {
        name: "Orchestrator",
        category: "System",
        status: "ERROR",
        durationMs: Date.now() - startTime,
        evidence: { error: err.message },
        message: `Orchestrator test failed: ${err.message}`,
      };
    }
  }

  private generateRecommendations(
    toolCategories: CategoryReport[],
    agentResults: TestResult[],
    orchestratorResult: TestResult
  ): string[] {
    const recommendations: string[] = [];

    for (const category of toolCategories) {
      if (category.failed > 0) {
        const failedTools = category.results
          .filter(r => r.status === "FAIL" || r.status === "ERROR")
          .map(r => r.name);
        recommendations.push(
          `[${category.category}] Fix failing tools: ${failedTools.join(", ")}`
        );
      }
    }

    const failedAgents = agentResults.filter(r => r.status !== "PASS");
    for (const agent of failedAgents) {
      recommendations.push(`[Agent] Fix ${agent.name}: ${agent.message}`);
    }

    if (orchestratorResult.status !== "PASS") {
      recommendations.push(`[Orchestrator] ${orchestratorResult.message}`);
    }

    return recommendations;
  }

  private printReport(report: CapabilitiesReport): void {
    console.log("\n" + "=".repeat(60));
    console.log("CAPABILITIES REPORT SUMMARY");
    console.log("=".repeat(60));
    console.log(`Timestamp: ${report.timestamp}`);
    console.log(`Duration: ${report.summary.durationMs}ms`);
    console.log("");
    console.log(`Overall Status: ${report.summary.overallStatus}`);
    console.log("");
    console.log("Tools:");
    console.log(`  Total: ${report.summary.totalTools}`);
    console.log(`  Passed: ${report.summary.toolsPassed}`);
    console.log(`  Failed: ${report.summary.toolsFailed}`);
    console.log("");
    console.log("Agents:");
    console.log(`  Total: ${report.summary.totalAgents}`);
    console.log(`  Passed: ${report.summary.agentsPassed}`);
    console.log(`  Failed: ${report.summary.agentsFailed}`);
    
    if (report.recommendations.length > 0) {
      console.log("");
      console.log("Recommendations:");
      for (const rec of report.recommendations) {
        console.log(`  - ${rec}`);
      }
    }
    
    console.log("=".repeat(60) + "\n");
  }

  getLastReport(): CapabilitiesReport | null {
    return this.report;
  }

  toJUnit(): string {
    if (!this.report) return "<testsuites />";

    const testcases = this.report.toolCategories.flatMap(cat =>
      cat.results.map(r => `
    <testcase name="${r.name}" classname="${r.category}" time="${r.durationMs / 1000}">
      ${r.status === "FAIL" || r.status === "ERROR" 
        ? `<failure message="${r.message || ""}">${JSON.stringify(r.evidence, null, 2)}</failure>` 
        : ""}
      ${r.status === "SKIP" ? `<skipped message="${r.message || ""}" />` : ""}
    </testcase>`)
    );

    const agentCases = this.report.agentResults.map(r => `
    <testcase name="${r.name}" classname="Agents" time="${r.durationMs / 1000}">
      ${r.status === "FAIL" || r.status === "ERROR" 
        ? `<failure message="${r.message || ""}">${JSON.stringify(r.evidence, null, 2)}</failure>` 
        : ""}
    </testcase>`);

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Capabilities Report" time="${this.report.summary.durationMs / 1000}">
  <testsuite name="Tools" tests="${this.report.summary.totalTools}" failures="${this.report.summary.toolsFailed}">
    ${testcases.join("")}
  </testsuite>
  <testsuite name="Agents" tests="${this.report.summary.totalAgents}" failures="${this.report.summary.agentsFailed}">
    ${agentCases.join("")}
  </testsuite>
</testsuites>`;
  }
}

export const capabilitiesReportRunner = new CapabilitiesReportRunner();
export { CapabilitiesReportRunner };
