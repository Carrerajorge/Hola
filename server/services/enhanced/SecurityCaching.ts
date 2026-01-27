/**
 * Security & Caching Enhancements (321-340)
 * Advanced security features and caching strategies
 */

import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';
import crypto from 'crypto';

// ============================================
// 321. Advanced Rate Limiting with Sliding Window
// ============================================
interface SlidingWindowConfig {
  windowMs: number;
  maxRequests: number;
  blockDurationMs?: number;
}

export class SlidingWindowRateLimiter {
  private windows: Map<string, { timestamps: number[]; blockedUntil?: number }> = new Map();
  private config: SlidingWindowConfig;

  constructor(config: SlidingWindowConfig) {
    this.config = config;
    setInterval(() => this.cleanup(), 60000);
  }

  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let record = this.windows.get(key);

    if (!record) {
      record = { timestamps: [] };
      this.windows.set(key, record);
    }

    // Check if blocked
    if (record.blockedUntil && record.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: record.blockedUntil
      };
    }

    // Clean old timestamps
    const windowStart = now - this.config.windowMs;
    record.timestamps = record.timestamps.filter(t => t > windowStart);

    // Check limit
    if (record.timestamps.length >= this.config.maxRequests) {
      if (this.config.blockDurationMs) {
        record.blockedUntil = now + this.config.blockDurationMs;
      }
      return {
        allowed: false,
        remaining: 0,
        resetAt: record.timestamps[0] + this.config.windowMs
      };
    }

    // Add current request
    record.timestamps.push(now);

    return {
      allowed: true,
      remaining: this.config.maxRequests - record.timestamps.length,
      resetAt: now + this.config.windowMs
    };
  }

  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [key, record] of this.windows) {
      record.timestamps = record.timestamps.filter(t => t > windowStart);
      if (record.timestamps.length === 0 && (!record.blockedUntil || record.blockedUntil < now)) {
        this.windows.delete(key);
      }
    }
  }

  getMiddleware(keyExtractor: (req: Request) => string = (req) => req.ip || 'unknown') {
    return (req: Request, res: Response, next: NextFunction) => {
      const key = keyExtractor(req);
      const result = this.check(key);

      res.setHeader('X-RateLimit-Limit', this.config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
          retryAfter
        });
      }

      next();
    };
  }
}

// ============================================
// 322. IP Reputation System
// ============================================
interface IPReputation {
  ip: string;
  score: number; // 0-100, higher is more trusted
  lastActivity: Date;
  violations: number;
  tags: string[];
}

export class IPReputationSystem {
  private reputations: Map<string, IPReputation> = new Map();
  private events = new EventEmitter();
  private defaultScore = 50;

  getReputation(ip: string): IPReputation {
    if (!this.reputations.has(ip)) {
      this.reputations.set(ip, {
        ip,
        score: this.defaultScore,
        lastActivity: new Date(),
        violations: 0,
        tags: []
      });
    }
    return this.reputations.get(ip)!;
  }

  adjustScore(ip: string, delta: number, reason: string): void {
    const rep = this.getReputation(ip);
    const oldScore = rep.score;
    rep.score = Math.max(0, Math.min(100, rep.score + delta));
    rep.lastActivity = new Date();

    if (delta < 0) {
      rep.violations++;
    }

    this.events.emit('scoreChanged', { ip, oldScore, newScore: rep.score, reason });

    if (rep.score < 20) {
      this.events.emit('lowReputation', rep);
    }
  }

  addTag(ip: string, tag: string): void {
    const rep = this.getReputation(ip);
    if (!rep.tags.includes(tag)) {
      rep.tags.push(tag);
    }
  }

  hasTag(ip: string, tag: string): boolean {
    const rep = this.getReputation(ip);
    return rep.tags.includes(tag);
  }

  isBlocked(ip: string): boolean {
    const rep = this.getReputation(ip);
    return rep.score < 10 || rep.tags.includes('blocked');
  }

