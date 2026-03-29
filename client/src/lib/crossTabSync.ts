/**
 * Cross-Tab State Synchronization
 * 
 * Sincroniza el estado de previsualizaciones entre pestañas del navegador
 * usando BroadcastChannel API.
 */

import { getCachedPreview, setCachedPreview, clearCachedPreview, type CachedPreview } from "./filePreviewCache";

const CHANNEL_NAME = "file_preview_sync";
const MESSAGE_TYPES = {
  PREVIEW_CACHED: "preview_cached",
  PREVIEW_CLEARED: "preview_cleared",
  CACHE_CLEARED: "cache_cleared",
  REQUEST_PREVIEW: "request_preview",
  RESPONSE_PREVIEW: "response_preview",
} as const;

interface SyncMessage {
  type: typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];
  payload?: {
    fileId?: string;
    preview?: CachedPreview;
    timestamp: number;
  };
  source: string;
}

type SyncCallback = (message: SyncMessage) => void;

class CrossTabSync {
  private channel: BroadcastChannel | null = null;
  private tabId: string;
  private callbacks: Set<SyncCallback> = new Set();
  private initialized = false;

  constructor() {
    this.tabId = `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  init(): void {
    if (this.initialized || typeof BroadcastChannel === "undefined") {
      return;
    }

    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = this.handleMessage.bind(this);
      this.initialized = true;
      console.log("[CrossTabSync] Initialized with tabId:", this.tabId);
    } catch (error) {
      console.warn("[CrossTabSync] Failed to initialize:", error);
    }
  }

  private handleMessage(event: MessageEvent): void {
    const message = event.data as SyncMessage;

    // Ignore own messages
    if (message.source === this.tabId) {
      return;
    }

    console.log("[CrossTabSync] Received:", message.type);

    // Handle message types
    switch (message.type) {
      case MESSAGE_TYPES.PREVIEW_CACHED:
        if (message.payload?.preview) {
          setCachedPreview(message.payload.preview);
        }
        break;

      case MESSAGE_TYPES.PREVIEW_CLEARED:
        if (message.payload?.fileId) {
          clearCachedPreview(message.payload.fileId);
        }
        break;

      case MESSAGE_TYPES.CACHE_CLEARED:
        // Clear local cache
        break;

      case MESSAGE_TYPES.REQUEST_PREVIEW:
        if (message.payload?.fileId) {
          const preview = getCachedPreview(message.payload.fileId);
          if (preview) {
            this.send(MESSAGE_TYPES.RESPONSE_PREVIEW, {
              fileId: message.payload.fileId,
              preview,
              timestamp: Date.now(),
            });
          }
        }
        break;
    }

    // Notify callbacks
    this.callbacks.forEach((callback) => callback(message));
  }

  private send(type: SyncMessage["type"], payload?: SyncMessage["payload"]): void {
    if (!this.channel) {
      return;
    }

    const message: SyncMessage = {
      type,
      payload,
      source: this.tabId,
    };

    try {
      this.channel.postMessage(message);
    } catch (error) {
      console.warn("[CrossTabSync] Failed to send:", error);
    }
  }

  broadcastPreviewCached(preview: CachedPreview): void {
    this.send(MESSAGE_TYPES.PREVIEW_CACHED, {
      preview,
      timestamp: Date.now(),
    });
  }

  broadcastPreviewCleared(fileId: string): void {
    this.send(MESSAGE_TYPES.PREVIEW_CLEARED, {
      fileId,
      timestamp: Date.now(),
    });
  }

  broadcastCacheCleared(): void {
    this.send(MESSAGE_TYPES.CACHE_CLEARED, {
      timestamp: Date.now(),
    });
  }

  requestPreviewFromOtherTabs(fileId: string): void {
    this.send(MESSAGE_TYPES.REQUEST_PREVIEW, {
      fileId,
      timestamp: Date.now(),
    });
  }

  subscribe(callback: SyncCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  destroy(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.callbacks.clear();
    this.initialized = false;
  }
}

// Singleton instance
let syncInstance: CrossTabSync | null = null;

export function getCrossTabSync(): CrossTabSync {
  if (!syncInstance) {
    syncInstance = new CrossTabSync();
    syncInstance.init();
  }
  return syncInstance;
}

export function initCrossTabSync(): void {
  getCrossTabSync();
}

export function destroyCrossTabSync(): void {
  if (syncInstance) {
    syncInstance.destroy();
    syncInstance = null;
  }
}
