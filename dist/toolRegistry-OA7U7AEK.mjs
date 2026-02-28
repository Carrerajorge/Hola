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
import{Ca as a,Da as b,Ea as c,Fa as d,Ga as e,Ha as f,Ia as g,Ja as h,Ka as i,La as j}from"./chunk-FS223YZ4.mjs";import"./chunk-62BGFGIM.mjs";import"./chunk-WCIRVKJN.mjs";import"./chunk-4JWTKVM3.mjs";import"./chunk-WRSRS3UV.mjs";import"./chunk-WSNG5WO6.mjs";import"./chunk-X7MS7TM4.mjs";import"./chunk-YQXQUKB3.mjs";import"./chunk-W7KNROZK.mjs";import"./chunk-5JBUO3EL.mjs";import"./chunk-FH7SSPHR.mjs";import"./chunk-KCR6A6FV.mjs";import"./chunk-IR4R2SCF.mjs";import"./chunk-TFKEBOLV.mjs";import"./chunk-DJCA23M6.mjs";import"./chunk-727B7WSG.mjs";import"./chunk-K5UZFPVK.mjs";import"./chunk-NCWOPIES.mjs";import"./chunk-AKX5KR4K.mjs";import"./chunk-HX7KPIND.mjs";import"./chunk-NV6BNJ64.mjs";import"./chunk-KRFCN6YW.mjs";import"./chunk-Q245SVP2.mjs";import"./chunk-EHTWEZTA.mjs";import"./chunk-WP3AAAKC.mjs";import"./chunk-RFZBR23N.mjs";import"./chunk-OQFD36C4.mjs";import"./chunk-E4MBEG5H.mjs";import"./chunk-WKASVOUS.mjs";import"./chunk-5B23YN35.mjs";import"./chunk-23TNEANO.mjs";import"./chunk-PNGSAWMQ.mjs";import"./chunk-JAI7YO2C.mjs";import"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-UWSZBHDA.mjs";import"./chunk-6EWVFNKC.mjs";import"./chunk-JL5GVIQJ.mjs";export{a as ToolDefinitionSchema,b as ToolRegistry,e as analyzeSpreadsheetSchema,h as browseUrlSchema,c as createArtifact,d as createError,i as generateDocumentSchema,g as generateImageSchema,j as toolRegistry,f as webSearchSchema};
