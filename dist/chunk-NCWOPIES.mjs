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
var n=new Map;function a(t){return!!t&&t.expiresAt>Date.now()}function c(t){n.delete(String(t))}function l(){n.clear()}async function s(t){let e=String(t||"");if(!e)return null;let r=n.get(e);if(a(r))return r.value;try{let{storage:i}=await import("./storage-ZR7ZSENF.mjs"),o=await i.getIntegrationPolicy(e);return n.set(e,{value:o,expiresAt:Date.now()+1e4}),o}catch{return null}}export{c as a,l as b,s as c};
