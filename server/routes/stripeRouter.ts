import { Router } from "express";
import type Stripe from "stripe";
import { getUncachableStripeClient, getStripePublishableKey } from "../stripeClient";
import { db } from "../db";
import { apiLogs, billingCreditGrants, invoices, payments, users } from "@shared/schema";
import { and, eq, gte, gt, lt, or, sql } from "drizzle-orm";
import { withRetry } from "../lib/retryUtility";
import { z } from "zod";
import { sendEmail } from "../services/genericEmailService";
import { requireAdmin } from "./admin/utils";
import { auditLog, AuditActions } from "../services/auditLogger";
import { isSystemAdminRole, isWorkspaceAdminRole, normalizeRoleKey, resolveRolePermissionsForOrg } from "../services/workspaceRoleService";
import {
  ACTIVE_SUBSCRIPTION_PLANS,
  ACTIVE_SUBSCRIPTION_PLAN_KEYS,
  getConfiguredProductId,
  getPlanKeyFromAlias,
  getPlanKeyFromAmount,
  getPlanKeyFromProductId,
} from "../lib/stripeActivePlans";

/** Valid subscription amounts (cents) — reject anything not on this list */
const VALID_PLAN_AMOUNTS = new Set(
  ACTIVE_SUBSCRIPTION_PLAN_KEYS.map((planKey) => ACTIVE_SUBSCRIPTION_PLANS[planKey].amount),
);

/** Webhook event idempotency cache — prevents replayed events (TTL: 24h) */
const processedWebhookEvents = new Map<string, number>();
const WEBHOOK_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function cleanupWebhookCache() {
  const now = Date.now();
  for (const [id, ts] of processedWebhookEvents.entries()) {
    if (now - ts > WEBHOOK_IDEMPOTENCY_TTL_MS) processedWebhookEvents.delete(id);
  }
  if (processedWebhookEvents.size > 10_000) processedWebhookEvents.clear();
}

const BILLING_CONTACT_COOLDOWN_MS = 10 * 60 * 1000;
const billingContactCooldown = new Map<string, number>();
const billingContactIpCooldown = new Map<string, number>();

// Credits: 1 USD => 100,000 credits (tokens). $5 minimum top-up.
const CREDITS_PER_USD = 100_000;

type ResolvedCheckoutPrice = {
  amount: number;
  planKey: keyof typeof ACTIVE_SUBSCRIPTION_PLANS;
  priceId: string;
  productId: string;
};

type DbStripePriceRow = {
  price_id: string | null;
  product_id: string | null;
  unit_amount: number | null;
};

function extractStripeProductId(product: Stripe.Price["product"]): string | null {
  if (typeof product === "string") return product;
  if (product && typeof product === "object" && "id" in product && typeof product.id === "string") {
    return product.id;
  }
  return null;
}

function extractStripeProductName(product: Stripe.Price["product"]): string {
  if (product && typeof product === "object" && "name" in product && typeof product.name === "string") {
    return product.name;
  }
  return "";
}

function extractStripeProductMetadata(product: Stripe.Price["product"]): Record<string, string> {
  if (product && typeof product === "object" && "metadata" in product && product.metadata) {
    return product.metadata as Record<string, string>;
  }
  return {};
}

function normalizeStripePlanText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferPlanKeyFromSignals(input: {
  amount?: number | null;
  metadataPlan?: string | null;
  planName?: string | null;
  priceLookupKey?: string | null;
  productId?: string | null;
}): keyof typeof ACTIVE_SUBSCRIPTION_PLANS | null {
  const byAmount = getPlanKeyFromAmount(input.amount);
  if (!byAmount) return null;

  const byProductId = getPlanKeyFromProductId(input.productId);
  if (byProductId && byProductId === byAmount) {
    return byProductId;
  }

  const candidates = [
    normalizeStripePlanText(input.metadataPlan),
    normalizeStripePlanText(input.planName),
    normalizeStripePlanText(input.priceLookupKey),
  ].filter(Boolean);

  for (const candidate of candidates) {
    for (const planKey of ACTIVE_SUBSCRIPTION_PLAN_KEYS) {
      const normalizedKey = normalizeStripePlanText(planKey);
      const normalizedName = normalizeStripePlanText(ACTIVE_SUBSCRIPTION_PLANS[planKey].name);
      if ((candidate === normalizedKey || candidate.includes(normalizedKey) || candidate.includes(normalizedName)) && planKey === byAmount) {
        return planKey;
      }
    }
  }

  return null;
}

