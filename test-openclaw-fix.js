import { runEmbeddedPiAgent } from './server/openclaw/src/agents/pi-embedded-runner/run';
import { randomUUID } from 'crypto';
import os from 'os';
import path from 'path';
const run = async () => {
    console.log("Starting runEmbeddedPiAgent test...");
    const runId = randomUUID();
    const sessionFile = path.join(os.tmpdir(), `session-${runId}.json`);
    try {
        const response = await runEmbeddedPiAgent({
            sessionId: runId,
            sessionKey: runId,
            sessionFile,
            workspaceDir: process.env.HOME + '/Desktop',
            prompt: 'enumera los archivos en la carpeta Hola',
            model: "gemini-2.5-flash",
            provider: "google",
            timeoutMs: 60000,
            runId,
            customCoreTools: [{
                    name: 'list_files',
                    description: 'Lists files in a directory',
                    parameters: {
                        type: "object",
                        properties: {
                            directory: { type: "string" },
                            maxEntries: { type: "number" }
                        },
                        required: ["directory"]
                    },
                    execute: async (toolCallId, args) => {
                        console.log(`[TEST TOOL CALL] list_files called with:`, args);
                        return { content: [{ type: "text", text: "Found 3 files: a.txt, b.txt, c.txt" }] };
                    }
                }],
            extraSystemPrompt: "You are a helpful assistant."
        });
        console.log("\\n[TEST RESULTS]");
        console.log(JSON.stringify(response.payloads, null, 2));
    }
    catch (err) {
        console.error("Test failed:", err);
    }
};
run().catch(console.error);
