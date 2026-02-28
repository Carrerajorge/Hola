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
import{a as i,b as p}from"./chunk-HBMCPVPU.mjs";import{a as h}from"./chunk-QX6BTQ2X.mjs";import{a as u}from"./chunk-W7KNROZK.mjs";import{d as m,e as d,i as f}from"./chunk-TFKEBOLV.mjs";import"./chunk-23TNEANO.mjs";import"./chunk-JL5GVIQJ.mjs";f();var S=class{constructor(s=20){this.defaultMaxResults=s}async search(s,l){let c=u(i,{query:s,maxResults:l??this.defaultMaxResults},"SearchAdapter.search");try{let r=await m(c.query,c.maxResults),o=[];for(let e of r.results)try{let t=h(e.url),n={url:e.url,canonicalUrl:t,title:e.title||"",snippet:e.snippet||"",authors:e.authors,year:e.year,citation:e.citation},a=p.safeParse(n);a.success?o.push(a.data):console.warn("[SearchAdapter] Invalid result from search:",a.error.message)}catch(t){console.warn("[SearchAdapter] Failed to process search result:",t)}return o}catch(r){throw console.error(`[SearchAdapter] Search failed for query "${s}":`,r),new Error(`Search failed: ${r instanceof Error?r.message:"Unknown error"}`)}}async searchScholar(s,l){let c=u(i,{query:s,maxResults:l??this.defaultMaxResults,includeScholar:!0},"SearchAdapter.searchScholar");try{let r=await d(c.query,c.maxResults),o=[];for(let e of r.results)try{let t=h(e.url),n={url:e.url,canonicalUrl:t,title:e.title||"",snippet:e.snippet||"",authors:e.authors,year:e.year,citation:e.citation},a=p.safeParse(n);a.success&&o.push(a.data)}catch(t){console.warn("[SearchAdapter] Failed to process scholar result:",t)}return o}catch(r){throw console.error(`[SearchAdapter] Scholar search failed for query "${s}":`,r),new Error(`Scholar search failed: ${r instanceof Error?r.message:"Unknown error"}`)}}},x=new S;export{S as DuckDuckGoSearchAdapter,x as searchAdapter};
