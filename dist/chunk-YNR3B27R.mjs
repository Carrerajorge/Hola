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
import{ob as r,va as o}from"./chunk-PNGSAWMQ.mjs";import{e as c}from"./chunk-6EWVFNKC.mjs";import{eq as n}from"drizzle-orm";var w="default";async function l(e){let[t]=await r.select().from(o).where(n(o.orgId,e)).limit(1);if(t)return t;let[s]=await r.insert(o).values({orgId:e,networkAccessEnabled:!1}).returning();return s}async function d(e){let[t]=await r.select().from(c).where(n(c.id,e)).limit(1),s=t?.orgId||w,i=!!t?.networkAccessEnabled,a=!!(await l(s)).networkAccessEnabled;return{orgId:s,orgNetworkAccessEnabled:a,userNetworkAccessEnabled:i,effectiveNetworkAccessEnabled:a&&i,lockedByOrg:!a}}async function E(e,t){return await r.update(c).set({networkAccessEnabled:t}).where(n(c.id,e)),d(e)}async function m(e,t){await l(e),await r.update(o).set({networkAccessEnabled:t,updatedAt:new Date}).where(n(o.orgId,e));let[s]=await r.select().from(o).where(n(o.orgId,e)).limit(1);return s}export{d as a,E as b,m as c};
