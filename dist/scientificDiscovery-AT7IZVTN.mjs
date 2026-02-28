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
import{a as n}from"./chunk-NVIOJ6KR.mjs";import"./chunk-E4MBEG5H.mjs";import{a as s}from"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-JL5GVIQJ.mjs";var r=class{async synthesizeLiterature(e){return s.info(`[Science] Researching topic: ${e}`),(await n.generateCompletion({taskId:"lit-review",messages:[{role:"system",content:"You are a senior research scientist. Synthesize the current state of the art on this topic based on your training data. Cite simulated references."},{role:"user",content:e}],requirements:{tier:"ultra"}})).content}},i=class{async generateHypotheses(e,t){let c=await n.generateCompletion({taskId:"hypothesis-gen",messages:[{role:"system",content:"Generate 3 valid scientific hypotheses to explain the observation. Return JSON."},{role:"user",content:`Context: ${t}

Observation: ${e}`}],requirements:{tier:"ultra",jsonMode:!0}});try{let g=JSON.parse(c.content);return g.hypotheses||g}catch{return[]}}},o=class{async runThoughtExperiment(e,t){return s.info(`[Science] Running thought experiment: ${e}`),(await n.generateCompletion({taskId:"thought-experiment",messages:[{role:"system",content:"Run a detailed step-by-step mental simulation (thought experiment) of the scenario. Consider edge cases and second-order effects."},{role:"user",content:`Scenario: ${e}
Variables: ${JSON.stringify(t)}`}],requirements:{tier:"ultra",minContext:16e3}})).content}},m=new r,u=new i,l=new o;export{r as AutomatedResearcher,i as HypothesisGenerator,o as SimulationEngine,u as hypothesis,m as researcher,l as simulator};
