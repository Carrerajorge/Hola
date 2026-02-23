import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{b as o,c as e}from"./chunk-2FP5DEJW.mjs";var s={};e(s,{MODELS:()=>n,openai:()=>t});import p from"openai";var t,n,i=o(()=>{t=new p({baseURL:"https://api.x.ai/v1",apiKey:process.env.XAI_API_KEY}),n={TEXT:"grok-3-mini",VISION:"grok-2-vision-1212",GROK_REASONING:"grok-4-1-fast-reasoning"}});export{t as a,n as b,s as c,i as d};
