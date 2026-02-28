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
import{a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q}from"./chunk-VIHFOOHA.mjs";import"./chunk-K5UZFPVK.mjs";import"./chunk-JL5GVIQJ.mjs";export{o as AcademicResearchEngineV3,p as academicEngineV3,q as default,l as exportToBibTeX,n as exportToCSV,j as exportToExcel,m as exportToRIS,k as exportToWord,h as generateAMACitation,b as generateAPACitation,i as generateASACitation,d as generateChicagoCitation,a as generateCitation,e as generateHarvardCitation,f as generateIEEECitation,c as generateMLACitation,g as generateVancouverCitation};
