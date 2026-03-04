import { BasePlane } from "../base_plane";
import { semanticMemoryStore } from "../../memory/SemanticMemoryStore";
import { ragService, personalizationService, workspaceContextService } from "../../services/ragService";
import { MemoryDaemon } from "./daemon";

export class KnowledgePlane extends BasePlane {
  private daemon: MemoryDaemon;

  constructor(os: any) {
    super(os);
    this.daemon = new MemoryDaemon();
  }

  async initialize() {
    console.log("[KnowledgePlane] Connecting to Memory Systems...");
    try {
        if (typeof semanticMemoryStore.initialize === 'function') {
            await semanticMemoryStore.initialize();
        }
        console.log("[KnowledgePlane] Memory Systems Online.");
        
        // Start background optimization
        this.daemon.start();
    } catch (e) {
        console.warn("[KnowledgePlane] Connection warning:", e);
    }
  }

  async shutdown() {
    this.daemon.stop();
  }

  // ── Ingestión Unificada ──
  async memorize(userId: string, content: string, opts: { type?: "fact" | "preference" | "note" | "conversation"; chatId?: string; role?: "user" | "assistant" } = {}) {
    const { type = "fact", chatId, role = "user" } = opts;
    const promises = [];

    // Auto-tagging
    const tags = await this.daemon.autoTagContent(content);

    if (semanticMemoryStore) {
        const metadata = { source: "agentos", chatId, tags };
        promises.push(semanticMemoryStore.remember(userId, content, type as any, metadata));
    }

    if (chatId) {
        promises.push(ragService.indexMessage(userId, chatId, content, role));
    }

    if (role === 'user') {
        promises.push(personalizationService.learnFromConversation(userId, [{ role, content }]));
    }

    await Promise.allSettled(promises);
    return { success: true, timestamp: Date.now() };
  }

  // ── Recuperación Unificada (Recall) ──
  async recall(userId: string, query: string, opts: { chatId?: string; limit?: number } = {}) {
    const { chatId, limit = 5 } = opts;

    const [semanticResults, ragResults, personalization, workspaceFiles] = await Promise.all([
        semanticMemoryStore.search(userId, query, { limit, minScore: 0.6 }).catch(() => []) as Promise<any[]>,
        ragService.search(userId, query, { limit, chatId, minScore: 0.3 }).catch(() => []) as Promise<any[]>,
        personalizationService.getPersonalizationContext(userId).catch(() => "") as Promise<string>,
        workspaceContextService.getRelevantFiles(userId, query, 3).catch(() => []) as Promise<any[]>
    ]);

    const contextParts = [];

    if (personalization) contextParts.push(`[PERFIL USUARIO]\n${personalization}`);
    
    if (semanticResults && semanticResults.length > 0) {
        const semanticText = semanticResults.map((r: any) => `• ${r.chunk?.content || r.content}`).join("\n");
        contextParts.push(`[MEMORIA SEMÁNTICA]\n${semanticText}`);
    }

    if (workspaceFiles && workspaceFiles.length > 0) {
        const filesText = workspaceFiles.map((f: any) => `• Archivo: ${f.filePath} (Resumen: ${f.summary})`).join("\n");
        contextParts.push(`[WORKSPACE FILES]\n${filesText}`);
    }

    if (ragResults && ragResults.length > 0) {
        const ragText = ragResults.map((r: any) => `• ${r.content}`).join("\n");
        contextParts.push(`[CONTEXTO HISTÓRICO]\n${ragText}`);
    }

    return contextParts.join("\n\n");
  }
}
