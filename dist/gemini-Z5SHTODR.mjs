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
import{b as a,c as b,d as c,e as d,f as e}from"./chunk-WKASVOUS.mjs";import"./chunk-JAI7YO2C.mjs";import"./chunk-JL5GVIQJ.mjs";export{c as GEMINI_MODELS,d as geminiChat,e as geminiStreamChat,a as getGeminiClient,b as getGeminiClientOrThrow};
