/**
 * Security Utilities - Centralized security functions
 * SECURITY FIX #50: Centralized input validation and sanitization utilities
 */

// Sensitive field names to always redact from logs
export const SENSITIVE_FIELDS = [
  'password', 'token', 'secret', 'apiKey', 'api_key', 'authorization',
  'cookie', 'session', 'credit_card', 'ssn', 'cvv', 'pin', 'private_key',
  'access_token', 'refresh_token', 'bearer'
];

// Dangerous SQL patterns
export const DANGEROUS_SQL_PATTERNS = [
  /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)/i,
  /INTO\s+OUTFILE/i,
  /LOAD_FILE/i,
  /pg_sleep/i,
  /pg_terminate/i,
  /COPY\s+(TO|FROM)/i,
  /pg_read_file/i,
  /pg_ls_dir/i,
  /lo_import/i,
  /lo_export/i,
  /dblink/i,
  /\/\*[\s\S]*?(DROP|DELETE|UPDATE|INSERT)/i,
];

// Characters that trigger formula execution in spreadsheets
export const CSV_INJECTION_CHARS = ['=', '+', '-', '@', '\t', '\r', '\n'];

/**
 * Sanitize object by removing/redacting sensitive fields
 */
export function sanitizeSensitiveData<T extends Record<string, any>>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = { ...obj };
  for (const [key, value] of Object.entries(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field))) {
      sanitized[key as keyof T] = '[REDACTED]' as any;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key as keyof T] = sanitizeSensitiveData(value);
    }
  }
  return sanitized;
}

/**
 * Check if a SQL query contains dangerous patterns
 */
export function containsDangerousSql(query: string): boolean {
  return DANGEROUS_SQL_PATTERNS.some(pattern => pattern.test(query));
}

/**
 * Sanitize CSV value to prevent formula injection
 */
export function sanitizeCsvValue(value: any): string {
  if (value === null || value === undefined) return "";

  let str = typeof value === "object" ? JSON.stringify(value) : String(value);

  // Escape double quotes
  str = str.replace(/"/g, '""');

  // Prefix dangerous characters with single quote
  if (CSV_INJECTION_CHARS.some(char => str.startsWith(char))) {
    str = "'" + str;
  }

  // Wrap in quotes if needed
  if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
    str = `"${str}"`;
  }

  return str;
}

/**
 * Validate and sanitize a file path to prevent traversal
 */
export function sanitizeFilePath(filePath: string, baseDir?: string): string | null {
  const path = require('path');

  // Normalize and resolve path
  const normalized = path.normalize(filePath).replace(/\\/g, '/');

  // Block obvious traversal attempts
  if (normalized.includes('..') || normalized.includes('\0')) {
    return null;
  }

  // If baseDir provided, ensure path stays within it
  if (baseDir) {
    const resolvedBase = path.resolve(baseDir);
    const resolvedPath = path.resolve(baseDir, normalized);
    if (!resolvedPath.startsWith(resolvedBase)) {
      return null;
    }
    return resolvedPath;
  }

  return normalized;
}

/**
 * Validate file name for safe storage
 */
export function sanitizeFileName(fileName: string, maxLength: number = 255): string {
  // Remove path separators, null bytes, and other dangerous characters
  let safe = fileName.replace(/[\/\\:\*\?"<>|\x00]/g, '_');

  // Limit length while preserving extension
  if (safe.length > maxLength) {
    const path = require('path');
    const ext = path.extname(safe);
    safe = safe.substring(0, maxLength - ext.length) + ext;
  }

  return safe;
}

/**
 * Check if IP address is internal/private
 */
export function isInternalIP(ip: string | undefined): boolean {
  if (!ip) return false;

  const internalIPs = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'];
  if (internalIPs.includes(ip)) return true;

  const privateIPPrefixes = [
    '10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
    '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.',
    '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '192.168.'
  ];

  // Handle IPv6-mapped IPv4
  const cleanIP = ip.replace('::ffff:', '');
  return privateIPPrefixes.some(prefix => cleanIP.startsWith(prefix));
}

/**
 * Mask sensitive value for logging (show first/last few chars)
 */
export function maskSensitiveValue(value: string, showChars: number = 3): string {
  if (!value || value.length <= showChars * 2) {
    return '***';
  }
  return value.substring(0, showChars) + '***' + value.substring(value.length - showChars);
}

/**
 * Rate limit key generator that includes user context
 */
export function generateRateLimitKey(prefix: string, userId?: string, ip?: string): string {
  const identifier = userId || ip || 'anonymous';
  return `${prefix}:${identifier}`;
}

/**
 * Validate content length within bounds
 */
export function validateContentLength(
  content: string,
  maxLength: number,
  minLength: number = 0
): { valid: boolean; error?: string } {
  if (typeof content !== 'string') {
    return { valid: false, error: 'Content must be a string' };
  }
  if (content.length < minLength) {
    return { valid: false, error: `Content must be at least ${minLength} characters` };
  }
  if (content.length > maxLength) {
    return { valid: false, error: `Content exceeds maximum length of ${maxLength} characters` };
  }
  return { valid: true };
}