function toResolvedCheckoutPrice(price: Stripe.Price): ResolvedCheckoutPrice | null {
  if (!price.active) return null;
  if (price.recurring?.interval !== "month") return null;

  const amount = typeof price.unit_amount === "number" ? price.unit_amount : null;
  if (amount === null || !VALID_PLAN_AMOUNTS.has(amount)) return null;

  const productId = extractStripeProductId(price.product);
  const productMetadata = extractStripeProductMetadata(price.product);
  const inferredPlanKey = inferPlanKeyFromSignals({
    amount,
    metadataPlan: productMetadata.plan || price.metadata?.plan || null,
    planName: extractStripeProductName(price.product),
    priceLookupKey: price.lookup_key || null,
    productId,
  });

  if (!productId || !inferredPlanKey) {
    return null;
  }

  return {
    amount,
    planKey: inferredPlanKey,
    priceId: price.id,
    productId,
  };
}

function toResolvedCheckoutPriceFromDbRow(row?: DbStripePriceRow | null): ResolvedCheckoutPrice | null {
  if (!row?.price_id || !row.product_id || typeof row.unit_amount !== "number") {
    return null;
  }

  if (!VALID_PLAN_AMOUNTS.has(row.unit_amount)) {
    return null;
  }

  const inferredPlanKey = inferPlanKeyFromSignals({
    amount: row.unit_amount,
    productId: row.product_id,
  });

  if (!inferredPlanKey) {
    return null;
  }

  return {
    amount: row.unit_amount,
    planKey: inferredPlanKey,
    priceId: row.price_id,
    productId: row.product_id,
  };
}

async function listActiveStripePrices(
  stripe: Stripe,
  productId?: string,
): Promise<Stripe.Price[]> {
  const collected: Stripe.Price[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < 5; page += 1) {
    const response = await withRetry(
      () =>
        stripe.prices.list({
          active: true,
          limit: 100,
          ...(productId ? { product: productId } : {}),
          ...(startingAfter ? { starting_after: startingAfter } : {}),
          expand: ["data.product"],
        }),
      { maxAttempts: 3, initialDelayMs: 1000 },
    );

    collected.push(...response.data);
    if (!response.has_more || response.data.length === 0) break;
    startingAfter = response.data[response.data.length - 1]?.id;
  }

  return collected;
}

async function findDbCheckoutPrice(rawIdentifier: string): Promise<ResolvedCheckoutPrice | null> {
  if (rawIdentifier.startsWith("price_")) {
    const result = await db.execute(sql`
      SELECT pr.id as price_id, p.id as product_id, pr.unit_amount
      FROM stripe.prices pr
      INNER JOIN stripe.products p ON p.id = pr.product
      WHERE pr.id = ${rawIdentifier}
        AND pr.active = true
        AND p.active = true
      LIMIT 1
    `);

    return toResolvedCheckoutPriceFromDbRow((result.rows as DbStripePriceRow[])[0]);
  }

  const aliasPlanKey = getPlanKeyFromAlias(rawIdentifier);
  const productId = aliasPlanKey ? getConfiguredProductId(aliasPlanKey) : rawIdentifier.startsWith("prod_") ? rawIdentifier : null;
  if (!productId) return null;

  const productPlanKey = getPlanKeyFromProductId(productId);
  const expectedAmount = aliasPlanKey
    ? ACTIVE_SUBSCRIPTION_PLANS[aliasPlanKey].amount
    : productPlanKey
      ? ACTIVE_SUBSCRIPTION_PLANS[productPlanKey].amount
      : null;

  if (expectedAmount === null) return null;

  const result = await db.execute(sql`
    SELECT pr.id as price_id, p.id as product_id, pr.unit_amount
    FROM stripe.prices pr
    INNER JOIN stripe.products p ON p.id = pr.product
    WHERE p.id = ${productId}
      AND p.active = true
      AND pr.active = true
      AND pr.unit_amount = ${expectedAmount}
    LIMIT 1
  `);

  return toResolvedCheckoutPriceFromDbRow((result.rows as DbStripePriceRow[])[0]);
}

async function findActiveMonthlyPriceForPlan(
  stripe: Stripe,
  planKey: keyof typeof ACTIVE_SUBSCRIPTION_PLANS,
): Promise<Stripe.Price | null> {
  const productId = getConfiguredProductId(planKey);
  const expectedAmount = ACTIVE_SUBSCRIPTION_PLANS[planKey].amount;
  const matchesPlan = (price: Stripe.Price) => {
    const resolved = toResolvedCheckoutPrice(price);
    return resolved?.planKey === planKey && resolved.amount === expectedAmount;
  };

  try {
    const productScopedPrices = await listActiveStripePrices(stripe, productId);
    const scopedMatch = productScopedPrices.find(matchesPlan);
    if (scopedMatch) {
      return scopedMatch;
    }
  } catch (error: any) {
    console.warn(`[Stripe] Product-scoped lookup failed for ${planKey}: ${error?.message || error}`);
  }

  return (
    (await listActiveStripePrices(stripe)).find((price) => {
      const resolved = toResolvedCheckoutPrice(price);
      return resolved?.planKey === planKey && resolved.amount === expectedAmount;
    }) || null
  );
}

