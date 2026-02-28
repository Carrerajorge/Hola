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
import{ob as s,t as e}from"./chunk-PNGSAWMQ.mjs";import"./chunk-JAI7YO2C.mjs";import"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-UWSZBHDA.mjs";import"./chunk-6EWVFNKC.mjs";import"./chunk-JL5GVIQJ.mjs";import{Router as a}from"express";import{eq as c}from"drizzle-orm";function u(){let t=a();return t.get("/",async(i,o)=>{try{let r=await s.select().from(e).where(c(e.isActive,"true")).orderBy(e.createdAt);o.json(r)}catch(r){console.error("[Public Releases API] fetch error:",r),o.status(500).json({error:"Failed to fetch active app releases."})}}),t}export{u as createPublicReleasesRouter};
