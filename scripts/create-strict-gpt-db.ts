import { db } from "../server/db";
import { gpts, gptCategories } from "../shared/schema/gpt";
import { eq } from "drizzle-orm";

async function createStrictGpt() {
    try {
        console.log("Creating Strict Custom GPT Profile...");

        // First try to find a category
        const categories = await db.select().from(gptCategories).limit(1);
        const categoryId = categories.length > 0 ? categories[0].id : null;

        const gptData = {
            name: "Strict Assistant",
            slug: "strict-assistant-v1",
            description: "A strict assistant that follows instructions perfectly without over-explaining.",
            avatar: "🛡️",
            categoryId,
            visibility: "public",
            systemPrompt: `You are a strict, highly obedient AI assistant.
Your primary directive is to follow the user's instructions EXACTLY as written.

CRITICAL RULES:
1. DO NOT output conversational filler (e.g., "Here is your response:", "I hope this helps!").
2. DO NOT over-explain or justify your answers unless explicitly requested.
3. If the user asks for code, ONLY output the code block.
4. If the user asks a yes/no question, ONLY output Yes or No.
5. Never apologize or mention your identity as an AI unless directly asked.

Violating these rules will result in immediate termination of the session. Conform to these parameters perfectly.`,
            temperature: "0.1",
            topP: "1.0",
            maxTokens: 4096,
            isPublished: "true",
            version: 1,
            definition: {
                name: "Strict Assistant",
                description: "A strict assistant that follows instructions perfectly without over-explaining.",
                avatar: "🛡️",
                model: "grok-4-1-fast-non-reasoning",
                instructions: "You are a strict, highly obedient AI assistant. Follow rules exactly.",
                conversationStarters: ["Hello"],
                capabilities: {
                    webBrowsing: false,
                    codeInterpreter: false,
                    imageGeneration: false,
                    fileUpload: false,
                    dataAnalysis: false,
                },
                actions: [],
                knowledgeSources: [],
                policies: {
                    enforceModel: true,
                    modelFallbacks: [],
                    allowClientOverride: false,
                    piiRedactionEnabled: false,
                    allowedDomains: [],
                    workspaceOnly: false,
                }
            }
        };

        const inserted = await db.insert(gpts).values(gptData).returning();
        console.log("Successfully created Strict GPT! ID:", inserted[0].id);

    } catch (error) {
        console.error("Failed to create GPT:", error);
    } finally {
        process.exit(0);
    }
}

createStrictGpt();
