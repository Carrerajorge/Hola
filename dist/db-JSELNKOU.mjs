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
import{mb as a,nb as b,ob as c,pb as d,qb as e,rb as f,sb as g,tb as h,ub as i,vb as j,wb as k,xb as l,yb as m,zb as n}from"./chunk-PNGSAWMQ.mjs";import"./chunk-JAI7YO2C.mjs";import"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-UWSZBHDA.mjs";import"./chunk-6EWVFNKC.mjs";import"./chunk-JL5GVIQJ.mjs";export{c as db,d as dbRead,k as drainConnections,l as getDbMetrics,m as getDbMetricsText,f as getHealthStatus,g as isHealthy,a as pool,b as poolRead,e as runMigrations,i as startHealthChecks,j as stopHealthChecks,n as verifyDatabaseConnection,h as waitForHealthy};
