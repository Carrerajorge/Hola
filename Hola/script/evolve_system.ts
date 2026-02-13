
import { promptOptimizer } from '../server/lib/ai/evolutionEngine';
import { Logger } from '../server/lib/logger';

// Mock Logger if needed for script execution context
if (!Logger.info) {
    (Logger as any).info = console.log;
    (Logger as any).warn = console.warn;
    (Logger as any).error = console.error;
}

async function runEvolution() {
    console.log("🧬 Starting System Evolution Sequence...");
    console.log("=========================================");

    // 1. Define the Candidate Prompt to Optimize
    const originalPrompt = `
    You are a helpful AI assistant. Answer the user's questions to the best of your ability.
    Be polite and professional.
    `;

    console.log("\n📋 Original Prompt:");
    console.log(originalPrompt.trim());

    // 2. Define Evaluation Examples (Ground Truth)
    const examples = [
        {
            input: "Explain quantum entanglement to a 5 year old.",
            output: "Imagine you have two magic dice. When you roll them, if one shows a 6, the other ALWAYS shows a 6, no matter how far apart they are!"
        },
        {
            input: "Write a python function to fibonacci.",
            output: "def fib(n):\n  if n <= 1: return n\n  return fib(n-1) + fib(n-2)"
        }
    ];

    // 3. Run Optimization
    console.log("\n🧠 Optimizing Prompt with Evolution Engine...");
    const optimizedPrompt = await promptOptimizer.optimize(originalPrompt, examples);

    // 4. Output Results
    console.log("\n✨ Optimized Prompt:");
    console.log("-----------------------------------------");
    console.log(optimizedPrompt);
    console.log("-----------------------------------------");

    console.log("\n✅ Evolution Complete.");
}

// Execute
runEvolution().catch(console.error);
