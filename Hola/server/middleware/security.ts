import helmet from "helmet";
import { Express } from "express";

const isProduction = process.env.NODE_ENV === "production";

export const setupSecurity = (app: Express) => {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // Required for React/Vite hydration
            ...(isProduction ? [] : ["'unsafe-eval'"]),
            "https://js.stripe.com",
            "https://accounts.google.com",
            "https://apis.google.com",
            "https://replit.com",
            "https://*.replit.com",
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'", // Required for UI libraries
            "https://fonts.googleapis.com",
          ],
          fontSrc: [
            "'self'",
            "https://fonts.gstatic.com",
            "data:",
          ],
          imgSrc: [
            "'self'",
            "data:",
            "blob:",
            "https://lh3.googleusercontent.com",
            "https://*.googleusercontent.com",
            "https://replit.com",
            "https://files.stripe.com",
          ],
          connectSrc: [
            "'self'",
            "wss:", // WebSockets
            "https://accounts.google.com",
            "https://api.stripe.com",
            "https://*.googleapis.com",
          ],
          frameSrc: [
            "'self'",
            "https://js.stripe.com",
            "https://accounts.google.com",
            "https://docs.google.com",
          ],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", "https://accounts.google.com"],
          frameAncestors: ["'self'"],
          workerSrc: ["'self'", "blob:"],
          ...(isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
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
