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
import{a as f}from"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-JL5GVIQJ.mjs";import{spawn as k}from"child_process";function g(e,r){return e.length<=r?e.toString("utf8"):e.subarray(0,r).toString("utf8")+`
[truncated ${e.length-r} bytes]`}async function M(e,r){let s=Date.now();return await new Promise(m=>{let o=!1,u=t=>{o||(o=!0,m(t))},n;try{n=k(e.bin,e.args,{shell:!1,stdio:["ignore","pipe","pipe"],env:{...process.env,...r.env??{}}})}catch(t){return u({ok:!1,exitCode:1,signal:null,stdout:"",stderr:`Failed to spawn ${e.bin}: ${t?.message||String(t)}`,durationMs:Date.now()-s})}let a=[],i=[],l=0,c=0,d=setTimeout(()=>{f.warn("[PackageExecutor] Timeout, killing process",{display:e.display,timeoutMs:r.timeoutMs});try{n.kill("SIGKILL")}catch{}},r.timeoutMs);n.stdout?.on("data",t=>{l<r.maxOutputBytes&&a.push(t),l+=t.length}),n.stderr?.on("data",t=>{c<r.maxOutputBytes&&i.push(t),c+=t.length}),n.on("error",t=>{clearTimeout(d),u({ok:!1,exitCode:1,signal:null,stdout:"",stderr:`Failed to spawn ${e.bin}: ${t?.message||String(t)}`,durationMs:Date.now()-s})}),n.on("close",(t,p)=>{clearTimeout(d);let x=Date.now()-s,y=Buffer.concat(a),b=Buffer.concat(i),B=g(y,r.maxOutputBytes),h=g(b,r.maxOutputBytes);u({ok:t===0,exitCode:t,signal:p,stdout:B,stderr:h,durationMs:x})})})}function E(e){return["apt","dnf","yum","apk","pacman","port"].includes(e)}export{M as executeCommand,E as requiresNonInteractiveSudo};
