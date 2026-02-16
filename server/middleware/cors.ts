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

/** Security: validate Replit domain format to prevent injection */
function isValidReplitDomain(domain: string): boolean {
    if (!domain || typeof domain !== 'string') return false;
    const trimmed = domain.trim().toLowerCase();
    // Replit domains should match *.replit.dev, *.repl.co, or *.replit.app
    return /^[a-z0-9][a-z0-9\-]*\.(replit\.dev|repl\.co|replit\.app)$/.test(trimmed);
}

// Build the allowed origins list based on environment
const getAllowedOrigins = (): string[] | '*' => {
    if (!isProduction) {
        // In development, allow localhost + validated Replit domains
        const replitOrigins = (process.env.REPLIT_DOMAINS?.split(',') || [])
            .filter(isValidReplitDomain)
            .map(d => `https://${d.trim()}`);
        return [...DEVELOPMENT_ORIGINS, ...replitOrigins];
    }

    // In production, only allow specific origins
    const productionDomains = process.env.ALLOWED_ORIGINS?.split(',').map(d => d.trim()).filter(Boolean) || PRODUCTION_ORIGINS;

    // Also allow validated Replit domains in production deployments
    if (process.env.REPLIT_DOMAINS) {
        const replitDomains = process.env.REPLIT_DOMAINS.split(',')
            .filter(isValidReplitDomain)
            .map(d => `https://${d.trim()}`);
        return [...productionDomains, ...replitDomains];
    }

    return productionDomains;
};

export const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = getAllowedOrigins();

        // Requests with no Origin header can happen for same-origin navigations or server-to-server calls.
        if (!origin) {
            callback(null, true);
            return;
        }

        // In development, allow all origins (useful for local testing).
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
            console.warn(`[CORS] Blocked request from origin: ${String(origin).substring(0, 200)}`);
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
