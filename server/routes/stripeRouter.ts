import { Router } from "express";
import { getUncachableStripeClient, getStripePublishableKey } from "../stripeClient";
import { db } from "../db";
import { apiLogs, users } from "@shared/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { withRetry } from "../lib/retryUtility";
import { z } from "zod";
import { sendEmail } from "../services/genericEmailService";
import { requireAdmin } from "./admin/utils";
import { auditLog, AuditActions } from "../services/auditLogger";

const PLAN_PRICE_MAPPING: Record<string, { name: string; amount: number; interval?: string }> = {
  price_go_monthly: { name: "Go", amount: 500, interval: "month" },
  price_plus_monthly: { name: "Plus", amount: 1000, interval: "month" },
  price_pro_monthly: { name: "Pro", amount: 20000, interval: "month" },
  price_business_monthly: { name: "Business", amount: 2500, interval: "month" },
};

const BILLING_MANAGER_ROLES = new Set(["admin", "superadmin", "team_admin"]);
const BILLING_CONTACT_COOLDOWN_MS = 10 * 60 * 1000;
const billingContactCooldown = new Map<string, number>();
const billingContactIpCooldown = new Map<string, number>();

function requireStripeProductSeedingEnabled(_req: any, res: any, next: any) {
  const flag = String(process.env.ALLOW_STRIPE_PRODUCT_SEEDING || "").trim().toLowerCase();
  if (flag === "true" || flag === "1") return next();
  // Hide Stripe product seeding endpoint unless explicitly enabled.
  return res.status(404).json({ error: "Not found" });
}

function normalizeRole(value: any): string {
  return String(value || "").toLowerCase().trim();
}

