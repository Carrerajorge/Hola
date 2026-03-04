import { storage } from "../storage";
import { costEngine } from "./finops/costEngine";
import { AgentOS } from "../agentos";

export interface SystemHealth {
  status: "healthy" | "degraded" | "critical";
  uptime: number;
  activeAgents: number;
  memoryUsage: number;
  errorRate: number; // last hour
}

export interface UsageMetrics {
  totalTokens: number;
  totalCost: number;
  requestsCount: number;
  topUsers: Array<{ userId: string; cost: number }>;
  topTools: Array<{ tool: string; count: number }>;
}

export class AdminDashboardService {
  
  async getSystemHealth(): Promise<SystemHealth> {
    const os = AgentOS.getInstance();
    
    // Obtener métricas de proceso
    const mem = process.memoryUsage();
    
    // Calcular tasa de error basada en logs recientes
    const logs = await os.data.getRecentActivity(100);
    const errors = logs.filter(l => l.type.includes("error") || (l as any).riskLevel === "critical").length;
    const errorRate = errors / 100;

    let status: SystemHealth["status"] = "healthy";
    if (os.status === "degraded") status = "degraded";
    if (errorRate > 0.1) status = "critical";

    return {
      status,
      uptime: process.uptime(),
      activeAgents: 0, // TODO: Track active runs in AgentOS
      memoryUsage: mem.heapUsed,
      errorRate
    };
  }

  async getGlobalMetrics(period: "day" | "week" | "month" = "day"): Promise<UsageMetrics> {
    // En producción, esto consultaría una tabla agregada en ClickHouse o TimescaleDB
    // Aquí simulamos agregación sobre logs de Postgres
    
    // Mock data based on costEngine state
    const wallet = await costEngine.getWallet("system_master"); 
    
    return {
      totalTokens: 1540020,
      totalCost: 15.42,
      requestsCount: 3420,
      topUsers: [
        { userId: "user_123", cost: 4.50 },
        { userId: "user_999", cost: 2.10 }
      ],
      topTools: [
        { tool: "web_search", count: 1200 },
        { tool: "generate_image", count: 450 },
        { tool: "terminal_exec", count: 120 }
      ]
    };
  }

  async getAuditTrail(limit = 50) {
    const os = AgentOS.getInstance();
    return await os.data.getRecentActivity(limit);
  }
}

export const adminDashboard = new AdminDashboardService();
