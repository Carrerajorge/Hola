// This script runs immediately and clears stale service workers before the main app loads
// It must be executed BEFORE any other JavaScript to break the cache cycle
(function() {
  var APP_VERSION = '2.0.2';
  var VERSION_KEY = 'iliagpt_version_check';
  var stored = localStorage.getItem(VERSION_KEY);
  
  if (stored !== APP_VERSION) {
    console.log('[IliaGPT Cleanup] Version changed: ' + stored + ' -> ' + APP_VERSION);
    localStorage.setItem(VERSION_KEY, APP_VERSION);
    
    // Immediately unregister all service workers
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for (var i = 0; i < registrations.length; i++) {
          registrations[i].unregister();
          console.log('[IliaGPT Cleanup] Unregistered SW:', registrations[i].scope);
        }
        // Clear all caches
        if ('caches' in window) {
          caches.keys().then(function(names) {
            for (var j = 0; j < names.length; j++) {
              caches.delete(names[j]);
              console.log('[IliaGPT Cleanup] Deleted cache:', names[j]);
            }
            // Force reload after cleanup
            if (registrations.length > 0 || names.length > 0) {
              console.log('[IliaGPT Cleanup] Reloading...');
              window.location.reload(true);
            }
          });
        }
      });
    }
  }
})();
