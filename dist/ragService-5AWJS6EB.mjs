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
import{a,b,c,d,e,f,g}from"./chunk-5JBUO3EL.mjs";import"./chunk-PNGSAWMQ.mjs";import"./chunk-JAI7YO2C.mjs";import"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-UWSZBHDA.mjs";import"./chunk-6EWVFNKC.mjs";import"./chunk-JL5GVIQJ.mjs";export{a as RAGService,b as UserPersonalizationService,c as WorkspaceContextService,g as buildEnhancedContext,e as personalizationService,d as ragService,f as workspaceContextService};
