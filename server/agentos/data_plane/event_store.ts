import * as crypto from "crypto";
import { AgentOSEvent, AgentOSEventType } from "./schemas";
import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";

export class EventStore {
  private memoryChain: AgentOSEvent[] = [];
  private logPath: string;
  private lastHash: string = "0000000000000000000000000000000000000000000000000000000000000000"; // Genesis hash

  constructor() {
    this.logPath = path.join(process.cwd(), "agentos_events.jsonl");
  }

  async initialize() {
    // Recuperar último estado del disco para mantener la cadena de integridad
    try {
      const exists = await fs.stat(this.logPath).then(() => true).catch(() => false);
      if (exists) {
        const content = await fs.readFile(this.logPath, "utf-8");
        const lines = content.trim().split("\n");
        if (lines.length > 0) {
          const lastLine = lines[lines.length - 1];
          const lastEvent = JSON.parse(lastLine) as AgentOSEvent;
          this.lastHash = lastEvent.hash;
          // Cargar últimos eventos en memoria para contexto rápido (sliding window)
          this.memoryChain = lines.slice(-50).map(l => JSON.parse(l));
        }
      }
    } catch (error) {
      console.warn("[EventStore] Could not recover chain state:", error);
    }
  }

  private calculateHash(event: Omit<AgentOSEvent, "hash">): string {
    const payloadStr = JSON.stringify(event.payload);
    const data = `${event.id}:${event.previousHash}:${event.timestamp}:${payloadStr}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  async append(params: {
    type: AgentOSEventType;
    actor: string;
    runId?: string;
    payload: Record<string, any>;
    riskLevel?: "low" | "medium" | "high" | "critical";
    component?: string;
  }): Promise<AgentOSEvent> {
    const eventId = randomUUID();
    
    const draftEvent: Omit<AgentOSEvent, "hash"> = {
      id: eventId,
      type: params.type,
      timestamp: Date.now(),
      actor: params.actor,
      runId: params.runId || "global",
      previousHash: this.lastHash,
      payload: params.payload,
      metadata: {
        riskLevel: params.riskLevel || "low",
        component: params.component || "system"
      }
    };

    const hash = this.calculateHash(draftEvent);
    const finalEvent: AgentOSEvent = { ...draftEvent, hash };

    // 1. Memoria
    this.memoryChain.push(finalEvent);
    if (this.memoryChain.length > 100) this.memoryChain.shift(); // Keep logs lean
    
    // 2. Actualizar puntero de cadena
    this.lastHash = hash;

    // 3. Persistencia (Append-only file)
    await fs.appendFile(this.logPath, JSON.stringify(finalEvent) + "\n");

    return finalEvent;
  }

  // Time-Travel: Replay events for a specific runId
  async getTrace(runId: string): Promise<AgentOSEvent[]> {
    try {
        const content = await fs.readFile(this.logPath, "utf-8");
        return content
            .split("\n")
            .filter(line => line.trim())
            .map(line => JSON.parse(line) as AgentOSEvent)
            .filter(e => e.runId === runId);
    } catch {
        return [];
    }
  }

  // Verify Chain Integrity (Forensics)
  async verifyChain(): Promise<{ valid: boolean; brokenAt?: string }> {
    try {
        const content = await fs.readFile(this.logPath, "utf-8");
        const events = content.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
        
        let prevHash = "0000000000000000000000000000000000000000000000000000000000000000";
        
        for (const ev of events) {
            if (ev.previousHash !== prevHash) {
                return { valid: false, brokenAt: ev.id };
            }
            // Recalculate hash to ensure payload wasn't tampered
            const { hash, ...data } = ev;
            const calculated = this.calculateHash(data);
            if (calculated !== hash) {
                return { valid: false, brokenAt: ev.id };
            }
            prevHash = hash;
        }
        return { valid: true };
    } catch {
        return { valid: false };
    }
  }
}
