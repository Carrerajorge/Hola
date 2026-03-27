// This script runs immediately and clears stale service workers before the main app loads
// It must be executed BEFORE any other JavaScript to break the cache cycle
(function() {
  var APP_VERSION = '2.0.2';
  // Keep the key consistent with client/src/main.tsx so both mechanisms agree.
  var VERSION_KEY = 'iliagpt_app_version';
  var RELOAD_GUARD_KEY = 'iliagpt_sw_cleanup_reload';
  var LEGACY_CACHE_PREFIXES = ['iliagpt-', 'precache-'];
  var stored = localStorage.getItem(VERSION_KEY);
  var reloadGuardVersion = null;
  var hadPreviousVersion = typeof stored === 'string' && stored.length > 0;

  // In development (served by Vite), skip version enforcement to avoid
  // infinite reload loops with main.tsx which uses "dev" as its version.
  var isDev = window.location.port === '5050' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  if (isDev) {
    return;
  }

  try {
    reloadGuardVersion = sessionStorage.getItem(RELOAD_GUARD_KEY);
  } catch (error) {
    reloadGuardVersion = null;
  }

  function reloadAfterCleanup(registrationCount, cacheCount) {
    if (reloadGuardVersion === APP_VERSION) {
      return;
    }
    if (!hadPreviousVersion && registrationCount === 0 && cacheCount === 0) {
      return;
    }
    try {
      sessionStorage.setItem(RELOAD_GUARD_KEY, APP_VERSION);
    } catch (error) {
      // Ignore storage errors.
    }
    console.log('[IliaGPT Cleanup] Reloading...');
    window.location.reload();
  }

  function isLegacyCacheName(name) {
    for (var i = 0; i < LEGACY_CACHE_PREFIXES.length; i += 1) {
      if (name.indexOf(LEGACY_CACHE_PREFIXES[i]) === 0) {
        return true;
      }
    }
    return false;
  }

  function deleteLegacyCaches() {
    if (!('caches' in window)) {
      return Promise.resolve(0);
    }

    return caches.keys().then(function(names) {
      var legacyNames = names.filter(isLegacyCacheName);
      return Promise.all(
        legacyNames.map(function(name) {
          console.log('[IliaGPT Cleanup] Deleted legacy cache:', name);
          return caches.delete(name);
        })
      ).then(function() {
        return legacyNames.length;
      });
    }).catch(function(error) {
      console.warn('[IliaGPT Cleanup] Failed to delete legacy caches:', error);
      return 0;
    });
  }

  if (stored !== APP_VERSION) {
    console.log('[IliaGPT Cleanup] Version changed: ' + stored + ' -> ' + APP_VERSION);
    localStorage.setItem(VERSION_KEY, APP_VERSION);
    var cleanupTasks = [];
    var registrationCount = 0;
    var cacheCount = 0;

    // Immediately unregister all service workers
    if ('serviceWorker' in navigator) {
      cleanupTasks.push(
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
          registrationCount = registrations.length;
          for (var i = 0; i < registrations.length; i++) {
            registrations[i].unregister();
            console.log('[IliaGPT Cleanup] Unregistered SW:', registrations[i].scope);
          }
        }).catch(function(error) {
          console.warn('[IliaGPT Cleanup] Failed to inspect service workers:', error);
        })
      );
    }

    cleanupTasks.push(
      deleteLegacyCaches().then(function(count) {
        cacheCount = count;
      })
    );

    Promise.all(cleanupTasks).catch(function() {
      // Individual cleanup tasks already log their own failures.
    }).then(function() {
      reloadAfterCleanup(registrationCount, cacheCount);
    });
  } else {
    void deleteLegacyCaches();
    try {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch (error) {
      // Ignore storage errors.
    }
  }
})();
