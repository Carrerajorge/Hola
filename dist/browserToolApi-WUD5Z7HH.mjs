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
import{b as a,c as b,d as c,e as d,f as e,g as f,h as g,i as h,j as i,k as j,l as k,m as l}from"./chunk-WRSRS3UV.mjs";import"./chunk-JL5GVIQJ.mjs";export{k as BrowserActionSchema,g as BrowserAssertSchema,c as BrowserClickSchema,h as BrowserDownloadWaitSchema,e as BrowserExtractSchema,a as BrowserOpenSchema,f as BrowserScreenshotSchema,j as BrowserScrollSchema,i as BrowserSelectSchema,l as BrowserToolApi,d as BrowserTypeSchema,b as BrowserWaitForSchema};
