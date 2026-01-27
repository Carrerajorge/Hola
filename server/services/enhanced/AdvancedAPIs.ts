/**
 * Advanced APIs Enhancements (301-320)
 * Advanced API patterns and utilities
 */

import { Request, Response, NextFunction, Router } from 'express';
import { EventEmitter } from 'events';

// ============================================
// 301. API Versioning System
// ============================================
interface VersionConfig {
  version: string;
  deprecated?: boolean;
  sunset?: Date;
  handler: Router;
}

export class APIVersionManager {
  private versions: Map<string, VersionConfig> = new Map();
  private defaultVersion: string = 'v1';

  registerVersion(config: VersionConfig): void {
    this.versions.set(config.version, config);
  }

  setDefaultVersion(version: string): void {
    this.defaultVersion = version;
  }

  getMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Extract version from URL, header, or query param
      let version = this.extractVersion(req);

      if (!version) {
        version = this.defaultVersion;
      }

      const versionConfig = this.versions.get(version);

      if (!versionConfig) {
        return res.status(404).json({
          error: 'API_VERSION_NOT_FOUND',
          message: `API version ${version} not found`,
          availableVersions: Array.from(this.versions.keys())
        });
      }

      if (versionConfig.deprecated) {
        res.setHeader('X-API-Deprecated', 'true');
        if (versionConfig.sunset) {
          res.setHeader('Sunset', versionConfig.sunset.toUTCString());
        }
      }

      res.setHeader('X-API-Version', version);
      (req as any).apiVersion = version;
      next();
    };
  }

  private extractVersion(req: Request): string | null {
    // Check URL path
    const pathMatch = req.path.match(/^\/(v\d+)/);
    if (pathMatch) return pathMatch[1];

    // Check header
    const headerVersion = req.headers['x-api-version'] as string;
    if (headerVersion) return headerVersion;

    // Check query param
    const queryVersion = req.query.version as string;
    if (queryVersion) return queryVersion;

    return null;
  }

  getRouter(): Router {
    const router = Router();

    for (const [version, config] of this.versions) {
      router.use(`/${version}`, config.handler);
    }

    return router;
  }
}

// ============================================
// 302. GraphQL-like Field Selection
// ============================================
interface FieldSelection {
  include: string[];
  exclude: string[];
  nested: Record<string, FieldSelection>;
}

export function parseFieldSelection(fields?: string): FieldSelection | null {
  if (!fields) return null;

  const selection: FieldSelection = {
    include: [],
    exclude: [],
    nested: {}
  };

  const parts = fields.split(',').map(f => f.trim());

  for (const part of parts) {
    if (part.startsWith('-')) {
      selection.exclude.push(part.slice(1));
    } else if (part.includes('.')) {
      const [parent, ...rest] = part.split('.');
      if (!selection.nested[parent]) {
        selection.nested[parent] = { include: [], exclude: [], nested: {} };
      }
      selection.nested[parent].include.push(rest.join('.'));
    } else {
      selection.include.push(part);
    }
  }

  return selection;
}

export function applyFieldSelection<T extends Record<string, any>>(
  data: T,
  selection: FieldSelection | null
): Partial<T> {
  if (!selection) return data;

  const result: any = {};

  // If include is specified, only include those fields
  const keysToInclude = selection.include.length > 0
    ? selection.include
    : Object.keys(data);

  for (const key of keysToInclude) {
    if (selection.exclude.includes(key)) continue;
    if (!(key in data)) continue;

    const value = data[key];

    if (selection.nested[key] && typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        result[key] = value.map(item =>
          applyFieldSelection(item, selection.nested[key])
        );
      } else {
        result[key] = applyFieldSelection(value, selection.nested[key]);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function fieldSelectionMiddleware(req: Request, res: Response, next: NextFunction) {
  const fields = req.query.fields as string;
  (req as any).fieldSelection = parseFieldSelection(fields);
  next();
}

// ============================================
// 303. Pagination Helper
// ============================================
interface PaginationOptions {
  defaultLimit?: number;
  maxLimit?: number;
  defaultSort?: string;
  allowedSortFields?: string[];
}

interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
  sort: string;
  order: 'asc' | 'desc';
}

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
  links: {
    first: string;
    last: string;
    next: string | null;
    prev: string | null;
  };
}

export function parsePagination(
  query: any,
  options: PaginationOptions = {}
): PaginationParams {
  const {
    defaultLimit = 20,
    maxLimit = 100,
    defaultSort = 'createdAt',
    allowedSortFields = ['createdAt', 'updatedAt', 'id']
  } = options;

  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit) || defaultLimit));
  const offset = (page - 1) * limit;

  let sort = query.sort || defaultSort;
  if (!allowedSortFields.includes(sort.replace(/^-/, ''))) {
    sort = defaultSort;
  }

  const order: 'asc' | 'desc' = sort.startsWith('-') ? 'desc' : 'asc';
  sort = sort.replace(/^-/, '');

  return { page, limit, offset, sort, order };
}

