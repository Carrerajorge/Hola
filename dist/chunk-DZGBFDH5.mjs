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
import{EventEmitter as A}from"events";var e=class extends A{emitAuth(t){this.emit("auth",t)}onAuth(t){return this.on("auth",t)}publish(t,n,i={},r){let E=new Date,o=E.toISOString().replace(/\.\d{3}Z$/,""),s={type:t,userId:n,timestamp:E,correlationId:r||`evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,data:i,idempotencyKey:`${n}:${t}:${o}`};this.emitAuth(s)}},a=new e;a.setMaxListeners(20);export{a};
