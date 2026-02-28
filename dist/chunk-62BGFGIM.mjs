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
import{a as n}from"./chunk-F7574FHZ.mjs";var s=class{constructor(){this.hooks=new Map}register(o,t){this.hooks.has(o)||this.hooks.set(o,[]),this.hooks.get(o).push(t)}unregister(o,t){let e=this.hooks.get(o);if(!e)return;let r=e.indexOf(t);r>=0&&e.splice(r,1)}async dispatch(o,t){let e=this.hooks.get(o);if(!(!e||e.length===0))for(let r of e)try{await r(t)}catch(i){n.error(`[OpenClaw:Hooks] Hook ${o} handler error: ${i.message}`)}}getRegisteredPoints(){return Array.from(this.hooks.keys())}getHandlerCount(o){return this.hooks.get(o)?.length??0}clear(){this.hooks.clear()}},k=new s;export{k as a};