function normalizeEmail(value: any): string {
  return String(value || "").toLowerCase().trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getAdminEmailNormalized(): string {
  return normalizeEmail(process.env.ADMIN_EMAIL);
}

function isBillingManagerRole(role: string): boolean {
  return BILLING_MANAGER_ROLES.has(normalizeRole(role));
}

function isAdminEmail(email: string): boolean {
  const adminEmail = getAdminEmailNormalized();
  const normalized = normalizeEmail(email);
  return !!adminEmail && !!normalized && normalized === adminEmail;
}

function getActorEmail(req: any): string {
  const passportUser = req?.session?.passport?.user;
  return normalizeEmail(
    req?.user?.claims?.email ||
      req?.user?.email ||
      passportUser?.claims?.email ||
      passportUser?.email ||
      req?.user?.profile?.emails?.[0]?.value
  );
}

function getActorRole(req: any): string {
  const passportUser = req?.session?.passport?.user;
  return normalizeRole(
    req?.user?.claims?.role ||
      req?.user?.role ||
      passportUser?.claims?.role ||
      passportUser?.role
  );
}

function canManageBillingForDbUser(dbUser: any): boolean {
  const role = normalizeRole(dbUser?.role);
  const email = normalizeEmail(dbUser?.email);
  return isBillingManagerRole(role) || isAdminEmail(email);
}

function getEffectiveUserId(req: any): string | undefined {
  const passportUser = req?.session?.passport?.user;
  const passportUserId =
    typeof passportUser === "string"
      ? passportUser
      : passportUser?.claims?.sub || passportUser?.id;
  return (
    req?.user?.claims?.sub ||
    req?.user?.id ||
    req?.session?.authUserId ||
    passportUserId
  );
}

function addMonths(base: Date, deltaMonths: number): Date {
  const d = new Date(base);
  const day = d.getDate();
  d.setMonth(d.getMonth() + deltaMonths);
  // Preserve end-of-month behavior where possible
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

export function createStripeRouter() {
  const router = Router();

  router.get("/api/stripe/publishable-key", async (req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error: any) {
      console.error("Error getting Stripe publishable key:", error);
      res.status(500).json({ error: "Failed to get publishable key" });
    }
  });

  router.get("/api/stripe/products", async (req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring
        FROM stripe.products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
        ORDER BY pr.unit_amount ASC
      `);

      const productsMap = new Map();
      for (const row of result.rows as any[]) {
        if (!productsMap.has(row.product_id)) {
          productsMap.set(row.product_id, {
            id: row.product_id,
            name: row.product_name,
            description: row.product_description,
            metadata: row.product_metadata,
            prices: []
          });
        }
        if (row.price_id) {
          productsMap.get(row.product_id).prices.push({
            id: row.price_id,
            unit_amount: row.unit_amount,
            currency: row.currency,
            recurring: row.recurring
          });
        }
      }

      res.json({ products: Array.from(productsMap.values()) });
    } catch (error: any) {
      console.error("Error fetching products:", error);
      res.json({ products: [] });
    }
  });

  router.get("/api/stripe/price-ids", async (req, res) => {
    try {
      const priceMapping: Record<string, string> = {};

      try {
        const result = await db.execute(sql`
          SELECT 
            p.name as product_name,
            pr.id as price_id,
            pr.unit_amount
          FROM stripe.products p
          LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
          WHERE p.active = true
          ORDER BY pr.unit_amount ASC
        `);

        for (const row of result.rows as any[]) {
          const productName = (row.product_name || "").toLowerCase();
          const amount = row.unit_amount;

          if (productName.includes("go") || amount === 500) {
            priceMapping.price_go_monthly = row.price_id;
          } else if (productName.includes("plus") || amount === 1000) {
            priceMapping.price_plus_monthly = row.price_id;
          } else if (productName.includes("pro") || amount === 2000) {
            priceMapping.price_pro_yearly = row.price_id;
          }
        }
      } catch (dbError) {
        console.log("DB lookup failed, trying Stripe API directly");
      }

      if (Object.keys(priceMapping).length === 0) {
        try {
          const stripe = await getUncachableStripeClient();
          // Add retry logic for Stripe API calls
          const prices = await withRetry(
            () => stripe.prices.list({ active: true, limit: 100, expand: ["data.product"] }),
            { maxAttempts: 3, initialDelayMs: 1000 }
          );

          // Prefer mapping by product name to avoid picking legacy prices
          for (const price of prices.data) {
            const amount = price.unit_amount;
            const interval = price.recurring?.interval;
            const productName =
              typeof price.product === "object" && price.product && "name" in price.product
                ? String((price.product as any).name || "").toLowerCase()
                : "";

            if (interval !== "month") continue;

            if (productName.includes("iliagpt business") || productName === "business") {
              if (amount === 2500) priceMapping.price_business_monthly = price.id;
              continue;
            }

            if (productName.includes("iliagpt pro") || productName === "pro") {
              if (amount === 20000) priceMapping.price_pro_monthly = price.id;
              continue;
            }

            if (productName.includes("iliagpt plus") || productName === "plus") {
              if (amount === 1000) priceMapping.price_plus_monthly = price.id;
              continue;
            }

            if (productName.includes("iliagpt go") || productName === "go") {
              if (amount === 500) priceMapping.price_go_monthly = price.id;
              continue;
            }
          }

          // Fallback by amount if still missing
          for (const price of prices.data) {
            if (typeof price.product === "object") {
              // already handled above
            }
            const amount = price.unit_amount;
            const interval = price.recurring?.interval;
            if (interval !== "month") continue;

            if (!priceMapping.price_go_monthly && amount === 500) priceMapping.price_go_monthly = price.id;
            if (!priceMapping.price_plus_monthly && amount === 1000) priceMapping.price_plus_monthly = price.id;
            if (!priceMapping.price_pro_monthly && amount === 20000) priceMapping.price_pro_monthly = price.id;
            if (!priceMapping.price_business_monthly && amount === 2500) priceMapping.price_business_monthly = price.id;
          }
        } catch (stripeError: any) {
          console.error("Stripe API lookup failed:", stripeError.message);
        }
      }

      res.json({ priceMapping });
    } catch (error: any) {
      console.error("Error fetching price IDs:", error);
      res.json({ priceMapping: {} });
    }
  });

  router.post("/api/checkout", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;

      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión para suscribirte" });
      }

      const { priceId, utmSource, utmMedium, utmCampaign, referrer } = req.body;
      if (!priceId) {
        return res.status(400).json({ error: "priceId is required" });
      }

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!dbUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const stripe = await getUncachableStripeClient();

      let customerId = dbUser.stripeCustomerId;
      if (!customerId) {
        // Add retry logic for customer creation
        const customer = await withRetry(
          () => stripe.customers.create({
            email: dbUser.email || undefined,
            metadata: { userId }
          }),
          { maxAttempts: 3, initialDelayMs: 1000 }
        );
        customerId = customer.id;

        await db.update(users)
          .set({ stripeCustomerId: customerId })
          .where(eq(users.id, userId));
      }

      const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost:5000';
      const protocol = domain.includes('localhost') ? 'http' : 'https';
      
      // Extract tracking info from request
      const ipAddress = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.ip || '';
      const userAgent = req.headers['user-agent'] || '';
      const deviceType = /Mobile|Android|iPhone|iPad/i.test(userAgent) ? 'Mobile' : 'Desktop';
      const browserMatch = userAgent.match(/(Chrome|Firefox|Safari|Edge|Opera)/i);
      const browser = browserMatch ? browserMatch[1] : 'Unknown';

      // Add retry logic for session creation with tracking metadata
      const session = await withRetry(
        () => stripe.checkout.sessions.create({
          customer: customerId,
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 1 }],
          mode: 'subscription',
          success_url: `${protocol}://${domain}/?subscription=success`,
          cancel_url: `${protocol}://${domain}/?subscription=cancelled`,
          metadata: { 
            userId,
            ipAddress: ipAddress.substring(0, 50),
            device: deviceType,
            browser: browser,
            utmSource: utmSource?.substring(0, 50) || '',
            utmMedium: utmMedium?.substring(0, 50) || '',
            utmCampaign: utmCampaign?.substring(0, 50) || '',
            referrer: referrer?.substring(0, 100) || '',
          },
          subscription_data: {
            metadata: {
              userId,
              ipAddress: ipAddress.substring(0, 50),
              device: deviceType,
              browser: browser,
              utmSource: utmSource?.substring(0, 50) || '',
              utmMedium: utmMedium?.substring(0, 50) || '',
              utmCampaign: utmCampaign?.substring(0, 50) || '',
              referrer: referrer?.substring(0, 100) || '',
            }
          }
        }),
        { maxAttempts: 3, initialDelayMs: 1000 }
      );
      
      console.log(`[Stripe] Checkout session created for user ${userId} | Session: ${session.id}`);

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Checkout error:", error);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  router.post("/api/stripe/create-products", requireStripeProductSeedingEnabled, requireAdmin, async (req, res) => {
    try {
      const stripe = await getUncachableStripeClient();
      const createdProducts: any[] = [];

      const productsToCreate = [
        {
          name: "IliaGPT Go",
          description: "Logra más con una IA más avanzada - 50 solicitudes por día",
          priceAmount: 500, // $5
          interval: "month" as const,
          metadata: { plan: "go" }
        },
        {
          name: "IliaGPT Plus",
          description: "Descubre toda la experiencia - 200 solicitudes por día",
          priceAmount: 1000, // $10
          interval: "month" as const,
          metadata: { plan: "plus" }
        },
        {
          name: "IliaGPT Pro",
          description: "Maximiza tu productividad - Mensajes ilimitados",
          priceAmount: 20000, // $200
          interval: "month" as const,
          metadata: { plan: "pro" }
        },
        {
          name: "IliaGPT Business",
          description: "Mejora la productividad con IA para equipos",
          priceAmount: 2500, // $25
          interval: "month" as const,
          metadata: { plan: "business" }
        }
      ];

      for (const productData of productsToCreate) {
        const existingProducts = await stripe.products.search({
          query: `name:'${productData.name}'`
        });

        let product;
        if (existingProducts.data.length > 0) {
          product = existingProducts.data[0];
        } else {
          product = await stripe.products.create({
            name: productData.name,
            description: productData.description,
            metadata: productData.metadata
          });
        }

        const existingPrices = await stripe.prices.list({
          product: product.id,
          active: true
        });

        let price;
        const matchingPrice = existingPrices.data.find(
          p => p.unit_amount === productData.priceAmount &&
            p.recurring?.interval === productData.interval
        );

        if (matchingPrice) {
          price = matchingPrice;
        } else {
          price = await stripe.prices.create({
            product: product.id,
            unit_amount: productData.priceAmount,
            currency: "usd",
            recurring: { interval: productData.interval }
          });
        }

        createdProducts.push({
          productId: product.id,
          productName: product.name,
          priceId: price.id,
          amount: price.unit_amount,
          interval: price.recurring?.interval
        });
      }

      res.json({
        success: true,
        message: "Productos creados exitosamente",
        products: createdProducts
      });
    } catch (error: any) {
      console.error("Error creating products:", error);
      res.status(500).json({ error: error.message || "Failed to create products" });
    }
  });

  router.post("/webhook", async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!sig || !webhookSecret) {
      return res.status(400).send("Webhook Error: Missing signature or secret");
    }

    let event;

    try {
      const stripe = await getUncachableStripeClient();
      // Use rawBody from server/index.ts middleware
      event = stripe.webhooks.constructEvent((req as any).rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      const { usageQuotaService } = await import("../services/usageQuotaService");
      const subscriptionService = await import("../services/subscriptionService");
      
      // Log webhook event for tracing
      console.log(`[Stripe Webhook] Received event: ${event.type} | ID: ${event.id}`);

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as any;
          const userId = session.metadata?.userId;

          if (userId) {
            console.log(`[Stripe] Checkout completed for user ${userId}`);

            if (session.subscription) {
              const stripe = await getUncachableStripeClient();
              const subscription = await stripe.subscriptions.retrieve(session.subscription);
              
              // Handle subscription created with notifications (pass event.id for idempotency)
              await subscriptionService.handleSubscriptionCreated(subscription, event.id);
              
              const priceId = subscription.items.data[0].price.id;
              const amount = subscription.items.data[0].price.unit_amount || 0;
              
              // Determine plan from amount
              let plan = "go";
              if (amount === 500) plan = "go";
              else if (amount === 1000) plan = "plus";
              else if (amount === 20000) plan = "pro";
              else if (amount === 2500) plan = "business";

              await usageQuotaService.updateUserPlan(userId, plan);
            }
          }
          break;
        }

        case 'customer.subscription.created': {
          const subscription = event.data.object as any;
          await subscriptionService.handleSubscriptionCreated(subscription, event.id);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as any;
          await subscriptionService.handleSubscriptionUpdated(subscription, event.id);
          
          // Also update via legacy service
          const [dbUser] = await db.select().from(users).where(eq(users.stripeCustomerId, subscription.customer));

          if (dbUser) {
            const status = subscription.status;
            const amount = subscription.items?.data?.[0]?.price?.unit_amount || 0;
            
            let plan = "free";
            if (status === 'active') {
              if (amount === 500) plan = "go";
              else if (amount === 1000) plan = "plus";
              else if (amount === 20000) plan = "pro";
              else if (amount === 2500) plan = "business";
              else plan = "pro"; // Default to pro if unknown
            }
            
            await usageQuotaService.updateUserPlan(dbUser.id, plan);
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as any;
          await subscriptionService.handleSubscriptionDeleted(subscription, event.id);
          
          const [dbUser] = await db.select().from(users).where(eq(users.stripeCustomerId, subscription.customer));

          if (dbUser) {
            console.log(`[Stripe] Subscription deleted for user ${dbUser.id}`);
            await usageQuotaService.updateUserPlan(dbUser.id, "free");
          }
          break;
        }
        
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          await subscriptionService.handlePaymentSucceeded(invoice, event.id);
          break;
        }
        
        case 'invoice.payment_failed': {
          const invoice = event.data.object as any;
          await subscriptionService.handlePaymentFailed(invoice, event.id);
          break;
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error(`[Stripe Webhook] Handler error for ${event.type}: ${err.message}`);
      res.status(500).send(`Webhook Handler Error: ${err.message}`);
    }
  });

  router.get("/api/billing/status", async (req, res) => {
    try {
      const userId = getEffectiveUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      const subscriptionStatus = dbUser?.subscriptionStatus || null;
      const subscriptionPeriodEnd = dbUser?.subscriptionPeriodEnd || null;

      const now = Date.now();
      const periodEndMs = subscriptionPeriodEnd ? new Date(subscriptionPeriodEnd).getTime() : null;

      const willDeactivate =
        !!subscriptionStatus &&
        subscriptionStatus !== "active" &&
        !!periodEndMs &&
        periodEndMs > now;

      res.json({
        subscriptionStatus,
        subscriptionPeriodEnd,
        willDeactivate,
      });
    } catch (error: any) {
      console.error("Billing status error:", error);
      res.status(500).json({ error: "Failed to get billing status" });
    }
  });

  router.get("/api/billing/credits/usage", async (req, res) => {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

      const offsetMonths = z
        .preprocess((v) => (v === undefined ? 0 : Number(v)), z.number().int().min(-24).max(24))
        .parse((req.query as any)?.offset);

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!dbUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const now = new Date();
      const anchorEnd = dbUser.subscriptionPeriodEnd ? new Date(dbUser.subscriptionPeriodEnd) : new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const cycleEnd = addMonths(anchorEnd, offsetMonths);
      const cycleStart = addMonths(cycleEnd, -1);

      const [usageRow] = await db
        .select({
          tokensIn: sql<number>`COALESCE(SUM(${apiLogs.tokensIn}), 0)`,
          tokensOut: sql<number>`COALESCE(SUM(${apiLogs.tokensOut}), 0)`,
          totalRequests: sql<number>`COUNT(*)`,
        })
        .from(apiLogs)
        .where(and(eq(apiLogs.userId, userId), gte(apiLogs.createdAt, cycleStart), lt(apiLogs.createdAt, cycleEnd)));

      const tokensIn = usageRow?.tokensIn ?? 0;
      const tokensOut = usageRow?.tokensOut ?? 0;
      const totalTokens = tokensIn + tokensOut;
      const totalRequests = usageRow?.totalRequests ?? 0;

      const effectivePlanRaw =
        (dbUser.subscriptionStatus === "active" && dbUser.subscriptionPlan ? dbUser.subscriptionPlan : dbUser.plan) || "free";
      const effectivePlan = String(effectivePlanRaw || "free").toLowerCase().trim();

      const DEFAULT_MONTHLY_LIMITS: Record<string, number | null> = {
        free: 100_000,
        go: 1_000_000,
        plus: 5_000_000,
        pro: null,
        business: null,
        enterprise: null,
        admin: null,
      };

      const configuredLimit = typeof dbUser.monthlyTokenLimit === "number" ? dbUser.monthlyTokenLimit : null;
      const limitTokens = configuredLimit && configuredLimit > 0 ? configuredLimit : (DEFAULT_MONTHLY_LIMITS[effectivePlan] ?? null);

      const percentUsed = limitTokens ? Math.min(100, (totalTokens / limitTokens) * 100) : null;

      res.json({
        cycleStart: cycleStart.toISOString(),
        cycleEnd: cycleEnd.toISOString(),
        plan: effectivePlan,
        totalTokens,
        totalRequests,
        limitTokens,
        percentUsed,
      });
    } catch (error: any) {
      console.error("Billing credit usage error:", error);
      res.status(500).json({ error: "Failed to get credit usage" });
    }
  });

  router.get("/api/billing/credits/alerts", async (req, res) => {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!dbUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const prefs = (dbUser as any).preferences || {};
      const saved = prefs?.billing?.creditAlerts || {};

      const canManage = canManageBillingForDbUser(dbUser);
      const adminEmail = canManage ? String(process.env.ADMIN_EMAIL || "").trim() : "";

      res.json({
        enabled: saved.enabled === true,
        thresholdPercent: typeof saved.thresholdPercent === "number" ? saved.thresholdPercent : 80,
        recipientEmail: adminEmail,
        canManage,
      });
    } catch (error: any) {
      console.error("Billing credit alerts get error:", error);
      res.status(500).json({ error: "Failed to get credit alerts" });
    }
  });

  router.put("/api/billing/credits/alerts", async (req, res) => {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

      const parsedBody = z
        .object({
          enabled: z.boolean(),
          thresholdPercent: z.number().int().min(1).max(100).default(80),
        })
        .safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({ error: "Invalid request body", code: "INVALID_BODY" });
      }
      const body = parsedBody.data;

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!dbUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const role = normalizeRole((dbUser as any).role);
      const canManage = canManageBillingForDbUser(dbUser);
      if (!canManage) {
        await auditLog(req, {
          action: AuditActions.SECURITY_ALERT,
          resource: "billing.credit_alerts",
          resourceId: userId,
          details: { reason: "permission_denied", role, actorEmail: getActorEmail(req) || null },
          category: "security",
          severity: "warning",
        });
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const prefs = ((dbUser as any).preferences || {}) as any;
      const nextPrefs = {
        ...prefs,
        billing: {
          ...(prefs.billing || {}),
          creditAlerts: {
            enabled: body.enabled,
            thresholdPercent: body.thresholdPercent,
            updatedAt: new Date().toISOString(),
          },
        },
      };

      await db.update(users).set({ preferences: nextPrefs, updatedAt: new Date() }).where(eq(users.id, userId));

      const recipientEmail = String(process.env.ADMIN_EMAIL || "").trim();

      await auditLog(req, {
        action: "billing.credit_alerts_updated",
        resource: "billing.credit_alerts",
        resourceId: userId,
        details: { enabled: body.enabled, thresholdPercent: body.thresholdPercent, recipientEmail },
        category: "config",
        severity: "info",
      });

      res.json({
        enabled: body.enabled,
        thresholdPercent: body.thresholdPercent,
        recipientEmail,
      });
    } catch (error: any) {
      console.error("Billing credit alerts update error:", error);
      res.status(500).json({ error: "Failed to update credit alerts" });
    }
  });

  router.post("/api/billing/credits/alerts/test", async (req, res) => {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!dbUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const role = normalizeRole((dbUser as any).role);
      const canManage = canManageBillingForDbUser(dbUser);
      if (!canManage) {
        await auditLog(req, {
          action: AuditActions.SECURITY_ALERT,
          resource: "billing.credit_alerts_test",
          resourceId: userId,
          details: { reason: "permission_denied", role, actorEmail: getActorEmail(req) || null },
          category: "security",
          severity: "warning",
        });
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const prefs = (dbUser as any).preferences || {};
      const saved = prefs?.billing?.creditAlerts || {};

      const recipientEmail = String(process.env.ADMIN_EMAIL || "").trim();
      const recipientEmailParsed = z.string().email().safeParse(recipientEmail);
      if (!recipientEmailParsed.success) {
        return res.status(500).json({ error: "ADMIN_EMAIL is invalid" });
      }
      const thresholdPercent = typeof saved.thresholdPercent === "number" ? saved.thresholdPercent : 80;

      const now = new Date();
      const result = await sendEmail({
        to: recipientEmail,
        subject: "Prueba: Alertas de uso de creditos (IliaGPT)",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
            <h2>Prueba de alerta de uso de creditos</h2>
            <p>Este es un correo de prueba para verificar que el panel de facturacion puede notificar al administrador.</p>
            <ul>
              <li><strong>Usuario:</strong> ${dbUser.email || dbUser.id}</li>
              <li><strong>Umbral:</strong> ${thresholdPercent}%</li>
              <li><strong>Fecha:</strong> ${now.toISOString()}</li>
            </ul>
            <p>Si recibiste este correo, la configuracion esta lista.</p>
          </div>
        `,
        text: `Prueba de alerta de uso de creditos\nUsuario: ${dbUser.email || dbUser.id}\nUmbral: ${thresholdPercent}%\nFecha: ${now.toISOString()}`,
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error || "Failed to send test email" });
      }

      await auditLog(req, {
        action: "billing.credit_alerts_test_sent",
        resource: "billing.credit_alerts",
        resourceId: userId,
        details: { recipientEmail, thresholdPercent, messageId: result.messageId || null },
        category: "config",
        severity: "info",
      });

      res.json({ success: true, recipientEmail, messageId: result.messageId });
    } catch (error: any) {
      console.error("Billing credit alerts test error:", error);
      res.status(500).json({ error: "Failed to send test email" });
    }
  });

  router.post("/api/billing/contact-admin", async (req, res) => {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

      const parsedBody = z
        .object({
          message: z.string().trim().min(5).max(2000),
          action: z.string().trim().max(100).optional(),
          source: z.string().trim().max(100).optional(),
        })
        .safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({ error: "Invalid request body", code: "INVALID_BODY" });
      }
      const body = parsedBody.data;

      const adminEmail = String(process.env.ADMIN_EMAIL || "").trim();
      const recipientEmailParsed = z.string().email().safeParse(adminEmail);
      if (!recipientEmailParsed.success) {
        return res.status(500).json({ error: "ADMIN_EMAIL is invalid" });
      }

      const nowMs = Date.now();
      const ip =
        ((req.headers["x-forwarded-for"] as string) || "").split(",")[0]?.trim() ||
        (req.headers["x-real-ip"] as string) ||
        req.ip ||
        "";

      const lastUserMs = billingContactCooldown.get(userId) || 0;
      const remainingUserMs = BILLING_CONTACT_COOLDOWN_MS - (nowMs - lastUserMs);

      const lastIpMs = ip ? (billingContactIpCooldown.get(ip) || 0) : 0;
      const remainingIpMs = ip ? BILLING_CONTACT_COOLDOWN_MS - (nowMs - lastIpMs) : 0;

      const remainingMs = Math.max(remainingUserMs, remainingIpMs);
      if (remainingMs > 0) {
        const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
        return res.status(429).json({
          error: "Too Many Requests",
          message: "Espera un poco antes de enviar otra solicitud al administrador.",
          retryAfterSeconds,
        });
      }
      billingContactCooldown.set(userId, nowMs);
      if (ip) billingContactIpCooldown.set(ip, nowMs);

      // Best-effort cleanup so these Maps don't grow unbounded in long-lived processes.
      if (billingContactCooldown.size > 5000) {
        for (const [k, v] of billingContactCooldown.entries()) {
          if (nowMs - v > BILLING_CONTACT_COOLDOWN_MS) billingContactCooldown.delete(k);
        }
        if (billingContactCooldown.size > 5000) billingContactCooldown.clear();
      }
      if (billingContactIpCooldown.size > 5000) {
        for (const [k, v] of billingContactIpCooldown.entries()) {
          if (nowMs - v > BILLING_CONTACT_COOLDOWN_MS) billingContactIpCooldown.delete(k);
        }
        if (billingContactIpCooldown.size > 5000) billingContactIpCooldown.clear();
      }

      const actorEmail = getActorEmail(req) || null;
      const actorRole = getActorRole(req) || null;
      const action = body.action ? String(body.action) : "support_request";
      const actionLabelMap: Record<string, string> = {
        workspace_settings: "Workspace: ajustes",
        workspace_name: "Workspace: nombre",
        workspace_logo: "Workspace: logotipo",
        workspace_billing: "Facturacion: general",
        manage_plan: "Facturacion: administrar plan",
        billing_portal: "Facturacion: portal",
        add_credits: "Facturacion: agregar creditos",
        credit_alerts: "Facturacion: alertas",
        billing_menu: "Facturacion: menu",
      };
      const actionLabel = actionLabelMap[action] || action;

      const safeMessage = body.message;
      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <h2>Solicitud al administrador</h2>
          <p><strong>Usuario:</strong> ${escapeHtml(String(actorEmail || userId))}</p>
          <p><strong>Rol:</strong> ${escapeHtml(String(actorRole || "unknown"))}</p>
          <p><strong>Accion:</strong> ${escapeHtml(String(actionLabel))}</p>
          <p><strong>Fecha:</strong> ${escapeHtml(new Date().toISOString())}</p>
          <hr />
          <pre style="white-space: pre-wrap; background: #f6f8fa; padding: 12px; border-radius: 6px;">${escapeHtml(safeMessage)}</pre>
        </div>
      `;
      const text = `Solicitud al administrador\nUsuario: ${actorEmail || userId}\nRol: ${actorRole || "unknown"}\nAccion: ${actionLabel}\nFecha: ${new Date().toISOString()}\n\n${safeMessage}`;

      const result = await sendEmail({
        to: adminEmail,
        subject: `Solicitud: ${actionLabel} (IliaGPT)`,
        html,
        text,
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error || "Failed to send request email" });
      }

      await auditLog(req, {
        action: "billing.admin_contact_requested",
        resource: "billing.support",
        resourceId: userId,
        details: {
          action,
          source: body.source || null,
          recipientEmail: adminEmail,
          messageId: result.messageId || null,
        },
        category: "user",
        severity: "info",
      });

      res.json({ success: true, messageId: result.messageId || null });
    } catch (error: any) {
      console.error("Billing contact admin error:", error);
      res.status(500).json({ error: "Failed to contact admin" });
    }
  });

  router.get("/api/billing/invoices", async (req, res) => {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

      const actorRole = getActorRole(req);
      if (actorRole && !isBillingManagerRole(actorRole) && !isAdminEmail(getActorEmail(req))) {
        await auditLog(req, {
          action: AuditActions.SECURITY_ALERT,
          resource: "billing.invoices",
          resourceId: userId,
          details: { reason: "permission_denied", role: actorRole, actorEmail: getActorEmail(req) || null },
          category: "security",
          severity: "warning",
        });
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const parsedQuery = z
        .object({
          limit: z
            .preprocess((v) => (v === undefined ? 10 : Number(v)), z.number().int().min(1).max(25))
            .default(10),
          startingAfter: z
            .preprocess((v) => (Array.isArray(v) ? v[0] : v), z.string().trim().min(1).optional()),
        })
        .parse(req.query);

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!dbUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const canManageBilling = canManageBillingForDbUser(dbUser);
      if (!canManageBilling) {
        await auditLog(req, {
          action: AuditActions.SECURITY_ALERT,
          resource: "billing.invoices",
          resourceId: userId,
          details: { reason: "permission_denied", role: normalizeRole((dbUser as any).role), actorEmail: getActorEmail(req) || null },
          category: "security",
          severity: "warning",
        });
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      if (!dbUser.stripeCustomerId) {
        return res.json({ invoices: [], hasMore: false, nextCursor: null });
      }

      const stripe = await getUncachableStripeClient();
      const result = await stripe.invoices.list({
        customer: dbUser.stripeCustomerId,
        limit: parsedQuery.limit,
        starting_after: parsedQuery.startingAfter,
      });

      const invoices = result.data.map((inv) => ({
        id: inv.id,
        number: inv.number || null,
        status: inv.status || null,
        currency: inv.currency || null,
        amountDue: typeof inv.amount_due === "number" ? inv.amount_due : 0,
        amountPaid: typeof inv.amount_paid === "number" ? inv.amount_paid : 0,
        amountRemaining: typeof inv.amount_remaining === "number" ? inv.amount_remaining : 0,
        subtotal: typeof inv.subtotal === "number" ? inv.subtotal : null,
        total: typeof inv.total === "number" ? inv.total : null,
        createdAt: inv.created ? new Date(inv.created * 1000).toISOString() : null,
        periodStart: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
        periodEnd: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
        hostedInvoiceUrl: inv.hosted_invoice_url || null,
        invoicePdf: inv.invoice_pdf || null,
      }));

      const nextCursor = result.has_more && result.data.length > 0 ? result.data[result.data.length - 1]!.id : null;

      await auditLog(req, {
        action: "billing.invoices_listed",
        resource: "billing.invoices",
        resourceId: userId,
        details: {
          customerId: dbUser.stripeCustomerId,
          limit: parsedQuery.limit,
          startingAfter: parsedQuery.startingAfter || null,
          returned: invoices.length,
          hasMore: result.has_more,
        },
        category: "user",
        severity: "info",
      });

      res.json({
        invoices,
        hasMore: result.has_more,
        nextCursor,
      });
    } catch (error: any) {
      console.error("Billing invoices error:", error);
      res.status(500).json({ error: "Failed to list invoices" });
    }
  });

  router.post("/api/stripe/portal", async (req, res) => {
    try {
      const userId = getEffectiveUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

      const actorRole = getActorRole(req);
      if (actorRole && !isBillingManagerRole(actorRole) && !isAdminEmail(getActorEmail(req))) {
        await auditLog(req, {
          action: AuditActions.SECURITY_ALERT,
          resource: "stripe.billing_portal",
          resourceId: userId,
          details: { reason: "permission_denied", role: actorRole, actorEmail: getActorEmail(req) || null },
          category: "security",
          severity: "warning",
        });
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!dbUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const canManageBilling = canManageBillingForDbUser(dbUser);
      if (!canManageBilling) {
        await auditLog(req, {
          action: AuditActions.SECURITY_ALERT,
          resource: "stripe.billing_portal",
          resourceId: userId,
          details: { reason: "permission_denied", role: normalizeRole((dbUser as any).role), actorEmail: getActorEmail(req) || null },
          category: "security",
          severity: "warning",
        });
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      if (!dbUser?.stripeCustomerId) {
        return res.status(400).json({ error: "No subscription found" });
      }

      const stripe = await getUncachableStripeClient();
      const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost:5000';
      const protocol = domain.includes('localhost') ? 'http' : 'https';

      const session = await stripe.billingPortal.sessions.create({
        customer: dbUser.stripeCustomerId,
        return_url: `${protocol}://${domain}/`
      });

      await auditLog(req, {
        action: "billing.portal_opened",
        resource: "stripe.billing_portal",
        resourceId: dbUser.stripeCustomerId,
        details: { userId },
        category: "user",
        severity: "info",
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Portal error:", error);
      res.status(500).json({ error: "Failed to create portal session" });
    }
  });

  return router;
}
