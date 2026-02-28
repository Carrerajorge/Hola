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
import"./chunk-JL5GVIQJ.mjs";function d(t){let o=[...t.matchAll(/\{(\w+)\}/g)].map(s=>s[1]);return{template:t,inputVariables:o}}function l(t,o){let s=t.template;for(let e of t.inputVariables){let r=o[e];r!==void 0&&(s=s.split(`{${e}}`).join(r))}return s}async function h(t,o){let s=Date.now(),e=[],r={...o};for(let n of t){let a=Date.now(),i=l(n.prompt,r),u=n.transform?n.transform(i):i,c=n.outputKey||`${n.name}_output`;e.push({name:n.name,input:{...r},output:u,durationMs:Date.now()-a}),r[c]=u}return{steps:e,finalOutput:e[e.length-1]?.output||"",totalDurationMs:Date.now()-s,variables:r}}async function w(t,o){let s=Date.now(),e={...o},r=await Promise.all(t.map(async n=>{let a=Date.now(),i=l(n.prompt,e),u=n.transform?n.transform(i):i;return{name:n.name,input:{...e},output:u,durationMs:Date.now()-a,outputKey:n.outputKey||`${n.name}_output`}}));for(let n of r)e[n.outputKey]=n.output;return{steps:r.map(({outputKey:n,...a})=>a),finalOutput:r[r.length-1]?.output||"",totalDurationMs:Date.now()-s,variables:e}}async function D(t,o,s,e="item",r="mapped_results"){let n=Date.now(),a=[],i=[];for(let p=0;p<t.length;p++){let f=Date.now(),g=l(o,{[e]:t[p],index:String(p)});i.push(g),a.push({name:`map_${p}`,input:{[e]:t[p]},output:g,durationMs:Date.now()-f})}let u=Date.now(),c=i.join(`
---
`),m=l(s,{[r]:c});return a.push({name:"reduce",input:{[r]:c},output:m,durationMs:Date.now()-u}),{steps:a,finalOutput:m,totalDurationMs:Date.now()-n,variables:{[r]:c}}}function R(...t){return o=>t.reduce((s,e)=>e(s),o)}var x={uppercase:t=>t.toUpperCase(),lowercase:t=>t.toLowerCase(),trim:t=>t.trim(),stripHtml:t=>t.replace(/<[^>]*>/g,""),extractFirstLine:t=>t.split(`
`)[0]||"",wordCount:t=>`Word count: ${t.split(/\s+/).filter(Boolean).length}`,sentenceCount:t=>`Sentence count: ${t.split(/[.!?]+/).filter(Boolean).length}`,truncate:t=>o=>o.length>t?o.slice(0,t)+"...":o};export{R as composeTransforms,d as createPrompt,h as executeChain,w as executeParallelChain,l as formatPrompt,D as mapReduceChain,x as transforms};
