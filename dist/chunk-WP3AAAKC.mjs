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
import{a as d}from"./chunk-RFZBR23N.mjs";import{d as a}from"./chunk-VLL76GHB.mjs";import{nanoid as p}from"nanoid";import y from"node:crypto";var f=5e3,o=[],b=4096,h=8;function m(e,t=0,n=new WeakSet){if(e==null||typeof e!="object")return e;if(n.has(e))return"[circular]";if(n.add(e),t>=h)return"[max-depth]";if(e instanceof Date)return e.toISOString();if(Array.isArray(e))return e.map(r=>m(r,t+1,n));let s=e,i={},c=Object.keys(s);for(let r of c){if(r.startsWith("__proto__")||r==="prototype"||r==="constructor"){i[r]="[redacted]";continue}i[r]=m(s[r],t+1,n)}return i}function w(e){if(!e||typeof e!="object")return e?{value:d({value:e})}:void 0;let t=m(d(e)),n=JSON.stringify(t);if(n.length<=b)return t;let s=y.createHash("sha256").update(n).digest("hex");return t={_truncated:!0,_originalBytes:n.length,_sha256:s,_timestamp:new Date().toISOString()},t}function I(e){let t={...e,id:p(12),timestamp:new Date};o.push(t),o.length>f&&o.splice(0,o.length-f);let n={component:t.component,requestId:t.requestId,userId:t.userId,duration:t.duration,...t.metadata||{}};switch(t.level){case"debug":a.debug(t.message,n);break;case"info":a.info(t.message,n);break;case"warn":a.warn(t.message,n);break;case"error":a.error(t.message,n);break}}function l(e){let t,n,s,i=r=>(g,u)=>{let L=w(u);I({level:r,message:g,component:e,requestId:t,userId:n,duration:s,metadata:L})},c={debug:i("debug"),info:i("info"),warn:i("warn"),error:i("error"),child(r){return a.child({...r,component:e})},withRequest(r,g){let u=l(e);return u._setContext(r,g,s),u},withDuration(r){let g=l(e);return g._setContext(t,n,r),g}};return c._setContext=(r,g,u)=>{t=r,n=g,s=u},c}function E(e){let t=[...o];if(e){if(e.level&&(t=t.filter(n=>n.level===e.level)),e.component&&(t=t.filter(n=>n.component===e.component)),e.since){let n=new Date(e.since);t=t.filter(s=>s.timestamp>=n)}e.requestId&&(t=t.filter(n=>n.requestId===e.requestId)),e.userId&&(t=t.filter(n=>n.userId===e.userId)),e.limit&&e.limit>0&&(t=t.slice(-e.limit))}return t}function q(){let e={debug:0,info:0,warn:0,error:0},t={};for(let n of o)e[n.level]++,t[n.component]=(t[n.component]||0)+1;return{total:o.length,byLevel:e,byComponent:t,oldestEntry:o.length>0?o[0].timestamp:void 0,newestEntry:o.length>0?o[o.length-1].timestamp:void 0}}var A=l("system");export{l as a,E as b,q as c};
