import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "katex/dist/katex.min.css";
import "katex/contrib/mhchem";
import "@/lib/i18n";
import {
  APP_VERSION_STORAGE_KEY,
  normalizeAppBuildVersion,
  recoverFromChunkError,
} from "@/lib/chunk-recovery";

const APP_VERSION = normalizeAppBuildVersion(import.meta.env.VITE_APP_VERSION);

// Auto-recover from stale deploys (Vite chunk load errors) by clearing SW caches.
window.addEventListener("error", (event) => {
  void recoverFromChunkError((event as any).error || (event as any).message, APP_VERSION);
});
window.addEventListener("unhandledrejection", (event) => {
  void recoverFromChunkError((event as any).reason, APP_VERSION);
});

const RELOAD_GUARD_KEY = "iliagpt_reload_guard";
// Boot-time stale-build cleanup is handled by /sw-cleanup.js with the runtime server version.
// Duplicating it here causes extra reloads and slower first paint when build-time and runtime
// versions differ, so this entrypoint only keeps the chunk-load recovery path.
localStorage.removeItem(RELOAD_GUARD_KEY);
localStorage.setItem(APP_VERSION_STORAGE_KEY, APP_VERSION);
createRoot(document.getElementById("root")!).render(<App />);
