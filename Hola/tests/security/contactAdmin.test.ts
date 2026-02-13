import express from "express";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHttpTestClient } from "../helpers/httpTestClient";

vi.mock("../../server/services/genericEmailService", () => ({
  sendEmail: vi.fn(async () => ({ success: true, messageId: "msg_test" })),
}));

import { createStripeRouter } from "../../server/routes/stripeRouter";

function makeApp(opts?: { withAuth?: boolean }) {
  const app = express();
  app.use(express.json());
  if (opts?.withAuth) {
    app.use((req, _res, next) => {
      (req as any).user = { claims: { sub: "user_123", role: "user", email: "user@example.com" } };
      next();
    });
  }
  app.use(createStripeRouter());
  return app;
}

describe("billing contact admin", () => {
  beforeEach(() => {
    process.env.ADMIN_EMAIL = "carrerajorge874@gmail.com";
  });

  it("requires authentication (401)", async () => {
    const app = makeApp({ withAuth: false });
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/billing/contact-admin").send({ message: "hola" });
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it("validates body (400)", async () => {
    const app = makeApp({ withAuth: true });
    const { client, close } = await createHttpTestClient(app);
    try {
      const res = await client.post("/api/billing/contact-admin").send({ message: "" });
      expect(res.status).toBe(400);
      expect(res.body?.code).toBe("INVALID_BODY");
    } finally {
      await close();
    }
  });

  it("rate limits repeated requests (429)", async () => {
    const app = makeApp({ withAuth: true });
    const { client, close } = await createHttpTestClient(app);

    try {
      const first = await client
        .post("/api/billing/contact-admin")
        .set("x-forwarded-for", "203.0.113.10")
        .send({ message: "Necesito ayuda con facturacion." });
      expect(first.status).toBe(200);
      expect(first.body?.success).toBe(true);

      const second = await client
        .post("/api/billing/contact-admin")
        .set("x-forwarded-for", "203.0.113.10")
        .send({ message: "Otra solicitud." });
      expect(second.status).toBe(429);
      expect(typeof second.body?.retryAfterSeconds).toBe("number");
    } finally {
      await close();
    }
  });
});
