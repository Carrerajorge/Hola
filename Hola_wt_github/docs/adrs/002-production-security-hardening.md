# 2. Production Security Hardening

Date: 2026-01-21

## Status

Accepted

## Context

The application required hardening to meet production security standards. Specifically:

- **XSS Vulnerabilities**: A lax Content Security Policy (CSP) increased the risk of Cross-Site Scripting.
- **Abuse Prevention**: There was insufficient protection against brute-force attacks or denial-of-service attempts on the API.
- **Proxy Awareness**: The application runs behind a reverse proxy (in production), but Express was not configured to trust it, potentially compromising IP-based security controls.

## Decision

We enforced a strictly layered security approach in `server/index.ts` and `server/middleware/`:

1. **Trust Proxy**: Enabled `app.set('trust proxy', 1)` to correctly resolve client IPs via `X-Forwarded-For`.
2. **Strict CSP**: Implemented a comprehensive CSP in `securityHeaders.ts`:
    - `default-src 'self'`
    - `script-src` restricted to trusted sources (nonces/`'self'`).
    - `upgrade-insecure-requests` enabled for production.
3. **Rate Limiting**:
    - Global API rate limit: 100 requests/minute.
    - Auth route strict limit: 10 requests/15 minutes.
    - Admin route limit: 30 requests/minute.
4. **Header Hardening**: Enforced `HSTS`, `X-Frame-Options`, `X-Content-Type-Options`, and `Referrer-Policy`.

## Consequences

### Positive

- **Reduced Attack Surface**: Significance decrease in XSS and clickjacking risks.
- **Stability**: Rate limiting prevents casual abuse and resource exhaustion.
- **Compliance**: aligns with standard security best practices (OWASP).

### Negative

- **Configuration Complexity**: Proxy settings must match the actual infrastructure (e.g., Nginx/Cloudflare).
- **Development Friction**: Strict CSP may block some dev tools or inline scripts, requiring `NODE_ENV` adjustments (which we implemented).
