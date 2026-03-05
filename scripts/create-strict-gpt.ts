import { db } from "../server/db";
import { gpts, gptCategories } from "../shared/schema/gpt";
import { eq } from "drizzle-orm";

async function run() {
  const category = await db.select().from(gptCategories).limit(1);
  const catId = category[0]?.id || null;

  const result = await db.insert(gpts).values({
    name: "Strict GPT",
    slug: "strict-gpt-001",
    description: "A GPT that strictly follows instructions without deviation.",
    systemPrompt: `You are a strict instruction-following assistant. You must adhere EXACTLY to the user's prompt. Do not add conversational filler, do not add pleasantries, and do not deviate or decline to follow the exact formatting or constraints requested. Your sole purpose is to execute the user's prompt as written.`,
    visibility: "public",
    categoryId: catId,
    avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=strict",
    isPublished: "true"
  }).returning();

  console.log("Created custom GPT:", result[0]?.name);
  process.exit(0);
}

run().catch(console.error);
