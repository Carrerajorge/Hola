import { createUnifiedRun, executeUnifiedChat } from "./unifiedChatHandler";
import fs from "fs";

const mockRes = {
    headersSent: false,
    setHeader: () => { },
    flushHeaders: () => { },
    write: (chunk: string) => {
        process.stdout.write(chunk);
        return true;
    },
    end: () => {
        console.log("\n[TEST] response ended");
    },
    flush: () => { },
    locals: {}
} as any;

async function testLevel1() {
    console.log("\n========== TEST NIVEL 1: Web Search + Save File ==========\n");
    const req = {
        messages: [{ role: "user", content: "Busca en la web sobre la misión Artemis y guárdalo en Desktop/mision_artemis.txt" }],
        chatId: "test-chat-1",
        userId: "test-user-1",
    };
    const context = await createUnifiedRun(req);
    await executeUnifiedChat(context, req, mockRes);
}

async function testLevel3() {
    console.log("\n========== TEST NIVEL 3: Read File + Summary ==========\n");
    const req = {
        messages: [{ role: "user", content: "Analiza el archivo /tmp/test_fusion.ts y dame un resumen" }],
        chatId: "test-chat-3",
        userId: "test-user-3",
    };
    const context = await createUnifiedRun(req);
    await executeUnifiedChat(context, req, mockRes);
}

async function main() {
    // Dummy file for test
    fs.writeFileSync('/tmp/test_fusion.ts', 'const app = express();\napp.use(cors());\nconst ws = new WebSocket();\n');

    // Let's stub getGeminiClient so it returns null for deterministic execution
    const geminiModule = require("../lib/gemini");
    geminiModule.getGeminiClient = () => null;

    await testLevel1();
    await testLevel3();

    process.exit(0);
}

main().catch(console.error);