export function createPaginatedResponse<T>(
  data: T[],
  totalItems: number,
  params: PaginationParams,
  baseUrl: string
): PaginatedResponse<T> {
  const totalPages = Math.ceil(totalItems / params.limit);

  const buildUrl = (page: number) => {
    const url = new URL(baseUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(params.limit));
    if (params.sort !== 'createdAt') {
      url.searchParams.set('sort', params.order === 'desc' ? `-${params.sort}` : params.sort);
    }
    return url.toString();
  };

  return {
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      totalItems,
      totalPages,
      hasNextPage: params.page < totalPages,
      hasPrevPage: params.page > 1
    },
    links: {
      first: buildUrl(1),
      last: buildUrl(totalPages),
      next: params.page < totalPages ? buildUrl(params.page + 1) : null,
      prev: params.page > 1 ? buildUrl(params.page - 1) : null
    }
  };
}

// ============================================
// 304. Request Transformation Pipeline
// ============================================
type TransformFn<T = any> = (data: T, req: Request) => T | Promise<T>;

export class RequestTransformer {
  private transforms: Map<string, TransformFn[]> = new Map();

  addTransform(path: string, transform: TransformFn): void {
    if (!this.transforms.has(path)) {
      this.transforms.set(path, []);
    }
    this.transforms.get(path)!.push(transform);
  }

  async transform(path: string, data: any, req: Request): Promise<any> {
    const transforms = this.transforms.get(path) || [];
    let result = data;

    for (const transform of transforms) {
      result = await transform(result, req);
    }

    return result;
  }

  getMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      if (req.body && Object.keys(req.body).length > 0) {
        try {
          req.body = await this.transform(req.path, req.body, req);
        } catch (error) {
          return next(error);
        }
      }
      next();
    };
  }
}

// ============================================
// 305. Response Transformer
// ============================================
export class ResponseTransformer {
  private transforms: TransformFn[] = [];

  addTransform(transform: TransformFn): void {
    this.transforms.push(transform);
  }

  async transform(data: any, req: Request): Promise<any> {
    let result = data;

    for (const transform of this.transforms) {
      result = await transform(result, req);
    }

    return result;
  }

  getMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const originalJson = res.json.bind(res);

      res.json = (data: any) => {
        this.transform(data, req)
          .then(transformed => originalJson(transformed))
          .catch(next);
        return res;
      };

      next();
    };
  }
}

// ============================================
// 306. Request Validation Schema Builder
// ============================================
type ValidationType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'email' | 'url' | 'uuid' | 'date';

interface ValidationRule {
  type: ValidationType;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
  items?: ValidationRule;
  properties?: Record<string, ValidationRule>;
  custom?: (value: any) => boolean | string;
}

interface ValidationSchema {
  body?: Record<string, ValidationRule>;
  query?: Record<string, ValidationRule>;
  params?: Record<string, ValidationRule>;
}

