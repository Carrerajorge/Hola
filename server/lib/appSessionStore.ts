import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import { pool } from "../db";

export const APP_SESSION_COOKIE_NAME = "siragpt.sid";
export const APP_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type AppSessionStoreMode = "memory" | "postgres";

type AppSessionStore = session.Store & {
  close?: () => void;
  pruneSessions?: (callback?: (err: Error) => void) => void;
};

const PG_STORE_TTL_SECONDS = Math.floor(APP_SESSION_TTL_MS / 1000);
const PgStore = connectPgSimple(session);

let cachedStore: AppSessionStore | null = null;
let cachedMode: AppSessionStoreMode | null = null;

function normalizeStoreMode(value?: string | null): AppSessionStoreMode | null {
  const mode = String(value || "").trim().toLowerCase();
  if (!mode) return null;
  if (["memory", "mem", "inmemory", "in-memory"].includes(mode)) {
    return "memory";
  }
  if (["postgres", "pg", "database", "db"].includes(mode)) {
    return "postgres";
  }
  return null;
}

function resolveDefaultStoreMode(): AppSessionStoreMode {
  const explicitMode = normalizeStoreMode(process.env.SESSION_STORE_MODE);
  if (explicitMode) {
    return explicitMode;
  }

  const isProduction =
    process.env.NODE_ENV === "production" ||
    String(process.env.REPLIT_DEPLOYMENT || "").toLowerCase() === "true" ||
    Boolean(process.env.REPL_SLUG);

  return isProduction ? "postgres" : "memory";
}

function shouldTreatStoreErrorAsMiss(error: unknown): boolean {
  const message = String(
    error instanceof Error ? error.message : error || "",
  ).toLowerCase();

  return [
    "unexpected token",
    "invalid input syntax",
    "json",
    "not found in row",
    "corrupt",
  ].some((pattern) => message.includes(pattern));
}

function createMemoryStore(): AppSessionStore {
  return new session.MemoryStore() as AppSessionStore;
}

function createPostgresStore(): AppSessionStore {
  const store = new PgStore({
    pool,
    tableName: "sessions",
    createTableIfMissing: true,
    ttl: PG_STORE_TTL_SECONDS,
    pruneSessionInterval: 60 * 15,
    errorLog: (...args: unknown[]) => {
      console.warn("[appSessionStore] postgres store warning:", ...args);
    },
  }) as AppSessionStore;

  const originalGet = store.get.bind(store);
  store.get = (sid, callback) => {
    originalGet(sid, (error, sessionData) => {
      if (error && shouldTreatStoreErrorAsMiss(error)) {
        console.warn(
          "[appSessionStore] Ignoring unreadable session payload and treating it as a cache miss.",
        );
        callback?.(null, null);
        return;
      }

      callback?.(error, sessionData);
    });
  };

  return store;
}

export function getAppSessionStoreMode(): AppSessionStoreMode {
  if (cachedMode) {
    return cachedMode;
  }

  cachedMode = resolveDefaultStoreMode();
  return cachedMode;
}

export function getAppSessionStore(): AppSessionStore {
  if (cachedStore) {
    return cachedStore;
  }

  const mode = getAppSessionStoreMode();

  if (mode === "postgres") {
    try {
      cachedStore = createPostgresStore();
      return cachedStore;
    } catch (error) {
      const isProduction =
        process.env.NODE_ENV === "production" || Boolean(process.env.REPL_SLUG);
      if (isProduction) {
        throw error;
      }

      console.warn(
        "[appSessionStore] Falling back to memory store because postgres session store could not be initialized:",
        error,
      );
      cachedMode = "memory";
    }
  }

  cachedStore = createMemoryStore();
  return cachedStore;
}
