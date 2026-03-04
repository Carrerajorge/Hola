import { BasePlane } from "../base_plane";
import { EventStore } from "./event_store";
import { AgentOSEvent, AgentOSEventType } from "./schemas";
import { storage } from "../../storage";

export class DataPlane extends BasePlane {
  public store: EventStore;

  constructor(os: any) {
    super(os);
    this.store = new EventStore();
  }

  async initialize() {
    console.log("[DataPlane] Connecting Event Sourcing Backbone (Crypto-Verifiable)...");
    await this.store.initialize();
    
    // Self-Audit on boot
    const integrity = await this.store.verifyChain();
    if (!integrity.valid) {
        console.error(`[DataPlane] 🚨 FATAL: AUDIT CHAIN BROKEN AT ${integrity.brokenAt}. SYSTEM MAY BE COMPROMISED.`);
        // In strict mode, we might throw/shutdown here.
    } else {
        console.log("[DataPlane] ✅ Audit Chain Integrity Verified.");
    }
  }

  async record(params: {
    type: AgentOSEventType;
    actor: string;
    runId?: string;
    payload: Record<string, any>;
    riskLevel?: "low" | "medium" | "high" | "critical";
    component?: string;
  }) {
    // 1. Immutable Ledger (File/EventStore)
    const event = await this.store.append(params);

    // 2. Operational DB (Postgres for Querying/Dashboard)
    // We replicate the event to SQL for easy filtering, but the "Truth" is in the Ledger.
    try {
        await storage.createAuditLog({
            userId: params.actor,
            action: params.type,
            resource: params.component || "system",
            resourceId: params.runId || "global",
            details: {
                payload: params.payload,
                eventHash: event.hash, // Link to immutable ledger
                timestamp: event.timestamp
            },
            severity: params.riskLevel === "critical" ? "error" : "info",
            category: "system"
        });
    } catch (e) {
        console.warn("[DataPlane] SQL Log replication failed (Ledger is safe):", e);
    }

    return event;
  }

  async getTrace(runId: string) {
    return this.store.getTrace(runId);
  }
}
