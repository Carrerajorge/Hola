import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "katex/dist/katex.min.css";

// Force Service Worker update and cache clear on new version
const APP_VERSION = "2.0.2"; // Increment on each deploy
const STORED_VERSION_KEY = "iliagpt_app_version";

async function clearCacheAndReload() {
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
    localStorage.setItem(STORED_VERSION_KEY, APP_VERSION);
    window.location.reload();
  } catch (error) {
    console.error("Error clearing cache:", error);
    localStorage.setItem(STORED_VERSION_KEY, APP_VERSION);
  }
}

// Check if we need to clear cache
const storedVersion = localStorage.getItem(STORED_VERSION_KEY);
if (storedVersion !== APP_VERSION) {
  console.log(`[IliaGPT] Version mismatch: ${storedVersion} -> ${APP_VERSION}, clearing cache...`);
  clearCacheAndReload();
} else {
  createRoot(document.getElementById("root")!).render(<App />);
}
