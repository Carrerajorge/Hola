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
import{a,b}from"./chunk-HB4DRXW7.mjs";import"./chunk-Y7B4CDGW.mjs";import"./chunk-7F2XZJM3.mjs";import"./chunk-K5UZFPVK.mjs";import"./chunk-JL5GVIQJ.mjs";export{b as exportAcademicArticlesFromPrompt,a as planAcademicArticlesExport};
