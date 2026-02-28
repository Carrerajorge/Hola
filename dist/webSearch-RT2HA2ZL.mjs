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
import{a,b,c,d,e,f,g,i as h}from"./chunk-TFKEBOLV.mjs";import"./chunk-23TNEANO.mjs";import"./chunk-JL5GVIQJ.mjs";h();export{b as fetchPageContent,c as fetchPageMetadata,a as fetchUrl,f as needsAcademicSearch,g as needsWebSearch,e as searchScholar,d as searchWeb};
