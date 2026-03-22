/**
 * Admin User Projection — CQRS-Lite
 *
 * Replaces the in-memory `getAllUsers()` approach with a PostgreSQL
 * materialized view that is refreshed on auth events.
 *
 * The materialized view aggregates:
 *  - Core user fields (email, role, plan, status, etc.)
 *  - Linked identity providers (from user_identities)
 *  - 2FA status (from user_2fa)
 *  - Active session count (from sessions)
 *
 * Refresh is debounced (2s) to handle burst registrations efficiently.
 */

import { db } from "../db";
import { users } from "@shared/schema";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { authEventBus } from "./authEventBus";
import { Logger } from "../lib/logger";

let lastRefreshAt: Date | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let isRefreshing = false;

const REFRESH_DEBOUNCE_MS = 2000;

type AdminUsersQueryFilters = {
  search?: string;
  role?: string;
  status?: string;
  plan?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
};

type AdminUsersQueryResult = { users: any[]; pagination: any };

function normalizeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTextFlag(value: unknown): "true" | "false" {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return "true";
    }
  }
  return "false";
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
      .filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function normalizeAdminUserRow(row: Record<string, any>) {
  const has2fa = row.has_2fa ?? row.has2fa ?? row.is2faEnabled ?? row.is_2fa_enabled;
  return {
    ...row,
    id: row.id,
    email: row.email ?? null,
    emailCanonical: row.email_canonical ?? row.emailCanonical ?? null,
    fullName: row.full_name ?? row.fullName ?? null,
    firstName: row.first_name ?? row.firstName ?? null,
    lastName: row.last_name ?? row.lastName ?? null,
    username: row.username ?? null,
    role: typeof row.role === "string" ? row.role.toLowerCase() : row.role ?? null,
    plan: typeof row.plan === "string" ? row.plan.toLowerCase() : row.plan ?? null,
    status: typeof row.status === "string" ? row.status.toLowerCase() : row.status ?? null,
    authProvider: typeof (row.auth_provider ?? row.authProvider) === "string"
      ? String(row.auth_provider ?? row.authProvider).toLowerCase()
      : (row.auth_provider ?? row.authProvider ?? null),
    emailVerified: normalizeTextFlag(row.email_verified ?? row.emailVerified),
    is2faEnabled: normalizeTextFlag(has2fa),
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
    lastLoginAt: row.last_login_at ?? row.lastLoginAt ?? null,
    loginCount: normalizeCount(row.login_count ?? row.loginCount),
    queryCount: normalizeCount(row.query_count ?? row.queryCount),
    tokensConsumed: normalizeCount(row.tokens_consumed ?? row.tokensConsumed),
    creditsBalance: normalizeCount(row.credits_balance ?? row.creditsBalance),
    stripeCustomerId: row.stripe_customer_id ?? row.stripeCustomerId ?? null,
    subscriptionStatus: row.subscription_status ?? row.subscriptionStatus ?? null,
    subscriptionPlan: row.subscription_plan ?? row.subscriptionPlan ?? null,
    orgId: row.org_id ?? row.orgId ?? null,
    lastIp: row.last_ip ?? row.lastIp ?? null,
    countryCode: row.country_code ?? row.countryCode ?? null,
    phone: row.phone ?? null,
    company: row.company ?? null,
    linkedProviders: normalizeStringArray(row.linked_providers ?? row.linkedProviders),
    activeSessions: normalizeCount(row.active_sessions ?? row.activeSessions),
    deletedAt: row.deleted_at ?? row.deletedAt ?? null,
  };
}

/**
 * Refresh the materialized view.
 * Uses CONCURRENTLY so it doesn't block reads.
 */
