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
import{a,b,c,d,e,f,g,h,i,j,k,l}from"./chunk-DOODR2FS.mjs";import"./chunk-JL5GVIQJ.mjs";export{c as AudienceToneSchema,i as CanonicalBriefSchema,g as ClarificationQuestionSchema,d as DataClassificationSchema,b as DeliverableSpecSchema,h as ImageAnalysisSchema,f as RiskAmbiguitySchema,a as SubTaskSchema,e as SuccessCriterionSchema,l as createEmptyBrief,j as getBriefJsonSchema,k as parseBrief};