export function validateValue(value: any, rule: ValidationRule, fieldName: string): string | null {
  if (value === undefined || value === null) {
    if (rule.required) return `${fieldName} is required`;
    return null;
  }

  switch (rule.type) {
    case 'string':
      if (typeof value !== 'string') return `${fieldName} must be a string`;
      if (rule.min && value.length < rule.min) return `${fieldName} must be at least ${rule.min} characters`;
      if (rule.max && value.length > rule.max) return `${fieldName} must be at most ${rule.max} characters`;
      if (rule.pattern && !rule.pattern.test(value)) return `${fieldName} has invalid format`;
      break;

    case 'number':
      const num = Number(value);
      if (isNaN(num)) return `${fieldName} must be a number`;
      if (rule.min !== undefined && num < rule.min) return `${fieldName} must be at least ${rule.min}`;
      if (rule.max !== undefined && num > rule.max) return `${fieldName} must be at most ${rule.max}`;
      break;

    case 'boolean':
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        return `${fieldName} must be a boolean`;
      }
      break;

    case 'email':
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) return `${fieldName} must be a valid email`;
      break;

    case 'url':
      try {
        new URL(value);
      } catch {
        return `${fieldName} must be a valid URL`;
      }
      break;

    case 'uuid':
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(value)) return `${fieldName} must be a valid UUID`;
      break;

    case 'date':
      if (isNaN(Date.parse(value))) return `${fieldName} must be a valid date`;
      break;

    case 'array':
      if (!Array.isArray(value)) return `${fieldName} must be an array`;
      if (rule.min && value.length < rule.min) return `${fieldName} must have at least ${rule.min} items`;
      if (rule.max && value.length > rule.max) return `${fieldName} must have at most ${rule.max} items`;
      if (rule.items) {
        for (let i = 0; i < value.length; i++) {
          const itemError = validateValue(value[i], rule.items, `${fieldName}[${i}]`);
          if (itemError) return itemError;
        }
      }
      break;

    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) return `${fieldName} must be an object`;
      if (rule.properties) {
        for (const [key, propRule] of Object.entries(rule.properties)) {
          const propError = validateValue(value[key], propRule, `${fieldName}.${key}`);
          if (propError) return propError;
        }
      }
      break;
  }

  if (rule.enum && !rule.enum.includes(value)) {
    return `${fieldName} must be one of: ${rule.enum.join(', ')}`;
  }

  if (rule.custom) {
    const customResult = rule.custom(value);
    if (typeof customResult === 'string') return customResult;
    if (customResult === false) return `${fieldName} failed custom validation`;
  }

  return null;
}

export function createValidator(schema: ValidationSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];

    const validate = (data: any, rules: Record<string, ValidationRule>) => {
      for (const [field, rule] of Object.entries(rules)) {
        const error = validateValue(data[field], rule, field);
        if (error) errors.push(error);
      }
    };

    if (schema.body) validate(req.body, schema.body);
    if (schema.query) validate(req.query, schema.query);
    if (schema.params) validate(req.params, schema.params);

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: errors
      });
    }

    next();
  };
}

// ============================================
// 307. API Rate Limiting with Token Bucket
// ============================================
interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export class TokenBucketRateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  private maxTokens: number;
  private refillRate: number; // tokens per second
  private refillInterval: number;

  constructor(maxTokens: number = 100, refillRate: number = 10) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.refillInterval = 1000 / refillRate;

    // Cleanup old buckets periodically
    setInterval(() => this.cleanup(), 60000);
  }

  consume(key: string, tokens: number = 1): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens
    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(timePassed / this.refillInterval);
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    // Try to consume
    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return {
        allowed: true,
        remaining: bucket.tokens,
        resetMs: this.refillInterval * (this.maxTokens - bucket.tokens)
      };
    }

    return {
      allowed: false,
      remaining: bucket.tokens,
      resetMs: this.refillInterval * (tokens - bucket.tokens)
    };
  }

  private cleanup(): void {
    const now = Date.now();
    const maxAge = 300000; // 5 minutes

    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > maxAge) {
        this.buckets.delete(key);
      }
    }
  }

  getMiddleware(keyExtractor: (req: Request) => string = (req) => req.ip || 'unknown') {
    return (req: Request, res: Response, next: NextFunction) => {
      const key = keyExtractor(req);
      const result = this.consume(key);

      res.setHeader('X-RateLimit-Limit', this.maxTokens);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + result.resetMs / 1000));

      if (!result.allowed) {
        return res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
          retryAfter: Math.ceil(result.resetMs / 1000)
        });
      }

      next();
    };
  }
}

