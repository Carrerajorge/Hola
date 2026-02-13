import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import { createUserRouter } from "../../server/routes/userRouter";
import { createStripeRouter } from "../../server/routes/stripeRouter";

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

    const res1 = await request(app).post("/api/integrations/seed").send({});
    expect(res1.status).toBe(404);
    expect(res1.body?.error).toBe("Not found");

    const res2 = await request(app).post("/api/notification-event-types/seed").send({});
    expect(res2.status).toBe(404);
    expect(res2.body?.error).toBe("Not found");
  });

  it("hides Stripe product seeding by default (404)", async () => {
    const app = makeApp();

    const res = await request(app).post("/api/stripe/create-products").send({});
    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("Not found");
  });

  it("rejects notification preferences access without auth (403)", async () => {
    const app = makeApp();

    const res = await request(app).get("/api/users/user_123/notification-preferences");
    expect(res.status).toBe(403);
    expect(typeof res.body?.error).toBe("string");
  });

  it("rejects Stripe billing portal access for non-billing-manager users (403)", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).user = { claims: { sub: "user_123", role: "user", email: "user@example.com" } };
      next();
    });
    app.use(createStripeRouter());

    const res = await request(app).post("/api/stripe/portal").send({});
    expect(res.status).toBe(403);
    expect(res.body?.code).toBe("PERMISSION_DENIED");
  });
});
