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
import{d as s}from"./chunk-VLL76GHB.mjs";var n=class{static info(r,t){s.info(r,t)}static warn(r,t){s.warn(r,t)}static error(r,t){t instanceof Error?s.error(r,{error:t.message,stack:t.stack,...t}):s.error(r,{error:t})}static security(r,t){s.warn(r,{...t,category:"security"})}static debug(r,t){s.debug(r,t)}};export{n as a};