  getMiddleware(minScore: number = 20) {
    return (req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip || 'unknown';
      const rep = this.getReputation(ip);

      if (this.isBlocked(ip)) {
        return res.status(403).json({
          error: 'IP_BLOCKED',
          message: 'Your IP has been blocked'
        });
      }

      if (rep.score < minScore) {
        return res.status(403).json({
          error: 'LOW_REPUTATION',
          message: 'Your IP reputation is too low'
        });
      }

      (req as any).ipReputation = rep;
      next();
    };
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 323. Request Fingerprinting
// ============================================
interface RequestFingerprint {
  hash: string;
  components: {
    ip: string;
    userAgent: string;
    acceptLanguage: string;
    acceptEncoding: string;
    screenResolution?: string;
    timezone?: string;
    platform?: string;
  };
}

export function generateRequestFingerprint(req: Request): RequestFingerprint {
  const components = {
    ip: req.ip || 'unknown',
    userAgent: req.headers['user-agent'] || '',
    acceptLanguage: req.headers['accept-language'] || '',
    acceptEncoding: req.headers['accept-encoding'] || '',
    screenResolution: req.headers['x-screen-resolution'] as string | undefined,
    timezone: req.headers['x-timezone'] as string | undefined,
    platform: req.headers['sec-ch-ua-platform'] as string | undefined
  };

  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(components))
    .digest('hex');

  return { hash, components };
}

// ============================================
// 324. Brute Force Protection
// ============================================
interface BruteForceConfig {
  maxAttempts: number;
  windowMs: number;
  blockDurationMs: number;
  onBlock?: (key: string, attempts: number) => void;
}

export class BruteForceProtection {
  private attempts: Map<string, { count: number; firstAttempt: number; blockedUntil?: number }> = new Map();
  private config: BruteForceConfig;

  constructor(config: BruteForceConfig) {
    this.config = config;
    setInterval(() => this.cleanup(), 60000);
  }

  recordAttempt(key: string): { blocked: boolean; attemptsRemaining: number; blockedUntil?: number } {
    const now = Date.now();
    let record = this.attempts.get(key);

    if (!record) {
      record = { count: 0, firstAttempt: now };
      this.attempts.set(key, record);
    }

    // Check if currently blocked
    if (record.blockedUntil && record.blockedUntil > now) {
      return {
        blocked: true,
        attemptsRemaining: 0,
        blockedUntil: record.blockedUntil
      };
    }

    // Reset if window expired
    if (now - record.firstAttempt > this.config.windowMs) {
      record.count = 0;
      record.firstAttempt = now;
      record.blockedUntil = undefined;
    }

    record.count++;

    if (record.count >= this.config.maxAttempts) {
      record.blockedUntil = now + this.config.blockDurationMs;
      this.config.onBlock?.(key, record.count);
      return {
        blocked: true,
        attemptsRemaining: 0,
        blockedUntil: record.blockedUntil
      };
    }

    return {
      blocked: false,
      attemptsRemaining: this.config.maxAttempts - record.count
    };
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  isBlocked(key: string): boolean {
    const record = this.attempts.get(key);
    if (!record || !record.blockedUntil) return false;
    return record.blockedUntil > Date.now();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.attempts) {
      if (
        now - record.firstAttempt > this.config.windowMs &&
        (!record.blockedUntil || record.blockedUntil < now)
      ) {
        this.attempts.delete(key);
      }
    }
  }
}

// ============================================
// 325. Security Headers Manager
// ============================================
interface SecurityHeadersConfig {
  contentSecurityPolicy?: string;
  strictTransportSecurity?: { maxAge: number; includeSubDomains?: boolean; preload?: boolean };
  xFrameOptions?: 'DENY' | 'SAMEORIGIN';
  xContentTypeOptions?: boolean;
  referrerPolicy?: string;
  permissionsPolicy?: Record<string, string[]>;
}

export function createSecurityHeaders(config: SecurityHeadersConfig = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Content Security Policy
    if (config.contentSecurityPolicy) {
      res.setHeader('Content-Security-Policy', config.contentSecurityPolicy);
    }

    // Strict Transport Security
    if (config.strictTransportSecurity) {
      let value = `max-age=${config.strictTransportSecurity.maxAge}`;
      if (config.strictTransportSecurity.includeSubDomains) value += '; includeSubDomains';
      if (config.strictTransportSecurity.preload) value += '; preload';
      res.setHeader('Strict-Transport-Security', value);
    }

    // X-Frame-Options
    if (config.xFrameOptions) {
      res.setHeader('X-Frame-Options', config.xFrameOptions);
    }

    // X-Content-Type-Options
    if (config.xContentTypeOptions !== false) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }

