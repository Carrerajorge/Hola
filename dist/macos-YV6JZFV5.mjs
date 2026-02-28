import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Some dependencies still reference CommonJS globals (module/exports) even when bundled.
// When output format is ESM, these are not defined by Node.
// Provide a minimal shim to avoid runtime crashes like:
//   ReferenceError: module is not defined in ES module scope
const module = { exports: {} };
const exports = module.exports;

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{$,A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z,_,a,aa,b,ba,c,ca,d,da,e,ea,f,fa,g,ga,h,ha,i,ia,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z}from"./chunk-OGLCNGOC.mjs";import"./chunk-JL5GVIQJ.mjs";export{ga as chooseFile,ha as chooseFolder,W as cleanupScreenshots,P as clearClipboard,ba as completeReminder,Y as createCalendarEvent,aa as createReminder,L as emptyTrash,C as focusApp,J as fullscreenWindow,u as getBatteryInfo,m as getBluetoothStatus,i as getBrightness,X as getCalendarEvents,N as getClipboard,M as getFinderSelection,E as getFrontmostApp,fa as getKeychainPassword,$ as getReminders,v as getUptime,e as getVolume,k as getWiFiStatus,B as hideApp,o as isDarkMode,a as isMacOS,h as isMuted,Z as listCalendars,D as listRunningApps,da as listShortcuts,F as listWindows,r as lockScreen,I as minimizeWindow,G as moveWindow,ia as musicControl,g as muteVolume,w as openApp,y as openFile,z as openFileWith,x as openUrl,A as quitApp,H as resizeWindow,K as revealInFinder,c as runJxa,b as runOsascript,d as runOsascriptFile,ea as runShortcut,T as sayText,_ as searchContacts,n as setBluetooth,j as setBrightness,O as setClipboard,p as setDarkMode,q as setDoNotDisturb,f as setVolume,l as setWiFi,R as showAlert,S as showDialog,Q as showNotification,t as sleepComputer,s as sleepDisplay,ca as spotlightSearch,U as takeScreenshot,V as takeWindowScreenshot};
