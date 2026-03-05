import helmet from "helmet";
import { Express } from "express";

export const setupSecurity = (app: Express) => {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'", // Necesario a veces para scripts de hidratación de React/Vite en dev
            "'unsafe-eval'",   // A veces necesario para dev tools, intentar quitar en prod estricto
            "https://js.stripe.com",
            "https://accounts.google.com",
            "https://apis.google.com",
            "https://replit.com",
            "https://*.replit.com", // Para frames de Replit
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'", // Estilos en línea de librerías UI
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
            "https://lh3.googleusercontent.com", // Avatares de Google
            "https://*.googleusercontent.com",
            "https://replit.com",
            "https://files.stripe.com",
          ],
          connectSrc: [
            "'self'",
            "wss:", // WebSockets
            "https://accounts.google.com",
            "https://api.stripe.com",
            "https://*.googleapis.com", // APIs de Google
          ],
          frameSrc: [
            "'self'",
            "https://js.stripe.com",
            "https://accounts.google.com",
            "https://docs.google.com", // Embeds de Docs/Sheets
          ],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: false, // Puede romper carga de recursos cross-origin
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );
};
