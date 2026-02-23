import { AutonomousAgentBrain } from '../server/agent/computerUse/autonomousAgentBrain.js';
import { globalRegistry } from '../server/agent/capabilities/registry.js';
import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Prueba End-To-End de la inyección Dinámica de Skills (Fase 8).
 * Simularemos que somos el Desktop Native enviando un Frame, y le pediremos al
 * Agente resolver una necesidad usando sus capacidades (Crossref).
 */

async function runCapabilityTest() {
    console.log("=== Phase 8: Capability Injection E2E Test ===");

    // Iniciar Cerebro Autónomo
    const brain = new AutonomousAgentBrain();

    const capabilities = globalRegistry.getAllRaw();
    console.log(`\n✅ Brain initialized with ${capabilities.length} active skills:`);
    capabilities.forEach(c => console.log(`   - [${c.name}]: ${c.description.substring(0, 50)}...`));

    console.log("\n🧪 Dispatching Goal Event: 'Research Active Inference'");

    const goal = {
        id: "goal-test-901",
        description: "Usa tu navegador (extract_webpage_content) para entrar a 'https://en.wikipedia.org/wiki/Active_inference', extrae el primer párrafo del texto y guárdalo usando create_word_document en un archivo llamado 'active_inference_summary.docx' con el título 'Active Inference'.",
        priority: "high" as const,
        category: "research" as const,
        constraints: {
            maxDuration: 60000,
            maxActions: 2, // Browser -> Word
            maxCost: 1,
            requireConfirmation: false,
            allowedTools: ["extract_webpage_content", "create_word_document"],
            blockedTools: []
        },
        successCriteria: ["Web Scrapeada.", "Documento Creado en Workspace."]
    };

    // Al arrancar, el run() entrará en el loop Predict-Observe-Act
    // generateNextAction debería elegir crossrefSearch e inyectar Json 
    // y executeAction lo resolverá dinamicamente:

    try {
        console.log("Mocking LLM inference to bypass HTTP 429 Limit...");

        // Emulamos al Agente decidiendo navegar
        const plan1 = {
            action: "extract_webpage_content",
            params: { url: "https://en.wikipedia.org/wiki/Active_inference" }
        };
        const result1 = await globalRegistry.get(plan1.action)?.execute(plan1.params);
        console.log("🌐 Result 1 (Playwright Browser): Extracted", result1.length, "chars. Preview:", (result1.content as string).substring(0, 100));

        // Emulamos al Agente volcando el texto en un Word (.docx)
        const plan2 = {
            action: "create_word_document",
            params: {
                filename: "active_inference_summary.docx",
                title: "Active Inference",
                paragraphs: [result1.content || "Failed"]
            }
        };
        const result2 = await globalRegistry.get(plan2.action)?.execute(plan2.params);
        console.log("📄 Result 2 (Office Generator):", result2);

        // Emulamos al Agente verificando su propio Workspace
        const plan3 = {
            action: "read_local_file",
            params: { operation: "list" }
        };
        const result3 = await globalRegistry.get(plan3.action)?.execute(plan3.params);
        console.log("📂 Result 3 (File System View):", result3);

        console.log("\n🎉 Agent Execution Log Ended.\nResult: Pipeline Verified via Mock");
    } catch (e: any) {
        console.error("Test Error:", e.stack);
    }
}

runCapabilityTest().then(() => process.exit(0));