    // Referrer Policy
    if (config.referrerPolicy) {
      res.setHeader('Referrer-Policy', config.referrerPolicy);
    }

    // Permissions Policy
    if (config.permissionsPolicy) {
      const value = Object.entries(config.permissionsPolicy)
        .map(([feature, allowList]) => `${feature}=(${allowList.join(' ')})`)
        .join(', ');
      res.setHeader('Permissions-Policy', value);
    }

    next();
  };
}

// ============================================
// 326. Input Sanitization
// ============================================
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .replace(/data:/gi, '') // Remove data: protocol
    .trim();
}

export function sanitizeObject<T extends Record<string, any>>(obj: T, fields?: string[]): T {
  const result = { ...obj };
  const fieldsToSanitize = fields || Object.keys(result);

  for (const field of fieldsToSanitize) {
    if (typeof result[field] === 'string') {
      (result as any)[field] = sanitizeInput(result[field]);
    } else if (typeof result[field] === 'object' && result[field] !== null) {
      (result as any)[field] = sanitizeObject(result[field]);
    }
  }

  return result;
}

export function sanitizationMiddleware(fields?: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body, fields);
    }
    next();
  };
}

// ============================================
// 327. SQL Injection Prevention
// ============================================
const sqlPatterns = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b)/gi,
  /(--)|(\/\*)|(\*\/)/g,
  /(;[\s]*$)/g,
  /(\b(OR|AND)\b[\s]+[\d]+=[\d]+)/gi,
  /(\b(UNION)\b[\s]+(ALL[\s]+)?SELECT)/gi
];

export function detectSQLInjection(input: string): boolean {
  for (const pattern of sqlPatterns) {
    if (pattern.test(input)) {
      return true;
    }
  }
  return false;
}

export function sqlInjectionProtection() {
  return (req: Request, res: Response, next: NextFunction) => {
    const checkObject = (obj: any): boolean => {
      for (const value of Object.values(obj)) {
        if (typeof value === 'string' && detectSQLInjection(value)) {
          return true;
        }
        if (typeof value === 'object' && value !== null && checkObject(value)) {
          return true;
        }
      }
      return false;
    };

    if (checkObject(req.body) || checkObject(req.query) || checkObject(req.params)) {
      return res.status(400).json({
        error: 'INVALID_INPUT',
        message: 'Potentially malicious input detected'
      });
    }

    next();
  };
}

// ============================================
// 328. XSS Prevention
// ============================================
const xssPatterns = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /<iframe/gi,
  /<object/gi,
  /<embed/gi,
  /<form/gi
];

export function detectXSS(input: string): boolean {
  for (const pattern of xssPatterns) {
    if (pattern.test(input)) {
      return true;
    }
  }
  return false;
}

export function escapeHTML(str: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
  };

  return str.replace(/[&<>"'`=\/]/g, char => htmlEntities[char]);
}

// ============================================
// 329. Multi-Level Cache System
// ============================================
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  tags: string[];
}

export class MultiLevelCache {
  private l1Cache: Map<string, CacheEntry<any>> = new Map(); // Memory
  private l2Cache: Map<string, CacheEntry<any>> = new Map(); // Simulated Redis
  private l1MaxSize: number;
  private events = new EventEmitter();

  constructor(l1MaxSize: number = 1000) {
    this.l1MaxSize = l1MaxSize;
  }

  async get<T>(key: string): Promise<T | null> {
    // Check L1
    const l1Entry = this.l1Cache.get(key);
    if (l1Entry && l1Entry.expiresAt > Date.now()) {
      this.events.emit('hit', { level: 'L1', key });
      return l1Entry.value;
    }

    // Check L2
    const l2Entry = this.l2Cache.get(key);
    if (l2Entry && l2Entry.expiresAt > Date.now()) {
      // Promote to L1
      this.setL1(key, l2Entry);
      this.events.emit('hit', { level: 'L2', key });
      return l2Entry.value;
    }

    this.events.emit('miss', { key });
    return null;
  }

  async set<T>(key: string, value: T, ttlMs: number, tags: string[] = []): Promise<void> {
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + ttlMs,
      tags
    };

