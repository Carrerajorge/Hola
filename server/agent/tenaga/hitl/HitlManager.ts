import { randomUUID } from "crypto";

/**
 * TENAGA - Human-In-The-Loop (HITL) Manager
 * Intercepta peticiones destructivas (Tier-2) y las pone en pausa
 * hasta recibir confirmación explícita vía WebSockets o REST.
 */

export interface PendingEscalation {
  id: string;
  runId: string;
  toolName: string;
  params: any;
  riskReason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
}

export class HitlManager {
  private static instance: HitlManager;
  private pendingRequests: Map<string, PendingEscalation> = new Map();
  // Callbacks para reanudar el hilo de ejecución original
  private resolvers: Map<string, (approved: boolean) => void> = new Map();

  private constructor() {}

  static getInstance(): HitlManager {
    if (!HitlManager.instance) {
      HitlManager.instance = new HitlManager();
    }
    return HitlManager.instance;
  }

  /**
   * Detiene la ejecución del tool hasta recibir confirmación humana.
   * Emite un evento (o guarda en BD) para que el frontend (React) lo muestre.
   */
  async requestApproval(runId: string, toolName: string, params: any, riskReason: string): Promise<boolean> {
    const id = randomUUID();
    
    const escalation: PendingEscalation = {
      id,
      runId,
      toolName,
      params,
      riskReason,
      status: 'pending',
      createdAt: Date.now()
    };

    this.pendingRequests.set(id, escalation);
    console.log(`[Tenaga:HITL] ⚠️ Escalation required: [${toolName}] Risk: ${riskReason}`);
    
    // Aquí idealmente emitimos vía Socket.io / SSE hacia el frontend
    // Para notificar a la UI: "Por favor, aprueba esta acción"
    // global.wss.emit('hitl_request', escalation);

    return new Promise((resolve) => {
      // Configuramos un timeout de 5 minutos. Si el humano no responde, rechazamos por seguridad.
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.resolveEscalation(id, false);
          console.log(`[Tenaga:HITL] ❌ Escalation timeout for ${id}`);
        }
      }, 5 * 60 * 1000);

      this.resolvers.set(id, (approved: boolean) => {
        clearTimeout(timeout);
        resolve(approved);
      });
    });
  }

  /**
   * Llamado por un endpoint REST/WS desde React cuando el usuario da click a "Aprobar"
   */
  resolveEscalation(id: string, approved: boolean) {
    const escalation = this.pendingRequests.get(id);
    if (!escalation) return false;

    escalation.status = approved ? 'approved' : 'rejected';
    
    const resolver = this.resolvers.get(id);
    if (resolver) {
      resolver(approved);
      this.resolvers.delete(id);
    }
    
    // Limpieza
    this.pendingRequests.delete(id);
    console.log(`[Tenaga:HITL] Escalation ${id} resolved: ${approved ? 'APPROVED ✅' : 'REJECTED ❌'}`);
    return true;
  }

  getPendingEscalations(): PendingEscalation[] {
    return Array.from(this.pendingRequests.values());
  }
}

export const hitlManager = HitlManager.getInstance();
