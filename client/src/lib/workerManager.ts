/**
 * Worker Manager for File Extraction
 * 
 * Gestiona Web Workers para extracción de archivos sin bloquear la UI.
 */

interface WorkerMessage {
  type: "progress" | "result" | "ready";
  fileId?: string;
  stage?: "reading" | "extracting" | "parsing" | "ready" | "error";
  progress?: number;
  message?: string;
  content?: string;
  htmlContent?: string;
  tables?: Array<{ headers: string[]; rows: string[][] }>;
  error?: string;
}

type ProgressCallback = (fileId: string, stage: string, progress: number, message: string) => void;
type ResultCallback = (fileId: string, result: { content?: string; htmlContent?: string; tables?: Array<{ headers: string[]; rows: string[][] }>; error?: string }) => void;

class WorkerManager {
  private worker: Worker | null = null;
  private progressCallbacks: Map<string, ProgressCallback> = new Map();
  private resultCallbacks: Map<string, ResultCallback> = new Map();
  private pendingTasks: Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = new Map();
  private workerReady = false;
  private readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = this.initWorker();
  }

  private async initWorker(): Promise<void> {
    if (typeof Worker === "undefined") {
      console.warn("[WorkerManager] Web Workers not supported");
      return;
    }

    return new Promise((resolve) => {
      try {
        // Use a simple worker URL - will fallback to main thread if worker fails
        const workerUrl = "/workers/fileExtractor.worker.js";
        this.worker = new Worker(workerUrl, { type: "module" });

        this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
          this.handleMessage(event.data);
          if (event.data.type === "ready") {
            this.workerReady = true;
            resolve();
          }
        };

        this.worker.onerror = (error) => {
          console.error("[WorkerManager] Worker error:", error);
          this.workerReady = false;
          resolve(); // Resolve anyway to fallback to main thread
        };
      } catch (error) {
        console.error("[WorkerManager] Failed to create worker:", error);
        resolve();
      }
    });
  }

  private handleMessage(message: WorkerMessage): void {
    if (message.type === "progress" && message.fileId) {
      const callback = this.progressCallbacks.get(message.fileId);
      if (callback && message.stage && message.progress !== undefined && message.message) {
        callback(message.fileId, message.stage, message.progress, message.message);
      }
    }

    if (message.type === "result" && message.fileId) {
      const callback = this.resultCallbacks.get(message.fileId);
      if (callback) {
        callback(message.fileId, {
          content: message.content,
          htmlContent: message.htmlContent,
          tables: message.tables,
          error: message.error,
        });
      }

      const pending = this.pendingTasks.get(message.fileId);
      if (pending) {
        pending.resolve(message);
        this.pendingTasks.delete(message.fileId);
      }

      this.progressCallbacks.delete(message.fileId);
      this.resultCallbacks.delete(message.fileId);
    }
  }

  async isReady(): Promise<boolean> {
    await this.readyPromise;
    return this.workerReady && this.worker !== null;
  }

  async extractFile(
    file: File,
    fileId: string,
    onProgress?: ProgressCallback,
    onResult?: ResultCallback
  ): Promise<{ content?: string; htmlContent?: string; tables?: Array<{ headers: string[]; rows: string[][] }>; error?: string }> {
    // Check if worker is available
    const ready = await this.isReady();

    if (!ready || !this.worker) {
      // Fallback to main thread extraction
      const { extractFileContent } = await import("../lib/fileContentExtractor");
      return extractFileContent(file, fileId);
    }

    return new Promise(async (resolve, reject) => {
      // Register callbacks
      if (onProgress) {
        this.progressCallbacks.set(fileId, onProgress);
      }
      if (onResult) {
        this.resultCallbacks.set(fileId, onResult);
      }

      this.pendingTasks.set(fileId, { resolve, reject });

      // Read file and send to worker
      const buffer = await file.arrayBuffer();

      this.worker!.postMessage({
        type: "extract",
        fileId,
        file: buffer,
        fileName: file.name,
        mimeType: file.type,
      }, [buffer]); // Transfer ownership
    });
  }

  cancel(fileId: string): void {
    if (this.worker) {
      this.worker.postMessage({ type: "cancel", fileId });
    }
    this.pendingTasks.delete(fileId);
    this.progressCallbacks.delete(fileId);
    this.resultCallbacks.delete(fileId);
  }

  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.progressCallbacks.clear();
    this.resultCallbacks.clear();
    this.pendingTasks.clear();
    this.workerReady = false;
  }
}

// Singleton
let managerInstance: WorkerManager | null = null;

export function getWorkerManager(): WorkerManager {
  if (!managerInstance) {
    managerInstance = new WorkerManager();
  }
  return managerInstance;
}

export function destroyWorkerManager(): void {
  if (managerInstance) {
    managerInstance.destroy();
    managerInstance = null;
  }
}