    this.setL1(key, entry);
    this.l2Cache.set(key, entry);
  }

  private setL1<T>(key: string, entry: CacheEntry<T>): void {
    // Evict if at capacity
    if (this.l1Cache.size >= this.l1MaxSize) {
      const oldestKey = this.l1Cache.keys().next().value;
      if (oldestKey) this.l1Cache.delete(oldestKey);
    }
    this.l1Cache.set(key, entry);
  }

  async invalidate(key: string): Promise<void> {
    this.l1Cache.delete(key);
    this.l2Cache.delete(key);
  }

  async invalidateByTag(tag: string): Promise<void> {
    for (const [key, entry] of this.l1Cache) {
      if (entry.tags.includes(tag)) {
        this.l1Cache.delete(key);
      }
    }
    for (const [key, entry] of this.l2Cache) {
      if (entry.tags.includes(tag)) {
        this.l2Cache.delete(key);
      }
    }
  }

  async invalidateAll(): Promise<void> {
    this.l1Cache.clear();
    this.l2Cache.clear();
  }

  getStats(): { l1Size: number; l2Size: number } {
    return {
      l1Size: this.l1Cache.size,
      l2Size: this.l2Cache.size
    };
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 330. Cache-Aside Pattern
// ============================================
export class CacheAside<T> {
  private cache: MultiLevelCache;
  private loader: (key: string) => Promise<T | null>;
  private keyPrefix: string;
  private defaultTTL: number;

  constructor(
    cache: MultiLevelCache,
    loader: (key: string) => Promise<T | null>,
    options: { keyPrefix?: string; defaultTTL?: number } = {}
  ) {
    this.cache = cache;
    this.loader = loader;
    this.keyPrefix = options.keyPrefix || '';
    this.defaultTTL = options.defaultTTL || 300000; // 5 minutes
  }

  async get(key: string, ttl?: number): Promise<T | null> {
    const cacheKey = this.keyPrefix + key;

    // Try cache first
    const cached = await this.cache.get<T>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // Load from source
    const value = await this.loader(key);
    if (value !== null) {
      await this.cache.set(cacheKey, value, ttl || this.defaultTTL);
    }

    return value;
  }

  async invalidate(key: string): Promise<void> {
    await this.cache.invalidate(this.keyPrefix + key);
  }

  async refresh(key: string, ttl?: number): Promise<T | null> {
    const cacheKey = this.keyPrefix + key;
    const value = await this.loader(key);

    if (value !== null) {
      await this.cache.set(cacheKey, value, ttl || this.defaultTTL);
    } else {
      await this.cache.invalidate(cacheKey);
    }

    return value;
  }
}

// ============================================
// 331. Write-Through Cache
// ============================================
export class WriteThroughCache<T> {
  private cache: MultiLevelCache;
  private writer: (key: string, value: T) => Promise<void>;
  private keyPrefix: string;
  private defaultTTL: number;

  constructor(
    cache: MultiLevelCache,
    writer: (key: string, value: T) => Promise<void>,
    options: { keyPrefix?: string; defaultTTL?: number } = {}
  ) {
    this.cache = cache;
    this.writer = writer;
    this.keyPrefix = options.keyPrefix || '';
    this.defaultTTL = options.defaultTTL || 300000;
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    const cacheKey = this.keyPrefix + key;

    // Write to source first
    await this.writer(key, value);

    // Then update cache
    await this.cache.set(cacheKey, value, ttl || this.defaultTTL);
  }
}

// ============================================
// 332. Cache Warming
// ============================================
export class CacheWarmer {
  private cache: MultiLevelCache;
  private warmers: Map<string, { loader: () => Promise<{ key: string; value: any; ttl: number }[]>; interval?: number }> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(cache: MultiLevelCache) {
    this.cache = cache;
  }

  register(
    name: string,
    loader: () => Promise<{ key: string; value: any; ttl: number }[]>,
    interval?: number
  ): void {
    this.warmers.set(name, { loader, interval });

    if (interval) {
      const intervalId = setInterval(() => this.warm(name), interval);
      this.intervals.set(name, intervalId);
    }
  }

  async warm(name?: string): Promise<void> {
    const warmersToRun = name ? [[name, this.warmers.get(name)!]] : Array.from(this.warmers);

    for (const [warmerName, config] of warmersToRun) {
      if (!config) continue;

      try {
        const items = await config.loader();
        for (const { key, value, ttl } of items) {
          await this.cache.set(key, value, ttl);
        }
      } catch (error) {
        console.error(`Cache warming failed for ${warmerName}:`, error);
      }
    }
  }

  stop(name: string): void {
    const intervalId = this.intervals.get(name);
    if (intervalId) {
      clearInterval(intervalId);
      this.intervals.delete(name);
    }
  }

  stopAll(): void {
    for (const [name] of this.intervals) {
      this.stop(name);
    }
  }
}

// ============================================
// 333. HTTP Cache Headers
// ============================================
interface HTTPCacheOptions {
  maxAge?: number;
  sMaxAge?: number;
  private?: boolean;
  public?: boolean;
  noCache?: boolean;
  noStore?: boolean;
  mustRevalidate?: boolean;
  proxyRevalidate?: boolean;
  immutable?: boolean;
  staleWhileRevalidate?: number;
  staleIfError?: number;
}

export function setCacheHeaders(res: Response, options: HTTPCacheOptions): void {
  const directives: string[] = [];

  if (options.public) directives.push('public');
  if (options.private) directives.push('private');
  if (options.noCache) directives.push('no-cache');
  if (options.noStore) directives.push('no-store');
  if (options.mustRevalidate) directives.push('must-revalidate');
  if (options.proxyRevalidate) directives.push('proxy-revalidate');
  if (options.immutable) directives.push('immutable');
  if (options.maxAge !== undefined) directives.push(`max-age=${options.maxAge}`);
  if (options.sMaxAge !== undefined) directives.push(`s-maxage=${options.sMaxAge}`);
  if (options.staleWhileRevalidate !== undefined) {
    directives.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
  }
  if (options.staleIfError !== undefined) {
    directives.push(`stale-if-error=${options.staleIfError}`);
  }

  res.setHeader('Cache-Control', directives.join(', '));
}

export function cacheMiddleware(options: HTTPCacheOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    setCacheHeaders(res, options);
    next();
  };
}

