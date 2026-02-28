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
import{i as a,j as b,k as c,l as d,m as e,n as f,o as g}from"./chunk-FD7MBTGZ.mjs";import"./chunk-JL5GVIQJ.mjs";export{e as TOOL_CATEGORIES,b as ToolConfigSchema,a as ToolErrorCodeSchema,c as ToolImplementationStatus,d as ToolMetadataSchema,f as ToolRegistry,g as toolRegistry};
