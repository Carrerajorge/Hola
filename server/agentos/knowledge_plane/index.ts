import { BasePlane } from "../base_plane";
import { semanticMemoryStore } from "../../memory/SemanticMemoryStore";

export class KnowledgePlane extends BasePlane {
  async initialize() {
    console.log("[KnowledgePlane] Connecting to RAGFlow & Vector DB...");
    try {
        await semanticMemoryStore.initialize();
        console.log("[KnowledgePlane] Semantic Memory Store connected.");
    } catch (e) {
        console.warn("[KnowledgePlane] Connection warning:", e);
    }
  }

  async ingest(userId: string, content: string, type: "fact" | "preference" | "note" = "fact", metadata?: any) {
    // 1. ETL & Store via SemanticMemoryStore
    return await semanticMemoryStore.remember(userId, content, type, metadata);
  }

  async query(userId: string, query: string, options?: any) {
    // 1. Semantic Search
    return await semanticMemoryStore.search(userId, query, options);
  }
}
