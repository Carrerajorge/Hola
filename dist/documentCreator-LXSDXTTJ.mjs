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
import{b as a,c as b}from"./chunk-HX7KPIND.mjs";import"./chunk-NV6BNJ64.mjs";import"./chunk-KRFCN6YW.mjs";import"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-JL5GVIQJ.mjs";export{a as DocumentCreator,b as documentCreator};
