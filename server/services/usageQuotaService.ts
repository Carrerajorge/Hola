import { db } from "../db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

export interface UsageCheckResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date | null;
  plan: string;
  message?: string;
}

export interface PlanLimits {
  dailyRequests: number;
  model: string;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { dailyRequests: 3, model: "grok-4-1-fast-non-reasoning" },
  pro: { dailyRequests: 100, model: "grok-4-1-fast-non-reasoning" },
  enterprise: { dailyRequests: -1, model: "grok-4-1-fast-non-reasoning" },
};

function getNextMidnight(): Date {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow;
}

export class UsageQuotaService {
  async checkAndIncrementUsage(userId: string): Promise<UsageCheckResult> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user) {
      return {
        allowed: false,
        remaining: 0,
        limit: 0,
        resetAt: null,
        plan: "free",
        message: "Usuario no encontrado"
      };
    }

    const plan = user.plan || "free";
    const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    
    if (planLimits.dailyRequests === -1) {
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        resetAt: null,
        plan
      };
    }

    const now = new Date();
    const resetAt = user.dailyRequestsResetAt;
    let currentUsed = user.dailyRequestsUsed || 0;

    if (!resetAt || now >= resetAt) {
      currentUsed = 0;
      const nextReset = getNextMidnight();
      
      await db.update(users)
        .set({
          dailyRequestsUsed: 1,
          dailyRequestsResetAt: nextReset,
          dailyRequestsLimit: planLimits.dailyRequests,
          updatedAt: now
        })
        .where(eq(users.id, userId));

      return {
        allowed: true,
        remaining: planLimits.dailyRequests - 1,
        limit: planLimits.dailyRequests,
        resetAt: nextReset,
        plan
      };
    }

    if (currentUsed >= planLimits.dailyRequests) {
      return {
        allowed: false,
        remaining: 0,
        limit: planLimits.dailyRequests,
        resetAt: user.dailyRequestsResetAt,
        plan,
        message: "Has alcanzado el límite diario de solicitudes. Actualiza tu plan para continuar."
      };
    }

    await db.update(users)
      .set({
        dailyRequestsUsed: currentUsed + 1,
        updatedAt: now
      })
      .where(eq(users.id, userId));

    return {
      allowed: true,
      remaining: planLimits.dailyRequests - currentUsed - 1,
      limit: planLimits.dailyRequests,
      resetAt: user.dailyRequestsResetAt,
      plan
    };
  }

  async getUsageStatus(userId: string): Promise<UsageCheckResult> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user) {
      return {
        allowed: false,
        remaining: 0,
        limit: 0,
        resetAt: null,
        plan: "free"
      };
    }

    const plan = user.plan || "free";
    const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    if (planLimits.dailyRequests === -1) {
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        resetAt: null,
        plan
      };
    }

    const now = new Date();
    const resetAt = user.dailyRequestsResetAt;
    let currentUsed = user.dailyRequestsUsed || 0;

    if (!resetAt || now >= resetAt) {
      currentUsed = 0;
    }

    const remaining = planLimits.dailyRequests - currentUsed;

    return {
      allowed: remaining > 0,
      remaining,
      limit: planLimits.dailyRequests,
      resetAt: user.dailyRequestsResetAt,
      plan
    };
  }

  async updateUserPlan(userId: string, plan: string): Promise<void> {
    const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    
    await db.update(users)
      .set({
        plan,
        dailyRequestsLimit: planLimits.dailyRequests,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));
  }
}

export const usageQuotaService = new UsageQuotaService();