// ============================================
// 308. API Key Management
// ============================================
interface APIKey {
  key: string;
  name: string;
  userId: string;
  permissions: string[];
  rateLimit?: number;
  expiresAt?: Date;
  createdAt: Date;
  lastUsedAt?: Date;
}

export class APIKeyManager {
  private keys: Map<string, APIKey> = new Map();
  private events = new EventEmitter();

  generateKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const prefix = 'sk_';
    let key = prefix;
    for (let i = 0; i < 32; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  }

  createKey(config: Omit<APIKey, 'key' | 'createdAt'>): APIKey {
    const key = this.generateKey();
    const apiKey: APIKey = {
      ...config,
      key,
      createdAt: new Date()
    };
    this.keys.set(key, apiKey);
    this.events.emit('keyCreated', apiKey);
    return apiKey;
  }

  validateKey(key: string): APIKey | null {
    const apiKey = this.keys.get(key);

    if (!apiKey) return null;

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return null;
    }

    apiKey.lastUsedAt = new Date();
    this.events.emit('keyUsed', apiKey);
    return apiKey;
  }

  revokeKey(key: string): boolean {
    const existed = this.keys.delete(key);
    if (existed) {
      this.events.emit('keyRevoked', key);
    }
    return existed;
  }

  hasPermission(key: string, permission: string): boolean {
    const apiKey = this.keys.get(key);
    if (!apiKey) return false;
    return apiKey.permissions.includes('*') || apiKey.permissions.includes(permission);
  }

  getMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'API key required'
        });
      }

      const key = authHeader.slice(7);
      const apiKey = this.validateKey(key);

      if (!apiKey) {
        return res.status(401).json({
          error: 'INVALID_API_KEY',
          message: 'Invalid or expired API key'
        });
      }

      (req as any).apiKey = apiKey;
      next();
    };
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 309. Webhook Delivery System
// ============================================
interface WebhookConfig {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  retryPolicy: {
    maxRetries: number;
    backoffMs: number;
  };
}

interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: any;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  lastAttemptAt?: Date;
  responseStatus?: number;
  responseBody?: string;
}

export class WebhookDeliverySystem {
  private webhooks: Map<string, WebhookConfig> = new Map();
  private deliveries: Map<string, WebhookDelivery> = new Map();
  private events = new EventEmitter();

  registerWebhook(config: WebhookConfig): void {
    this.webhooks.set(config.id, config);
  }

  unregisterWebhook(id: string): void {
    this.webhooks.delete(id);
  }

