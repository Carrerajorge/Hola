import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{chromium as m}from"playwright";var l={format:"A4",margin:{top:"20mm",right:"20mm",bottom:"20mm",left:"20mm"},landscape:!1,printBackground:!0,scale:1,preferCSSPageSize:!1},i=null;async function g(){return(!i||!i.isConnected())&&(i=await m.launch({headless:!0,args:["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"]})),i}function u(e){let o=/<html[\s>]/i.test(e),t=/<head[\s>]/i.test(e),a=`
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
  `;return o&&t?e.replace(/<head([^>]*)>/i,`<head$1>${a}`):o?e.replace(/<html([^>]*)>/i,`<html$1><head>${a}</head>`):`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${a}
</head>
<body>
  ${e}
</body>
</html>`}function w(e){if(!e||typeof e!="string")throw new Error("HTML content is required and must be a string");if(e.trim().length===0)throw new Error("HTML content cannot be empty");let o=10*1024*1024;if(e.length>o)throw new Error(`HTML content exceeds maximum size of ${o/1024/1024}MB`)}async function y(e,o){w(e);let t={...l,...o,margin:{...l.margin,...o?.margin}};if(process.env.ENABLE_BACKGROUND_JOBS==="true"){let{dispatchPdfGeneration:n}=await import("./jobService-L7RER2C5.mjs");console.log("[pdfGeneration] Background jobs enabled, but direct execution requested for immediate response.")}let a=null;try{a=await(await g()).newContext();let r=await a.newPage(),p=u(e);await r.setContent(p,{waitUntil:"networkidle",timeout:3e4}),await r.waitForLoadState("domcontentloaded"),await r.evaluate(()=>new Promise(d=>{document.readyState==="complete"?d():window.addEventListener("load",()=>d())}));let s={format:t.format,margin:t.margin,landscape:t.landscape,printBackground:t.printBackground,scale:t.scale,preferCSSPageSize:t.preferCSSPageSize};(t.headerTemplate||t.footerTemplate)&&(s.displayHeaderFooter=!0,s.headerTemplate=t.headerTemplate||"<span></span>",s.footerTemplate=t.footerTemplate||"<span></span>");let f=await r.pdf(s);return Buffer.from(f)}catch(n){let r=n instanceof Error?n.message:String(n);throw r.includes("timeout")||r.includes("Timeout")?new Error(`PDF generation timed out: ${r}`):r.includes("net::ERR_")||r.includes("Navigation")?new Error(`Failed to load HTML content: ${r}`):new Error(`PDF generation failed: ${r}`)}finally{a&&await a.close().catch(n=>{console.error("[pdfGeneration] Error closing browser context:",n)})}}async function c(){if(i)try{await i.close()}catch(e){console.error("[pdfGeneration] Error closing browser:",e)}finally{i=null}}process.on("SIGTERM",async()=>{await c()});process.on("SIGINT",async()=>{await c()});export{y as a,c as b};
