import { executeLocalControlRequest } from './server/routes/chatAiRouter.js';
import { db } from './server/db/index.js';

async function main() {
    console.log("Starting test...");
    try {
        const result = await executeLocalControlRequest("revisa mi carpeta hola en el escritorio de mi mac y me avisas que hay", {
            requestId: "test-req",
            userId: "test-user-id"
        });
        console.log("Result:", JSON.stringify(result, null, 2));
    } catch (err: any) {
        console.error("Failed:", err);
    }
    process.exit(0);
}

main();
