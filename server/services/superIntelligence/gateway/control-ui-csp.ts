export function buildControlUiCspHeader(): string {
  // Control UI: allow only same-origin embedding so the first-party ILIAGPT
  // shell can host the panel while cross-origin framing stays blocked. Keep
  // inline scripts disabled and inline styles permissive because the UI uses a
  // lot of inline style attributes in templates.
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
  ].join("; ");
}