async function resolveAllowedCheckoutPrice(
  stripe: Stripe,
  rawIdentifier: string,
): Promise<ResolvedCheckoutPrice | null> {
  const normalized = rawIdentifier.trim();
  if (!normalized) return null;

  try {
    const dbResolved = await findDbCheckoutPrice(normalized);
    if (dbResolved) return dbResolved;
  } catch {
    // Fall through to direct Stripe API lookup if the billing mirror is unavailable.
  }

  if (normalized.startsWith("price_")) {
    const price = await withRetry(
      () => stripe.prices.retrieve(normalized, { expand: ["product"] }),
      { maxAttempts: 3, initialDelayMs: 1000 },
    );
    return toResolvedCheckoutPrice(price);
  }

  const aliasPlanKey = getPlanKeyFromAlias(normalized);
  if (aliasPlanKey) {
    const price = await findActiveMonthlyPriceForPlan(stripe, aliasPlanKey);
    return price ? toResolvedCheckoutPrice(price) : null;
  }

  if (normalized.startsWith("prod_")) {
    const planKey = getPlanKeyFromProductId(normalized);
    if (!planKey) return null;

    const price = await findActiveMonthlyPriceForPlan(stripe, planKey);
    return price ? toResolvedCheckoutPrice(price) : null;
  }

  return null;
}

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