  async deliver(event: string, payload: any): Promise<void> {
    const relevantWebhooks = Array.from(this.webhooks.values())
      .filter(w => w.active && w.events.includes(event));

    for (const webhook of relevantWebhooks) {
      const delivery: WebhookDelivery = {
        id: `del_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        webhookId: webhook.id,
        event,
        payload,
        status: 'pending',
        attempts: 0
      };

      this.deliveries.set(delivery.id, delivery);
      this.attemptDelivery(delivery, webhook);
    }
  }

  private async attemptDelivery(delivery: WebhookDelivery, webhook: WebhookConfig): Promise<void> {
    delivery.attempts++;
    delivery.lastAttemptAt = new Date();

    try {
      const signature = this.generateSignature(delivery.payload, webhook.secret);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': delivery.event,
          'X-Webhook-Delivery': delivery.id
        },
        body: JSON.stringify(delivery.payload)
      });

      delivery.responseStatus = response.status;
      delivery.responseBody = await response.text();

      if (response.ok) {
        delivery.status = 'success';
        this.events.emit('deliverySuccess', delivery);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      if (delivery.attempts < webhook.retryPolicy.maxRetries) {
        const backoff = webhook.retryPolicy.backoffMs * Math.pow(2, delivery.attempts - 1);
        setTimeout(() => this.attemptDelivery(delivery, webhook), backoff);
      } else {
        delivery.status = 'failed';
        this.events.emit('deliveryFailed', delivery);
      }
    }
  }

  private generateSignature(payload: any, secret: string): string {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return `sha256=${hmac.digest('hex')}`;
  }

  getDeliveryStatus(id: string): WebhookDelivery | undefined {
    return this.deliveries.get(id);
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 310. HATEOAS Link Builder
// ============================================
interface HATEOASLink {
  href: string;
  rel: string;
  method: string;
  title?: string;
}

export class HATEOASBuilder {
  private baseUrl: string;
  private links: HATEOASLink[] = [];

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  self(path: string): this {
    this.links.push({
      href: `${this.baseUrl}${path}`,
      rel: 'self',
      method: 'GET'
    });
    return this;
  }

  link(rel: string, path: string, method: string = 'GET', title?: string): this {
    this.links.push({
      href: `${this.baseUrl}${path}`,
      rel,
      method,
      title
    });
    return this;
  }

  collection(path: string): this {
    this.links.push({
      href: `${this.baseUrl}${path}`,
      rel: 'collection',
      method: 'GET'
    });
    return this;
  }

  create(path: string): this {
    this.links.push({
      href: `${this.baseUrl}${path}`,
      rel: 'create',
      method: 'POST'
    });
    return this;
  }

  update(path: string): this {
    this.links.push({
      href: `${this.baseUrl}${path}`,
      rel: 'update',
      method: 'PUT'
    });
    return this;
  }

  delete(path: string): this {
    this.links.push({
      href: `${this.baseUrl}${path}`,
      rel: 'delete',
      method: 'DELETE'
    });
    return this;
  }

  pagination(basePath: string, page: number, totalPages: number): this {
    if (page > 1) {
      this.link('first', `${basePath}?page=1`);
      this.link('prev', `${basePath}?page=${page - 1}`);
    }
    if (page < totalPages) {
      this.link('next', `${basePath}?page=${page + 1}`);
      this.link('last', `${basePath}?page=${totalPages}`);
    }
    return this;
  }

  build(): HATEOASLink[] {
    return [...this.links];
  }

  toObject(): Record<string, HATEOASLink> {
    return this.links.reduce((acc, link) => {
      acc[link.rel] = link;
      return acc;
    }, {} as Record<string, HATEOASLink>);
  }
}

// ============================================
// 311-320: Additional API Utilities
// ============================================

// 311. Bulk Operations Handler
export class BulkOperationHandler<T> {
  private batchSize: number;
  private processor: (items: T[]) => Promise<any[]>;

  constructor(processor: (items: T[]) => Promise<any[]>, batchSize: number = 100) {
    this.processor = processor;
    this.batchSize = batchSize;
  }

  async process(items: T[]): Promise<{ success: any[]; errors: { item: T; error: string }[] }> {
    const success: any[] = [];
    const errors: { item: T; error: string }[] = [];

    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);

      try {
        const results = await this.processor(batch);
        success.push(...results);
      } catch (error) {
        batch.forEach(item => {
          errors.push({ item, error: (error as Error).message });
        });
      }
    }

    return { success, errors };
  }
}

// 312. Content Negotiation
export function contentNegotiation(req: Request): string {
  const accept = req.headers.accept || 'application/json';

  const types = accept.split(',').map(t => {
    const [type, ...params] = t.trim().split(';');
    const q = params.find(p => p.trim().startsWith('q='));
    return {
      type: type.trim(),
      quality: q ? parseFloat(q.split('=')[1]) : 1
    };
  }).sort((a, b) => b.quality - a.quality);

  const supported = ['application/json', 'application/xml', 'text/plain'];

  for (const { type } of types) {
    if (type === '*/*') return 'application/json';
    if (supported.includes(type)) return type;
  }

  return 'application/json';
}

// 313. ETag Generator
export function generateETag(data: any): string {
  const crypto = require('crypto');
  const hash = crypto.createHash('md5');
  hash.update(JSON.stringify(data));
  return `"${hash.digest('hex')}"`;
}

export function conditionalResponse(req: Request, res: Response, data: any): boolean {
  const etag = generateETag(data);
  res.setHeader('ETag', etag);

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch === etag) {
    res.status(304).end();
    return true;
  }

  return false;
}

// 314. Request Coalescing
export class RequestCoalescer {
  private pending: Map<string, Promise<any>> = new Map();

  async coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.pending.has(key)) {
      return this.pending.get(key)!;
    }

    const promise = fn().finally(() => {
      this.pending.delete(key);
    });

    this.pending.set(key, promise);
    return promise;
  }
}

// 315. API Response Envelope
interface APIEnvelope<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    requestId: string;
    version: string;
  };
}

export function createAPIEnvelope<T>(data: T, requestId: string): APIEnvelope<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      requestId,
      version: process.env.API_VERSION || '1.0.0'
    }
  };
}

export function createErrorEnvelope(code: string, message: string, details?: any, requestId?: string): APIEnvelope<never> {
  return {
    success: false,
    error: { code, message, details },
    meta: {
      timestamp: new Date().toISOString(),
      requestId: requestId || 'unknown',
      version: process.env.API_VERSION || '1.0.0'
    }
  };
}

// 316. Cursor-based Pagination
interface CursorPaginationParams {
  cursor?: string;
  limit: number;
  direction: 'forward' | 'backward';
}

export function parseCursorPagination(query: any, defaultLimit: number = 20): CursorPaginationParams {
  return {
    cursor: query.cursor as string | undefined,
    limit: Math.min(100, Math.max(1, parseInt(query.limit) || defaultLimit)),
    direction: query.direction === 'backward' ? 'backward' : 'forward'
  };
}

export function encodeCursor(data: Record<string, any>): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export function decodeCursor(cursor: string): Record<string, any> | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    return null;
  }
}

// 317. Request Timeout Handler
export function requestTimeout(timeoutMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          error: 'GATEWAY_TIMEOUT',
          message: 'Request timed out'
        });
      }
    }, timeoutMs);

    res.on('finish', () => clearTimeout(timeout));
    res.on('close', () => clearTimeout(timeout));

    next();
  };
}

// 318. Request Correlation ID
export function correlationId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.headers['x-correlation-id'] as string ||
               req.headers['x-request-id'] as string ||
               `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    (req as any).correlationId = id;
    res.setHeader('X-Correlation-ID', id);
    next();
  };
}

// 319. JSON Patch Support
interface JSONPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: any;
  from?: string;
}

export function applyJSONPatch<T extends Record<string, any>>(target: T, operations: JSONPatchOperation[]): T {
  const result = JSON.parse(JSON.stringify(target));

  for (const op of operations) {
    const pathParts = op.path.split('/').filter(Boolean);

    switch (op.op) {
      case 'add':
      case 'replace':
        setNestedValue(result, pathParts, op.value);
        break;
      case 'remove':
        removeNestedValue(result, pathParts);
        break;
      case 'move':
      case 'copy':
        if (op.from) {
          const fromParts = op.from.split('/').filter(Boolean);
          const value = getNestedValue(result, fromParts);
          if (op.op === 'move') {
            removeNestedValue(result, fromParts);
          }
          setNestedValue(result, pathParts, value);
        }
        break;
    }
  }

  return result;
}

function getNestedValue(obj: any, path: string[]): any {
  return path.reduce((curr, key) => curr?.[key], obj);
}

function setNestedValue(obj: any, path: string[], value: any): void {
  const lastKey = path.pop()!;
  const parent = path.reduce((curr, key) => {
    if (!curr[key]) curr[key] = {};
    return curr[key];
  }, obj);
  parent[lastKey] = value;
}

function removeNestedValue(obj: any, path: string[]): void {
  const lastKey = path.pop()!;
  const parent = path.reduce((curr, key) => curr?.[key], obj);
  if (parent) delete parent[lastKey];
}

// 320. API Deprecation Helper
export function deprecated(message: string, sunset?: Date) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Deprecation', 'true');
    res.setHeader('X-Deprecation-Message', message);
    if (sunset) {
      res.setHeader('Sunset', sunset.toUTCString());
    }
    next();
  };
}

// Export all
export {
  VersionConfig,
  FieldSelection,
  PaginationOptions,
  PaginationParams,
  PaginatedResponse,
  ValidationRule,
  ValidationSchema,
  APIKey,
  WebhookConfig,
  WebhookDelivery,
  HATEOASLink,
  APIEnvelope,
  CursorPaginationParams,
  JSONPatchOperation
};
