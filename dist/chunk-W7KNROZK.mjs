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
function s(t,a,r){let e=t.safeParse(a);if(!e.success)throw console.error(`[Validation] ${r} failed:`,e.error.errors),new o(r,e.error);return e.data}var o=class t extends Error{constructor(r,e){super(`Validation failed in ${r}: ${e.message}`);this.context=r;this.zodError=e;this.name="ValidationError",this.originalStack=new Error().stack||"",Error.captureStackTrace?.(this,t)}getFormattedErrors(){return this.zodError.errors.map(r=>`${r.path.join(".")}: ${r.message}`)}toJSON(){return{name:this.name,context:this.context,message:this.message,errors:this.getFormattedErrors()}}};export{s as a,o as b};
