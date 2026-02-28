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
import{b as c}from"./chunk-NJU3WRZT.mjs";async function h(t,n){let e=[];if(!t)return e.push({role:"user",content:n}),{messages:e};switch(t.type){case"image":{let r=t.buffer.toString("base64");e.push({role:"user",content:[{type:"image_url",image_url:{url:`data:${t.mimetype};base64,${r}`,detail:"high"}},{type:"text",text:n||"Analiza esta imagen y dime qu\xE9 ves."}]});break}case"audio":{let r=await c.transcribe(t.localPath,{provider:"whisper_api",language:"es"}),a=r.success?`[Mensaje de voz transcrito]:
"${r.text}"`:"[Mensaje de voz recibido, no se pudo transcribir]";return e.push({role:"user",content:`${a}

${n||""}`.trim()}),{messages:e,transcription:r.success?r.text:void 0}}case"video":{let r=await m(t.localPath,3),a=[];for(let s of r){let o=await f(s,"Describe lo que ves en este frame de video");a.push(o)}e.push({role:"user",content:`[Video recibido - an\xE1lisis de frames]:
${a.map((s,o)=>`Frame ${o+1}: ${s}`).join(`
`)}

${n||"Analiza este video."}`});break}case"document":{let r=await d(t.localPath,t.mimetype);return e.push({role:"user",content:`[Documento recibido: "${t.fileName}" (${t.mimetype})]:

${r.slice(0,15e3)}

${n||"Analiza este documento."}`}),{messages:e,extractedText:r}}case"sticker":{let r=t.buffer.toString("base64");e.push({role:"user",content:[{type:"image_url",image_url:{url:`data:${t.mimetype};base64,${r}`}},{type:"text",text:n||"\xBFQu\xE9 sticker es este?"}]});break}}return{messages:e}}async function m(t,n){let{execSync:e}=await import("child_process"),r=await import("os").then(s=>s.tmpdir()),a=[];for(let s=0;s<n;s++){let o=`${r}/frame_${Date.now()}_${s}.jpg`;try{let u=e(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${t}"`).toString().trim(),p=parseFloat(u)/(n+1)*(s+1);e(`ffmpeg -y -ss ${p} -i "${t}" -vframes 1 -q:v 2 "${o}" 2>/dev/null`);let l=await import("fs/promises").then(i=>i.readFile(o));a.push(l),await import("fs/promises").then(i=>i.unlink(o).catch(()=>{}))}catch{}}return a}async function d(t,n){if(n.includes("pdf")){let e=await import("pdf-parse"),r=e.default||e,a=await import("fs/promises").then(o=>o.readFile(t));return(await r(a)).text}if(n.includes("wordprocessingml")||n.includes("docx"))return(await(await import("mammoth")).extractRawText({path:t})).value;if(n.includes("spreadsheetml")||n.includes("xlsx")){let e=await import("xlsx"),r=e.readFile(t);return r.SheetNames.map(a=>{let s=e.utils.sheet_to_csv(r.Sheets[a]);return`[Hoja: ${a}]
${s}`}).join(`

`)}return import("fs/promises").then(e=>e.readFile(t,"utf-8"))}async function f(t,n){let{llmGateway:e}=await import("./llmGateway-7N7T4TNA.mjs");return(await e.chat([{role:"user",content:[{type:"image_url",image_url:{url:`data:image/jpeg;base64,${t.toString("base64")}`}},{type:"text",text:n}]}],{model:"gemini-2.0-flash",maxTokens:500})).content||""}export{h as a};
