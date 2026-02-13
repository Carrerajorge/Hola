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
  isAdmin?: boolean;
  isPaid?: boolean;
}

export interface PlanLimits {
  dailyRequests: number;
  model: string;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: { dailyRequests: 3, model: "grok-4-1-fast-non-reasoning" },
  go: { dailyRequests: 50, model: "grok-4-1-fast-non-reasoning" },
  plus: { dailyRequests: 200, model: "grok-4-1-fast-non-reasoning" },
  pro: { dailyRequests: -1, model: "grok-4-1-fast-non-reasoning" },
  admin: { dailyRequests: -1, model: "grok-4-1-fast-non-reasoning" },
};

// SECURITY: Admin email moved to environment variable
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";

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

    // SECURITY: Check admin status using env variable and database role
    const isAdmin = (ADMIN_EMAIL && user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) || user.role === "admin";
    const plan = isAdmin ? "admin" : (user.plan || "free");
    const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    if (isAdmin || planLimits.dailyRequests === -1) {
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        resetAt: null,
        plan
      };
    }

    const now = new Date();
    const nextReset = getNextMidnight();

    // FIX: Use atomic SQL operation to prevent race condition
    // This performs the check and increment in a single atomic operation
    const result = await db.execute(sql`
      UPDATE users
      SET
        daily_requests_used = CASE
          WHEN daily_requests_reset_at IS NULL OR NOW() >= daily_requests_reset_at
          THEN 1
          ELSE COALESCE(daily_requests_used, 0) + 1
        END,
        daily_requests_reset_at = CASE
          WHEN daily_requests_reset_at IS NULL OR NOW() >= daily_requests_reset_at
          THEN ${nextReset}
          ELSE daily_requests_reset_at
        END,
        daily_requests_limit = ${planLimits.dailyRequests},
        updated_at = NOW()
      WHERE id = ${userId}
        AND (
          -- Allow if reset needed
          daily_requests_reset_at IS NULL
          OR NOW() >= daily_requests_reset_at
          -- Or if under limit
          OR COALESCE(daily_requests_used, 0) < ${planLimits.dailyRequests}
        )
      RETURNING
        daily_requests_used as used,
        daily_requests_reset_at as reset_at
    `);

    // If no rows updated, user has exceeded limit
    if (result.rows.length === 0) {
      return {
        allowed: false,
        remaining: 0,
        limit: planLimits.dailyRequests,
        resetAt: user.dailyRequestsResetAt,
        plan,
        message: "Has alcanzado el límite diario de solicitudes. Actualiza tu plan para continuar."
      };
    }

    const updatedData = result.rows[0] as { used: number; reset_at: Date };

    return {
      allowed: true,
      remaining: planLimits.dailyRequests - updatedData.used,
      limit: planLimits.dailyRequests,
      resetAt: updatedData.reset_at,
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

    const isAdmin = (ADMIN_EMAIL && user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()) || user.role === "admin";
    const plan = isAdmin ? "admin" : (user.plan || "free");
    const isPaid = plan !== "free" && plan !== "admin";
    const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    if (isAdmin || planLimits.dailyRequests === -1) {
      return {
        allowed: true,
        remaining: -1,
        limit: -1,
        resetAt: null,
        plan,
        isAdmin,
        isPaid: isPaid || isAdmin
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
      plan,
      isAdmin: false,
      isPaid: isPaid
    };
  }

  async updateUserPlan(userId: string, plan: string): Promise<void> {
    const planLimits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

    await db.update(users)
      .set({
        plan,
        dailyRequestsLimit: planLimits.dailyRequests,
        dailyRequestsUsed: 0,
        dailyRequestsResetAt: null,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));
  }

  async hasTokenQuota(userId: string): Promise<boolean> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return false;

    if (user.role === "admin" || user.plan === "pro" || (ADMIN_EMAIL && user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase())) {
      return true;
    }

    const currentConsumed = user.tokensConsumed || 0;
    const limit = user.tokensLimit || 100000;

    return currentConsumed < limit;
  }

  async recordTokenUsage(userId: string, tokens: number): Promise<void> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return;

    const currentConsumed = user.tokensConsumed || 0;

    await db.update(users)
      .set({
        tokensConsumed: currentConsumed + tokens,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));
  }
}

export const usageQuotaService = new UsageQuotaService();
