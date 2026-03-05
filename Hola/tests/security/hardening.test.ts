import express from "express";
import { describe, it, expect, beforeEach } from "vitest";
import { createUserRouter } from "../../server/routes/userRouter";
import { createStripeRouter } from "../../server/routes/stripeRouter";
import { createHttpTestClient } from "../helpers/httpTestClient";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(createUserRouter());
  app.use(createStripeRouter());
  return app;
}

describe("security hardening", () => {
  beforeEach(() => {
    delete process.env.ALLOW_CATALOG_SEEDING;
    delete process.env.ALLOW_STRIPE_PRODUCT_SEEDING;
  });

  it("hides catalog seed endpoints by default (404)", async () => {
    const app = makeApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res1 = await client.post("/api/integrations/seed").send({});
      expect(res1.status).toBe(404);
      expect(res1.body?.error).toBe("Not found");

      const res2 = await client.post("/api/notification-event-types/seed").send({});
      expect(res2.status).toBe(404);
      expect(res2.body?.error).toBe("Not found");
    } finally {
      await close();
    }
  });

  it("hides Stripe product seeding by default (404)", async () => {
    const app = makeApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.post("/api/stripe/create-products").send({});
      expect(res.status).toBe(404);
      expect(res.body?.error).toBe("Not found");
    } finally {
      await close();
    }
  });

  it("rejects notification preferences access without auth (403)", async () => {
    const app = makeApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.get("/api/users/user_123/notification-preferences");
      expect(res.status).toBe(403);
      expect(typeof res.body?.error).toBe("string");
    } finally {
      await close();
    }
  });

  it("rejects Stripe billing portal access for non-billing-manager users (403)", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { claims: { sub: "user_123", role: "user", email: "user@example.com" } };
      next();
    });
    app.use(createStripeRouter());
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.post("/api/stripe/portal").send({});
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe("PERMISSION_DENIED");
    } finally {
      await close();
    }
  });

  it("requires authentication to list invoices (401)", async () => {
    const app = makeApp();
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.get("/api/billing/invoices");
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it("rejects invoice listing for non-billing-manager users (403)", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { claims: { sub: "user_123", role: "user", email: "user@example.com" } };
      next();
    });
    app.use(createStripeRouter());
    const { client, close } = await createHttpTestClient(app);

    try {
      const res = await client.get("/api/billing/invoices");
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe("PERMISSION_DENIED");
    } finally {
      await close();
    }
  });
});
