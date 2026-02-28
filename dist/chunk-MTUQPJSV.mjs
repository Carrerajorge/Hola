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
import{EventEmitter as r}from"events";var e=class extends r{constructor(){super();this.batch=[];this.MAX_BATCH_SIZE=250;this.on("event",t=>{this.batch.push(t),this.batch.length>=this.MAX_BATCH_SIZE&&this.flush()}),this.flushInterval=setInterval(()=>this.flush(),5e3)}async flush(){if(this.batch.length===0)return;let t=[...this.batch];this.batch=[];try{console.log(`[Telemetry] Flushed batch of ${t.length} events asynchronously (zstd compressed mock)`)}catch(n){console.error("[Telemetry] Flush failed, dropping batch to prevent memory leak",n)}}},h=new e;function i(s){return h.emit("event",s),!0}export{e as a,h as b,i as c};
