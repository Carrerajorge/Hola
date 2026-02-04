/**
 * Subscription Service v2.0
 * Enhanced with full tracking, idempotency, and detailed admin notifications
 */

import { db } from "../db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { getStripeClient } from "../stripeClient";
import { randomUUID } from "crypto";

import { createRequire } from 'module';

// Optional dependency: nodemailer
const require = createRequire(import.meta.url);
let nodemailerModule: any = null;
function getNodemailer() {
  if (!nodemailerModule) {
    try {
      nodemailerModule = require('nodemailer');
    } catch {
      console.log('nodemailer not installed, email notifications disabled');
    }
  }
  return nodemailerModule;
}

// ============================================
// TYPES
// ============================================

export interface SubscriptionInfo {
  plan: "free" | "go" | "plus" | "pro" | "business";
  status: "active" | "cancelled" | "past_due" | "trialing" | "inactive";
  currentPeriodEnd?: Date;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export interface PurchaseNotification {
  userId: string;
  userEmail: string;
  userName?: string;
  plan: string;
  amount: number;
  currency: string;
  timestamp: Date;
  stripePaymentId?: string;
  // Enhanced tracking fields
  intentId?: string;
  sessionId?: string;
  ipAddress?: string;
  country?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
  device?: string;
  browser?: string;
  correlationId?: string;
  paymentMethod?: string;
}

// ============================================
// CONSTANTS
// ============================================

const ADMIN_EMAIL = "carrerajorge874@gmail.com";

const PLAN_HIERARCHY: Record<string, number> = {
  free: 0,
  go: 1,
  plus: 2,
  pro: 3,
  business: 4,
};

const PLAN_PRICES: Record<string, number> = {
  go: 5,
  plus: 10,
  pro: 200,
  business: 25,
};

// Processed event IDs for idempotency (in-memory cache, could be Redis in production)
const processedEvents = new Map<string, number>();
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================
// TEXT SANITIZATION - Clean invisible characters
// ============================================

/**
 * Deep clean text by removing invisible/special characters
 * Handles: NBSP, zero-width, tabs, carriage returns, etc.
 */
export function sanitizeText(input: string | null | undefined): string {
  if (!input) return "";
  
  let cleaned = input;
  
  // Replace NBSP (\u00A0) with regular space
  cleaned = cleaned.replace(/\u00A0/g, " ");
  
  // Remove zero-width characters
  cleaned = cleaned.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
  
  // Normalize line endings
  cleaned = cleaned.replace(/\r\n/g, "\n");
  cleaned = cleaned.replace(/\r/g, "\n");
  
  // Remove tabs, replace with space
  cleaned = cleaned.replace(/\t/g, " ");
  
  // Remove other control characters (except newline)
  cleaned = cleaned.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, "");
  
  // Normalize Unicode (NFC normalization)
  cleaned = cleaned.normalize("NFC");
  
  // Collapse multiple spaces into one
  cleaned = cleaned.replace(/ {2,}/g, " ");
  
  // Trim start and end
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * Debug function to show invisible characters
 */
export function debugText(input: string): { original: string; hex: string; cleaned: string } {
  const hexDump = [...input].map(c => {
    const code = c.charCodeAt(0);
    return code > 127 || code < 32 ? `\\u${code.toString(16).padStart(4, "0")}` : c;
  }).join("");
  
  return {
    original: input,
    hex: hexDump,
    cleaned: sanitizeText(input),
  };
}

// ============================================
// IDEMPOTENCY
// ============================================

function isEventProcessed(eventId: string): boolean {
  const processedAt = processedEvents.get(eventId);
  if (!processedAt) return false;
  
  // Check if within window
  if (Date.now() - processedAt > IDEMPOTENCY_WINDOW_MS) {
    processedEvents.delete(eventId);
    return false;
  }
  
  return true;
}

function markEventProcessed(eventId: string): void {
  processedEvents.set(eventId, Date.now());
  
  // Cleanup old entries periodically
  if (processedEvents.size > 1000) {
    const cutoff = Date.now() - IDEMPOTENCY_WINDOW_MS;
    for (const [id, timestamp] of processedEvents.entries()) {
      if (timestamp < cutoff) {
        processedEvents.delete(id);
      }
    }
  }
}

// ============================================
// USER SUBSCRIPTION FUNCTIONS
// ============================================

export async function getUserSubscription(userId: string): Promise<SubscriptionInfo> {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user) {
      return { plan: "free", status: "inactive" };
    }
    