// ============================================
// 334. Session Security Manager
// ============================================
interface SessionSecurityConfig {
  maxConcurrentSessions?: number;
  sessionTimeout?: number;
  inactivityTimeout?: number;
  requireReauth?: string[]; // Paths that require recent auth
  reauthWindow?: number;
}

export class SessionSecurityManager {
  private sessions: Map<string, { userId: string; createdAt: number; lastActivity: number; deviceId: string }[]> = new Map();
  private config: SessionSecurityConfig;

  constructor(config: SessionSecurityConfig = {}) {
    this.config = {
      maxConcurrentSessions: config.maxConcurrentSessions || 5,
      sessionTimeout: config.sessionTimeout || 24 * 60 * 60 * 1000, // 24 hours
      inactivityTimeout: config.inactivityTimeout || 30 * 60 * 1000, // 30 minutes
      requireReauth: config.requireReauth || [],
      reauthWindow: config.reauthWindow || 15 * 60 * 1000 // 15 minutes
    };
  }

  createSession(userId: string, deviceId: string): string {
    const sessionId = crypto.randomBytes(32).toString('hex');
    let userSessions = this.sessions.get(userId) || [];

    // Check concurrent sessions limit
    if (userSessions.length >= this.config.maxConcurrentSessions!) {
      // Remove oldest session
      userSessions.sort((a, b) => a.createdAt - b.createdAt);
      userSessions.shift();
    }

    userSessions.push({
      userId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      deviceId
    });

    this.sessions.set(userId, userSessions);
    return sessionId;
  }

  validateSession(userId: string, deviceId: string): boolean {
    const userSessions = this.sessions.get(userId);
    if (!userSessions) return false;

    const session = userSessions.find(s => s.deviceId === deviceId);
    if (!session) return false;

    const now = Date.now();

    // Check session timeout
    if (now - session.createdAt > this.config.sessionTimeout!) {
      this.removeSession(userId, deviceId);
      return false;
    }

    // Check inactivity timeout
    if (now - session.lastActivity > this.config.inactivityTimeout!) {
      this.removeSession(userId, deviceId);
      return false;
    }

    // Update activity
    session.lastActivity = now;
    return true;
  }

  removeSession(userId: string, deviceId: string): void {
    const userSessions = this.sessions.get(userId);
    if (!userSessions) return;

    const filtered = userSessions.filter(s => s.deviceId !== deviceId);
    if (filtered.length === 0) {
      this.sessions.delete(userId);
    } else {
      this.sessions.set(userId, filtered);
    }
  }

