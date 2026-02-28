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
function s(t){return t.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,"")}function u(t){return t>=65&&t<=90||t>=97&&t<=122}function c(t){if(!t)return!1;let r=t.charCodeAt(0);return u(r)||t==="/"||t==="!"||t==="?"}function o(t){let r=[],n=!1;for(let e=0;e<t.length;e++){let i=t[e];if(!n&&i==="<"){if(c(t[e+1])){n=!0;continue}r.push(i);continue}if(n){i===">"&&(n=!1);continue}r.push(i)}return r.join("")}var l={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#39;":"'","&#x27;":"'","&nbsp;":" "},a=/&(?:amp|lt|gt|quot|nbsp);|&#39;|&#x27;/gi;function f(t){return t.replace(a,r=>l[r.toLowerCase()]??r)}function g(t){return t.replace(/\s+/g," ").trim()}function p(t,r){if(typeof t!="string")return"";let n=t;n=s(n);try{n=n.normalize("NFC")}catch{}n=o(n),n=f(n),n=o(n),n=r?.collapseWs??!0?g(n):n.trim();let e=r?.maxLen;return typeof e=="number"&&e>0&&n.length>e&&(n=n.slice(0,e)),n}function m(t,r=500){return p(t,{maxLen:r,collapseWs:!0})}function h(t){if(typeof t!="string")return"";let r=t.trim();if(!r)return"";if(r.startsWith("//"))return`https:${r}`;try{let n=new URL(r);return n.protocol!=="http:"&&n.protocol!=="https:"?"":n.toString()}catch{return""}}export{p as a,m as b,h as c};
