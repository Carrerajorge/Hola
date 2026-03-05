import fs from "fs";
import { executeAgentLoop } from "./agentExecutor";

const mockRes = {
    headersSent: false,
    setHeader: () => { },
    flushHeaders: () => { },
    write: (chunk: string) => {
        process.stdout.write(`>>> [SSE] ${chunk}`);
        return true;
    },
    end: () => {
        console.log("\n[TEST] response ended");
    },
    flush: () => { },
    locals: {}
} as any;

const baseSpec: any = {
    intent: "chat",
    intentConfidence: 1.0,
    deliverableType: "text_response",
    primaryAgent: "orchestrator",
    targetAgents: ["orchestrator"],
    attachments: []
};

function emitIntent(intent: string, confidence: number) {
    mockRes.write(`event: intent\ndata: ${JSON.stringify({ intent, confidence })}\n\n`);
}

async function testLevel1() {
    console.log("\n========== TEST NIVEL 1: Web Search + Save File ==========\n");
    const reqSpec = { ...baseSpec, intent: "web_automation", rawMessage: "Busca en la web sobre la misión Artemis y guárdalo en mision_artemis.txt" };
    emitIntent(reqSpec.intent, reqSpec.intentConfidence ?? 1.0);
    await executeAgentLoop(
        [{ role: "user", content: reqSpec.rawMessage }],
        mockRes,
        { runId: "test-run-1", userId: "test-user-1", chatId: "test-chat-1", requestSpec: reqSpec as any }
    );
}

async function testLevel3() {
    console.log("\n========== TEST NIVEL 3: Read File + Summary ==========\n");
    const reqSpec = { ...baseSpec, intent: "multi_step_task", rawMessage: "Analiza el archivo /tmp/test_light.txt y dame un resumen" };
    emitIntent(reqSpec.intent, reqSpec.intentConfidence ?? 1.0);
    await executeAgentLoop(
        [{ role: "user", content: reqSpec.rawMessage }],
        mockRes,
        { runId: "test-run-3", userId: "test-user-3", chatId: "test-chat-3", requestSpec: reqSpec as any }
    );
}

async function main() {
    fs.writeFileSync('/tmp/test_light.txt', 'const x = 1;\nconsole.log(x);\n// Some test content\n');

    await testLevel1();
    await testLevel3();

    process.exit(0);
}

main().catch(console.error);
