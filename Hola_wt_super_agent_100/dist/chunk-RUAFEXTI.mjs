import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{Ta as o,Va as w,Ya as r,f as c,hb as d}from"./chunk-SFS5HO6Q.mjs";d();w();import{eq as n}from"drizzle-orm";var b="default";async function l(e){let[t]=await r.select().from(o).where(n(o.orgId,e)).limit(1);if(t)return t;let[s]=await r.insert(o).values({orgId:e,networkAccessEnabled:!1}).returning();return s}async function g(e){let[t]=await r.select().from(c).where(n(c.id,e)).limit(1),s=t?.orgId||b,i=!!t?.networkAccessEnabled,a=!!(await l(s)).networkAccessEnabled;return{orgId:s,orgNetworkAccessEnabled:a,userNetworkAccessEnabled:i,effectiveNetworkAccessEnabled:a&&i,lockedByOrg:!a}}async function y(e,t){return await r.update(c).set({networkAccessEnabled:t}).where(n(c.id,e)),g(e)}async function N(e,t){await l(e),await r.update(o).set({networkAccessEnabled:t,updatedAt:new Date}).where(n(o.orgId,e));let[s]=await r.select().from(o).where(n(o.orgId,e)).limit(1);return s}export{g as a,y as b,N as c};
