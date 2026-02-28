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
import{randomBytes as l}from"crypto";function c(e){let n=e.user,i=n?.claims?.sub||n?.id;if(i)return i;let t=e.session;if(t?.authUserId)return t.authUserId;let s=t?.passport?.user;if(typeof s=="string"&&s)return s;if(s?.claims?.sub)return s.claims.sub;if(s?.id)return s.id;let r=e.headers["x-anonymous-user-id"];if(r&&typeof r=="string"&&t?.anonUserId&&r===t.anonUserId)return r;if(t&&!t.anonUserId){let a=e.sessionID;a&&(t.anonUserId=`anon_${a}`)}return t?.anonUserId||null}function g(e){let n=c(e);return n||`anon_${l(16).toString("hex")}`}var u=new Map,o=new Map,p=[5,10,25,50,100,250,500,1e3,2500,5e3,1e4];function f(e){u.set(e.name,{...e,type:"counter"}),o.set(e.name,[])}function h(e){u.set(e.name,{...e,type:"gauge"}),o.set(e.name,[])}function d(e){u.set(e.name,{...e,type:"histogram",buckets:e.buckets||p}),o.set(e.name,[])}function _(e,n={},i=1){let t=o.get(e);if(!t)return;let s=JSON.stringify(n),r=t.find(a=>JSON.stringify(a.labels)===s);r?(r.value+=i,r.timestamp=Date.now()):t.push({value:i,labels:n,timestamp:Date.now()})}function y(e,n,i={}){let t=o.get(e);if(!t)return;let s=JSON.stringify(i),r=t.find(a=>JSON.stringify(a.labels)===s);r?(r.value=n,r.timestamp=Date.now()):t.push({value:n,labels:i,timestamp:Date.now()})}function M(e,n,i={}){let t=u.get(e);if(!t||t.type!=="histogram")return;let s=o.get(e);s&&(s.push({value:n,labels:i,timestamp:Date.now()}),s.length>1e4&&s.splice(0,s.length-1e4))}export{c as a,g as b,f as c,h as d,d as e,_ as f,y as g,M as h};
