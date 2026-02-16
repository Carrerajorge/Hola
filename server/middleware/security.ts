import helmet from "helmet";
import { Express } from "express";

const isProduction = process.env.NODE_ENV === "production";

export const setupSecurity = (app: Express) => {
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "same-origin" },
      crossOriginOpenerPolicy: { policy: "same-origin" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    })
  );

  // Permissions-Policy: restrict sensitive browser APIs
  app.use((_req, res, next) => {
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(self), usb=(), magnetometer=(), gyroscope=(), accelerometer=()"
    );
    next();
  });
};
