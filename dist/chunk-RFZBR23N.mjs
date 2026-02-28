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
import y from"node:net";import b from"node:path";var x=["password","token","secret","apiKey","api_key","authorization","cookie","session","credit_card","ssn","cvv","pin","private_key","access_token","refresh_token","bearer"];function E(s){if(!s||typeof s!="object")return s;let r={...s};for(let[t,n]of Object.entries(r)){let u=t.toLowerCase();x.some(o=>u.includes(o))?r[t]="[REDACTED]":Array.isArray(n)?r[t]=n.map(o=>E(o)):typeof n=="object"&&n!==null&&(r[t]=E(n))}return r}function P(s,r=255){if(typeof s!="string")return"";let t=s.replace(/[\/\\:\*\?"<>|\x00\r\n\t]/g,"_");if(t=t.replace(/[^\x20-\x7E]/g,"_"),t.length>r){let n=b.extname(t);t=t.substring(0,r-n.length)+n}return t}function _(s){if(!s)return!1;let r=s.trim().toLowerCase();if(!r)return!1;let t=r.replace(/^\[(.+)\]$/,"$1");if(t==="localhost"||t==="::1"||t==="0:0:0:0:0:0:0:1")return!0;let n=y.isIP(t);if(n===4){let e=t.split(".").map(i=>Number.parseInt(i,10));return e.length!==4||e.some(i=>Number.isNaN(i)||i<0||i>255)?!1:e[0]===10||e[0]===127||e[0]===172&&e[1]>=16&&e[1]<=31||e[0]===192&&e[1]===168}if(n===6){let e=(()=>{let d=["::ffff:","0:0:0:0:0:ffff:"].find(l=>t.startsWith(l));if(!d)return null;let p=t.slice(d.length);if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(p))return p;let f=p.split(":");if((f.length===1||f.length===2)&&f.every(l=>/^[0-9a-f]{1,4}$/i.test(l))){let a=f.map(c=>c.padStart(4,"0")).join("");if(a.length===8){let c=Number.parseInt(a.slice(0,2),16),g=Number.parseInt(a.slice(2,4),16),m=Number.parseInt(a.slice(4,6),16),h=Number.parseInt(a.slice(6,8),16);if([c,g,m,h].every(T=>Number.isFinite(T)))return`${c}.${g}.${m}.${h}`}}return null})();if(e)return _(e);if(t.startsWith("fc")||t.startsWith("fd")||t.startsWith("fe8")||t.startsWith("fe9")||t.startsWith("fea")||t.startsWith("feb")||t.startsWith("fec")||t.startsWith("fed")||t.startsWith("fee")||t.startsWith("fef")||t.startsWith("fe80"))return!0}let u=["10.","172.16.","172.17.","172.18.","172.19.","172.20.","172.21.","172.22.","172.23.","172.24.","172.25.","172.26.","172.27.","172.28.","172.29.","172.30.","172.31.","192.168."],o=t.replace("::ffff:","");return u.some(e=>o.startsWith(e))}export{E as a,P as b,_ as c};
