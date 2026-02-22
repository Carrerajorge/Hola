import 'dotenv/config'; // Make sure process.env is populated
import { orchestratorAgent } from "../server/agent/langgraph/agents/OrchestratorAgent";
import { initializeAgents } from "../server/agent/langgraph/agents";

// Boot up registry
initializeAgents();

async function runTest() {
    console.log("== Starting Orchestrator Test ==");

    const result = await orchestratorAgent.execute({
        id: "test-run-123",
        type: "complex_execution",
        description: "Write a small javascript function that calculates the factorial of a number and test it with 5.",
        input: {},
        priority: "high",
        retries: 0,
        maxRetries: 1
    });

    console.log("\n== Final Result ==");
    console.log(JSON.stringify(result, null, 2));
}

runTest().catch(console.error);
