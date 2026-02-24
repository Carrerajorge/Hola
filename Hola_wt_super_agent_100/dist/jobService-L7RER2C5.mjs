import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{a as i,c as n}from"./chunk-EP5DT7YM.mjs";import{h as r,i as c}from"./chunk-H7EJRODP.mjs";import"./chunk-2FP5DEJW.mjs";c();var a={PDF_GENERATE:"pdf-generate",EXCEL_PARSE:"excel-parse"},t=n(i.PROCESSING);async function p(o){if(!t)return r.warn("[JobService] Processing queue not available, skipping PDF job"),null;try{let e=await t.add(a.PDF_GENERATE,o,{priority:5,removeOnComplete:!0,attempts:3});return r.info(`[JobService] Dispatched PDF job ${e.id}`),e.id||null}catch(e){return r.error("[JobService] Failed to dispatch PDF job",e),null}}async function u(o){if(!t)return r.warn("[JobService] Processing queue not available, skipping Excel job"),null;try{let e=await t.add(a.EXCEL_PARSE,o,{priority:10,attempts:3});return r.info(`[JobService] Dispatched Excel job ${e.id}`),e.id||null}catch(e){return r.error("[JobService] Failed to dispatch Excel job",e),null}}export{a as JOB_NAMES,u as dispatchExcelParse,p as dispatchPdfGeneration};
