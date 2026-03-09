import { AgentOS } from "../../index";
import { z } from "zod";

export interface TestCase {
  id: string;
  category: "agentic" | "research" | "safety";
  prompt: string;
  expectedCondition: (output: string, toolsUsed: string[]) => boolean;
  timeoutMs?: number;
}

export interface TestResult {
  testId: string;
  passed: boolean;
  durationMs: number;
  output: string;
  toolsUsed: string[];
  error?: string;
}

export class EvalEngine {
  private os: AgentOS;

  constructor() {
    this.os = AgentOS.getInstance();
  }

  async runSuite(name: string, tests: TestCase[]): Promise<{ score: number; results: TestResult[] }> {
    console.log(`\n🧪 STARTING EVAL SUITE: ${name}`);
    console.log(`   Running ${tests.length} rigorous tests...`);
    
    // Asegurar que el sistema está vivo
    if (this.os.status !== "ready") await this.os.boot();

    const results: TestResult[] = [];
    let passedCount = 0;

    for (const test of tests) {
        console.log(`   ► Running ${test.id}: "${test.prompt.slice(0, 50)}..."`);
        const start = Date.now();
        const toolsUsed: string[] = [];

        try {
            // Hook para capturar herramientas usadas
            const originalExecute = this.os.action.execute.bind(this.os.action);
            
            // Monkey-patch temporal para espiar herramientas (Spying)
            // En prod usaríamos el EventStore, pero esto es más rápido para el test
            (this.os.action as any).execute = async (tool: string, params: any, ctx: any) => {
                toolsUsed.push(tool);
                return await originalExecute(tool, params, ctx);
            };

            // Ejecución
            const response = await this.os.model.route({
                userId: "eval_tester",
                messages: [{ role: "user", content: test.prompt }],
                maxTokens: 1000
            });

            // Restore execution
            (this.os.action as any).execute = originalExecute;

            const output = response.output || "";
            const passed = test.expectedCondition(output, toolsUsed);
            
            if (passed) passedCount++;
            
            results.push({
                testId: test.id,
                passed,
                durationMs: Date.now() - start,
                output,
                toolsUsed
            });

            console.log(`      ${passed ? "✅ PASS" : "❌ FAIL"} (${Date.now() - start}ms)`);

        } catch (e: any) {
            console.log(`      ❌ CRASH: ${e.message}`);
            results.push({
                testId: test.id,
                passed: false,
                durationMs: Date.now() - start,
                output: "",
                toolsUsed,
                error: e.message
            });
        }
    }

    const score = (passedCount / tests.length) * 100;
    console.log(`\n🏁 SUITE COMPLETE. Score: ${score.toFixed(1)}%\n`);
    return { score, results };
  }
}
