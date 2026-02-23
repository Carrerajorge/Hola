import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{a as o}from"./chunk-SSZPPAJR.mjs";import{d as r}from"./chunk-SD5XFGWA.mjs";import"./chunk-2FP5DEJW.mjs";var i=class{async generateCode(e){r.info(`[AutoCoder] Generating code for task: ${e.id}`);let t=`
      You are an expert autonomous software engineer.
      Task: ${e.description}
      Context: ${e.context}
      Files to modify: ${e.files.join(", ")}
      
      Return a JSON array of file changes. Format: [{ "file": "path", "content": "..." }]
    `,n=await o.generateCompletion({taskId:e.id,messages:[{role:"user",content:t}],requirements:{tier:"ultra",jsonMode:!0}});try{let s=JSON.parse(n.content);return this.refineCode(s,e)}catch(s){throw r.error(`[AutoCoder] Failed to parse generated code: ${s}`),new Error("Code generation failed")}}async refineCode(e,t){return e}},a=class{async diagnoseAndFix(e,t){r.warn(`[SelfHealing] Diagnosing error: ${e.message}`);let n=await o.generateCompletion({taskId:"fix-error",messages:[{role:"system",content:"Analyze the error and provide a fix code block."},{role:"user",content:`Error: ${e.message}
Stack: ${e.stack}
Context: ${JSON.stringify(t)}`}],requirements:{tier:"pro"}});return r.info(`[SelfHealing] Proposed fix: ${n.content.substring(0,50)}...`),null}},c=class{async generateTests(e,t="typescript"){return(await o.generateCompletion({taskId:"gen-tests",messages:[{role:"system",content:`Generate comprehensive unit tests for this ${t} code using Vitest.`},{role:"user",content:e}],requirements:{tier:"pro"}})).content}},f=new i,m=new a,u=new c;export{i as AutonomousCoder,a as SelfHealingEngine,c as TestGenerator,f as autoCoder,m as selfHealer,u as testGenerator};
