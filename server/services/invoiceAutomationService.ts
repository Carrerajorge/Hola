import { db } from "../db";
import { invoices, notificationLogs, payments } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { sendPaymentEmail } from "./genericEmailService";

type StripeInvoiceLite = {
  id: string;
  number?: string | null;
  subscription?: string | null;
  currency?: string | null;
  amount_paid?: number | null;
  amount_due?: number | null;
  paid?: boolean | null;
  status?: string | null;
  due_date?: number | null;
  status_transitions?: { paid_at?: number | null } | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  customer_email?: string | null;
};

export async function recordStripeInvoicePaymentSucceeded(params: {
  userId: string;
  userEmail?: string | null;
  stripeInvoice: StripeInvoiceLite;
}): Promise<void> {
  const { userId, userEmail, stripeInvoice } = params;

  if (!userId) return;
  if (!stripeInvoice?.id) return;

  const invoiceNumber = String(stripeInvoice.number || stripeInvoice.id).trim();
  const currency = normalizeCurrency(stripeInvoice.currency);
  const amountMinor = pickAmountPaidCents(stripeInvoice);
  const amount = formatStripeAmountToMajorUnit(amountMinor, currency);

  const paymentRow = await upsertPaymentFromStripeInvoice({
    userId,
    stripeInvoice,
    amount,
    currency,
  });

  const paidAt = unixSecondsToDate(stripeInvoice.status_transitions?.paid_at) || new Date();
  const dueDate = unixSecondsToDate(stripeInvoice.due_date);
  const pdfPath = stripeInvoice.invoice_pdf || stripeInvoice.hosted_invoice_url || null;

  await upsertInvoiceFromStripeInvoice({
    userId,
    paymentId: paymentRow?.id || null,
    invoiceNumber,
    amount,
    currency,
    paidAt,
    dueDate,
    pdfPath,
  });

  const recipientEmail = (userEmail || stripeInvoice.customer_email || "").trim();
  if (!recipientEmail) return;

  const invoiceUrl =
    stripeInvoice.hosted_invoice_url || stripeInvoice.invoice_pdf || undefined;

  await sendInvoiceEmailIdempotent({
    eventId: `stripe:invoice_payment_succeeded:${stripeInvoice.id}`,
    userId,
    to: recipientEmail,
    invoiceIdForDisplay: invoiceNumber,
    amount,
    currency,
    status: "paid",
    invoiceUrl,
  });
}

async function upsertPaymentFromStripeInvoice(params: {
  userId: string;
  stripeInvoice: StripeInvoiceLite;
  amount: string;
  currency: string;
}) {
  const { userId, stripeInvoice, amount, currency } = params;

  const values = {
    userId,
    amount,
    currency,
    status: "completed",
    method: "stripe",
    description: `Stripe invoice ${String(stripeInvoice.number || stripeInvoice.id).trim()}`,
    stripePaymentId: stripeInvoice.id,
  } as const;

  try {
    const [result] = await db
      .insert(payments)
      .values(values)
      .onConflictDoUpdate({
        target: payments.stripePaymentId,
        set: {
          userId,
          amount,
          currency,
          status: "completed",
          method: "stripe",
          description: values.description,
        },
      })
      .returning();
    return result;
  } catch (error) {
    // Fallback path if the unique index is missing in a given environment.
    const [existing] = await db
      .select()
      .from(payments)
      .where(eq(payments.stripePaymentId, stripeInvoice.id))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(payments)
        .set({
          userId,
          amount,
          currency,
          status: "completed",
          method: "stripe",
          description: values.description,
        })
        .where(eq(payments.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(payments).values(values).returning();
    return created;
  }
}

async function upsertInvoiceFromStripeInvoice(params: {
  userId: string;
  paymentId: string | null;
  invoiceNumber: string;
  amount: string;
  currency: string;
  paidAt: Date;
  dueDate: Date | null;
  pdfPath: string | null;
}) {
  const { userId, paymentId, invoiceNumber, amount, currency, paidAt, dueDate, pdfPath } = params;

  const values = {
    userId,
    paymentId,
    invoiceNumber,
    amount,
    currency,
    status: "paid",
    dueDate,
    paidAt,
    pdfPath,
  } as const;

  try {
    await db
      .insert(invoices)
      .values(values)
      .onConflictDoUpdate({
        target: [invoices.userId, invoices.invoiceNumber],
        set: {
          paymentId,
          amount,
          currency,
          status: "paid",
          dueDate,
          paidAt,
          pdfPath,
        },
      })
      .returning();
  } catch (error) {
    // Fallback if the unique index is missing.
    const [existing] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.userId, userId), eq(invoices.invoiceNumber, invoiceNumber)))
      .limit(1);

    if (existing) {
      await db
        .update(invoices)
        .set({
          paymentId,
          amount,
          currency,
          status: "paid",
          dueDate,
          paidAt,
          pdfPath,
        })
        .where(eq(invoices.id, existing.id));
      return;
    }

    await db.insert(invoices).values(values);
  }
}

