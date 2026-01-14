import { Router } from "express";
import { getUncachableStripeClient, getStripePublishableKey } from "../stripeClient";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

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
        const customer = await stripe.customers.create({
          email: dbUser.email || undefined,
          metadata: { userId }
        });
        customerId = customer.id;
        
        await db.update(users)
          .set({ stripeCustomerId: customerId })
          .where(eq(users.id, userId));
      }

      const domain = process.env.REPLIT_DOMAINS?.split(',')[0] || 'localhost:5000';
      const protocol = domain.includes('localhost') ? 'http' : 'https';

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${protocol}://${domain}/?subscription=success`,
        cancel_url: `${protocol}://${domain}/?subscription=cancelled`,
        metadata: { userId }
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Checkout error:", error);
      res.status(500).json({ error: "Failed to create checkout session" });
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
