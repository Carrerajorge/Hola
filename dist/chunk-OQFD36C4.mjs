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
import{c as e,d as o,e as p,k as I}from"./chunk-E4MBEG5H.mjs";import{b as E,c as t}from"./chunk-JL5GVIQJ.mjs";var s={};t(s,{MODELS:()=>A,openai:()=>_});import O from"openai";var _,A,L=E(()=>{I();_=new O({baseURL:"https://api.x.ai/v1",apiKey:process.env.XAI_API_KEY||"missing"}),A={TEXT:e,VISION:p,GROK_REASONING:o}});export{_ as a,A as b,s as c,L as d};
