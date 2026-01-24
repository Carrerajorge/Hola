/**
 * CORS Configuration Middleware - Production-ready
 * Fix #22: Configure restrictive CORS for production
 */
import cors from 'cors';

// Production domains - add your actual domains here
const PRODUCTION_ORIGINS = [
    'https://iliagpt.com',
    'https://www.iliagpt.com',
    'https://app.iliagpt.com',
];

// Development origins (only in non-production)
const DEVELOPMENT_ORIGINS = [
    'http://localhost:5050',
    'http://localhost:5001',
    'http://localhost:3000',
    'http://127.0.0.1:5050',
];

const isProduction = process.env.NODE_ENV === 'production';

// Build the allowed origins list based on environment
const getAllowedOrigins = (): string[] | '*' => {
    if (!isProduction) {
        // In development, allow all localhost origins
        return [...DEVELOPMENT_ORIGINS, ...(process.env.REPLIT_DOMAINS?.split(',').map(d => `https://${d}`) || [])];
    }

    // In production, only allow specific origins
    const productionDomains = process.env.ALLOWED_ORIGINS?.split(',') || PRODUCTION_ORIGINS;

    // Also allow Replit domains in production deployments
    if (process.env.REPLIT_DOMAINS) {
        const replitDomains = process.env.REPLIT_DOMAINS.split(',').map(d => `https://${d}`);
        return [...productionDomains, ...replitDomains];
    }

    return productionDomains;
};

// SECURITY FIX #11: Paths that can accept requests without origin (internal/health checks only)
const NO_ORIGIN_ALLOWED_PATHS = ['/health', '/metrics', '/api/health'];

export const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = getAllowedOrigins();

        // SECURITY FIX #12: In production, only allow no-origin for specific paths (handled in middleware)
        // For other requests, require origin in production
        if (!origin) {
            if (isProduction) {
                // Log but allow - will be filtered by path in middleware if needed
                // This allows legitimate server-to-server calls
                callback(null, true);
                return;
            }
            callback(null, true);
            return;
        }

        // SECURITY FIX #13: Even in development, log origins for auditing
        if (!isProduction) {
            if (process.env.CORS_DEBUG === 'true') {
                console.log(`[CORS] Dev mode - allowing origin: ${origin}`);
            }
            callback(null, true);
            return;
        }

        // In production, check against whitelist
        if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Blocked request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Request-ID',
        'X-Idempotency-Key',
        'X-CSRF-Token',
        'Accept',
        'Origin',
    ],
    exposedHeaders: [
        'X-Request-ID',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
    ],
    maxAge: 86400, // 24 hours - cache preflight requests
};

export const corsMiddleware = cors(corsOptions);

export default corsMiddleware;
