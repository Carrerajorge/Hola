/**
 * Enhanced Services Index (201-400)
 * Export all enhanced services for frontend (201-300) and backend (301-400)
 */

// ============================================
// Backend Services (301-400)
// ============================================

// Advanced APIs (301-320)
export {
  APIVersionManager,
  parseFieldSelection,
  applyFieldSelection,
  fieldSelectionMiddleware,
  parsePagination,
  createPaginatedResponse,
  RequestTransformer,
  ResponseTransformer,
  validateValue,
  createValidator,
  TokenBucketRateLimiter,
  APIKeyManager,
  WebhookDeliverySystem,
  HATEOASBuilder,
  BulkOperationHandler,
  contentNegotiation,
  generateETag,
  conditionalResponse,
  RequestCoalescer,
  createAPIEnvelope,
  createErrorEnvelope,
  parseCursorPagination,
  encodeCursor,
  decodeCursor,
  requestTimeout,
  correlationId,
  applyJSONPatch,
  deprecated
} from './AdvancedAPIs';

export type {
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
} from './AdvancedAPIs';

// Security & Caching (321-340)
export {
  SlidingWindowRateLimiter,
  IPReputationSystem,
  generateRequestFingerprint,
  BruteForceProtection,
  createSecurityHeaders,
  sanitizeInput,
  sanitizeObject,
  sanitizationMiddleware,
  detectSQLInjection,
  sqlInjectionProtection,
  detectXSS,
  escapeHTML,
  MultiLevelCache,
  CacheAside,
  WriteThroughCache,
  CacheWarmer,
  setCacheHeaders,
  cacheMiddleware,
  SessionSecurityManager,
  EncryptionHelper,
  corsPreflightCache,
  SecurityAuditLogger,
  RequestSigner,
  generateCacheKey,
  SWRCache
} from './SecurityCaching';

export type {
  SlidingWindowConfig,
  IPReputation,
  RequestFingerprint,
  BruteForceConfig,
  SecurityHeadersConfig,
  CacheEntry,
  HTTPCacheOptions,
  SessionSecurityConfig
} from './SecurityCaching';

// Jobs & Workers (341-360)
export {
  JobQueue,
  ScheduledTaskManager,
  WorkerPool,
  PriorityQueue,
  BatchProcessor,
  RateLimitedExecutor,
  RetryManager,
  DeadLetterQueue,
  JobDependencyManager,
  JobThrottler,
  JobProgressTracker,
  WorkflowEngine,
  processLargeDataset,
  JobMetricsCollector,
  createConcurrencyLimiter,
  JobChainBuilder,
  executeParallel,
  DebouncedJobExecutor,
  getNextRunTime,
  JobStateMachine
} from './JobsWorkers';

export type {
  Job,
  JobStatus,
  JobOptions,
  JobHandler,
  ScheduledTask,
  Worker,
  BatchConfig,
  RetryConfig,
  DeadLetterEntry,
  WorkflowStep,
  JobState
} from './JobsWorkers';

// Notifications & Files (361-380)
export {
  NotificationManager,
  PushNotificationService,
  EmailNotificationService,
  InAppNotificationCenter,
  FileUploadManager,
  ImageProcessingService,
  FileVersioningSystem,
  LocalStorageProvider,
  FileSharingSystem,
  FileCompressionService,
  detectFileType,
  calculateFileHash,
  NotificationDigestBuilder,
  FileQuotaManager,
  NotificationPriorityQueue,
  extractFileMetadata,
  NotificationRateLimiter,
  sanitizeFilename,
  NotificationScheduler,
  FilePreviewGenerator
} from './NotificationsFiles';

export type {
  Notification,
  NotificationChannel,
  NotificationTemplate,
  PushSubscription,
  EmailOptions,
  InAppNotification,
  UploadedFile,
  UploadConfig,
  ImageTransform,
  FileVersion,
  StorageProvider,
  SharedLink
} from './NotificationsFiles';

