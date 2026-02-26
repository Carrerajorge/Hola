/**
 * Temporary media store with TTL-based auto-cleanup.
 * Ported from upstream OpenClaw v2026.2.24: src/media/store.ts
 *
 * In-memory store for media buffers with automatic expiration.
 * Used for short-lived media processing (e.g., upload → process → respond).
 */

import { randomUUID } from 'crypto';
import type { MediaStoreEntry, MediaInfo } from './types';
import { Logger } from '../../lib/logger';

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 60 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // cleanup every 5 minutes

export class MediaStore {
  private entries = new Map<string, MediaStoreEntry>();
  private ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMinutes: number = 60) {
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  /**
   * Store media data and return its ID.
   */
  store(data: Buffer, info: MediaInfo): string {
    const id = randomUUID();
    const now = Date.now();

    this.entries.set(id, {
      id,
      data,
      info,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    });

    // Start cleanup timer on first store
    if (!this.cleanupTimer) {
      this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
      // Ensure timer doesn't block process exit
      if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    }

    return id;
  }

  /**
   * Retrieve stored media by ID. Returns null if expired or not found.
   */
  get(id: string): MediaStoreEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(id);
      return null;
    }

    return entry;
  }

  /**
   * Check if a media entry exists and is not expired.
   */
  has(id: string): boolean {
    return this.get(id) !== null;
  }

  /**
   * Remove a specific entry.
   */
  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Remove all expired entries.
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, entry] of this.entries) {
      if (now >= entry.expiresAt) {
        this.entries.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      Logger.info(`[Media:Store] Cleaned ${cleaned} expired entries, ${this.entries.size} remaining`);
    }

    return cleaned;
  }

  /**
   * Get the number of stored entries.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Get total bytes of stored media.
   */
  get totalBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.data.length;
    }
    return total;
  }

  /**
   * Destroy the store and clear the cleanup timer.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.entries.clear();
  }
}
