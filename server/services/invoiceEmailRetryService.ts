import { db } from "../db";
import { notificationLogs } from "@shared/schema";
import { and, eq, lt, or, sql } from "drizzle-orm";

import { sendInvoiceEmailIdempotent } from "./invoiceAutomationService";

export async function retryInvoiceEmailNotifications(params?: {
  batchSize?: number;
}): Promise<{
  considered: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  missingPayload: number;
}> {
  const batchSize = Math.min(100, Math.max(1, Number(params?.batchSize ?? 25) || 25));
  const pendingStaleMs = 10 * 60 * 1000;
  const maxRetries = 3;

  const staleCutoff = new Date(Date.now() - pendingStaleMs);

  const candidates = await db
    .select({
      id: notificationLogs.id,
      eventId: notificationLogs.eventId,
      userId: notificationLogs.userId,
      status: notificationLogs.status,
      retryCount: notificationLogs.retryCount,
      providerResponse: notificationLogs.providerResponse,
      createdAt: notificationLogs.createdAt,
    })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.eventTypeId, "invoice.sent"),
        eq(notificationLogs.channel, "email"),
        or(
          and(
            eq(notificationLogs.status, "failed"),
            sql`COALESCE(${notificationLogs.retryCount}, 0) < ${maxRetries}`,
          )!,
          and(eq(notificationLogs.status, "pending"), lt(notificationLogs.createdAt, staleCutoff))!,
        )!,
      )!,
    )
    .orderBy(notificationLogs.createdAt)
    .limit(batchSize);

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let missingPayload = 0;

  for (const row of candidates) {
    const provider = row.providerResponse as any;
    const payload = provider?.payload;

    if (!payload || !payload.to || !payload.invoiceId) {
      missingPayload += 1;
      continue;
    }

    attempted += 1;

    try {
      const outcome = await sendInvoiceEmailIdempotent({
        eventId: String(row.eventId),
        userId: String(row.userId),
        to: String(payload.to),
        invoiceIdForDisplay: String(payload.invoiceId),
        amount: String(payload.amount ?? "0"),
        currency: String(payload.currency ?? "EUR"),
        status: (String(payload.status || "pending") as any) || "pending",
        invoiceUrl: payload.invoiceUrl ? String(payload.invoiceUrl) : undefined,
      });

      if (outcome.status === "sent") sent += 1;
      else if (outcome.status === "failed") failed += 1;
      else skipped += 1;
    } catch {
      // sendInvoiceEmailIdempotent already writes status/errors to the DB.
      failed += 1;
    }
  }

  return {
    considered: candidates.length,
    attempted,
    sent,
    failed,
    skipped,
    missingPayload,
  };
}