async function sendInvoiceEmailIdempotent(params: {
  eventId: string;
  userId: string;
  to: string;
  invoiceIdForDisplay: string;
  amount: string;
  currency: string;
  status: "paid" | "pending" | "failed";
  invoiceUrl?: string;
}): Promise<void> {
  const { eventId, userId, to, invoiceIdForDisplay, amount, currency, status, invoiceUrl } = params;

  const maxRetries = 3;

  const decision = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(notificationLogs)
      .where(and(eq(notificationLogs.eventId, eventId), eq(notificationLogs.channel, "email")))
      .for("update");

    if (!existing) {
      const [created] = await tx
        .insert(notificationLogs)
        .values({
          eventId,
          userId,
          eventTypeId: "invoice.sent",
          channel: "email",
          status: "pending",
          createdAt: new Date(),
        })
        .returning();

      return { shouldSend: true as const, logId: created.id, retryCount: 0 };
    }

    const existingStatus = String(existing.status || "").toLowerCase().trim();
    if (existingStatus === "sent" || existingStatus === "delivered") {
      return { shouldSend: false as const, logId: existing.id, retryCount: existing.retryCount || 0 };
    }

    if (existingStatus === "pending") {
      return { shouldSend: false as const, logId: existing.id, retryCount: existing.retryCount || 0 };
    }

    const retries = existing.retryCount || 0;
    if (retries >= maxRetries) {
      return { shouldSend: false as const, logId: existing.id, retryCount: retries };
    }

    await tx
      .update(notificationLogs)
      .set({
        status: "pending",
        errorMessage: null,
      })
      .where(eq(notificationLogs.id, existing.id));

    return { shouldSend: true as const, logId: existing.id, retryCount: retries };
  });

  if (!decision.shouldSend) return;

  const emailResult = await sendPaymentEmail(to, {
    invoiceId: invoiceIdForDisplay,
    amount,
    currency,
    status,
    invoiceUrl,
  });

  if (emailResult.success) {
    await db
      .update(notificationLogs)
      .set({
        status: "sent",
        providerResponse: { messageId: emailResult.messageId },
        errorMessage: null,
        sentAt: new Date(),
      })
      .where(eq(notificationLogs.id, decision.logId));
    return;
  }

  await db
    .update(notificationLogs)
    .set({
      status: "failed",
      errorMessage: emailResult.error || "Failed to send invoice email",
      providerResponse: { error: emailResult.error || "unknown" },
      // Increment on failure even if the log row was newly created (retryCount default 0).
      retryCount: sql<number>`COALESCE(${notificationLogs.retryCount}, 0) + 1`,
    })
    .where(eq(notificationLogs.id, decision.logId));
}

function normalizeCurrency(currency: string | null | undefined): string {
  const cur = String(currency || "EUR").trim();
  return cur ? cur.toUpperCase() : "EUR";
}

function pickAmountPaidCents(invoice: StripeInvoiceLite): number {
  const paid = invoice.amount_paid;
  if (typeof paid === "number" && Number.isFinite(paid)) return paid;

  const due = invoice.amount_due;
  if (typeof due === "number" && Number.isFinite(due)) return due;

  return 0;
}

function centsToDecimalString(cents: number): string {
  // Deprecated: kept for backward compatibility in case other modules import this file.
  if (!Number.isFinite(cents)) return "0.00";
  return formatStripeAmountToMajorUnit(cents, "USD");
}

// Stripe reports amounts in the smallest currency unit. Most are 2-decimal (cents),
// but some are 0-decimal (JPY) or 3-decimal (BHD). Keep conversion logic centralized.
const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

const STRIPE_THREE_DECIMAL_CURRENCIES = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

function getStripeCurrencyExponent(currency: string): number {
  const c = String(currency || "").trim().toLowerCase();
  if (!c) return 2;
  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(c)) return 0;
  if (STRIPE_THREE_DECIMAL_CURRENCIES.has(c)) return 3;
  return 2;
}

function formatStripeAmountToMajorUnit(amountMinor: number, currency: string): string {
  const n = typeof amountMinor === "number" ? amountMinor : Number(amountMinor || 0);
  if (!Number.isFinite(n)) return "0";
  const exponent = getStripeCurrencyExponent(currency);
  const divisor = Math.pow(10, exponent);
  return (n / divisor).toFixed(exponent);
}

function unixSecondsToDate(unixSeconds: number | null | undefined): Date | null {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000);
}
