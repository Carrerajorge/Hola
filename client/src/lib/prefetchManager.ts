/**
 * Prefetch Manager
 * 
 * Gestiona el prefetch inteligente de previsualizaciones:
 * - Detecta archivos visibles en viewport
 * - Inicia extracción en background cuando usuario hace hover
 * - Prioriza archivos probablemente cliqueados
 */

import { extractFileContent } from "./fileContentExtractor";
import { getCachedPreview, setCachedPreview, type CachedPreview } from "./filePreviewCache";

interface PrefetchQueueItem {
  file: File;
  fileId: string;
  priority: number;
  status: "pending" | "processing" | "completed" | "error";
  timestamp: number;
}

interface PrefetchOptions {
  maxConcurrent: number;
  hoverDelay: number;
  viewportPriority: number;
  hoverPriority: number;
}

const DEFAULT_OPTIONS: PrefetchOptions = {
  maxConcurrent: 3,
  hoverDelay: 200,
  viewportPriority: 5,
  hoverPriority: 10,
};

class PrefetchManager {
  private queue: Map<string, PrefetchQueueItem> = new Map();
  private processing: Set<string> = new Set();
  private options: PrefetchOptions;
  private hoverTimers: Map<string, NodeJS.Timeout> = new Map();
  private observers: Map<string, IntersectionObserver> = new Map();

  constructor(options: Partial<PrefetchOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Register a file for potential prefetching
   */
  registerFile(file: File, fileId: string, element?: Element): void {
    // Check if already cached
    const cached = getCachedPreview(fileId);
    if (cached) {
      return;
    }

    // Add to queue
    this.queue.set(fileId, {
      file,
      fileId,
      priority: 0,
      status: "pending",
      timestamp: Date.now(),
    });

    // Set up viewport observation if element provided
    if (element) {
      this.observeViewport(fileId, element);
    }
  }

  /**
   * Called when user hovers over a file
   */
  onHover(fileId: string): void {
    const item = this.queue.get(fileId);
    if (!item || item.status !== "pending") {
      return;
    }

    // Clear existing timer
    const existingTimer = this.hoverTimers.get(fileId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set delayed prefetch
    const timer = setTimeout(() => {
      this.hoverTimers.delete(fileId);
      this.prioritizeAndProcess(fileId, this.options.hoverPriority);
    }, this.options.hoverDelay);

    this.hoverTimers.set(fileId, timer);
  }

  /**
   * Called when user stops hovering
   */
  onHoverEnd(fileId: string): void {
    const timer = this.hoverTimers.get(fileId);
    if (timer) {
      clearTimeout(timer);
      this.hoverTimers.delete(fileId);
    }
  }

  /**
   * Set up IntersectionObserver for viewport visibility
   */
  private observeViewport(fileId: string, element: Element): void {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const item = this.queue.get(fileId);
            if (item && item.status === "pending") {
              item.priority = Math.max(item.priority, this.options.viewportPriority);
              this.processQueue();
            }
          }
        });
      },
      {
        rootMargin: "100px",
        threshold: 0.1,
      }
    );

    observer.observe(element);
    this.observers.set(fileId, observer);
  }

  /**
   * Prioritize and immediately process a file
   */
  private async prioritizeAndProcess(fileId: string, priority: number): Promise<void> {
    const item = this.queue.get(fileId);
    if (!item) return;

    item.priority = priority;
    await this.processItem(item);
  }

  /**
   * Process the queue based on priority
   */
  private async processQueue(): Promise<void> {
    // Check concurrent limit
    if (this.processing.size >= this.options.maxConcurrent) {
      return;
    }

    // Get highest priority pending item
    const pending = Array.from(this.queue.values())
      .filter((item) => item.status === "pending")
      .sort((a, b) => b.priority - a.priority);

    if (pending.length === 0) {
      return;
    }

    const item = pending[0];
    await this.processItem(item);

    // Continue processing if slots available
    if (this.processing.size < this.options.maxConcurrent) {
      setTimeout(() => this.processQueue(), 100);
    }
  }

  /**
   * Process a single item
   */
  private async processItem(item: PrefetchQueueItem): Promise<void> {
    if (this.processing.has(item.fileId)) {
      return;
    }

    // Check if already cached
    const cached = getCachedPreview(item.fileId);
    if (cached) {
      item.status = "completed";
      return;
    }

    this.processing.add(item.fileId);
    item.status = "processing";

    try {
      const result = await extractFileContent(item.file, item.fileId);

      if (result.error) {
        item.status = "error";
      } else {
        const preview: CachedPreview = {
          id: item.fileId,
          name: item.file.name,
          mimeType: item.file.type,
          content: result.content,
          htmlContent: result.htmlContent,
          tables: result.tables,
          extractedAt: Date.now(),
          size: item.file.size,
        };

        setCachedPreview(preview);
        item.status = "completed";

        console.log("[Prefetch] Completed:", item.fileId);
      }
    } catch (error) {
      console.error("[Prefetch] Error:", error);
      item.status = "error";
    } finally {
      this.processing.delete(item.fileId);
    }
  }

  /**
   * Get prefetch status
   */
  getStatus(fileId: string): PrefetchQueueItem["status"] | null {
    const item = this.queue.get(fileId);
    return item?.status || null;
  }

  /**
   * Cancel prefetch for a file
   */
  cancel(fileId: string): void {
    const timer = this.hoverTimers.get(fileId);
    if (timer) {
      clearTimeout(timer);
      this.hoverTimers.delete(fileId);
    }

    const observer = this.observers.get(fileId);
    if (observer) {
      observer.disconnect();
      this.observers.delete(fileId);
    }

    this.queue.delete(fileId);
  }

  /**
   * Clear all prefetch state
   */
  clear(): void {
    this.hoverTimers.forEach((timer) => clearTimeout(timer));
    this.hoverTimers.clear();

    this.observers.forEach((observer) => observer.disconnect());
    this.observers.clear();

    this.queue.clear();
    this.processing.clear();
  }
}

// Singleton instance
let prefetchInstance: PrefetchManager | null = null;

export function getPrefetchManager(): PrefetchManager {
  if (!prefetchInstance) {
    prefetchInstance = new PrefetchManager();
  }
  return prefetchInstance;
}

export function initPrefetchManager(options?: Partial<PrefetchOptions>): PrefetchManager {
  if (!prefetchInstance) {
    prefetchInstance = new PrefetchManager(options);
  }
  return prefetchInstance;
}
