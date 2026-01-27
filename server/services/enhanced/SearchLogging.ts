/**
 * Search & Logging Enhancements (381-400)
 * Advanced search capabilities and structured logging
 */

import { EventEmitter } from 'events';

// ============================================
// 381. Full-Text Search Engine
// ============================================
interface SearchDocument {
  id: string;
  content: Record<string, any>;
  index: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SearchResult {
  id: string;
  score: number;
  highlights: Record<string, string[]>;
  document: Record<string, any>;
}

interface SearchQuery {
  query: string;
  fields?: string[];
  filters?: Record<string, any>;
  sort?: { field: string; order: 'asc' | 'desc' }[];
  page?: number;
  limit?: number;
  highlight?: boolean;
}

export class SearchEngine {
  private indices: Map<string, Map<string, SearchDocument>> = new Map();
  private invertedIndex: Map<string, Map<string, Set<string>>> = new Map(); // term -> index -> docIds
  private events = new EventEmitter();

  createIndex(name: string): void {
    if (!this.indices.has(name)) {
      this.indices.set(name, new Map());
      this.invertedIndex.set(name, new Map());
      this.events.emit('index:created', { name });
    }
  }

  async index(indexName: string, id: string, content: Record<string, any>): Promise<void> {
    let index = this.indices.get(indexName);
    if (!index) {
      this.createIndex(indexName);
      index = this.indices.get(indexName)!;
    }

    const doc: SearchDocument = {
      id,
      content,
      index: indexName,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Remove old document from inverted index
    const existing = index.get(id);
    if (existing) {
      this.removeFromInvertedIndex(indexName, id, existing.content);
    }

    // Add to document store
    index.set(id, doc);

    // Add to inverted index
    this.addToInvertedIndex(indexName, id, content);

    this.events.emit('document:indexed', { index: indexName, id });
  }

  private addToInvertedIndex(indexName: string, docId: string, content: Record<string, any>): void {
    const invertedIndex = this.invertedIndex.get(indexName)!;
    const terms = this.extractTerms(content);

    for (const term of terms) {
      if (!invertedIndex.has(term)) {
        invertedIndex.set(term, new Set());
      }
      invertedIndex.get(term)!.add(docId);
    }
  }

  private removeFromInvertedIndex(indexName: string, docId: string, content: Record<string, any>): void {
    const invertedIndex = this.invertedIndex.get(indexName);
    if (!invertedIndex) return;

    const terms = this.extractTerms(content);
    for (const term of terms) {
      invertedIndex.get(term)?.delete(docId);
    }
  }

  private extractTerms(content: Record<string, any>): string[] {
    const terms: string[] = [];

    const extract = (value: any) => {
      if (typeof value === 'string') {
        const words = value.toLowerCase().split(/\s+/);
        terms.push(...words.filter(w => w.length > 1));
      } else if (Array.isArray(value)) {
        value.forEach(extract);
      } else if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(extract);
      }
    };

    extract(content);
    return terms;
  }

  async search(indexName: string, query: SearchQuery): Promise<{ results: SearchResult[]; total: number }> {
    const index = this.indices.get(indexName);
    const invertedIndex = this.invertedIndex.get(indexName);
    if (!index || !invertedIndex) {
      return { results: [], total: 0 };
    }

    const queryTerms = query.query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const matchingDocIds = new Map<string, number>(); // docId -> score

    // Find matching documents
    for (const term of queryTerms) {
      const docIds = invertedIndex.get(term);
      if (docIds) {
        for (const docId of docIds) {
          matchingDocIds.set(docId, (matchingDocIds.get(docId) || 0) + 1);
        }
      }
    }

    // Score and filter
    let results: SearchResult[] = [];
    for (const [docId, termMatches] of matchingDocIds) {
      const doc = index.get(docId);
      if (!doc) continue;

      // Apply filters
      if (query.filters && !this.matchesFilters(doc.content, query.filters)) {
        continue;
      }

      // Calculate score (simple TF-IDF-like)
      const score = termMatches / queryTerms.length;

      // Generate highlights
      const highlights: Record<string, string[]> = {};
      if (query.highlight) {
        const fields = query.fields || Object.keys(doc.content);
        for (const field of fields) {
          const value = doc.content[field];
          if (typeof value === 'string') {
            const highlighted = this.generateHighlights(value, queryTerms);
            if (highlighted.length > 0) {
              highlights[field] = highlighted;
            }
          }
        }
      }

      results.push({
        id: docId,
        score,
        highlights,
        document: doc.content
      });
    }

    // Sort
    if (query.sort) {
      results.sort((a, b) => {
        for (const { field, order } of query.sort!) {
          const aVal = a.document[field];
          const bVal = b.document[field];
          const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
          if (cmp !== 0) return order === 'asc' ? cmp : -cmp;
        }
        return b.score - a.score; // Default: score desc
      });
    } else {
      results.sort((a, b) => b.score - a.score);
    }

    const total = results.length;

    // Paginate
    const page = query.page || 1;
    const limit = query.limit || 10;
    const offset = (page - 1) * limit;
    results = results.slice(offset, offset + limit);

    this.events.emit('search:executed', { index: indexName, query: query.query, results: results.length });
    return { results, total };
  }

