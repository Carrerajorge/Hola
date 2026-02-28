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
import{La as r,ea as n,la as c,ma as m,na as p}from"./chunk-FS223YZ4.mjs";import"./chunk-62BGFGIM.mjs";import"./chunk-WCIRVKJN.mjs";import"./chunk-4JWTKVM3.mjs";import"./chunk-WRSRS3UV.mjs";import"./chunk-WSNG5WO6.mjs";import"./chunk-X7MS7TM4.mjs";import"./chunk-YQXQUKB3.mjs";import"./chunk-W7KNROZK.mjs";import"./chunk-5JBUO3EL.mjs";import"./chunk-FH7SSPHR.mjs";import"./chunk-KCR6A6FV.mjs";import"./chunk-IR4R2SCF.mjs";import"./chunk-TFKEBOLV.mjs";import"./chunk-DJCA23M6.mjs";import"./chunk-727B7WSG.mjs";import"./chunk-K5UZFPVK.mjs";import"./chunk-NCWOPIES.mjs";import"./chunk-AKX5KR4K.mjs";import"./chunk-HX7KPIND.mjs";import"./chunk-NV6BNJ64.mjs";import"./chunk-KRFCN6YW.mjs";import"./chunk-Q245SVP2.mjs";import"./chunk-EHTWEZTA.mjs";import"./chunk-WP3AAAKC.mjs";import"./chunk-RFZBR23N.mjs";import"./chunk-OQFD36C4.mjs";import"./chunk-E4MBEG5H.mjs";import"./chunk-WKASVOUS.mjs";import"./chunk-5B23YN35.mjs";import"./chunk-23TNEANO.mjs";import"./chunk-PNGSAWMQ.mjs";import"./chunk-JAI7YO2C.mjs";import{a as t}from"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-UWSZBHDA.mjs";import"./chunk-6EWVFNKC.mjs";import"./chunk-JL5GVIQJ.mjs";function u(o){let a=new p({safeBins:o.tools.safeBins,security:o.tools.execSecurity,timeout:o.tools.execTimeout}),s=m(a,o.tools.workspaceRoot);r.register(s),t.info(`[OpenClaw:Tools] Registered tool: ${s.name}`);let l=c(o.tools.workspaceRoot,!0);for(let e of l)r.register(e),t.info(`[OpenClaw:Tools] Registered tool: ${e.name}`);let i=n();for(let e of i)r.register(e),t.info(`[OpenClaw:Tools] Registered tool: ${e.name}`);t.info(`[OpenClaw:Tools] ${1+l.length+i.length} tools registered`)}export{u as registerOpenClawTools};
