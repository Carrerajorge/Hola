import { db } from '../server/db';
import { storage } from '../server/storage';

async function testGptCreation() {
    try {
        const res = await storage.createGpt({
            name: "Test GPT 2026",
            slug: "test-gpt-2026-" + Math.random().toString(36).substring(7),
            systemPrompt: "You are a test.",
        });
        console.log("SUCCESS:", res.id);
    } catch (err: any) {
        console.error("DB ERROR DETAILS:", err);
    }
}

testGptCreation().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
