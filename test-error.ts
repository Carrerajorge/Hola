import { dbRead } from "./server/db";
import { chatRuns } from "./shared/schema/chat";
import { eq, and } from "drizzle-orm";

async function main() {
    try {
        const chatId = "test-chat-id";
        const clientRequestId = "test-request-id";
        console.log("Running query...");
        const [fromRead] = await dbRead.select().from(chatRuns).where(
            and(eq(chatRuns.chatId, chatId), eq(chatRuns.clientRequestId, clientRequestId))
        );
        console.log("Success:", fromRead);
    } catch (error: any) {
        console.error("Query failed with error:");
        console.error(error);
    }
    process.exit(0);
}
main();
