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
import{a as c}from"./chunk-W7KNROZK.mjs";import{z as _}from"zod";var h=_.string().min(1).max(8192),d=new Set(["utm_source","utm_medium","utm_campaign","utm_term","utm_content","utm_id","utm_cid","fbclid","gclid","gclsrc","dclid","gbraid","wbraid","msclkid","twclid","igshid","mc_cid","mc_eid","ref","ref_","source","src","campaign","affiliate","aff_id","partner","partner_id","tracking","track","trk","click_id","clickid","session_id","sessionid","visitor_id","visitorid","_ga","_gl","_hsenc","_hsmi","hsa_acc","hsa_cam","hsa_grp","hsa_ad","hsa_src","hsa_tgt","hsa_kw","hsa_mt","hsa_net","hsa_ver","oly_anon_id","oly_enc_id","s_kwcid","ef_id","s_cid","zanpid","spm","scm","_bta_tid","_bta_c","mkwid","pcrid","pmt","pkw","slid","gad_source"]),m=["utm_","fbad_","fb_","ga_","google_","bing_","ad_","ads_","campaign_","track_","click_","ref_","__hs","hsa_","mc_"];function p(i){let e=i.toLowerCase();if(d.has(e))return!0;for(let t of m)if(e.startsWith(t))return!0;return!1}function f(i){let e=c(h,i,"canonicalizeUrl"),t;try{let r=e.trim();r.match(/^https?:\/\//i)||(r=`https://${r}`),t=new URL(r)}catch{throw new Error(`Invalid URL format: ${i}`)}t.protocol=t.protocol.toLowerCase(),t.hostname=t.hostname.toLowerCase(),t.hostname.startsWith("www.")&&(t.hostname=t.hostname.slice(4)),(t.protocol==="http:"&&t.port==="80"||t.protocol==="https:"&&t.port==="443")&&(t.port="");let o=new URLSearchParams,n=[];t.searchParams.forEach((r,s)=>{p(s)||n.push([s,r])}),n.sort((r,s)=>r[0].localeCompare(s[0]));for(let[r,s]of n)o.append(r,s);t.search=o.toString()?`?${o.toString()}`:"",t.hash="";let a=t.pathname;return a=a.replace(/\/+/g,"/"),a.length>1&&a.endsWith("/")&&(a=a.slice(0,-1)),a=a.split("/").map(r=>{try{let s=decodeURIComponent(r);return encodeURIComponent(s)}catch{return r}}).join("/"),t.pathname=a,t.toString()}function w(i){try{return new URL(i.startsWith("http")?i:`https://${i}`).hostname.toLowerCase().replace(/^www\./,"")}catch{return""}}export{f as a,w as b};
