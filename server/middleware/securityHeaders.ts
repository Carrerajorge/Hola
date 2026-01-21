import type { Request, Response, NextFunction } from "express";

export interface SecurityHeadersConfig {
  enableHSTS?: boolean;
  hstsMaxAge?: number;
  hstsIncludeSubDomains?: boolean;
  hstsPreload?: boolean;
  enableCSP?: boolean;
  cspDirectives?: Record<string, string[]>;
  enableXFrameOptions?: boolean;
  xFrameOptionsValue?: "DENY" | "SAMEORIGIN";
  enableXContentTypeOptions?: boolean;
  enableXXSSProtection?: boolean;
  enableReferrerPolicy?: boolean;
  referrerPolicyValue?: string;
  enablePermissionsPolicy?: boolean;
  permissionsPolicyDirectives?: Record<string, string[]>;
  customHeaders?: Record<string, string>;
}

const DEFAULT_CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  // Production CSP: Use nonces for inline scripts in production
  // For development, we need unsafe-inline for hot reload
  "script-src": process.env.NODE_ENV === 'production'
    ? ["'self'", "https://cdn.jsdelivr.net"]
    : ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
  "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "connect-src": ["'self'", "https://api.x.ai", "https://generativelanguage.googleapis.com", "wss:", "ws:"],
  "frame-ancestors": ["'self'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"],
  "upgrade-insecure-requests": [],
};

const DEFAULT_PERMISSIONS_POLICY: Record<string, string[]> = {
  "accelerometer": [],
  "camera": [],
  "geolocation": [],
  "gyroscope": [],
  "magnetometer": [],
  "microphone": ["self"],
  "payment": [],
  "usb": [],
};

function buildCSPHeader(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([directive, values]) => {
      if (values.length === 0) {
        return directive;
      }
      return `${directive} ${values.join(" ")}`;
    })
    .join("; ");
}

function buildPermissionsPolicyHeader(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([feature, allowlist]) => {
      if (allowlist.length === 0) {
        return `${feature}=()`;
      }
      return `${feature}=(${allowlist.join(" ")})`;
    })
    .join(", ");
}

const DEFAULT_CONFIG: Required<SecurityHeadersConfig> = {
  enableHSTS: true,
  hstsMaxAge: 31536000,
  hstsIncludeSubDomains: true,
  hstsPreload: false,
  enableCSP: true,
  cspDirectives: DEFAULT_CSP_DIRECTIVES,
  enableXFrameOptions: true,
  xFrameOptionsValue: "SAMEORIGIN",
  enableXContentTypeOptions: true,
  enableXXSSProtection: true,
  enableReferrerPolicy: true,
  referrerPolicyValue: "strict-origin-when-cross-origin",
  enablePermissionsPolicy: true,
  permissionsPolicyDirectives: DEFAULT_PERMISSIONS_POLICY,
  customHeaders: {},
};

export function securityHeaders(config: SecurityHeadersConfig = {}) {
  const mergedConfig: Required<SecurityHeadersConfig> = {
    ...DEFAULT_CONFIG,
    ...config,
    cspDirectives: {
      ...DEFAULT_CSP_DIRECTIVES,
      ...config.cspDirectives,
    },
    permissionsPolicyDirectives: {
      ...DEFAULT_PERMISSIONS_POLICY,
      ...config.permissionsPolicyDirectives,
    },
    customHeaders: {
      ...DEFAULT_CONFIG.customHeaders,
      ...config.customHeaders,
    },
  };

  return function securityHeadersMiddleware(
    _req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (mergedConfig.enableHSTS) {
      let hstsValue = `max-age=${mergedConfig.hstsMaxAge}`;
      if (mergedConfig.hstsIncludeSubDomains) {
        hstsValue += "; includeSubDomains";
      }
      if (mergedConfig.hstsPreload) {
        hstsValue += "; preload";
      }
      res.setHeader("Strict-Transport-Security", hstsValue);
    }

    if (mergedConfig.enableCSP) {
      const cspHeader = buildCSPHeader(mergedConfig.cspDirectives);
      res.setHeader("Content-Security-Policy", cspHeader);
    }

    if (mergedConfig.enableXFrameOptions) {
      res.setHeader("X-Frame-Options", mergedConfig.xFrameOptionsValue);
    }

    if (mergedConfig.enableXContentTypeOptions) {
      res.setHeader("X-Content-Type-Options", "nosniff");
    }

    if (mergedConfig.enableXXSSProtection) {
      res.setHeader("X-XSS-Protection", "1; mode=block");
    }

    if (mergedConfig.enableReferrerPolicy) {
      res.setHeader("Referrer-Policy", mergedConfig.referrerPolicyValue);
    }

    if (mergedConfig.enablePermissionsPolicy) {
      const permissionsPolicy = buildPermissionsPolicyHeader(
        mergedConfig.permissionsPolicyDirectives
      );
      res.setHeader("Permissions-Policy", permissionsPolicy);
    }

    res.removeHeader("X-Powered-By");

    for (const [headerName, headerValue] of Object.entries(mergedConfig.customHeaders)) {
      res.setHeader(headerName, headerValue);
    }

    next();
  };
}

export function apiSecurityHeaders() {
  return securityHeaders({
    enableCSP: false,
    customHeaders: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}

export function staticSecurityHeaders() {
  return securityHeaders({
    hstsPreload: true,
    customHeaders: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export const defaultSecurityHeaders = securityHeaders();
