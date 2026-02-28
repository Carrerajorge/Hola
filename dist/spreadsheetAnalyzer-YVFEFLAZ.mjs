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
import{a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z}from"./chunk-IR4R2SCF.mjs";import"./chunk-PNGSAWMQ.mjs";import"./chunk-JAI7YO2C.mjs";import"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-UWSZBHDA.mjs";import"./chunk-6EWVFNKC.mjs";import"./chunk-JL5GVIQJ.mjs";export{x as analyzeWorkbook,o as createAnalysisJob,m as createAnalysisOutput,j as createAnalysisSession,h as createSheet,c as createUpload,z as default,g as deleteUpload,w as detectInterSheetReferences,b as generateChecksum,v as generateCrossSheetSummary,q as getAnalysisJob,p as getAnalysisJobsBySession,n as getAnalysisOutputs,k as getAnalysisSession,s as getSheetByName,i as getSheets,d as getUpload,e as getUserUploads,u as inferColumnTypes,t as parseSpreadsheet,y as spreadsheetAnalyzer,r as updateAnalysisJob,l as updateAnalysisSession,f as updateUploadStatus,a as validateSpreadsheetFile};
