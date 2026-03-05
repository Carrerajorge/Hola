import { db } from "./server/db";
import { chatMessages } from "./shared/schema";
import { desc } from "drizzle-orm";

async function run() {
  const msgs = await db.select().from(chatMessages).orderBy(desc(chatMessages.createdAt)).limit(10);
  for (const m of msgs) {
    if (m.role === 'user') {
      console.log(`[USER] ${m.content}`);
    } else {
      console.log(`[${m.role}] ${String(m.content).substring(0, 50)}...`);
    }
  }
  process.exit(0);
}
run();
