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
import{ob as c}from"./chunk-PNGSAWMQ.mjs";import{sql as o}from"drizzle-orm";function f(g){let n=g.toLowerCase().split(/\s+/),t=new Map;n.forEach((s,a)=>{t.has(s)||t.set(s,t.size)});let e=new Array(256).fill(0);n.forEach(s=>{let a=s.split("").reduce((d,m)=>(d<<5)-d+m.charCodeAt(0)|0,0),i=Math.abs(a)%256;e[i]+=1/n.length});let r=Math.sqrt(e.reduce((s,a)=>s+a*a,0));return r>0?e.map(s=>s/r):e}function O(g,n){let t=0;for(let e=0;e<Math.min(g.length,n.length);e++)t+=g[e]*n[e];return t}var N=async()=>{try{await c.execute(o`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        chat_id VARCHAR(255),
        content TEXT NOT NULL,
        content_type VARCHAR(50) DEFAULT 'message',
        embedding JSONB,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `),await c.execute(o`CREATE INDEX IF NOT EXISTS idx_rag_user ON rag_documents(user_id)`),await c.execute(o`CREATE INDEX IF NOT EXISTS idx_rag_chat ON rag_documents(chat_id)`),await c.execute(o`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) UNIQUE NOT NULL,
        preferences JSONB DEFAULT '{}',
        communication_style JSONB DEFAULT '{}',
        topics_of_interest JSONB DEFAULT '[]',
        language VARCHAR(10) DEFAULT 'es',
        timezone VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `),await c.execute(o`
      CREATE TABLE IF NOT EXISTS workspace_context (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        file_path TEXT,
        file_type VARCHAR(50),
        content_summary TEXT,
        embedding JSONB,
        last_accessed TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)}catch{}};N();var y=class{async indexMessage(n,t,e,r){if(e.length<20)return;let s=f(e);await c.execute(o`
      INSERT INTO rag_documents (user_id, chat_id, content, content_type, embedding, metadata)
      VALUES (${n}, ${t}, ${e.substring(0,2e3)}, ${r}, 
              ${JSON.stringify(s)}, ${JSON.stringify({role:r,timestamp:Date.now()})})
    `)}async search(n,t,e={}){let{limit:r=5,chatId:s,minScore:a=.3}=e,i=f(t),d=o`user_id = ${n}`;return s&&(d=o`user_id = ${n} AND chat_id != ${s}`),((await c.execute(o`
      SELECT content, chat_id, embedding FROM rag_documents
      WHERE user_id = ${n}
      ORDER BY created_at DESC
      LIMIT 100
    `)).rows||[]).map(u=>{let p=typeof u.embedding=="string"?JSON.parse(u.embedding):u.embedding,_=O(i,p||[]);return{content:u.content,chatId:u.chat_id,score:_}}).filter(u=>u.score>=a).sort((u,p)=>p.score-u.score).slice(0,r)}async getContextForMessage(n,t,e){let r=await this.search(n,t,{limit:3,chatId:e,minScore:.4});return r.length===0?"":`

[Contexto de conversaciones anteriores]
${r.map((a,i)=>`[Contexto ${i+1}]: ${a.content.substring(0,300)}...`).join(`
`)}
`}},h=class{async getPreferences(n){let t=await c.execute(o`
      SELECT * FROM user_preferences WHERE user_id = ${n}
    `);return t.rows?.length?t.rows[0]:(await c.execute(o`
      INSERT INTO user_preferences (user_id) VALUES (${n})
      ON CONFLICT (user_id) DO NOTHING
    `),{preferences:{},communication_style:{},topics_of_interest:[],language:"es"})}async updatePreferences(n,t){let{preferences:e,communicationStyle:r,topicsOfInterest:s,language:a,timezone:i}=t;await c.execute(o`
      INSERT INTO user_preferences (user_id, preferences, communication_style, topics_of_interest, language, timezone)
      VALUES (${n}, ${JSON.stringify(e||{})}, ${JSON.stringify(r||{})}, 
              ${JSON.stringify(s||[])}, ${a||"es"}, ${i})
      ON CONFLICT (user_id) DO UPDATE SET
        preferences = COALESCE(${e?JSON.stringify(e):null}, user_preferences.preferences),
        communication_style = COALESCE(${r?JSON.stringify(r):null}, user_preferences.communication_style),
        topics_of_interest = COALESCE(${s?JSON.stringify(s):null}, user_preferences.topics_of_interest),
        language = COALESCE(${a}, user_preferences.language),
        timezone = COALESCE(${i}, user_preferences.timezone),
        updated_at = NOW()
    `)}async learnFromConversation(n,t){let e=t.filter(l=>l.role==="user").map(l=>l.content),r=e.join(" ").toLowerCase(),s=(r.match(/\b(el|la|los|las|de|que|y|en|un|una|es|por|para)\b/g)||[]).length,a=(r.match(/\b(the|a|an|is|are|to|of|and|in|for|with)\b/g)||[]).length,i=s>a?"es":"en",d=[],m={programaci\u00F3n:/\b(código|programar|python|javascript|api|función|error|bug)\b/i,negocios:/\b(ventas|clientes|marketing|empresa|negocio|inversión)\b/i,creatividad:/\b(diseño|imagen|crear|arte|historia|escribir)\b/i,educaci\u00F3n:/\b(aprender|estudiar|curso|explicar|entender)\b/i,datos:/\b(datos|análisis|estadística|gráfico|reporte)\b/i};for(let[l,T]of Object.entries(m))T.test(r)&&d.push(l);let E={},u=(r.match(/\b(usted|por favor|gracias|estimado|cordialmente)\b/g)||[]).length,p=(r.match(/\b(tu|oye|mira|genial|cool|jaja)\b/g)||[]).length;E.formality=u>p?"formal":"casual";let _=e.reduce((l,T)=>l+T.length,0)/(e.length||1);E.detailLevel=_>100?"detailed":"concise",await this.updatePreferences(n,{language:i,topicsOfInterest:d,communicationStyle:E})}async getPersonalizationContext(n){let t=await this.getPreferences(n),e=[];return t.language&&e.push(`Idioma preferido: ${t.language==="es"?"Espa\xF1ol":"English"}`),t.communication_style?.formality&&e.push(`Estilo: ${t.communication_style.formality==="formal"?"Formal y profesional":"Casual y amigable"}`),t.communication_style?.detailLevel&&e.push(`Nivel de detalle: ${t.communication_style.detailLevel==="detailed"?"Respuestas detalladas":"Respuestas concisas"}`),t.topics_of_interest?.length&&e.push(`Temas de inter\xE9s: ${t.topics_of_interest.join(", ")}`),e.length===0?"":`

[Preferencias del usuario]
${e.join(`
`)}
`}},A=class{async indexFile(n,t,e,r){let s=e.substring(0,500),a=f(e);await c.execute(o`
      INSERT INTO workspace_context (user_id, file_path, file_type, content_summary, embedding)
      VALUES (${n}, ${t}, ${r}, ${s}, ${JSON.stringify(a)})
      ON CONFLICT DO NOTHING
    `)}async getRelevantFiles(n,t,e=3){let r=f(t);return((await c.execute(o`
      SELECT file_path, content_summary, embedding FROM workspace_context
      WHERE user_id = ${n}
      ORDER BY last_accessed DESC
      LIMIT 50
    `)).rows||[]).map(i=>{let d=typeof i.embedding=="string"?JSON.parse(i.embedding):i.embedding,m=O(r,d||[]);return{filePath:i.file_path,summary:i.content_summary,score:m}}).filter(i=>i.score>=.3).sort((i,d)=>d.score-i.score).slice(0,e)}async getWorkspaceContext(n,t){let e=await this.getRelevantFiles(n,t,2);return e.length===0?"":`

[Archivos relacionados del workspace]
${e.map(s=>`[${s.filePath}]: ${s.summary.substring(0,200)}...`).join(`
`)}
`}},b=new y,S=new h,C=new A;async function x(g,n,t){let[e,r,s]=await Promise.all([b.getContextForMessage(g,n,t),S.getPersonalizationContext(g),C.getWorkspaceContext(g,n)]);return r+e+s}export{y as a,h as b,A as c,b as d,S as e,C as f,x as g};
