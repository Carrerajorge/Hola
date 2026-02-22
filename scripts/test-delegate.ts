import 'dotenv/config';
import { initializeAgents } from "../server/agent/langgraph/agents";
import { AGENT_REGISTRY } from "../server/agent/langgraph/agents/types";

// Boot up registry so CodeAgent knows about ResearchAssistantAgent
initializeAgents();

async function runDelegationTest() {
    console.log("== Starting Peer-to-Peer Delegation Test ==");

    const codeAgent = AGENT_REGISTRY.get("CodeAgent");

    if (!codeAgent) {
        throw new Error("CodeAgent not found in registry.");
    }

    console.log(`[Invoking] ${codeAgent.getName()}`);

    // We ask CodeAgent to write code about something highly specific it likely doesn't know.
    // Given the new prompt injection, it should decide to call `delegate_task` to the ResearchAssistantAgent
    const result = await codeAgent.execute({
        id: "test-delegate-123",
        // Force it to write code based on a specific API it needs to research
        type: "code_generation",
        description: "Write a typescript script that pulls the current weather for Tokyo using the Open-Meteo API. You must use the ResearchAssistantAgent to find out the correct API endpoint and parameters for Open-Meteo before writing the code.",
        input: {},
        priority: "high",
        retries: 0,
        maxRetries: 1
    });

    console.log("\n== Final Result from CodeAgent ==");
    console.log(JSON.stringify(result, null, 2));
}

runDelegationTest().catch(console.error);
