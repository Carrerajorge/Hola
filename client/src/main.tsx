import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "katex/dist/katex.min.css";
import "katex/contrib/mhchem";
import "@/lib/i18n";
import {
  normalizeAppBuildVersion,
  shouldAttemptChunkRecovery,
} from "@/lib/chunk-recovery";

// Force Service Worker update and cache clear on new version
const APP_VERSION = normalizeAppBuildVersion(import.meta.env.VITE_APP_VERSION);
const STORED_VERSION_KEY = "iliagpt_app_version";
let cleanupInProgress = false;

function persistCurrentVersion() {
  if (!APP_VERSION) return;
  localStorage.setItem(STORED_VERSION_KEY, APP_VERSION);
}

async function clearCacheAndReload() {
  if (cleanupInProgress) return;
  cleanupInProgress = true;
  try {
    // Unregister all service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }
    
    // Clear all caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
    
    // Clear localStorage marker and reload
    persistCurrentVersion();
    window.location.reload();
  } catch (error) {
    console.error("Error clearing cache:", error);
    persistCurrentVersion();
    window.location.reload();
  }
}

// Auto-recover from stale deploys (Vite chunk load errors) by clearing SW caches.
window.addEventListener("error", (event) => {
  if (shouldAttemptChunkRecovery((event as any).error || (event as any).message, APP_VERSION)) {
    void clearCacheAndReload();
  }
});
window.addEventListener("unhandledrejection", (event) => {
  if (shouldAttemptChunkRecovery((event as any).reason, APP_VERSION)) {
    void clearCacheAndReload();
  }
});

const RELOAD_GUARD_KEY = "iliagpt_reload_guard";
// Boot-time stale-build cleanup is handled by /sw-cleanup.js with the runtime server version.
// Duplicating it here causes extra reloads and slower first paint when build-time and runtime
// versions differ, so this entrypoint only keeps the chunk-load recovery path.
localStorage.removeItem(RELOAD_GUARD_KEY);
persistCurrentVersion();
createRoot(document.getElementById("root")!).render(<App />);
