import { db } from "../db";
import { payments, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

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

function getStripeCurrencyExponent(currency: string | null | undefined): number {
  const c = String(currency || "").toLowerCase().trim();
  if (!c) return 2;
  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(c)) return 0;
  if (STRIPE_THREE_DECIMAL_CURRENCIES.has(c)) return 3;
  return 2;
}

export function formatStripeAmountToMajorUnit(amountMinor: unknown, currency: string | null | undefined): string {
  const n = typeof amountMinor === "number" ? amountMinor : Number(amountMinor || 0);
  if (!Number.isFinite(n)) return "0.00";
  const exponent = getStripeCurrencyExponent(currency);
  const divisor = Math.pow(10, exponent);
  return (n / divisor).toFixed(exponent);
}

function unixSecondsToDate(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000);
}

export function getStripeCustomerIdFromInvoice(invoice: any): string | null {
  const customer = invoice?.customer;
  if (!customer) return null;
  if (typeof customer === "string") return customer;
  if (typeof customer === "object" && typeof customer.id === "string") return customer.id;
  return null;
}

export async function resolveUserIdFromStripeCustomerId(stripeCustomerId: string | null): Promise<string | null> {
  if (!stripeCustomerId) return null;
  const [result] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.stripeCustomerId, stripeCustomerId))
    .limit(1);
  return result?.id || null;
}

export async function upsertPaymentFromStripeInvoice(args: {
  invoice: any;
  status: "completed" | "failed";
  userId: string | null;
  plan?: string | null;
}): Promise<{ created: boolean }> {
  const { invoice, status, userId, plan } = args;

  const stripePaymentId = typeof invoice?.id === "string" ? invoice.id : null;
  if (!stripePaymentId) return { created: false };

  const currencyRaw = typeof invoice?.currency === "string" ? invoice.currency : "eur";
  const currency = currencyRaw.toUpperCase();

  const amountMinor =
    status === "completed"
      ? (typeof invoice?.amount_paid === "number" ? invoice.amount_paid : 0)
      : (typeof invoice?.amount_due === "number" ? invoice.amount_due : 0);
  const amount = formatStripeAmountToMajorUnit(amountMinor, currencyRaw);

  const occurredAt =
    unixSecondsToDate(invoice?.status_transitions?.paid_at) ||
    unixSecondsToDate(invoice?.created) ||
    new Date();

  const billingReason = typeof invoice?.billing_reason === "string" ? invoice.billing_reason : "";
  const descriptionParts = ["stripe"];
  if (plan) descriptionParts.push(String(plan));
  if (billingReason) descriptionParts.push(`(${billingReason})`);
  const description = descriptionParts.join(" ").trim();

  // Use an upsert to avoid duplicates on webhook retries or concurrent processing.
  const insertValues: typeof payments.$inferInsert = {
    userId: userId || null,
    amount,
    currency,
    status,
    method: "stripe",
    description,
    stripePaymentId,
    createdAt: occurredAt,
  };

  const updateSet: Partial<typeof payments.$inferInsert> = {
    // If userId can't be resolved for this event, don't overwrite an existing userId.
    userId: sql`coalesce(${userId}, ${payments.userId})`,
    amount,
    currency,
    status,
    method: "stripe",
    description,
    createdAt: occurredAt,
  } as any;

  await db
    .insert(payments)
    .values(insertValues)
    .onConflictDoUpdate({
      target: payments.stripePaymentId,
      set: updateSet,
    });

  return { created: true };
}

