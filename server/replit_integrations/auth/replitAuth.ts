import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";
import { storage } from "../../storage";
import { withRetry } from "../../utils/retry";
import { authRateLimiter } from "../../middleware/rateLimiter";

const PRE_EMPTIVE_REFRESH_THRESHOLD_SECONDS = 300;
const AUTH_METRICS = {
  loginAttempts: 0,
  loginSuccess: 0,
  loginFailures: 0,
  tokenRefreshAttempts: 0,
  tokenRefreshSuccess: 0,
  tokenRefreshFailures: 0,
  sessionCreations: 0,
};

export function getAuthMetrics() {
  return { ...AUTH_METRICS };
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  const isProduction = process.env.NODE_ENV === "production" || !!process.env.REPL_SLUG;
  return session({
    name: "siragpt.sid",
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" as const : "lax" as const,
      maxAge: sessionTtl,
      path: "/",
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  
  if (tokens.expires_in) {
    user.expires_at = Math.floor(Date.now() / 1000) + tokens.expires_in;
  } else if (user.claims?.exp) {
    user.expires_at = user.claims.exp;
  } else {
    user.expires_at = Math.floor(Date.now() / 1000) + 3600;
  }
  
  user.last_refresh = Date.now();
}

async function upsertUser(claims: any) {
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", authRateLimiter, (req, res, next) => {
    AUTH_METRICS.loginAttempts++;
    const startTime = Date.now();
    console.log(`[Auth] Login initiated from IP: ${req.ip}, hostname: ${req.hostname}`);
    
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", authRateLimiter, (req, res, next) => {
    const startTime = Date.now();
    const requestId = `cb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, (err: any, user: any, info: any) => {
      if (err) {
        AUTH_METRICS.loginFailures++;
        console.error(`[Auth] [${requestId}] Callback error after ${Date.now() - startTime}ms:`, {
          error: err.message,
          code: err.code,
          ip: req.ip,
        });
        return res.redirect("/login?error=auth_failed");
      }
      if (!user) {
        AUTH_METRICS.loginFailures++;
        console.error(`[Auth] [${requestId}] No user returned after ${Date.now() - startTime}ms:`, {
          info,
          ip: req.ip,
        });
        return res.redirect("/login?error=no_user");
      }
      req.logIn(user, async (loginErr) => {
        if (loginErr) {
          AUTH_METRICS.loginFailures++;
          console.error(`[Auth] [${requestId}] Login error after ${Date.now() - startTime}ms:`, {
            error: loginErr.message,
            ip: req.ip,
          });
          return res.redirect("/login?error=login_failed");
        }
        
        AUTH_METRICS.loginSuccess++;
        AUTH_METRICS.sessionCreations++;
        
        const userId = user.claims?.sub;
        const loginDuration = Date.now() - startTime;
        console.log(`[Auth] [${requestId}] Login successful in ${loginDuration}ms:`, {
          userId,
          email: user.claims?.email,
          ip: req.ip,
        });
        
        if (userId) {
          try {
            await authStorage.updateUserLogin(userId, {
              ipAddress: req.ip || req.socket.remoteAddress || null,
              userAgent: req.headers["user-agent"] || null
            });
            
            await storage.createAuditLog({
              userId,
              action: "user_login",
              resource: "auth",
              details: { 
                email: user.claims?.email,
                provider: "google_oauth",
                duration_ms: loginDuration,
              },
              ipAddress: req.ip || req.socket.remoteAddress || null,
              userAgent: req.headers["user-agent"] || null
            });
          } catch (auditError) {
            console.warn(`[Auth] [${requestId}] Failed to create audit log:`, auditError);
          }
        }
        
        return res.redirect("/?auth=success");
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;
  const requestId = `auth-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ 
      message: "Unauthorized",
      code: "SESSION_INVALID",
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const timeUntilExpiry = user.expires_at - now;
  
  if (timeUntilExpiry > PRE_EMPTIVE_REFRESH_THRESHOLD_SECONDS) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    console.warn(`[Auth] [${requestId}] No refresh token available for user:`, user.claims?.sub);
    return res.status(401).json({ 
      message: "Session expired",
      code: "NO_REFRESH_TOKEN",
    });
  }

  if (timeUntilExpiry > 0) {
    console.log(`[Auth] [${requestId}] Pre-emptive token refresh triggered, expires in ${timeUntilExpiry}s`);
  } else {
    console.log(`[Auth] [${requestId}] Token expired ${-timeUntilExpiry}s ago, attempting refresh`);
  }

  AUTH_METRICS.tokenRefreshAttempts++;
  
  try {
    const config = await getOidcConfig();
    
    const tokenResponse = await withRetry(
      () => client.refreshTokenGrant(config, refreshToken),
      {
        maxRetries: 2,
        baseDelay: 500,
        maxDelay: 2000,
        shouldRetry: (error) => {
          const errorMsg = error.message.toLowerCase();
          return errorMsg.includes('network') || 
                 errorMsg.includes('timeout') || 
                 errorMsg.includes('econnreset') ||
                 errorMsg.includes('5');
        },
        onRetry: (error, attempt, delay) => {
          console.warn(`[Auth] [${requestId}] Token refresh retry ${attempt}: ${error.message}, waiting ${delay}ms`);
        },
      }
    );
    
    updateUserSession(user, tokenResponse);
    AUTH_METRICS.tokenRefreshSuccess++;
    console.log(`[Auth] [${requestId}] Token refresh successful for user:`, user.claims?.sub);
    
    return next();
  } catch (error: any) {
    AUTH_METRICS.tokenRefreshFailures++;
    console.error(`[Auth] [${requestId}] Token refresh failed:`, {
      userId: user.claims?.sub,
      error: error.message,
    });
    
    return res.status(401).json({ 
      message: "Session expired, please login again",
      code: "TOKEN_REFRESH_FAILED",
    });
  }
};

export function getSessionStats() {
  return {
    metrics: getAuthMetrics(),
    timestamp: new Date().toISOString(),
  };
}
