import { EvalEngine } from "../server/agentos/evals/engine";
import { INDUSTRIAL_SUITE } from "../server/agentos/evals/suites/industrial_benchmarks";

async function main() {
    console.log("🚀 Initializing Industrial Grade Evaluation Harness...");
    
    const engine = new EvalEngine();
    
    const report = await engine.runSuite("IliaGPT Production Readiness", INDUSTRIAL_SUITE);
    
    console.log("\n📊 FINAL SCORECARD:");
    console.log(`   Score: ${report.score.toFixed(1)}%`);
    console.log(`   Pass: ${report.results.filter(r => r.passed).length}`);
    console.log(`   Fail: ${report.results.filter(r => !r.passed).length}`);
    
    if (report.score < 80) {
        console.error("\n❌ FAILED: System is not ready for production (Score < 80%).");
        console.error("   Recommendation: Review System Prompts and Tool Definitions.");
        process.exit(1);
    } else {
        console.log("\n✅ PASSED: System meets industrial standards.");
        process.exit(0);
    }
}

main().catch(console.error);
