import { Router } from "express";
import { getUncachableStripeClient, getStripePublishableKey } from "../stripeClient";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { withRetry } from "../lib/retryUtility";

const PLAN_PRICE_MAPPING: Record<string, { name: string; amount: number; interval?: string }> = {
  price_go_monthly: { name: "Go", amount: 500, interval: "month" },
  price_plus_monthly: { name: "Plus", amount: 1000, interval: "month" },
  price_pro_monthly: { name: "Pro", amount: 20000, interval: "month" },
  price_business_monthly: { name: "Business", amount: 2500, interval: "month" },
};

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
            () => stripe.prices.list({ active: true, limit: 100 }),
            { maxAttempts: 3, initialDelayMs: 1000 }
          );

          for (const price of prices.data) {
            const amount = price.unit_amount;
            const interval = price.recurring?.interval;

            if (amount === 500 && interval === "month") {
              priceMapping.price_go_monthly = price.id;
            } else if (amount === 1000 && interval === "month") {
              priceMapping.price_plus_monthly = price.id;
            } else if (amount === 2000 && interval === "year") {
              priceMapping.price_pro_yearly = price.id;
            }
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

      const { priceId } = req.body;
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

      // Add retry logic for session creation
      const session = await withRetry(
        () => stripe.checkout.sessions.create({
          customer: customerId,
          payment_method_types: ['card'],
          line_items: [{ price: priceId, quantity: 1 }],
          mode: 'subscription',
          success_url: `${protocol}://${domain}/?subscription=success`,
          cancel_url: `${protocol}://${domain}/?subscription=cancelled`,
          metadata: { userId }
        }),
        { maxAttempts: 3, initialDelayMs: 1000 }
      );

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Checkout error:", error);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  router.post("/api/stripe/create-products", async (req, res) => {
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

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as any;
          const userId = session.metadata?.userId;

          if (userId) {
            console.log(`[Stripe] Checkout completed for user ${userId}`);

            if (session.subscription) {
              const stripe = await getUncachableStripeClient();
              const subscription = await stripe.subscriptions.retrieve(session.subscription);
              
              // Handle subscription created with notifications
              await subscriptionService.handleSubscriptionCreated(subscription);
              
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
          await subscriptionService.handleSubscriptionCreated(subscription);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as any;
          await subscriptionService.handleSubscriptionUpdated(subscription);
          
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
          await subscriptionService.handleSubscriptionDeleted(subscription);
          
          const [dbUser] = await db.select().from(users).where(eq(users.stripeCustomerId, subscription.customer));

          if (dbUser) {
            console.log(`[Stripe] Subscription deleted for user ${dbUser.id}`);
            await usageQuotaService.updateUserPlan(dbUser.id, "free");
          }
          break;
        }
        
        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          await subscriptionService.handlePaymentSucceeded(invoice);
          break;
        }
        
        case 'invoice.payment_failed': {
          const invoice = event.data.object as any;
          await subscriptionService.handlePaymentFailed(invoice);
          break;
        }
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error(`Webhook handler error: ${err.message}`);
      res.status(500).send(`Webhook Handler Error: ${err.message}`);
    }
  });

  router.post("/api/stripe/portal", async (req, res) => {
    try {
      const user = (req as any).user;
      const userId = user?.claims?.sub;

      if (!userId) {
        return res.status(401).json({ error: "Debes iniciar sesión" });
      }

      const [dbUser] = await db.select().from(users).where(eq(users.id, userId));
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

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Portal error:", error);
      res.status(500).json({ error: "Failed to create portal session" });
    }
  });

  return router;
}