// Search & Logging (381-400)
export {
  SearchEngine,
  AutocompleteEngine,
  FacetedSearch,
  SearchAnalytics,
  StructuredLogger,
  RequestLogger,
  AuditLogger,
  ErrorTracker,
  PerformanceLogger,
  LogAggregator,
  parseSearchQuery,
  formatLogEntry,
  generateCorrelationId,
  LogSampler,
  rankSearchResults,
  LogRetentionManager,
  analyzeText,
  LogAlertManager,
  SearchSpellChecker,
  getEnhancedServicesStatus
} from './SearchLogging';

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
} from './SearchLogging';

// ============================================
// Service Instances (Singletons)
// ============================================
import { MultiLevelCache } from './SecurityCaching';
import { JobQueue, ScheduledTaskManager, WorkerPool } from './JobsWorkers';
import { NotificationManager, InAppNotificationCenter, FileUploadManager } from './NotificationsFiles';
import { SearchEngine, AutocompleteEngine, StructuredLogger, AuditLogger, ErrorTracker, PerformanceLogger } from './SearchLogging';

// Create singleton instances
export const cache = new MultiLevelCache(1000);
export const jobQueue = new JobQueue(5);
export const taskManager = new ScheduledTaskManager();
export const workerPool = new WorkerPool({ min: 2, max: 10 });
export const notificationManager = new NotificationManager();
export const notificationCenter = new InAppNotificationCenter(100);
export const searchEngine = new SearchEngine();
export const autocomplete = new AutocompleteEngine();
export const logger = new StructuredLogger({ level: 'info', format: 'json' });
export const auditLogger = new AuditLogger(90);
export const errorTracker = new ErrorTracker(10);
export const performanceLogger = new PerformanceLogger(10000);

// ============================================
// Initialization & Shutdown
// ============================================
let initialized = false;

export async function initializeEnhanced(): Promise<void> {
  if (initialized) return;

  console.log('[Enhanced] Initializing enhanced services (201-400)...');

  // Initialize search indices
  searchEngine.createIndex('users');
  searchEngine.createIndex('chats');
  searchEngine.createIndex('messages');

  // Initialize autocomplete indices
  autocomplete.createIndex('search-history');
  autocomplete.createIndex('commands');

  // Setup common scheduled tasks
  taskManager.register('cleanup-old-logs', '@daily', async () => {
    console.log('[Enhanced] Running daily log cleanup...');
  });

  taskManager.register('cache-warmup', '@hourly', async () => {
    console.log('[Enhanced] Running hourly cache warmup...');
  });

  // Register common job handlers
  jobQueue.registerHandler('send-notification', async (job, progress) => {
    progress(50);
    await new Promise(resolve => setTimeout(resolve, 100));
    progress(100);
    return { sent: true };
  });

  jobQueue.registerHandler('process-file', async (job, progress) => {
    progress(50);
    await new Promise(resolve => setTimeout(resolve, 100));
    progress(100);
    return { processed: true };
  });

  initialized = true;
  console.log('[Enhanced] Enhanced services initialized successfully');
}

export async function shutdownEnhanced(): Promise<void> {
  if (!initialized) return;

  console.log('[Enhanced] Shutting down enhanced services...');

  // Stop scheduled tasks
  taskManager.shutdown();

  // Wait for job queue to drain
  jobQueue.pause();

  // Shutdown worker pool
  await workerPool.shutdown();

  // Clear caches
  await cache.invalidateAll();

  initialized = false;
  console.log('[Enhanced] Enhanced services shut down');
}

export function getEnhancedStatus(): {
  healthy: boolean;
  initialized: boolean;
  services: {
    cache: { l1Size: number; l2Size: number };
    jobQueue: { pending: number; processing: number; completed: number; failed: number };
    workerPool: { totalWorkers: number; busyWorkers: number; queueLength: number };
    search: { indices: number; documents: number; terms: number };
    errors: { total: number; unresolved: number };
  };
} {
  return {
    healthy: initialized,
    initialized,
    services: {
      cache: cache.getStats(),
      jobQueue: jobQueue.getStats(),
      workerPool: workerPool.getStats(),
      search: searchEngine.getStats() as any,
      errors: errorTracker.getStats()
    }
  };
}