    return {
      plan: (user.plan as SubscriptionInfo["plan"]) || "free",
      status: (user.status as SubscriptionInfo["status"]) || "inactive",
      currentPeriodEnd: user.subscriptionPeriodEnd ? new Date(user.subscriptionPeriodEnd) : undefined,
      stripeCustomerId: user.stripeCustomerId || undefined,
      stripeSubscriptionId: user.stripeSubscriptionId || undefined,
    };
  } catch (error) {
    console.error("Error getting user subscription:", error);
    return { plan: "free", status: "inactive" };
  }
}

export async function updateUserSubscription(
  userId: string,
  subscription: Partial<SubscriptionInfo>
): Promise<boolean> {
  try {
    await db.update(users)
      .set({
        plan: subscription.plan,
        status: subscription.status,
        subscriptionPeriodEnd: subscription.currentPeriodEnd,
        stripeCustomerId: subscription.stripeCustomerId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    
    return true;
  } catch (error) {
    console.error("Error updating user subscription:", error);
    return false;
  }
}

export function isPaidUser(subscription: SubscriptionInfo): boolean {
  return subscription.plan !== "free" && subscription.status === "active";
}

export function canUpgrade(currentPlan: string, targetPlan: string): boolean {
  return (PLAN_HIERARCHY[targetPlan] || 0) > (PLAN_HIERARCHY[currentPlan] || 0);
}

// ============================================
// ADMIN NOTIFICATION
// ============================================

export async function notifyAdminOfPurchase(notification: PurchaseNotification): Promise<boolean> {
  try {
    // Generate correlation ID if not provided
    if (!notification.correlationId) {
      notification.correlationId = `PAY-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;
    }
    
    // Sanitize all text fields
    notification.userName = sanitizeText(notification.userName);
    notification.userEmail = sanitizeText(notification.userEmail);
    notification.plan = sanitizeText(notification.plan);
    notification.utmSource = sanitizeText(notification.utmSource);
    notification.utmMedium = sanitizeText(notification.utmMedium);
    notification.utmCampaign = sanitizeText(notification.utmCampaign);
    notification.referrer = sanitizeText(notification.referrer);
    notification.device = sanitizeText(notification.device);
    notification.browser = sanitizeText(notification.browser);
    
    // Try to send email
    const emailSent = await sendPurchaseEmail(notification);
    
    // Log to database for tracking
    await logPurchaseToDatabase(notification);
    
    return emailSent;
  } catch (error) {
    console.error("Error notifying admin of purchase:", error);
    return false;
  }
}

async function sendPurchaseEmail(notification: PurchaseNotification): Promise<boolean> {
  try {
    const nodemailer = await getNodemailer();
    if (!nodemailer) {
      console.log("Email skipped: nodemailer not available");
      return false;
    }
    
    // Create transporter (using environment variables)
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    
    const planPrice = PLAN_PRICES[notification.plan] || notification.amount / 100;
    
    const emailContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; background: #f3f4f6; margin: 0; padding: 20px; }
    .container { max-width: 700px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0 0 10px 0; font-size: 28px; }
    .highlight { background: rgba(255,255,255,0.2); padding: 15px 30px; border-radius: 10px; display: inline-block; font-size: 32px; font-weight: bold; margin-top: 10px; }
    .content { padding: 30px; }
    .section { background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .section-title { font-size: 14px; text-transform: uppercase; color: #6b7280; font-weight: 600; margin-bottom: 15px; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 10px 0; vertical-align: top; }
    td:first-child { font-weight: 500; color: #374151; width: 40%; }
    td:last-child { color: #1f2937; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
    .badge-green { background: #d1fae5; color: #065f46; }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
    .correlation { background: #fef3c7; padding: 10px 15px; border-radius: 8px; font-family: monospace; font-size: 13px; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 ¡Nueva Compra!</h1>
      <div class="highlight">+$${planPrice} USD</div>
    </div>
    
    <div class="content">
      <!-- User Info -->
      <div class="section">
        <div class="section-title">👤 Información del Usuario</div>
        <table>
          <tr>
            <td>Nombre:</td>
            <td><strong>${notification.userName || "No especificado"}</strong></td>
          </tr>
          <tr>
            <td>Email:</td>
            <td>${notification.userEmail}</td>
          </tr>
          <tr>
            <td>ID Usuario:</td>
            <td><code style="background:#e5e7eb;padding:2px 6px;border-radius:4px;font-size:12px;">${notification.userId}</code></td>
          </tr>
        </table>
      </div>
      
      <!-- Transaction Details -->
      <div class="section">
        <div class="section-title">💳 Detalles de la Transacción</div>
        <table>
          <tr>
            <td>Plan:</td>
            <td><span class="badge badge-green">${notification.plan.toUpperCase()}</span></td>
          </tr>
          <tr>
            <td>Monto:</td>
            <td><strong>$${planPrice} ${notification.currency.toUpperCase()}</strong>/mes</td>
          </tr>
          <tr>
            <td>Método de Pago:</td>
            <td>${notification.paymentMethod || "Tarjeta"}</td>
          </tr>
          <tr>
            <td>Fecha/Hora:</td>
            <td>${notification.timestamp.toLocaleString("es-PE", { timeZone: "America/Lima" })} (Lima)</td>
          </tr>
          ${notification.sessionId ? `
          <tr>
            <td>Session ID:</td>
            <td><code style="font-size:11px;">${notification.sessionId}</code></td>
          </tr>
          ` : ""}
          ${notification.intentId ? `
          <tr>
            <td>Intent ID:</td>
            <td><code style="font-size:11px;">${notification.intentId}</code></td>
          </tr>
          ` : ""}
          ${notification.stripePaymentId ? `
          <tr>
            <td>Invoice ID:</td>
            <td><code style="font-size:11px;">${notification.stripePaymentId}</code></td>
          </tr>
          ` : ""}
        </table>
      </div>
      
      <!-- Tracking Info -->
      <div class="section">
        <div class="section-title">📊 Información de Tracking</div>
        <table>
          ${notification.ipAddress ? `
          <tr>
            <td>IP / País:</td>
            <td>${notification.ipAddress} ${notification.country ? `(${notification.country})` : ""}</td>
          </tr>
          ` : ""}
          ${notification.device || notification.browser ? `
          <tr>
            <td>Dispositivo:</td>
            <td>${notification.browser || ""} ${notification.device ? `en ${notification.device}` : ""}</td>
          </tr>
          ` : ""}
          ${notification.referrer ? `
          <tr>
            <td>Referrer:</td>
            <td>${notification.referrer}</td>
          </tr>
          ` : ""}
          ${notification.utmSource || notification.utmMedium || notification.utmCampaign ? `
          <tr>
            <td>UTM:</td>
            <td>
              ${notification.utmSource ? `source: <span class="badge badge-blue">${notification.utmSource}</span>` : ""}
              ${notification.utmMedium ? `medium: <span class="badge badge-blue">${notification.utmMedium}</span>` : ""}
              ${notification.utmCampaign ? `campaign: <span class="badge badge-blue">${notification.utmCampaign}</span>` : ""}
            </td>
          </tr>
          ` : ""}
        </table>
      </div>
      
      <!-- Correlation ID -->
      <div class="correlation">
        <strong>🔗 Correlation ID:</strong> ${notification.correlationId}
      </div>
    </div>
    
    <div class="footer">
      <p>Ver detalles en <a href="https://dashboard.stripe.com" style="color:#10b981;">Dashboard de Stripe</a></p>
      <p>IliaGPT - Sistema de Pagos</p>
    </div>
  </div>
</body>
</html>
`;
    
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "IliaGPT <noreply@iliagpt.com>",
      to: ADMIN_EMAIL,
      subject: `Pago confirmado – ${notification.userId.slice(0, 8)} – $${planPrice} ${notification.currency.toUpperCase()}`,
      html: emailContent,
    });
    
    console.log(`[Stripe] Purchase notification email sent to ${ADMIN_EMAIL} | Correlation: ${notification.correlationId}`);
    return true;
  } catch (error) {
    console.error("Error sending purchase email:", error);
    return false;
  }
}

async function logPurchaseToDatabase(notification: PurchaseNotification): Promise<void> {
  try {
    // Log to console with structured data
    console.log("PURCHASE_LOG:", JSON.stringify({
      type: "NEW_PURCHASE",
      correlationId: notification.correlationId,
      userId: notification.userId,
      userEmail: notification.userEmail,
      userName: notification.userName,
      plan: notification.plan,
      amount: notification.amount,
      currency: notification.currency,
      paymentMethod: notification.paymentMethod,
      sessionId: notification.sessionId,
      intentId: notification.intentId,
      stripePaymentId: notification.stripePaymentId,
      ipAddress: notification.ipAddress,
      country: notification.country,
      utmSource: notification.utmSource,
      utmMedium: notification.utmMedium,
      utmCampaign: notification.utmCampaign,
      referrer: notification.referrer,
      device: notification.device,
      browser: notification.browser,
      timestamp: notification.timestamp.toISOString(),
    }));
    
    // Try to persist to a payments_log table if it exists
    try {
      await db.execute(sql`
        INSERT INTO payments_log (
          correlation_id, user_id, email, name, plan, amount, currency,
          payment_method, session_id, intent_id, invoice_id,
          ip_address, country, utm_source, utm_medium, utm_campaign,
          referrer, device, browser, created_at
        ) VALUES (
          ${notification.correlationId},
          ${notification.userId},
          ${notification.userEmail},
          ${notification.userName || null},
          ${notification.plan},
          ${notification.amount},
          ${notification.currency},
          ${notification.paymentMethod || null},
          ${notification.sessionId || null},
          ${notification.intentId || null},
          ${notification.stripePaymentId || null},
          ${notification.ipAddress || null},
          ${notification.country || null},
          ${notification.utmSource || null},
          ${notification.utmMedium || null},
          ${notification.utmCampaign || null},
          ${notification.referrer || null},
          ${notification.device || null},
          ${notification.browser || null},
          NOW()
        )
      `);
    } catch (dbError: any) {
      // Table might not exist, that's ok
      if (!dbError.message?.includes("does not exist")) {
        console.error("Error inserting payment log:", dbError);
      }
    }
  } catch (error) {
    console.error("Error logging purchase:", error);
  }
}

// ============================================
// STRIPE WEBHOOK HANDLERS
// ============================================

export async function handleSubscriptionCreated(subscription: any, eventId?: string): Promise<void> {
  // Idempotency check
  if (eventId && isEventProcessed(eventId)) {
    console.log(`[Stripe] Event ${eventId} already processed, skipping`);
    return;
  }
  
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("No userId in subscription metadata");
    return;
  }
  
  const planName = getPlanFromPriceId(subscription.items.data[0]?.price?.id);
  
  await updateUserSubscription(userId, {
    plan: planName as SubscriptionInfo["plan"],
    status: "active",
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: new Date(((subscription as any).current_period_end ?? 0) * 1000),
  });
  
  // Get user info for notification
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  
  if (user) {
    await notifyAdminOfPurchase({
      userId,
      userEmail: user.email || "unknown",
      userName: (user as any).displayName || (user as any).name || user.fullName || [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
      plan: planName,
      amount: subscription.items.data[0]?.price?.unit_amount || 0,
      currency: subscription.currency || "usd",
      timestamp: new Date(),
      stripePaymentId: subscription.latest_invoice,
      sessionId: subscription.metadata?.checkoutSessionId,
      // Tracking from metadata if available
      ipAddress: subscription.metadata?.ipAddress,
      country: subscription.metadata?.country,
      utmSource: subscription.metadata?.utmSource,
      utmMedium: subscription.metadata?.utmMedium,
      utmCampaign: subscription.metadata?.utmCampaign,
      referrer: subscription.metadata?.referrer,
      device: subscription.metadata?.device,
      browser: subscription.metadata?.browser,
    });
  }
  
  // Mark event as processed
  if (eventId) {
    markEventProcessed(eventId);
  }
}

export async function handleSubscriptionUpdated(subscription: any, eventId?: string): Promise<void> {
  if (eventId && isEventProcessed(eventId)) {
    console.log(`[Stripe] Event ${eventId} already processed, skipping`);
    return;
  }
  
  const userId = subscription.metadata?.userId;
  if (!userId) return;
  
  const status = subscription.status === "active" ? "active" :
                 subscription.status === "past_due" ? "past_due" :
                 subscription.status === "canceled" ? "cancelled" : "inactive";
  
  await updateUserSubscription(userId, {
    status,
    currentPeriodEnd: new Date(((subscription as any).current_period_end ?? 0) * 1000),
  });
  
  if (eventId) {
    markEventProcessed(eventId);
  }
}

export async function handleSubscriptionDeleted(subscription: any, eventId?: string): Promise<void> {
  if (eventId && isEventProcessed(eventId)) {
    console.log(`[Stripe] Event ${eventId} already processed, skipping`);
    return;
  }
  
  const userId = subscription.metadata?.userId;
  if (!userId) return;
  
  await updateUserSubscription(userId, {
    plan: "free",
    status: "cancelled",
    stripeSubscriptionId: undefined,
  });
  
  if (eventId) {
    markEventProcessed(eventId);
  }
}

export async function handlePaymentSucceeded(invoice: any, eventId?: string): Promise<void> {
  if (eventId && isEventProcessed(eventId)) {
    console.log(`[Stripe] Event ${eventId} already processed, skipping`);
    return;
  }
  
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;
  
  try {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = subscription.metadata?.userId;
    
    if (userId) {
      await updateUserSubscription(userId, {
        status: "active",
        currentPeriodEnd: new Date(((subscription as any).current_period_end ?? (subscription as any).currentPeriodEnd ?? 0) * 1000),
      });
      
      // For recurring payments (not first payment), send notification
      if (invoice.billing_reason === "subscription_cycle") {
        const [user] = await db.select().from(users).where(eq(users.id, userId));
        if (user) {
          const planName = getPlanFromPriceId(subscription.items.data[0]?.price?.id);
          await notifyAdminOfPurchase({
            userId,
            userEmail: user.email || "unknown",
            userName: (user as any).displayName || (user as any).name || user.fullName || [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
            plan: planName,
            amount: invoice.amount_paid || subscription.items.data[0]?.price?.unit_amount || 0,
            currency: invoice.currency || "usd",
            timestamp: new Date(),
            stripePaymentId: invoice.id,
            intentId: invoice.payment_intent,
          });
        }
      }
    }
    
    if (eventId) {
      markEventProcessed(eventId);
    }
  } catch (error) {
    console.error("Error handling payment succeeded:", error);
  }
}

export async function handlePaymentFailed(invoice: any, eventId?: string): Promise<void> {
  if (eventId && isEventProcessed(eventId)) {
    console.log(`[Stripe] Event ${eventId} already processed, skipping`);
    return;
  }
  
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;
  
  try {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = subscription.metadata?.userId;
    
    if (userId) {
      await updateUserSubscription(userId, {
        status: "past_due",
      });
      
      // Notify admin of failed payment
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (user) {
        console.log("PAYMENT_FAILED:", {
          correlationId: `FAIL-${Date.now()}-${randomUUID().slice(0, 8)}`,
          userId,
          email: user.email,
          subscriptionId,
          invoiceId: invoice.id,
          amount: invoice.amount_due,
          timestamp: new Date().toISOString(),
        });
      }
    }
    
    if (eventId) {
      markEventProcessed(eventId);
    }
  } catch (error) {
    console.error("Error handling payment failed:", error);
  }
}

// ============================================
// HELPERS
// ============================================

function getPlanFromPriceId(priceId: string): string {
  const pricePlanMap: Record<string, string> = {
    price_go_monthly: "go",
    price_plus_monthly: "plus",
    price_pro_monthly: "pro",
    price_business_monthly: "business",
  };
  
  if (priceId === process.env.STRIPE_PRICE_GO) return "go";
  if (priceId === process.env.STRIPE_PRICE_PLUS) return "plus";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_BUSINESS) return "business";
  
  return pricePlanMap[priceId] || "go";
}

// ============================================
// VALIDATION
// ============================================

export function validateSubscriptionData(data: any): boolean {
  if (!data) return false;
  if (!data.plan || !["free", "go", "plus", "pro", "business"].includes(data.plan)) return false;
  if (!data.status || !["active", "cancelled", "past_due", "trialing", "inactive"].includes(data.status)) return false;
  return true;
}

export function sanitizeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9-_]/g, "").substring(0, 100);
}
