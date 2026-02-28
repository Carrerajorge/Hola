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
import{chromium as ae}from"playwright";import oe from"dompurify";import{JSDOM as ce}from"jsdom";import{createHash as C}from"node:crypto";var y=200,X=/[^a-zA-Z0-9\s\-_.\u00C0-\u024F\u0400-\u04FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/g;function Ee(e,t){if(!e||typeof e!="string")return`document_${Date.now()}${t}`;let n=e.replace(/[/\\]/g,"").replace(/\0/g,"").replace(/[\x00-\x1F\x7F]/g,"").replace(/[\r\n]/g,"").replace(/["']/g,"").replace(X,"_").replace(/_+/g,"_").replace(/^[_.]+|[_.]+$/g,"").trim();return n.length>y&&(n=n.substring(0,y)),n||(n=`document_${Date.now()}`),`${n}${t}`}function Te(e){let t=e.replace(/[^\x20-\x7E]/g,"_"),n=encodeURIComponent(e);return`attachment; filename="${t}"; filename*=UTF-8''${n}`}var Se=16*1024;var Ae=1*1024*1024,De=10*1024*1024;var M=100*1024*1024,k=25*1024*1024,G=1440*60*1e3,U=120*1e3,W=10080*60*1e3,P=180;function R(e){return typeof e!="string"?"application/octet-stream":e.split(";")[0]?.trim().toLowerCase()||"application/octet-stream"}var j={"application/vnd.openxmlformats-officedocument.wordprocessingml.document":[80,75,3,4],"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":[80,75,3,4],"application/vnd.openxmlformats-officedocument.presentationml.presentation":[80,75,3,4],"application/pdf":[37,80,68,70]},q={".docx":[80,75,3,4],".xlsx":[80,75,3,4],".pptx":[80,75,3,4],".pdf":[37,80,68,70]};function L(e){if(!e||typeof e!="string")return`shared_document_${Date.now()}`;let t=e.replace(/[/\\]/g,"").replace(/\0/g,"").replace(/[\r\n]/g,"").replace(/[\x00-\x1F\x7F]/g,"").replace(/["']/g,"");return t.length>P&&(t=t.slice(0,P)),t||`shared_document_${Date.now()}`}function Y(e){let t=e.lastIndexOf(".");return t<0?"":e.slice(t).toLowerCase()}function V(e,t,n){let r=R(t),s=L(n),c=j[r],o=q[Y(s)],a=c??o;if(!a||!Buffer.isBuffer(e)||e.length<a.length)return!1;for(let i=0;i<a.length;i+=1)if(e[i]!==a[i])return!1;return!0}var Z={word:[80,75,3,4],excel:[80,75,3,4],ppt:[80,75,3,4],docx:[80,75,3,4],xlsx:[80,75,3,4],pptx:[80,75,3,4],cv:[80,75,3,4],report:[80,75,3,4],letter:[80,75,3,4],pdf:[37,80,68,70]};function we(e,t){if(!e||e.length===0)return{valid:!1,error:`Generated ${t} document is empty`};if(e.length>M)return{valid:!1,error:`Generated ${t} document exceeds maximum size of ${M/1024/1024}MB`};let n=Z[t.toLowerCase()];return n&&e.length>=n.length&&!n.every((s,c)=>e[c]===s)?{valid:!1,error:`Generated ${t} document has invalid file signature`}:{valid:!0}}var u={MAX_SLIDES:200,MAX_TEXT_ELEMENTS_PER_SLIDE:50,MAX_CONTENT_ITEMS_PER_SLIDE:20,MAX_SLIDE_TITLE_LENGTH:500,MAX_SLIDE_CONTENT_LENGTH:5e3,WARN_SLIDES:100,WARN_TEXT_ELEMENTS:30};function be(e){let t=[];return!Array.isArray(e)||e.length===0?(t.push({code:"PPT_E001",message:"Presentation must have at least one slide",path:"slides",severity:"error"}),v(t)):(e.length>u.MAX_SLIDES?t.push({code:"PPT_E002",message:`Presentation has ${e.length} slides, maximum allowed is ${u.MAX_SLIDES}`,path:"slides",severity:"error"}):e.length>u.WARN_SLIDES&&t.push({code:"PPT_W001",message:`Presentation has ${e.length} slides, consider splitting into multiple presentations`,path:"slides",severity:"warning"}),e.forEach((n,r)=>{let s=`slides[${r}]`;!n.title||typeof n.title!="string"?t.push({code:"PPT_E003",message:`Slide ${r+1} has no title`,path:`${s}.title`,severity:"error"}):n.title.length>u.MAX_SLIDE_TITLE_LENGTH&&t.push({code:"PPT_E004",message:`Slide ${r+1} title exceeds ${u.MAX_SLIDE_TITLE_LENGTH} characters`,path:`${s}.title`,severity:"error"}),Array.isArray(n.content)?(n.content.length>u.MAX_CONTENT_ITEMS_PER_SLIDE&&t.push({code:"PPT_E006",message:`Slide ${r+1} has ${n.content.length} content items, maximum is ${u.MAX_CONTENT_ITEMS_PER_SLIDE}`,path:`${s}.content`,severity:"error"}),n.content.forEach((c,o)=>{typeof c=="string"&&c.length>u.MAX_SLIDE_CONTENT_LENGTH&&t.push({code:"PPT_E007",message:`Slide ${r+1}, content item ${o+1} exceeds ${u.MAX_SLIDE_CONTENT_LENGTH} characters`,path:`${s}.content[${o}]`,severity:"error"})})):t.push({code:"PPT_E005",message:`Slide ${r+1} content must be an array`,path:`${s}.content`,severity:"error"})}),v(t))}function v(e){let t=e.filter(r=>r.severity==="error").map(({code:r,message:s,path:c})=>({code:r,message:s,path:c})),n=e.filter(r=>r.severity==="warning").map(({code:r,message:s,path:c})=>({code:r,message:s,path:c}));return{valid:t.length===0,errors:t,warnings:n}}function B(e){let t=[],n=[];return!e||e.length===0?(t.push("PDF buffer is empty"),{valid:!1,errors:t,warnings:n}):e.subarray(0,5).toString("ascii").startsWith("%PDF-")?(e.length<100&&n.push("PDF is unusually small, may be incomplete"),e.subarray(Math.max(0,e.length-1024)).toString("ascii").includes("%%EOF")||n.push("PDF may be incomplete (missing %%EOF marker)"),{valid:t.length===0,errors:t,warnings:n}):(t.push("Buffer does not have valid PDF signature (expected %PDF- header)"),{valid:!1,errors:t,warnings:n})}var J=/^[a-f0-9]{64}$/;function ye(e){return C("sha256").update(e).digest("hex")}var T=1e3,Q=3600*1e3,K=/^[a-zA-Z0-9_-]{8,64}$/,ee=100,N=1,O=1e3;function te(e){let t=Number(e);if(!Number.isFinite(t))return ee;let n=Math.floor(t);return n<N?N:n>O?O:n}function I(e){return{...e,blob:Buffer.from(e.blob),createdAt:new Date(e.createdAt),expiresAt:new Date(e.expiresAt),lastAccessedAt:e.lastAccessedAt?new Date(e.lastAccessedAt):void 0}}var S=class{constructor(){this.documents=new Map;this.cleanupTimer=null;this.cleanupTimer=setInterval(()=>this.cleanup(),Q),typeof this.cleanupTimer=="object"&&this.cleanupTimer&&"unref"in this.cleanupTimer&&this.cleanupTimer.unref()}set(t,n,r=G){if(typeof t!="string"||!K.test(t)||!n||!Buffer.isBuffer(n.blob)||!n.blob.length||n.blob.length>k||typeof n.filename!="string"||!n.filename||n.downloadTokenHash!==void 0&&(typeof n.downloadTokenHash!="string"||!J.test(n.downloadTokenHash))||this.documents.has(t))return!1;if(this.documents.size>=T&&(this.cleanup(),this.documents.size>=T))return console.warn("[SharedDocumentStore] Maximum capacity reached, rejecting new document"),!1;let s=Math.min(Math.max(r,U),W),c=Date.now(),o=L(n.filename),a=R(n.contentType),i=Buffer.from(n.blob),l=`W/"${C("sha256").update(i).digest("hex")}"`,d=te(n.maxAccesses??process.env.SHARE_MAX_DOWNLOADS);return V(i,a,o)?(this.documents.set(t,{...n,blob:i,filename:o,contentType:a,createdAt:new Date(c),etag:l,byteLength:i.length,accessCount:0,maxAccesses:d,lastAccessedAt:void 0,expiresAt:new Date(c+s)}),!0):!1}get(t){let n=this.documents.get(t);return n?n.expiresAt<new Date?(this.documents.delete(t),null):I(n):null}consume(t){let n=this.documents.get(t);if(!n)return null;let r=new Date;return n.expiresAt<r?(this.documents.delete(t),null):n.accessCount>=n.maxAccesses?(this.documents.delete(t),null):(n.accessCount+=1,n.lastAccessedAt=r,this.documents.set(t,n),I(n))}delete(t){this.documents.delete(t)}get size(){return this.documents.size}cleanup(){let t=new Date,n=this.documents.size,r=0,s=[];for(let[o,a]of this.documents)a.expiresAt<t&&s.push(o);for(let o of s)this.documents.delete(o)&&(r+=1);let c=Math.max(0,T-1);if(this.documents.size>c){let o=this.documents.size-c,a=[...this.documents.entries()].sort(([,i],[,l])=>{let d=i.createdAt.getTime()-l.createdAt.getTime();return d!==0?d:i.expiresAt.getTime()-l.expiresAt.getTime()});for(let i=0;i<o;i+=1){let[l]=a[i]||[];l&&this.documents.delete(l)&&(r+=1)}}r>0&&console.log(`[SharedDocumentStore] Cleaned up ${r} documents from ${n} entries, ${this.documents.size} remaining`)}destroy(){this.cleanupTimer&&(clearInterval(this.cleanupTimer),this.cleanupTimer=null),this.documents.clear()}},Me=new S;function g(e){let t={...e,timestamp:e.timestamp||new Date().toISOString()};console.log(`[DocAudit] ${JSON.stringify(t)}`)}var ne={"X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","X-Download-Options":"noopen","Cache-Control":"no-store, no-cache, must-revalidate, private",Pragma:"no-cache","Content-Security-Policy":"default-src 'none'"};function Pe(e){for(let[t,n]of Object.entries(ne))e.setHeader(t,n)}function ve(e){return(e instanceof Error?e.message:String(e)).replace(/\/[^\s:)]+/g,"[path]").replace(/[A-Z]:\\[^\s:)]+/g,"[path]").replace(/at\s+.+:\d+:\d+/g,"[stack]").replace(/\(node:\w+:\d+:\d+\)/g,"[internal]").substring(0,500)}var re=5,se=20,ie=8,f=class{constructor(t,n){this.maxConcurrent=t;this.name=n;this.active=0}async acquire(){return this.active>=this.maxConcurrent?(console.warn(`[ConcurrencyLimiter:${this.name}] Limit reached (${this.active}/${this.maxConcurrent})`),!1):(this.active++,!0)}release(){this.active=Math.max(0,this.active-1)}get currentCount(){return this.active}},A=new f(re,"PDF"),Ne=new f(se,"DOC"),Oe=new f(ie,"SHARE");var F={format:"A4",margin:{top:"20mm",right:"20mm",bottom:"20mm",left:"20mm"},landscape:!1,printBackground:!0,scale:1,preferCSSPageSize:!1},$=50*1024*1024,le=3e4;var p=null,de=new ce("").window,ue=oe(de),H=500,h=0,pe=100;async function me(){return p&&h>=pe&&(console.log(`[pdfGeneration] Restarting browser after ${h} contexts for leak prevention`),await D(),h=0),(!p||!p.isConnected())&&(p=await ae.launch({headless:!0,args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu","--disable-extensions","--disable-background-networking","--disable-default-apps","--disable-sync","--disable-translate","--no-first-run","--disable-component-update","--disable-domain-reliability","--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process","--disable-ipc-flooding-protection","--disable-renderer-backgrounding","--js-flags=--max-old-space-size=256","--disable-breakpad","--disable-crash-reporter","--disable-remote-fonts","--disable-client-side-phishing-detection"]}),h=0),p}function fe(e){let t=/<html[\s>]/i.test(e),n=/<head[\s>]/i.test(e),r=`
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      @media print {
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }
        body {
          margin: 0;
          padding: 0;
        }
        @page {
          margin: 0;
        }
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        line-height: 1.6;
        color: #333;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th, td {
        border: 1px solid #ddd;
        padding: 8px;
        text-align: left;
      }
      th {
        background-color: #f5f5f5;
      }
      img {
        max-width: 100%;
        height: auto;
      }
      pre, code {
        font-family: 'Courier New', Courier, monospace;
        background-color: #f5f5f5;
        padding: 2px 4px;
        border-radius: 3px;
      }
      pre {
        padding: 12px;
        overflow-x: auto;
      }
      blockquote {
        border-left: 4px solid #ddd;
        margin: 0;
        padding-left: 16px;
        color: #666;
      }
    </style>
  `;return t&&n?e.replace(/<head([^>]*)>/i,`<head$1>${r}`):t?e.replace(/<html([^>]*)>/i,`<html$1><head>${r}</head>`):`<!DOCTYPE html>
<html>
<head>
  ${r}
</head>
<body>
  ${e}
</body>
</html>`}function ge(e){if(!e||typeof e!="string")throw new Error("HTML content is required and must be a string");if(e.trim().length===0)throw new Error("HTML content cannot be empty");let t=10*1024*1024;if(e.length>t)throw new Error(`HTML content exceeds maximum size of ${t/1024/1024}MB`)}function he(e){return ue.sanitize(e,{ALLOWED_TAGS:["html","head","body","title","style","div","span","p","br","hr","h1","h2","h3","h4","h5","h6","ul","ol","li","blockquote","pre","code","strong","em","b","i","u","s","del","mark","table","thead","tbody","tr","th","td","a","img"],ALLOWED_ATTR:["href","src","alt","title","class","id","style","width","height","colspan","rowspan","align","target","rel"],FORBID_TAGS:["script","noscript","iframe","object","embed","applet","base","meta","link","form","input","button"],ALLOW_DATA_ATTR:!1})}async function He(e,t){let n=Date.now();ge(e);let r=he(e),s={...F,...t,margin:{...F.margin,...t?.margin}};if(!await A.acquire())throw g({timestamp:new Date().toISOString(),event:"rate_limit_exceeded",docType:"pdf"}),new Error("Too many concurrent PDF generations. Please try again.");process.env.ENABLE_BACKGROUND_JOBS==="true"&&console.log("[pdfGeneration] Background jobs enabled, but direct execution requested for immediate response."),g({timestamp:new Date().toISOString(),event:"generate_start",docType:"pdf",details:{htmlSize:r.length}});let o=null;try{let a=await me();h++,o=await a.newContext({javaScriptEnabled:!1,permissions:[],serviceWorkers:"block",offline:!1});let i=await o.newPage();await i.route("**/*",_=>{let E=_.request().url();E.startsWith("data:")||E==="about:blank"?E.startsWith("data:text/html")?_.abort("blockedbyclient"):_.continue():_.abort("blockedbyclient")});let l=fe(r);await i.setContent(l,{waitUntil:"domcontentloaded",timeout:le});let d={format:s.format,margin:s.margin,landscape:s.landscape,printBackground:s.printBackground,scale:s.scale,preferCSSPageSize:s.preferCSSPageSize};(s.headerTemplate||s.footerTemplate)&&(d.displayHeaderFooter=!0,d.headerTemplate=s.headerTemplate||"<span></span>",d.footerTemplate=s.footerTemplate||"<span></span>");let z=await i.pdf(d),m=Buffer.from(z);if(m.length>$)throw new Error(`Generated PDF exceeds maximum size of ${$/1024/1024}MB`);let x=B(m);if(!x.valid)throw new Error(`Generated PDF is invalid: ${x.errors.join("; ")}`);x.warnings.length>0&&console.warn("[pdfGeneration] Warnings:",x.warnings);let w=m.toString("binary").match(/\/Type\s*\/Page[^s]/g),b=w?w.length:0;if(b>H)throw new Error(`Generated PDF has too many pages (~${b}). Maximum is ${H}`);return g({timestamp:new Date().toISOString(),event:"generate_success",docType:"pdf",durationMs:Date.now()-n,details:{bufferSize:m.length}}),m}catch(a){let i=a instanceof Error?a.message:String(a);throw g({timestamp:new Date().toISOString(),event:"generate_failure",docType:"pdf",durationMs:Date.now()-n,details:{error:i}}),i.includes("timeout")||i.includes("Timeout")?new Error(`PDF generation timed out: ${i}`):i.includes("net::ERR_")||i.includes("Navigation")?new Error(`Failed to load HTML content: ${i}`):new Error(`PDF generation failed: ${i}`)}finally{A.release(),o&&await o.close().catch(a=>{console.error("[pdfGeneration] Error closing browser context:",a)})}}async function D(){if(p)try{await p.close()}catch(e){console.error("[pdfGeneration] Error closing browser:",e)}finally{p=null}}process.on("SIGTERM",async()=>{await D()});process.on("SIGINT",async()=>{await D()});export{Ee as a,Te as b,Ae as c,k as d,G as e,R as f,V as g,we as h,be as i,ye as j,Me as k,g as l,Pe as m,ve as n,Ne as o,Oe as p,He as q,D as r};
