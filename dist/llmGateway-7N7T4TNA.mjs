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
import{k as a}from"./chunk-EHTWEZTA.mjs";import"./chunk-WP3AAAKC.mjs";import"./chunk-RFZBR23N.mjs";import"./chunk-OQFD36C4.mjs";import"./chunk-E4MBEG5H.mjs";import"./chunk-WKASVOUS.mjs";import"./chunk-5B23YN35.mjs";import"./chunk-23TNEANO.mjs";import"./chunk-PNGSAWMQ.mjs";import"./chunk-JAI7YO2C.mjs";import"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-UWSZBHDA.mjs";import"./chunk-6EWVFNKC.mjs";import"./chunk-JL5GVIQJ.mjs";export{a as llmGateway};