  private matchesFilters(content: Record<string, any>, filters: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(filters)) {
      if (content[key] !== value) return false;
    }
    return true;
  }

  private generateHighlights(text: string, terms: string[]): string[] {
    const highlights: string[] = [];
    const sentences = text.split(/[.!?]+/);

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();
      if (terms.some(term => lower.includes(term))) {
        let highlighted = sentence;
        for (const term of terms) {
          highlighted = highlighted.replace(
            new RegExp(`(${term})`, 'gi'),
            '<mark>$1</mark>'
          );
        }
        highlights.push(highlighted.trim());
      }
    }

    return highlights.slice(0, 3); // Max 3 highlights
  }

  async delete(indexName: string, id: string): Promise<boolean> {
    const index = this.indices.get(indexName);
    if (!index) return false;

    const doc = index.get(id);
    if (!doc) return false;

    this.removeFromInvertedIndex(indexName, id, doc.content);
    index.delete(id);

    this.events.emit('document:deleted', { index: indexName, id });
    return true;
  }

  async deleteIndex(name: string): Promise<void> {
    this.indices.delete(name);
    this.invertedIndex.delete(name);
    this.events.emit('index:deleted', { name });
  }

  getStats(indexName?: string): { indices: number; documents: number; terms: number } | Record<string, any> {
    if (indexName) {
      const index = this.indices.get(indexName);
      const invertedIndex = this.invertedIndex.get(indexName);
      return {
        documents: index?.size || 0,
        terms: invertedIndex?.size || 0
      };
    }

    return {
      indices: this.indices.size,
      documents: Array.from(this.indices.values()).reduce((sum, idx) => sum + idx.size, 0),
      terms: Array.from(this.invertedIndex.values()).reduce((sum, idx) => sum + idx.size, 0)
    };
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 382. Autocomplete/Suggest Engine
// ============================================
interface Suggestion {
  text: string;
  score: number;
  metadata?: Record<string, any>;
}

export class AutocompleteEngine {
  private prefixTree: Map<string, Map<string, { text: string; score: number; metadata?: any }>> = new Map();
  private events = new EventEmitter();

  createIndex(name: string): void {
    if (!this.prefixTree.has(name)) {
      this.prefixTree.set(name, new Map());
    }
  }

  add(indexName: string, text: string, score: number = 1, metadata?: any): void {
    let index = this.prefixTree.get(indexName);
    if (!index) {
      this.createIndex(indexName);
      index = this.prefixTree.get(indexName)!;
    }

    const normalizedText = text.toLowerCase();

    // Add all prefixes
    for (let i = 1; i <= normalizedText.length; i++) {
      const prefix = normalizedText.slice(0, i);
      const existing = index.get(prefix);

      if (!existing || existing.score < score) {
        index.set(prefix, { text, score, metadata });
      }
    }

    // Also add word prefixes for multi-word texts
    const words = normalizedText.split(/\s+/);
    for (let wordIndex = 1; wordIndex < words.length; wordIndex++) {
      const suffix = words.slice(wordIndex).join(' ');
      for (let i = 1; i <= suffix.length; i++) {
        const prefix = suffix.slice(0, i);
        const existing = index.get(prefix);
        if (!existing || existing.score < score) {
          index.set(prefix, { text, score, metadata });
        }
      }
    }
  }

  suggest(indexName: string, prefix: string, limit: number = 10): Suggestion[] {
    const index = this.prefixTree.get(indexName);
    if (!index) return [];

    const normalizedPrefix = prefix.toLowerCase();
    const suggestions = new Map<string, Suggestion>();

    // Find all matching prefixes
    for (const [key, value] of index) {
      if (key.startsWith(normalizedPrefix)) {
        const existing = suggestions.get(value.text);
        if (!existing || existing.score < value.score) {
          suggestions.set(value.text, {
            text: value.text,
            score: value.score,
            metadata: value.metadata
          });
        }
      }
    }

    // Sort by score and limit
    return Array.from(suggestions.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  incrementScore(indexName: string, text: string, increment: number = 1): void {
    const index = this.prefixTree.get(indexName);
    if (!index) return;

    const normalizedText = text.toLowerCase();

    for (const [key, value] of index) {
      if (value.text.toLowerCase() === normalizedText) {
        value.score += increment;
      }
    }
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 383. Faceted Search
// ============================================
interface Facet {
  field: string;
  values: Array<{ value: any; count: number }>;
}

export class FacetedSearch {
  private searchEngine: SearchEngine;
  private facetFields: Map<string, Set<string>> = new Map(); // index -> fields

  constructor(searchEngine: SearchEngine) {
    this.searchEngine = searchEngine;
  }

  configureFacets(indexName: string, fields: string[]): void {
    this.facetFields.set(indexName, new Set(fields));
  }

  async searchWithFacets(
    indexName: string,
    query: SearchQuery
  ): Promise<{ results: SearchResult[]; total: number; facets: Facet[] }> {
    const searchResult = await this.searchEngine.search(indexName, {
      ...query,
      limit: 1000 // Get all for facet calculation
    });

    // Calculate facets
    const facetFields = this.facetFields.get(indexName) || new Set();
    const facets: Facet[] = [];

    for (const field of facetFields) {
      const valueCounts = new Map<any, number>();

      for (const result of searchResult.results) {
        const value = result.document[field];
        if (value !== undefined) {
          valueCounts.set(value, (valueCounts.get(value) || 0) + 1);
        }
      }

      facets.push({
        field,
        values: Array.from(valueCounts.entries())
          .map(([value, count]) => ({ value, count }))
          .sort((a, b) => b.count - a.count)
      });
    }

    // Apply pagination to results
    const page = query.page || 1;
    const limit = query.limit || 10;
    const offset = (page - 1) * limit;
    const paginatedResults = searchResult.results.slice(offset, offset + limit);

    return {
      results: paginatedResults,
      total: searchResult.total,
      facets
    };
  }
}

// ============================================
// 384. Search Analytics
// ============================================
interface SearchAnalyticsEntry {
  query: string;
  index: string;
  resultsCount: number;
  clickedResults: string[];
  timestamp: Date;
  userId?: string;
}

export class SearchAnalytics {
  private entries: SearchAnalyticsEntry[] = [];
  private popularQueries: Map<string, number> = new Map();
  private zeroResultQueries: Map<string, number> = new Map();
  private events = new EventEmitter();

  record(entry: Omit<SearchAnalyticsEntry, 'timestamp'>): void {
    const fullEntry: SearchAnalyticsEntry = {
      ...entry,
      timestamp: new Date()
    };

    this.entries.push(fullEntry);

    // Update popular queries
    const normalizedQuery = entry.query.toLowerCase().trim();
    this.popularQueries.set(normalizedQuery, (this.popularQueries.get(normalizedQuery) || 0) + 1);

    // Track zero result queries
    if (entry.resultsCount === 0) {
      this.zeroResultQueries.set(normalizedQuery, (this.zeroResultQueries.get(normalizedQuery) || 0) + 1);
    }

    this.events.emit('search:recorded', fullEntry);
  }

  recordClick(query: string, documentId: string): void {
    // Find recent search with this query
    const recentSearch = [...this.entries].reverse().find(
      e => e.query.toLowerCase() === query.toLowerCase() &&
           Date.now() - e.timestamp.getTime() < 300000 // 5 minutes
    );

    if (recentSearch && !recentSearch.clickedResults.includes(documentId)) {
      recentSearch.clickedResults.push(documentId);
      this.events.emit('click:recorded', { query, documentId });
    }
  }

  getPopularQueries(limit: number = 10): Array<{ query: string; count: number }> {
    return Array.from(this.popularQueries.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query, count]) => ({ query, count }));
  }

  getZeroResultQueries(limit: number = 10): Array<{ query: string; count: number }> {
    return Array.from(this.zeroResultQueries.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query, count]) => ({ query, count }));
  }

  getClickThroughRate(): number {
    if (this.entries.length === 0) return 0;

    const searchesWithClicks = this.entries.filter(e => e.clickedResults.length > 0).length;
    return searchesWithClicks / this.entries.length;
  }

  getStats(since?: Date): {
    totalSearches: number;
    uniqueQueries: number;
    zeroResultSearches: number;
    avgClickThroughRate: number;
  } {
    let entries = this.entries;
    if (since) {
      entries = entries.filter(e => e.timestamp >= since);
    }

    const uniqueQueries = new Set(entries.map(e => e.query.toLowerCase())).size;
    const zeroResultSearches = entries.filter(e => e.resultsCount === 0).length;
    const searchesWithClicks = entries.filter(e => e.clickedResults.length > 0).length;

    return {
      totalSearches: entries.length,
      uniqueQueries,
      zeroResultSearches,
      avgClickThroughRate: entries.length > 0 ? searchesWithClicks / entries.length : 0
    };
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 385. Structured Logger
// ============================================
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, any>;
  correlationId?: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

interface LoggerConfig {
  level: LogLevel;
  format: 'json' | 'text';
  outputs: Array<'console' | 'file' | 'remote'>;
  contextFields?: string[];
}

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5
};

export class StructuredLogger {
  private config: LoggerConfig;
  private defaultContext: Record<string, any> = {};
  private events = new EventEmitter();

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: config.level || 'info',
      format: config.format || 'json',
      outputs: config.outputs || ['console'],
      contextFields: config.contextFields || []
    };
  }

  setDefaultContext(context: Record<string, any>): void {
    this.defaultContext = { ...this.defaultContext, ...context };
  }

  child(context: Record<string, any>): StructuredLogger {
    const childLogger = new StructuredLogger(this.config);
    childLogger.setDefaultContext({ ...this.defaultContext, ...context });
    return childLogger;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  private formatEntry(entry: LogEntry): string {
    if (this.config.format === 'json') {
      return JSON.stringify(entry);
    }

    let text = `[${entry.timestamp.toISOString()}] ${entry.level.toUpperCase()}: ${entry.message}`;
    if (entry.context && Object.keys(entry.context).length > 0) {
      text += ` ${JSON.stringify(entry.context)}`;
    }
    if (entry.error) {
      text += `\n  Error: ${entry.error.message}`;
      if (entry.error.stack) {
        text += `\n  Stack: ${entry.error.stack}`;
      }
    }
    return text;
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context: { ...this.defaultContext, ...context },
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    };

    const formatted = this.formatEntry(entry);

    if (this.config.outputs.includes('console')) {
      const consoleFn = level === 'error' || level === 'fatal' ? console.error :
                       level === 'warn' ? console.warn :
                       level === 'debug' || level === 'trace' ? console.debug :
                       console.log;
      consoleFn(formatted);
    }

    this.events.emit('log', entry);
  }

  trace(message: string, context?: Record<string, any>): void {
    this.log('trace', message, context);
  }

  debug(message: string, context?: Record<string, any>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error, context?: Record<string, any>): void {
    this.log('error', message, context, error);
  }

  fatal(message: string, error?: Error, context?: Record<string, any>): void {
    this.log('fatal', message, context, error);
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 386. Request Logger
// ============================================
interface RequestLog {
  id: string;
  method: string;
  path: string;
  query: Record<string, any>;
  headers: Record<string, string>;
  body?: any;
  userId?: string;
  ip: string;
  userAgent?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  statusCode?: number;
  error?: string;
}

export class RequestLogger {
  private logs: Map<string, RequestLog> = new Map();
  private logger: StructuredLogger;
  private events = new EventEmitter();

  constructor(logger: StructuredLogger) {
    this.logger = logger;
  }

  start(request: Omit<RequestLog, 'id' | 'startTime'>): string {
    const id = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const log: RequestLog = {
      ...request,
      id,
      startTime: new Date()
    };

    this.logs.set(id, log);
    this.logger.debug('Request started', { requestId: id, method: request.method, path: request.path });

    return id;
  }

  end(id: string, statusCode: number, error?: string): void {
    const log = this.logs.get(id);
    if (!log) return;

    log.endTime = new Date();
    log.duration = log.endTime.getTime() - log.startTime.getTime();
    log.statusCode = statusCode;
    log.error = error;

    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    this.logger[level]('Request completed', {
      requestId: id,
      method: log.method,
      path: log.path,
      statusCode,
      duration: log.duration
    });

    this.events.emit('request:completed', log);

    // Cleanup old logs
    setTimeout(() => this.logs.delete(id), 300000); // 5 minutes
  }

  getLog(id: string): RequestLog | undefined {
    return this.logs.get(id);
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 387. Audit Logger
// ============================================
interface AuditEntry {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId: string;
  userIp?: string;
  oldValue?: any;
  newValue?: any;
  metadata?: Record<string, any>;
  timestamp: Date;
  success: boolean;
  errorMessage?: string;
}

export class AuditLogger {
  private entries: AuditEntry[] = [];
  private events = new EventEmitter();
  private retentionDays: number;

  constructor(retentionDays: number = 90) {
    this.retentionDays = retentionDays;

    // Cleanup old entries periodically
    setInterval(() => this.cleanup(), 24 * 60 * 60 * 1000);
  }

  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const fullEntry: AuditEntry = {
      ...entry,
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    };

    this.entries.push(fullEntry);
    this.events.emit('audit:logged', fullEntry);

    return fullEntry;
  }

  query(filters: {
    userId?: string;
    action?: string;
    resource?: string;
    resourceId?: string;
    from?: Date;
    to?: Date;
    success?: boolean;
  }): AuditEntry[] {
    return this.entries.filter(entry => {
      if (filters.userId && entry.userId !== filters.userId) return false;
      if (filters.action && entry.action !== filters.action) return false;
      if (filters.resource && entry.resource !== filters.resource) return false;
      if (filters.resourceId && entry.resourceId !== filters.resourceId) return false;
      if (filters.from && entry.timestamp < filters.from) return false;
      if (filters.to && entry.timestamp > filters.to) return false;
      if (filters.success !== undefined && entry.success !== filters.success) return false;
      return true;
    });
  }

  getResourceHistory(resource: string, resourceId: string): AuditEntry[] {
    return this.entries
      .filter(e => e.resource === resource && e.resourceId === resourceId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  getUserActivity(userId: string, limit: number = 100): AuditEntry[] {
    return this.entries
      .filter(e => e.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  private cleanup(): void {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    this.entries = this.entries.filter(e => e.timestamp > cutoff);
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 388. Error Tracking
// ============================================
interface TrackedError {
  id: string;
  name: string;
  message: string;
  stack?: string;
  fingerprint: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  context: Array<{
    timestamp: Date;
    userId?: string;
    requestId?: string;
    metadata?: Record<string, any>;
  }>;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export class ErrorTracker {
  private errors: Map<string, TrackedError> = new Map();
  private events = new EventEmitter();
  private maxContextPerError: number;

  constructor(maxContextPerError: number = 10) {
    this.maxContextPerError = maxContextPerError;
  }

  private generateFingerprint(error: Error): string {
    // Create a fingerprint based on error type and location
    const stackLines = (error.stack || '').split('\n').slice(0, 3);
    return `${error.name}:${error.message}:${stackLines.join('|')}`;
  }

  track(error: Error, context?: { userId?: string; requestId?: string; metadata?: Record<string, any> }): TrackedError {
    const fingerprint = this.generateFingerprint(error);
    let tracked = this.errors.get(fingerprint);

    if (tracked) {
      tracked.count++;
      tracked.lastSeen = new Date();
      tracked.context.unshift({
        timestamp: new Date(),
        ...context
      });

      // Limit context array
      if (tracked.context.length > this.maxContextPerError) {
        tracked.context.pop();
      }
    } else {
      tracked = {
        id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: error.name,
        message: error.message,
        stack: error.stack,
        fingerprint,
        count: 1,
        firstSeen: new Date(),
        lastSeen: new Date(),
        context: context ? [{
          timestamp: new Date(),
          ...context
        }] : [],
        resolved: false
      };
      this.errors.set(fingerprint, tracked);
    }

    this.events.emit('error:tracked', tracked);
    return tracked;
  }

  resolve(fingerprint: string, userId: string): boolean {
    const error = this.errors.get(fingerprint);
    if (!error) return false;

    error.resolved = true;
    error.resolvedAt = new Date();
    error.resolvedBy = userId;

    this.events.emit('error:resolved', error);
    return true;
  }

  unresolve(fingerprint: string): boolean {
    const error = this.errors.get(fingerprint);
    if (!error) return false;

    error.resolved = false;
    error.resolvedAt = undefined;
    error.resolvedBy = undefined;

    return true;
  }

  getUnresolved(limit: number = 50): TrackedError[] {
    return Array.from(this.errors.values())
      .filter(e => !e.resolved)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getTopErrors(limit: number = 10, since?: Date): TrackedError[] {
    let errors = Array.from(this.errors.values());

    if (since) {
      errors = errors.filter(e => e.lastSeen >= since);
    }

    return errors
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getStats(): {
    total: number;
    unresolved: number;
    totalOccurrences: number;
    recentErrors: number;
  } {
    const errors = Array.from(this.errors.values());
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return {
      total: errors.length,
      unresolved: errors.filter(e => !e.resolved).length,
      totalOccurrences: errors.reduce((sum, e) => sum + e.count, 0),
      recentErrors: errors.filter(e => e.lastSeen >= oneDayAgo).length
    };
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 389. Performance Logger
// ============================================
interface PerformanceEntry {
  name: string;
  duration: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export class PerformanceLogger {
  private entries: PerformanceEntry[] = [];
  private timers: Map<string, number> = new Map();
  private events = new EventEmitter();
  private maxEntries: number;

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;
  }

  startTimer(name: string): void {
    this.timers.set(name, performance.now());
  }

  endTimer(name: string, metadata?: Record<string, any>): number {
    const startTime = this.timers.get(name);
    if (!startTime) return -1;

    const duration = performance.now() - startTime;
    this.timers.delete(name);

    this.record(name, duration, metadata);
    return duration;
  }

  record(name: string, duration: number, metadata?: Record<string, any>): void {
    const entry: PerformanceEntry = {
      name,
      duration,
      timestamp: new Date(),
      metadata
    };

    this.entries.push(entry);

    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    this.events.emit('performance:recorded', entry);
  }

  measure<T>(name: string, fn: () => T, metadata?: Record<string, any>): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.record(name, performance.now() - start, metadata);
    }
  }

  async measureAsync<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, any>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.record(name, performance.now() - start, metadata);
    }
  }

  getStats(name: string, since?: Date): {
    count: number;
    avg: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    let entries = this.entries.filter(e => e.name === name);
    if (since) {
      entries = entries.filter(e => e.timestamp >= since);
    }

    if (entries.length === 0) return null;

    const durations = entries.map(e => e.duration).sort((a, b) => a - b);

    return {
      count: durations.length,
      avg: durations.reduce((a, b) => a + b, 0) / durations.length,
      min: durations[0],
      max: durations[durations.length - 1],
      p50: this.percentile(durations, 50),
      p95: this.percentile(durations, 95),
      p99: this.percentile(durations, 99)
    };
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
}

// ============================================
// 390-400: Additional Utilities
// ============================================

// 390. Log Aggregator
export class LogAggregator {
  private logs: Map<string, LogEntry[]> = new Map();
  private maxLogsPerSource: number;

  constructor(maxLogsPerSource: number = 1000) {
    this.maxLogsPerSource = maxLogsPerSource;
  }

  add(source: string, entry: LogEntry): void {
    if (!this.logs.has(source)) {
      this.logs.set(source, []);
    }

    const sourceLogs = this.logs.get(source)!;
    sourceLogs.push(entry);

    if (sourceLogs.length > this.maxLogsPerSource) {
      sourceLogs.shift();
    }
  }

  query(options: {
    source?: string;
    level?: LogLevel;
    from?: Date;
    to?: Date;
    search?: string;
    limit?: number;
  }): LogEntry[] {
    let results: LogEntry[] = [];

    const sources = options.source ? [options.source] : Array.from(this.logs.keys());

    for (const source of sources) {
      const sourceLogs = this.logs.get(source) || [];
      results.push(...sourceLogs);
    }

    if (options.level) {
      const minLevel = LOG_LEVELS[options.level];
      results = results.filter(e => LOG_LEVELS[e.level] >= minLevel);
    }

    if (options.from) {
      results = results.filter(e => e.timestamp >= options.from!);
    }

    if (options.to) {
      results = results.filter(e => e.timestamp <= options.to!);
    }

    if (options.search) {
      const searchLower = options.search.toLowerCase();
      results = results.filter(e =>
        e.message.toLowerCase().includes(searchLower) ||
        JSON.stringify(e.context).toLowerCase().includes(searchLower)
      );
    }

    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return results.slice(0, options.limit || 100);
  }

  getSources(): string[] {
    return Array.from(this.logs.keys());
  }

  clear(source?: string): void {
    if (source) {
      this.logs.delete(source);
    } else {
      this.logs.clear();
    }
  }
}

// 391. Search Query Parser
export function parseSearchQuery(queryString: string): {
  terms: string[];
  phrases: string[];
  filters: Record<string, string>;
  exclude: string[];
} {
  const result = {
    terms: [] as string[],
    phrases: [] as string[],
    filters: {} as Record<string, string>,
    exclude: [] as string[]
  };

  // Extract quoted phrases
  const phraseMatches = queryString.match(/"[^"]+"/g) || [];
  for (const match of phraseMatches) {
    result.phrases.push(match.slice(1, -1));
    queryString = queryString.replace(match, '');
  }

  // Extract filters (field:value)
  const filterMatches = queryString.match(/\w+:\w+/g) || [];
  for (const match of filterMatches) {
    const [field, value] = match.split(':');
    result.filters[field] = value;
    queryString = queryString.replace(match, '');
  }

  // Extract excluded terms (-term)
  const excludeMatches = queryString.match(/-\w+/g) || [];
  for (const match of excludeMatches) {
    result.exclude.push(match.slice(1));
    queryString = queryString.replace(match, '');
  }

  // Remaining words are terms
  result.terms = queryString.split(/\s+/).filter(t => t.length > 0);

  return result;
}

// 392. Log Formatter
export function formatLogEntry(entry: LogEntry, format: 'json' | 'text' | 'csv'): string {
  switch (format) {
    case 'json':
      return JSON.stringify(entry);

    case 'text':
      return `[${entry.timestamp.toISOString()}] [${entry.level.toUpperCase()}] ${entry.message}` +
             (entry.context ? ` ${JSON.stringify(entry.context)}` : '') +
             (entry.error ? `\n  Error: ${entry.error.message}` : '');

    case 'csv':
      return [
        entry.timestamp.toISOString(),
        entry.level,
        `"${entry.message.replace(/"/g, '""')}"`,
        entry.context ? `"${JSON.stringify(entry.context).replace(/"/g, '""')}"` : '',
        entry.error?.message || ''
      ].join(',');

    default:
      return JSON.stringify(entry);
  }
}

// 393. Correlation ID Generator
export function generateCorrelationId(): string {
  return `cid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 394. Log Sampler
export class LogSampler {
  private sampleRates: Map<string, number> = new Map();
  private counters: Map<string, number> = new Map();

  setSampleRate(key: string, rate: number): void {
    this.sampleRates.set(key, Math.max(0, Math.min(1, rate)));
  }

  shouldSample(key: string): boolean {
    const rate = this.sampleRates.get(key) ?? 1;
    if (rate >= 1) return true;
    if (rate <= 0) return false;

    const count = (this.counters.get(key) || 0) + 1;
    this.counters.set(key, count);

    return (count % Math.ceil(1 / rate)) === 0;
  }
}

// 395. Search Result Ranker
export function rankSearchResults(
  results: SearchResult[],
  options: {
    boostRecent?: boolean;
    boostField?: string;
    boostValue?: any;
  } = {}
): SearchResult[] {
  return results.map(result => {
    let boostedScore = result.score;

    if (options.boostRecent && result.document.createdAt) {
      const age = Date.now() - new Date(result.document.createdAt).getTime();
      const daysSinceCreation = age / (24 * 60 * 60 * 1000);
      boostedScore *= Math.exp(-daysSinceCreation / 30); // Decay over 30 days
    }

    if (options.boostField && options.boostValue !== undefined) {
      if (result.document[options.boostField] === options.boostValue) {
        boostedScore *= 1.5;
      }
    }

    return { ...result, score: boostedScore };
  }).sort((a, b) => b.score - a.score);
}

// 396. Log Retention Manager
export class LogRetentionManager {
  private retentionPolicies: Map<string, number> = new Map(); // source -> days

  setPolicy(source: string, retentionDays: number): void {
    this.retentionPolicies.set(source, retentionDays);
  }

  shouldRetain(source: string, timestamp: Date): boolean {
    const retentionDays = this.retentionPolicies.get(source) ?? 30;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    return timestamp > cutoff;
  }

  getPolicy(source: string): number {
    return this.retentionPolicies.get(source) ?? 30;
  }
}

// 397. Search Index Analyzer
export function analyzeText(text: string, options: {
  lowercase?: boolean;
  removeStopWords?: boolean;
  stem?: boolean;
} = {}): string[] {
  let tokens = text.split(/\s+/);

  if (options.lowercase !== false) {
    tokens = tokens.map(t => t.toLowerCase());
  }

  if (options.removeStopWords) {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for']);
    tokens = tokens.filter(t => !stopWords.has(t));
  }

  // Simple stemming (just remove common suffixes)
  if (options.stem) {
    tokens = tokens.map(t => {
      if (t.endsWith('ing')) return t.slice(0, -3);
      if (t.endsWith('ed')) return t.slice(0, -2);
      if (t.endsWith('s') && t.length > 3) return t.slice(0, -1);
      return t;
    });
  }

  return tokens.filter(t => t.length > 1);
}

// 398. Log Alert Manager
export class LogAlertManager {
  private rules: Map<string, {
    condition: (entry: LogEntry) => boolean;
    callback: (entry: LogEntry) => void;
    cooldownMs: number;
    lastTriggered?: number;
  }> = new Map();

  addRule(
    name: string,
    condition: (entry: LogEntry) => boolean,
    callback: (entry: LogEntry) => void,
    cooldownMs: number = 60000
  ): void {
    this.rules.set(name, { condition, callback, cooldownMs });
  }

  removeRule(name: string): void {
    this.rules.delete(name);
  }

  evaluate(entry: LogEntry): void {
    const now = Date.now();

    for (const [name, rule] of this.rules) {
      if (rule.lastTriggered && now - rule.lastTriggered < rule.cooldownMs) {
        continue;
      }

      if (rule.condition(entry)) {
        rule.lastTriggered = now;
        rule.callback(entry);
      }
    }
  }
}

// 399. Search Spell Checker
export class SearchSpellChecker {
  private dictionary: Set<string> = new Set();

  addWords(words: string[]): void {
    for (const word of words) {
      this.dictionary.add(word.toLowerCase());
    }
  }

  suggest(word: string, maxSuggestions: number = 5): string[] {
    const lower = word.toLowerCase();
    if (this.dictionary.has(lower)) return [];

    const suggestions: Array<{ word: string; distance: number }> = [];

    for (const dictWord of this.dictionary) {
      const distance = this.levenshteinDistance(lower, dictWord);
      if (distance <= 2) { // Max edit distance of 2
        suggestions.push({ word: dictWord, distance });
      }
    }

    return suggestions
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxSuggestions)
      .map(s => s.word);
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }
}

// 400. Unified Logging and Search Status
export function getEnhancedServicesStatus(): {
  search: boolean;
  logging: boolean;
  analytics: boolean;
  errorTracking: boolean;
  healthy: boolean;
} {
  return {
    search: true,
    logging: true,
    analytics: true,
    errorTracking: true,
    healthy: true
  };
}

// Export all types
export type {
  SearchDocument,
  SearchResult,
  SearchQuery,
  Suggestion,
  Facet,
  SearchAnalyticsEntry,
  LogLevel,
  LogEntry,
  LoggerConfig,
  RequestLog,
  AuditEntry,
  TrackedError,
  PerformanceEntry
};