export async function refreshAdminProjection(): Promise<void> {
  if (isRefreshing) return; // Skip if already refreshing

  isRefreshing = true;
  const start = Date.now();

  try {
    await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY admin_user_projection`);
    lastRefreshAt = new Date();
    Logger.info(`[AdminProjection] Refreshed in ${Date.now() - start}ms`);
  } catch (error: any) {
    const code = error?.cause?.code || error?.code;
    // 42P01 = relation doesn't exist (pre-migration)
    if (code === "42P01") {
      Logger.info("[AdminProjection] Materialized view not yet created — skipping refresh");
    } else {
      Logger.error(`[AdminProjection] Refresh failed: ${error?.message}`);
    }
  } finally {
    isRefreshing = false;
  }
}

/**
 * Schedule a debounced refresh.
 * Multiple rapid events within REFRESH_DEBOUNCE_MS will only trigger one refresh.
 */
function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    await refreshAdminProjection();
  }, REFRESH_DEBOUNCE_MS);
}

/**
 * Query the admin user projection with pagination, search, and filters.
 * Falls back to direct users table query if the materialized view doesn't exist.
 */
export async function queryAdminUsers(filters: AdminUsersQueryFilters): Promise<AdminUsersQueryResult> {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(2000, Math.max(1, filters.limit || 20));
  const offset = (page - 1) * limit;
  const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";

  // Map sortBy to safe column names
  const sortColumns: Record<string, string> = {
    createdAt: "created_at",
    email: "email",
    queryCount: "query_count",
    tokensConsumed: "tokens_consumed",
    lastLoginAt: "last_login_at",
    loginCount: "login_count",
  };
  const sortCol = sortColumns[filters.sortBy || "createdAt"] || "created_at";

  try {
    const conditions = [sql`1=1`];

    if (filters.search) {
      const q = `%${filters.search}%`;
      conditions.push(
        sql`(email ILIKE ${q} OR full_name ILIKE ${q} OR first_name ILIKE ${q} OR last_name ILIKE ${q})`
      );
    }

    if (filters.role) {
      conditions.push(sql`role = ${filters.role}`);
    }

    if (filters.status) {
      conditions.push(sql`status = ${filters.status}`);
    }

    if (filters.plan) {
      conditions.push(sql`plan = ${filters.plan}`);
    }

    const whereClause = sql.join(conditions, sql` AND `);

    const countResult = await db.execute(
      sql`SELECT COUNT(*)::int as total FROM admin_user_projection WHERE ${whereClause}`
    );
    const total = Number((countResult as any)?.rows?.[0]?.total || 0);

    const dataResult = await db.execute(
      sql`SELECT * FROM admin_user_projection
          WHERE ${whereClause}
          ORDER BY ${sql.raw(sortCol)} ${sql.raw(sortOrder)}
          LIMIT ${limit}
          OFFSET ${offset}`
    );
    const rows = ((dataResult as any)?.rows || []).map((row: Record<string, any>) => normalizeAdminUserRow(row));

    return {
      users: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
    };
  } catch (error: any) {
    const code = error?.cause?.code || error?.code;
    if (code === "42P01") {
      // Materialized view doesn't exist — fall back to direct query
      Logger.info("[AdminProjection] View not found — falling back to direct users query");
      return fallbackDirectQuery(filters, page, limit, offset, sortCol, sortOrder);
    }
    throw error;
  }
}

/**
 * Fallback: query users table directly (pre-migration compatibility).
 */
async function fallbackDirectQuery(
  filters: AdminUsersQueryFilters,
  page: number,
  limit: number,
  offset: number,
  sortKey: string,
  sortOrder: string,
): Promise<AdminUsersQueryResult> {
  const conditions = [isNull(users.deletedAt)];

  if (filters.search) {
    const q = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(users.email, q),
        ilike(users.fullName, q),
        ilike(users.firstName, q),
        ilike(users.lastName, q),
      )!,
    );
  }

  if (filters.role) {
    conditions.push(eq(users.role, filters.role));
  }

  if (filters.status) {
    conditions.push(eq(users.status, filters.status));
  }

  if (filters.plan) {
    conditions.push(eq(users.plan, filters.plan));
  }

  const whereClause = and(...conditions);
  const sortColumnMap: Record<string, any> = {
    created_at: users.createdAt,
    email: users.email,
    query_count: users.queryCount,
    tokens_consumed: users.tokensConsumed,
    last_login_at: users.lastLoginAt,
    login_count: users.loginCount,
  };
  const orderColumn = sortColumnMap[sortKey] ?? users.createdAt;
  const orderByClause = sortOrder === "ASC" ? asc(orderColumn) : desc(orderColumn);

  const [rows, totalRows] = await Promise.all([
    db.select().from(users).where(whereClause).orderBy(orderByClause).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(users).where(whereClause),
  ]);
  const total = Number(totalRows[0]?.count || 0);

  return {
    users: rows.map((row) => normalizeAdminUserRow(row as Record<string, any>)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

/**
 * Get projection health status.
 */
export function getProjectionHealth(): {
  lastRefreshAt: string | null;
  isRefreshing: boolean;
} {
  return {
    lastRefreshAt: lastRefreshAt?.toISOString() || null,
    isRefreshing,
  };
}

/**
 * Initialize the projection consumer.
 * Subscribes to auth events and schedules debounced refreshes.
 */
export function initAdminProjection(): void {
  authEventBus.onAuth((_event) => {
    scheduleRefresh();
  });

  // Initial refresh on startup (non-blocking)
  setTimeout(() => refreshAdminProjection(), 5000);

  Logger.info("[AdminProjection] Consumer initialized — listening for auth events");
}