  removeAllSessions(userId: string): void {
    this.sessions.delete(userId);
  }

  getActiveSessions(userId: string): number {
    return this.sessions.get(userId)?.length || 0;
  }
}

// ============================================
// 335. Encryption Helper
// ============================================
export class EncryptionHelper {
  private algorithm = 'aes-256-gcm';
  private keyLength = 32;
  private ivLength = 16;
  private tagLength = 16;

  deriveKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(password, salt, 100000, this.keyLength, 'sha256');
  }

  encrypt(plaintext: string, key: Buffer): { ciphertext: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');

    const tag = cipher.getAuthTag();

    return {
      ciphertext,
      iv: iv.toString('hex'),
      tag: tag.toString('hex')
    };
  }

  decrypt(ciphertext: string, key: Buffer, iv: string, tag: string): string {
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      key,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  }

  hash(data: string, algorithm: string = 'sha256'): string {
    return crypto.createHash(algorithm).update(data).digest('hex');
  }

  generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }
}

// ============================================
// 336-340: Additional Security & Caching
// ============================================

// 336. CORS Preflight Cache
export function corsPreflightCache(maxAge: number = 86400) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Max-Age', maxAge);
    }
    next();
  };
}

// 337. Security Audit Logger
export class SecurityAuditLogger {
  private events = new EventEmitter();

  log(event: {
    type: string;
    userId?: string;
    ip: string;
    userAgent?: string;
    action: string;
    resource?: string;
    status: 'success' | 'failure';
    details?: any;
  }): void {
    const entry = {
      ...event,
      timestamp: new Date().toISOString()
    };

    this.events.emit('audit', entry);

    // Also log to console for now
    console.log('[SECURITY AUDIT]', JSON.stringify(entry));
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// 338. Request Signing
export class RequestSigner {
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  sign(payload: any, timestamp: number = Date.now()): string {
    const data = `${timestamp}.${JSON.stringify(payload)}`;
    return crypto.createHmac('sha256', this.secret).update(data).digest('hex');
  }

  verify(payload: any, signature: string, timestamp: number, maxAge: number = 300000): boolean {
    // Check timestamp age
    if (Date.now() - timestamp > maxAge) {
      return false;
    }

    const expectedSignature = this.sign(payload, timestamp);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }
}

// 339. Content Hash Cache Key Generator
export function generateCacheKey(prefix: string, params: Record<string, any>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {} as Record<string, any>);

  const hash = crypto
    .createHash('md5')
    .update(JSON.stringify(sortedParams))
    .digest('hex');

  return `${prefix}:${hash}`;
}

// 340. Stale-While-Revalidate Cache
export class SWRCache<T> {
  private cache: Map<string, { value: T; staleAt: number; expiresAt: number }> = new Map();
  private revalidating: Set<string> = new Set();

  async get(
    key: string,
    fetcher: () => Promise<T>,
    options: { staleTime: number; maxAge: number }
  ): Promise<T> {
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached) {
      // Fresh data
      if (now < cached.staleAt) {
        return cached.value;
      }

      // Stale but not expired - return stale and revalidate
      if (now < cached.expiresAt) {
        this.revalidate(key, fetcher, options);
        return cached.value;
      }
    }

    // No cache or expired - fetch new
    const value = await fetcher();
    this.cache.set(key, {
      value,
      staleAt: now + options.staleTime,
      expiresAt: now + options.maxAge
    });

    return value;
  }

  private async revalidate(
    key: string,
    fetcher: () => Promise<T>,
    options: { staleTime: number; maxAge: number }
  ): Promise<void> {
    if (this.revalidating.has(key)) return;

    this.revalidating.add(key);

    try {
      const now = Date.now();
      const value = await fetcher();
      this.cache.set(key, {
        value,
        staleAt: now + options.staleTime,
        expiresAt: now + options.maxAge
      });
    } finally {
      this.revalidating.delete(key);
    }
  }
}

// Export all
export {
  SlidingWindowConfig,
  IPReputation,
  RequestFingerprint,
  BruteForceConfig,
  SecurityHeadersConfig,
  CacheEntry,
  HTTPCacheOptions,
  SessionSecurityConfig
};
