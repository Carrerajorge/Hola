/**
 * Subscription Service
 * Handles user subscription logic, plan management, and admin notifications
 */

import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getStripeClient } from "../stripeClient";

// Dynamic import for nodemailer (optional dependency)
let nodemailerModule: any = null;
async function getNodemailer() {
  if (!nodemailerModule) {
    try {
      nodemailerModule = await import("nodemailer");
    } catch {
      console.log("nodemailer not installed, email notifications disabled");
    }
  }
  return nodemailerModule?.default || nodemailerModule;
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
      currentPeriodEnd: user.subscriptionEndDate ? new Date(user.subscriptionEndDate) : undefined,
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
        subscriptionEndDate: subscription.currentPeriodEnd?.toISOString(),
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
    // Try to send email
    const emailSent = await sendPurchaseEmail(notification);
    
    // Also log to database for tracking
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
    body { font-family: Arial, sans-serif; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 20px; border-radius: 0 0 10px 10px; }
    .highlight { background: #10b981; color: white; padding: 10px 20px; border-radius: 5px; display: inline-block; }
    .details { margin: 20px 0; }
    .details table { width: 100%; border-collapse: collapse; }
    .details td { padding: 10px; border-bottom: 1px solid #e5e7eb; }
    .details td:first-child { font-weight: bold; width: 40%; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 ¡Nueva Compra en IliaGPT!</h1>
    </div>
    <div class="content">
      <p class="highlight">+$${planPrice} USD</p>
      
      <div class="details">
        <h3>Detalles de la compra:</h3>
        <table>
          <tr>
            <td>Usuario:</td>
            <td>${notification.userName || notification.userEmail}</td>
          </tr>
          <tr>
            <td>Email:</td>
            <td>${notification.userEmail}</td>
          </tr>
          <tr>
            <td>Plan:</td>
            <td><strong>${notification.plan.toUpperCase()}</strong></td>
          </tr>
          <tr>
            <td>Monto:</td>
            <td>$${planPrice} ${notification.currency.toUpperCase()}/mes</td>
          </tr>
          <tr>
            <td>Fecha:</td>
            <td>${notification.timestamp.toLocaleString()}</td>
          </tr>
          <tr>
            <td>ID Usuario:</td>
            <td>${notification.userId}</td>
          </tr>
          ${notification.stripePaymentId ? `
          <tr>
            <td>ID Pago Stripe:</td>
            <td>${notification.stripePaymentId}</td>
          </tr>
          ` : ""}
        </table>
      </div>
      
      <p>Puedes ver más detalles en el <a href="https://dashboard.stripe.com">Dashboard de Stripe</a>.</p>
    </div>
  </div>
</body>
</html>
`;
    
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "IliaGPT <noreply@iliagpt.com>",
      to: ADMIN_EMAIL,
      subject: `🎉 Nueva compra: Plan ${notification.plan.toUpperCase()} - $${planPrice}`,
      html: emailContent,
    });
    
    console.log(`Purchase notification email sent to ${ADMIN_EMAIL}`);
    return true;
  } catch (error) {
    console.error("Error sending purchase email:", error);
    // Don't fail the whole process if email fails
    return false;
  }
}

async function logPurchaseToDatabase(notification: PurchaseNotification): Promise<void> {
  try {
    // Log to a simple audit log (could be expanded to a dedicated purchases table)
    console.log("PURCHASE_LOG:", JSON.stringify({
      type: "NEW_PURCHASE",
      ...notification,
      timestamp: notification.timestamp.toISOString(),
    }));
  } catch (error) {
    console.error("Error logging purchase:", error);
  }
}

// ============================================
// STRIPE WEBHOOK HANDLERS
// ============================================

export async function handleSubscriptionCreated(subscription: any): Promise<void> {
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
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
  });
  
  // Get user info for notification
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  
  if (user) {
    await notifyAdminOfPurchase({
      userId,
      userEmail: user.email || "unknown",
      userName: user.displayName || user.name || undefined,
      plan: planName,
      amount: subscription.items.data[0]?.price?.unit_amount || 0,
      currency: subscription.currency || "usd",
      timestamp: new Date(),
      stripePaymentId: subscription.latest_invoice,
    });
  }
}

export async function handleSubscriptionUpdated(subscription: any): Promise<void> {
  const userId = subscription.metadata?.userId;
  if (!userId) return;
  
  const status = subscription.status === "active" ? "active" :
                 subscription.status === "past_due" ? "past_due" :
                 subscription.status === "canceled" ? "cancelled" : "inactive";
  
  await updateUserSubscription(userId, {
    status,
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
  });
}

export async function handleSubscriptionDeleted(subscription: any): Promise<void> {
  const userId = subscription.metadata?.userId;
  if (!userId) return;
  
  await updateUserSubscription(userId, {
    plan: "free",
    status: "cancelled",
    stripeSubscriptionId: undefined,
  });
}

export async function handlePaymentSucceeded(invoice: any): Promise<void> {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;
  
  try {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const userId = subscription.metadata?.userId;
    
    if (userId) {
      await updateUserSubscription(userId, {
        status: "active",
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      });
    }
  } catch (error) {
    console.error("Error handling payment succeeded:", error);
  }
}

export async function handlePaymentFailed(invoice: any): Promise<void> {
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
          userId,
          email: user.email,
          subscriptionId,
        });
      }
    }
  } catch (error) {
    console.error("Error handling payment failed:", error);
  }
}

// ============================================
// HELPERS
// ============================================

function getPlanFromPriceId(priceId: string): string {
  // Map price IDs to plan names
  const pricePlanMap: Record<string, string> = {
    price_go_monthly: "go",
    price_plus_monthly: "plus",
    price_pro_monthly: "pro",
    price_business_monthly: "business",
  };
  
  // Check environment variable mappings first
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
  // Remove any potentially dangerous characters
  return userId.replace(/[^a-zA-Z0-9-_]/g, "").substring(0, 100);
}
