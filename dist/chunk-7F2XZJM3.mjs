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
var p=_(process.env.SCOPUS_SOFT_LIMIT_PERCENT,.9),S=M(process.env.SCOPUS_SOFT_LIMIT_MIN_REMAINING,100,0),b=M(process.env.SCOPUS_SOFT_LIMIT_COOLDOWN_MS,900*1e3,1e3),e={};function _(t,n){let i=Number(t);return Number.isFinite(i)?Math.max(.5,Math.min(.99,i)):n}function M(t,n,i=0){let r=Number(t);return Number.isFinite(r)?Math.max(i,Math.floor(r)):n}function o(t,n){if(!t)return;if(typeof t.get=="function")return t.get(n)??t.get(n.toLowerCase())??void 0;let i=t,r=i[n];if(typeof r=="string")return r;let u=i[n.toLowerCase()];if(typeof u=="string")return u;let s=n.toLowerCase();for(let[l,m]of Object.entries(i))if(l.toLowerCase()===s&&typeof m=="string")return m}function a(t){if(!t)return;let n=Number(t);if(!Number.isFinite(n))return;let i=Math.floor(n);return i>=0?i:void 0}function g(t){let n=a(t);if(n!==void 0)return n<1e10?n*1e3:n}function d(t,n){if(!t||t<=0||n===void 0)return!1;let i=(t-n)/t;return n<=S?!0:i>=p}function c(t){e.pausedUntilMs&&t>=e.pausedUntilMs&&(e.pausedUntilMs=void 0,e.pauseReason=void 0),e.resetAtMs&&t>=e.resetAtMs&&(e.resetAtMs=void 0,e.limit=void 0,e.remaining=void 0)}function I(t){return e.resetAtMs&&e.resetAtMs>t?e.resetAtMs:t+b}function f(t){let n=Date.now();e.pausedUntilMs=I(n),e.pauseReason=t,e.updatedAtMs=n}function A(){let t=Date.now();return c(t),!e.pausedUntilMs&&d(e.limit,e.remaining)&&f("soft_limit"),!!e.pausedUntilMs&&t<e.pausedUntilMs?{allowed:!1,reason:e.pauseReason==="rate_limited"?"Scopus rate-limited (429). Waiting for reset.":`Scopus soft-limit reached (${Math.round(p*100)}%). Paused before hard limit.`,retryAtMs:e.pausedUntilMs,state:{...e}}:{allowed:!0,state:{...e}}}function N(t,n){let i=Date.now(),r=a(o(t,"x-ratelimit-limit")),u=a(o(t,"x-ratelimit-remaining")),s=g(o(t,"x-ratelimit-reset"));if(r!==void 0&&(e.limit=r),u!==void 0&&(e.remaining=u),s!==void 0&&(e.resetAtMs=s),n!==void 0&&(e.lastStatus=n),e.updatedAtMs=i,c(i),n===429){f("rate_limited");return}if(d(e.limit,e.remaining)){f("soft_limit");return}e.pausedUntilMs&&!d(e.limit,e.remaining)&&(e.pausedUntilMs=void 0,e.pauseReason=void 0)}function O(){return c(Date.now()),{...e}}export{A as a,N as b,O as c};