async function canManageBillingForDbUser(dbUser: any): Promise<boolean> {
  const roleKey = normalizeRoleKey(dbUser?.role);
  const email = normalizeEmail(dbUser?.email);
  if (isAdminEmail(email)) return true;
  if (isSystemAdminRole(roleKey) || isWorkspaceAdminRole(roleKey)) return true;

  const orgId = String(dbUser?.orgId || "").trim() || "default";
  const perms = await resolveRolePermissionsForOrg(orgId, roleKey);
  return perms.includes("admin:billing" as any) || perms.includes("*" as any);
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
      const productMapping: Record<string, string> = {};
      let stripe: Stripe | null = null;

      for (const planKey of ACTIVE_SUBSCRIPTION_PLAN_KEYS) {
        const plan = ACTIVE_SUBSCRIPTION_PLANS[planKey];
        const productId = getConfiguredProductId(planKey);
        productMapping[plan.alias] = productId;

        try {
          const result = await db.execute(
            sql`
              SELECT pr.id as price_id
              FROM stripe.products p
              INNER JOIN stripe.prices pr ON pr.product = p.id
              WHERE p.id = ${productId}
                AND p.active = true
                AND pr.active = true
                AND pr.unit_amount = ${plan.amount}
              LIMIT 1
            `,
          );

          const priceId = typeof result.rows[0]?.price_id === "string" ? result.rows[0].price_id : null;
          if (priceId) {
            priceMapping[plan.alias] = priceId;
            continue;
          }
        } catch {
          console.log(`[Stripe] DB lookup failed for ${planKey}, trying Stripe API directly`);
        }

        try {
          stripe ??= await getUncachableStripeClient();
          const price = await findActiveMonthlyPriceForPlan(stripe, planKey);
          if (price?.id) {
            priceMapping[plan.alias] = price.id;
          }
        } catch (stripeError: any) {
          console.error(`[Stripe] Price lookup failed for ${planKey}:`, stripeError.message);
        }
      }

      res.json({ priceMapping, productMapping });
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

      const parsedCheckout = z.object({
        priceId: z.string().trim().min(1).max(200),
        utmSource: z.string().trim().max(100).optional(),
        utmMedium: z.string().trim().max(100).optional(),
        utmCampaign: z.string().trim().max(100).optional(),
        referrer: z.string().trim().max(200).optional(),
      }).safeParse(req.body);
      if (!parsedCheckout.success) {
        return res.status(400).json({ error: "Invalid request body" });
      }
      const { priceId: requestedPriceId, utmSource, utmMedium, utmCampaign, referrer } = parsedCheckout.data;

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!dbUser) {
        // Avoid leaking user existence details and keep behavior consistent in environments
        // where user provisioning is async.
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const stripe = await getUncachableStripeClient();
      const resolvedCheckoutPrice = await resolveAllowedCheckoutPrice(stripe, requestedPriceId);

      if (!resolvedCheckoutPrice) {
        return res.status(400).json({
          error: "Solo están habilitados los planes Go ($5) y Plus ($10).",
        });
      }

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

      // Prefer configured public base URL for Stripe redirects (avoids wrong host like michat.iliagpt.com)
      const configuredBaseUrl = (process.env.BASE_URL || process.env.APP_URL || '').trim();
      const baseUrl = (configuredBaseUrl || `${protocol}://${domain}`).replace(/\/$/, '');

      const withQueryParam = (inputUrl: string, key: string, value: string) => {
        const u = new URL(inputUrl);
        u.searchParams.set(key, value);
        return u.toString();
      };

      // If the request has a same-origin referer, use it as the return target.
      // This improves UX when the user hits back/cancel in Stripe.
      const refererHeader = req.headers.referer;
      let successUrl = withQueryParam(`${baseUrl}/`, 'subscription', 'success');
      let cancelUrl = withQueryParam(`${baseUrl}/`, 'subscription', 'cancelled');

      if (typeof refererHeader === 'string' && refererHeader.length > 0) {
        try {
          const refUrl = new URL(refererHeader);
          const baseHost = new URL(baseUrl).host;
          if (refUrl.host === baseHost) {
            successUrl = withQueryParam(refUrl.toString(), 'subscription', 'success');
            cancelUrl = withQueryParam(refUrl.toString(), 'subscription', 'cancelled');
          }
        } catch {
          // ignore invalid referer
        }
      }
      
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
          line_items: [{ price: resolvedCheckoutPrice.priceId, quantity: 1 }],
          mode: 'subscription',
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: { 
            userId,
            plan: resolvedCheckoutPrice.planKey,
            stripeProductId: resolvedCheckoutPrice.productId,
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
              plan: resolvedCheckoutPrice.planKey,
              stripeProductId: resolvedCheckoutPrice.productId,
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
      return res.status(400).json({ error: "Bad request" });
    }

    let event;

    try {
      const stripe = await getUncachableStripeClient();
      event = stripe.webhooks.constructEvent((req as any).rawBody, sig, webhookSecret);
    } catch (err: any) {
      console.error(`[Stripe Webhook] Signature verification failed: ${err.message}`);
      // Never leak error details to the caller
      return res.status(400).json({ error: "Webhook signature verification failed" });
    }

    // Idempotency: skip already-processed events
    if (processedWebhookEvents.has(event.id)) {
      return res.json({ received: true, deduplicated: true });
    }
    processedWebhookEvents.set(event.id, Date.now());
    cleanupWebhookCache();

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
              
              const amount = subscription.items.data[0].price.unit_amount || 0;
              
              // Determine plan from amount
              let plan = "go";
              if (amount === 500) plan = "go";
              else if (amount === 1000) plan = "plus";
              else if (amount === 20000) plan = "pro";
              else if (amount === 2500) plan = "business";

              await usageQuotaService.updateUserPlan(userId, plan);
            } else if (String(session?.metadata?.kind || "") === "credits_topup") {
              // Credits top-up (one-time payment)
              const now = new Date();
              const amountMinorRaw = typeof session?.amount_total === "number" ? session.amount_total : 0;
              const currency = typeof session?.currency === "string" ? session.currency : "usd";
              const amountUsd = Math.round(amountMinorRaw / 100);
              const creditsFromAmount = Math.max(0, amountUsd) * CREDITS_PER_USD;
              const creditsRaw = Number(session?.metadata?.creditsGranted || session?.metadata?.credits || 0);
              const creditsGranted = Number.isFinite(creditsRaw) && creditsRaw > 0 ? Math.floor(creditsRaw) : creditsFromAmount;

              if (creditsGranted > 0) {
                const checkoutSessionId = typeof session?.id === "string" ? session.id : null;
                const paymentIntentId =
                  typeof session?.payment_intent === "string"
                    ? session.payment_intent
                    : (typeof session?.payment_intent === "object" && typeof session.payment_intent?.id === "string")
                      ? session.payment_intent.id
                      : null;

                if (checkoutSessionId) {
                  const [existing] = await db
                    .select({ id: billingCreditGrants.id })
                    .from(billingCreditGrants)
                    .where(eq(billingCreditGrants.stripeCheckoutSessionId, checkoutSessionId))
                    .limit(1);

                  if (!existing) {
                    const expiresAt = addMonths(now, 12);
                    await db.insert(billingCreditGrants).values({
                      userId,
                      creditsGranted,
                      creditsRemaining: creditsGranted,
                      currency,
                      amountMinor: amountMinorRaw,
                      stripeCheckoutSessionId: checkoutSessionId,
                      stripePaymentIntentId: paymentIntentId,
                      createdAt: now,
                      expiresAt,
                      metadata: { source: "stripe_checkout", kind: "credits_topup" },
                    });

                    // Maintain legacy aggregate on users for convenience (best-effort).
                    await db
                      .update(users)
                      .set({
                        creditsBalance: sql<number>`COALESCE(${users.creditsBalance}, 0) + ${creditsGranted}`,
                        updatedAt: new Date(),
                      })
                      .where(eq(users.id, userId));

	                    await auditLog(req as any, {
	                      action: "billing.credits_topup_completed",
	                      resource: "billing_credit_grants",
	                      resourceId: checkoutSessionId,
	                      details: { userId, creditsGranted, amountMinor: amountMinorRaw, currency, expiresAt: expiresAt.toISOString() },
	                      category: "system",
	                      severity: "info",
	                    });
                  }
                }
              }
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

        case 'charge.refunded': {
          const charge = event.data.object as any;
          const chargeId = typeof charge?.id === "string" ? charge.id : null;
          const paymentIntentId =
            typeof charge?.payment_intent === "string"
              ? charge.payment_intent
              : (typeof charge?.payment_intent === "object" && typeof charge.payment_intent?.id === "string")
                ? charge.payment_intent.id
                : null;
          const stripeInvoiceId =
            typeof charge?.invoice === "string"
              ? charge.invoice
              : (typeof charge?.invoice === "object" && typeof charge.invoice?.id === "string")
                ? charge.invoice.id
                : null;

          const conditions = [
            chargeId ? eq(payments.stripeChargeId, chargeId) : null,
            paymentIntentId ? eq(payments.stripePaymentIntentId, paymentIntentId) : null,
            stripeInvoiceId ? eq(payments.stripePaymentId, stripeInvoiceId) : null,
          ].filter(Boolean) as any[];

          if (conditions.length > 0) {
            const updateSet: Partial<typeof payments.$inferInsert> = { status: "refunded" };
            if (chargeId) updateSet.stripeChargeId = chargeId;
            if (paymentIntentId) updateSet.stripePaymentIntentId = paymentIntentId;
            if (stripeInvoiceId) updateSet.stripePaymentId = stripeInvoiceId;

            await db.update(payments).set(updateSet).where(or(...conditions));

            if (stripeInvoiceId) {
              await db.update(invoices).set({ status: "refunded" }).where(eq(invoices.stripeInvoiceId, stripeInvoiceId));
            }

	            await auditLog(req as any, {
	              action: AuditActions.PAYMENT_REFUNDED,
	              resource: "payments",
	              resourceId: stripeInvoiceId || chargeId || null,
	              details: {
	                stripeChargeId: chargeId,
	                stripePaymentIntentId: paymentIntentId,
	                stripeInvoiceId,
	                amountRefunded: charge?.amount_refunded ?? null,
	                currency: charge?.currency ?? null,
	              },
	              category: "system",
	              severity: "warning",
	            });
          }
          break;
        }

        case 'charge.dispute.created': {
          const dispute = event.data.object as any;
          const chargeId =
            typeof dispute?.charge === "string"
              ? dispute.charge
              : (typeof dispute?.charge === "object" && typeof dispute.charge?.id === "string")
                ? dispute.charge.id
                : null;

          if (chargeId) {
            let stripeInvoiceId: string | null = null;
            let paymentIntentId: string | null = null;
            try {
              const stripe = await getUncachableStripeClient();
              const charge = await stripe.charges.retrieve(chargeId);
              stripeInvoiceId =
                typeof (charge as any)?.invoice === "string"
                  ? (charge as any).invoice
                  : (typeof (charge as any)?.invoice === "object" && typeof (charge as any).invoice?.id === "string")
                    ? (charge as any).invoice.id
                    : null;
              paymentIntentId =
                typeof (charge as any)?.payment_intent === "string"
                  ? (charge as any).payment_intent
                  : (typeof (charge as any)?.payment_intent === "object" && typeof (charge as any).payment_intent?.id === "string")
                    ? (charge as any).payment_intent.id
                    : null;
            } catch (err) {
              console.error("[Stripe] Failed to retrieve charge for dispute:", err);
            }

            const conditions = [
              eq(payments.stripeChargeId, chargeId),
              paymentIntentId ? eq(payments.stripePaymentIntentId, paymentIntentId) : null,
              stripeInvoiceId ? eq(payments.stripePaymentId, stripeInvoiceId) : null,
            ].filter(Boolean) as any[];

            await db.update(payments).set({ status: "disputed", stripeChargeId: chargeId }).where(or(...conditions));

            if (stripeInvoiceId) {
              await db.update(invoices).set({ status: "disputed" }).where(eq(invoices.stripeInvoiceId, stripeInvoiceId));
            }

	            await auditLog(req as any, {
	              action: AuditActions.PAYMENT_DISPUTED,
	              resource: "payments",
	              resourceId: stripeInvoiceId || chargeId,
	              details: {
	                stripeChargeId: chargeId,
	                stripeInvoiceId,
	                stripePaymentIntentId: paymentIntentId,
	                stripeDisputeId: dispute?.id ?? null,
	                reason: dispute?.reason ?? null,
	                amount: dispute?.amount ?? null,
	                currency: dispute?.currency ?? null,
	                status: dispute?.status ?? null,
	              },
	              category: "system",
	              severity: "critical",
	            });
          }
          break;
        }

        case 'charge.dispute.closed': {
          const dispute = event.data.object as any;
          const chargeId =
            typeof dispute?.charge === "string"
              ? dispute.charge
              : (typeof dispute?.charge === "object" && typeof dispute.charge?.id === "string")
                ? dispute.charge.id
                : null;

          if (chargeId) {
            let stripeInvoiceId: string | null = null;
            let paymentIntentId: string | null = null;
            try {
              const stripe = await getUncachableStripeClient();
              const charge = await stripe.charges.retrieve(chargeId);
              stripeInvoiceId =
                typeof (charge as any)?.invoice === "string"
                  ? (charge as any).invoice
                  : (typeof (charge as any)?.invoice === "object" && typeof (charge as any).invoice?.id === "string")
                    ? (charge as any).invoice.id
                    : null;
              paymentIntentId =
                typeof (charge as any)?.payment_intent === "string"
                  ? (charge as any).payment_intent
                  : (typeof (charge as any)?.payment_intent === "object" && typeof (charge as any).payment_intent?.id === "string")
                    ? (charge as any).payment_intent.id
                    : null;
            } catch (err) {
              console.error("[Stripe] Failed to retrieve charge for dispute:", err);
            }

            const disputeStatus = String(dispute?.status || "").toLowerCase();
            const nextPaymentStatus = disputeStatus === "won" || disputeStatus === "warning_closed" ? "completed" : disputeStatus === "lost" ? "failed" : "disputed";

            const conditions = [
              eq(payments.stripeChargeId, chargeId),
              paymentIntentId ? eq(payments.stripePaymentIntentId, paymentIntentId) : null,
              stripeInvoiceId ? eq(payments.stripePaymentId, stripeInvoiceId) : null,
            ].filter(Boolean) as any[];

            await db.update(payments).set({ status: nextPaymentStatus }).where(or(...conditions));

            if (stripeInvoiceId) {
              const nextInvoiceStatus = nextPaymentStatus === "completed" ? "paid" : nextPaymentStatus;
              await db.update(invoices).set({ status: nextInvoiceStatus }).where(eq(invoices.stripeInvoiceId, stripeInvoiceId));
            }
          }
          break;
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error(`[Stripe Webhook] Handler error for ${event.type}: ${err.message}`);
      // Never expose internal error details to external callers
      res.status(500).json({ error: "Internal webhook error" });
    }
  });

	  router.get("/api/billing/status", async (req, res) => {
	    try {
	      const userId = getEffectiveUserId(req);

      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

	      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      const subscriptionStatusRaw = (dbUser as any)?.subscriptionStatus || null;
      const subscriptionCancelAtPeriodEnd = Boolean(
        (dbUser as any)?.subscriptionCancelAtPeriodEnd,
      );
      const inferredStatus =
        subscriptionStatusRaw ||
        ((dbUser as any)?.stripeSubscriptionId ? "active" : null) ||
        ((dbUser as any)?.plan && (dbUser as any).plan !== "free" ? "active" : null);
      const subscriptionStatus = inferredStatus;
      const subscriptionPeriodEnd =
        dbUser?.subscriptionPeriodEnd || (dbUser as any)?.subscriptionExpiresAt || null;

      const now = Date.now();
      const periodEndMs = subscriptionPeriodEnd ? new Date(subscriptionPeriodEnd).getTime() : null;

      const willDeactivate =
        !!periodEndMs &&
        periodEndMs > now &&
        (
          subscriptionCancelAtPeriodEnd ||
          (!!subscriptionStatus && subscriptionStatus !== "active")
        );

	      const [{ monthsPaid = 0 } = { monthsPaid: 0 }] = await db
	        .select({
	          monthsPaid: sql<number>`COALESCE(COUNT(*), 0)`,
	        })
        .from(payments)
        .where(
          and(
            eq(payments.userId, userId),
            eq(payments.method, "stripe"),
            eq(payments.status, "completed"),
            sql`${payments.description} ILIKE '%subscription%'`
          )
        );

	      const nowDate = new Date();
      const [{ extraCredits = 0 } = { extraCredits: 0 }] = await db
        .select({
          extraCredits: sql<number>`COALESCE(SUM(${billingCreditGrants.creditsRemaining}), 0)`,
        })
        .from(billingCreditGrants)
        .where(
          and(
            eq(billingCreditGrants.userId, userId),
            gt(billingCreditGrants.creditsRemaining, 0),
            gt(billingCreditGrants.expiresAt, nowDate)
          )
        );

	      res.json({
	        subscriptionStatus,
	        subscriptionPeriodEnd,
	        subscriptionCancelAtPeriodEnd,
	        willDeactivate,
	        plan: (dbUser as any)?.plan || "free",
	        monthsPaid,
	        extraCredits,
	        canManageBilling: await canManageBillingForDbUser(dbUser),
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
        // Avoid leaking user existence details and keep behavior consistent in environments
        // where user provisioning is async.
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const now = new Date();
      const anchorEnd = dbUser.subscriptionPeriodEnd
        ? new Date(dbUser.subscriptionPeriodEnd)
        : new Date(now.getFullYear(), now.getMonth() + 1, 1);

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

      const [{ extraCredits = 0 } = { extraCredits: 0 }] = await db
        .select({
          extraCredits: sql<number>`COALESCE(SUM(${billingCreditGrants.creditsRemaining}), 0)`,
        })
        .from(billingCreditGrants)
        .where(
          and(
            eq(billingCreditGrants.userId, userId),
            gt(billingCreditGrants.creditsRemaining, 0),
            gt(billingCreditGrants.expiresAt, now)
          )
        );

      const [{ nextExpiry = null } = { nextExpiry: null }] = await db
        .select({
          nextExpiry: sql<Date | null>`MIN(${billingCreditGrants.expiresAt})`,
        })
        .from(billingCreditGrants)
        .where(
          and(
            eq(billingCreditGrants.userId, userId),
            gt(billingCreditGrants.creditsRemaining, 0),
            gt(billingCreditGrants.expiresAt, now)
          )
        );

      res.json({
        cycleStart: cycleStart.toISOString(),
        cycleEnd: cycleEnd.toISOString(),
        plan: effectivePlan,
        totalTokens,
        totalRequests,
        limitTokens,
        percentUsed,
        extraCredits,
        extraCreditsNextExpiry: nextExpiry ? new Date(nextExpiry).toISOString() : null,
      });
    } catch (error: any) {
      console.error("Billing credit usage error:", error);
      res.status(500).json({ error: "Failed to get credit usage" });
    }
  });

  router.post("/api/billing/credits/checkout", async (req, res) => {
    try {
      const userId = getEffectiveUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

      const parsedBody = z
        .object({
          amountUsd: z.number().int().min(5).max(5000),
        })
        .safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({ error: "Invalid request body", code: "INVALID_BODY" });
      }

      const amountUsd = parsedBody.data.amountUsd;
      if (amountUsd % 5 !== 0) {
        return res.status(400).json({ error: "El mínimo es $5 y debe ser múltiplo de 5", code: "INVALID_AMOUNT" });
      }

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!dbUser) {
        // Avoid leaking user existence details and keep behavior consistent in environments
        // where user provisioning is async.
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const canManageBilling = await canManageBillingForDbUser(dbUser);
      if (!canManageBilling) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const stripe = await getUncachableStripeClient();

      let customerId = dbUser.stripeCustomerId;
      if (!customerId) {
        const customer = await withRetry(
          () =>
            stripe.customers.create({
              email: dbUser.email || undefined,
              metadata: { userId },
            }),
          { maxAttempts: 3, initialDelayMs: 1000 }
        );
        customerId = customer.id;

        await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
      }

      const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000";
      const protocol = domain.includes("localhost") ? "http" : "https";
      const configuredBaseUrl = (process.env.BASE_URL || process.env.APP_URL || "").trim();
	      const baseUrl = (configuredBaseUrl || `${protocol}://${domain}`).replace(/\/$/, "");

      const withQueryParam = (inputUrl: string, key: string, value: string) => {
        const u = new URL(inputUrl);
        u.searchParams.set(key, value);
        return u.toString();
      };

      let successUrl = withQueryParam(`${baseUrl}/workspace-settings?section=billing`, "credits", "success");
      let cancelUrl = withQueryParam(`${baseUrl}/workspace-settings?section=billing`, "credits", "cancelled");

      const refererHeader = req.headers.referer;
      if (typeof refererHeader === "string" && refererHeader.length > 0) {
        try {
          const refUrl = new URL(refererHeader);
          const baseHost = new URL(baseUrl).host;
          if (refUrl.host === baseHost) {
            successUrl = withQueryParam(refUrl.toString(), "credits", "success");
            cancelUrl = withQueryParam(refUrl.toString(), "credits", "cancelled");
          }
        } catch {
          // ignore invalid referer
        }
      }

      const amountMinor = amountUsd * 100;
      const creditsGranted = amountUsd * CREDITS_PER_USD;

      const session = await withRetry(
        () =>
          stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ["card"],
            mode: "payment",
            invoice_creation: { enabled: true },
            line_items: [
              {
                price_data: {
                  currency: "usd",
                  unit_amount: amountMinor,
                  product_data: {
                    name: "ILIAGPT Creditos",
                    description: `Top-up de ${creditsGranted.toLocaleString()} creditos (validos 12 meses)`,
                    metadata: { kind: "credits_topup" },
                  },
                },
                quantity: 1,
              },
            ],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: {
              userId,
              kind: "credits_topup",
              amountUsd: String(amountUsd),
              creditsGranted: String(creditsGranted),
            },
          }),
        { maxAttempts: 3, initialDelayMs: 1000 }
      );

	      await auditLog(req as any, {
	        action: "billing.credits_topup_checkout_created",
	        resource: "stripe.checkout_session",
	        resourceId: session.id,
	        details: { userId, amountUsd, amountMinor, creditsGranted },
	        category: "user",
	        severity: "info",
	      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Credits checkout error:", error);
      res.status(500).json({ error: "Failed to create credits checkout session" });
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
        // Avoid leaking user existence details and keep behavior consistent in environments
        // where user provisioning is async.
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      const prefs = (dbUser as any).preferences || {};
      const saved = prefs?.billing?.creditAlerts || {};

      const canManage = await canManageBillingForDbUser(dbUser);
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
	      // Only billing managers can start a subscription checkout for the workspace.
	      if (!(await canManageBillingForDbUser(dbUser))) {
	        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
	      }

      const role = normalizeRole((dbUser as any).role);
      const canManage = await canManageBillingForDbUser(dbUser);
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
      const canManage = await canManageBillingForDbUser(dbUser);
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

            // Fail-closed: if the session/claims role is clearly non-billing, deny before touching DB/Stripe.
      const sessionRoleKey = normalizeRoleKey(getActorRole(req));
      if (sessionRoleKey && !["billing_manager", "team_admin", "admin", "superadmin"].includes(sessionRoleKey)) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

// Rely on DB-backed permissions. Session-embedded roles can be stale.

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
        // Avoid leaking user existence details and keep behavior consistent in environments
        // where user provisioning is async.
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      let canManageBilling = false;
      try {
        canManageBilling = await canManageBillingForDbUser(dbUser);
      } catch {
        // fail-closed: si no podemos resolver permisos, negamos acceso
        canManageBilling = false;
      }
      if (!canManageBilling) {
        try {
          await auditLog(req, {
          action: AuditActions.SECURITY_ALERT,
          resource: "billing.invoices",
          resourceId: userId,
          details: { reason: "permission_denied", role: normalizeRole((dbUser as any).role), actorEmail: getActorEmail(req) || null },
          category: "security",
          severity: "warning",
        });
        } catch {
          // best-effort (no bloquear el 403)
        }
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

            // Fail-closed: if the session/claims role is clearly non-billing, deny before touching DB/Stripe.
      const sessionRoleKey = normalizeRoleKey(getActorRole(req));
      if (sessionRoleKey && !["billing_manager", "team_admin", "admin", "superadmin"].includes(sessionRoleKey)) {
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

// Rely on DB-backed permissions. Session-embedded roles can be stale.

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
      if (!dbUser) {
        // Avoid leaking user existence details and keep behavior consistent in environments
        // where user provisioning is async.
        return res.status(403).json({ error: "Insufficient permissions", code: "PERMISSION_DENIED" });
      }

      let canManageBilling = false;
      try {
        canManageBilling = await canManageBillingForDbUser(dbUser);
      } catch {
        // fail-closed: si no podemos resolver permisos, negamos acceso
        canManageBilling = false;
      }
      if (!canManageBilling) {
        try {
          await auditLog(req, {
          action: AuditActions.SECURITY_ALERT,
          resource: "stripe.billing_portal",
          resourceId: userId,
          details: { reason: "permission_denied", role: normalizeRole((dbUser as any).role), actorEmail: getActorEmail(req) || null },
          category: "security",
          severity: "warning",
        });
        } catch {
          // best-effort (no bloquear el 403)
        }
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
