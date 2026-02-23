import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{a as o}from"./chunk-X7YU7M46.mjs";import{h as r,i as d}from"./chunk-H7EJRODP.mjs";import"./chunk-2FP5DEJW.mjs";d();var i=class{async generateCode(e){r.info(`[AutoCoder] Generating code for task: ${e.id}`);let t=`
      You are an expert autonomous software engineer.
      Task: ${e.description}
      Context: ${e.context}
      Files to modify: ${e.files.join(", ")}
      
      Return a JSON array of file changes. Format: [{ "file": "path", "content": "..." }]
    `,n=await o.generateCompletion({taskId:e.id,messages:[{role:"user",content:t}],requirements:{tier:"ultra",jsonMode:!0}});try{let s=JSON.parse(n.content);return this.refineCode(s,e)}catch(s){throw r.error(`[AutoCoder] Failed to parse generated code: ${s}`),new Error("Code generation failed")}}async refineCode(e,t){return e}},a=class{async diagnoseAndFix(e,t){r.warn(`[SelfHealing] Diagnosing error: ${e.message}`);let n=await o.generateCompletion({taskId:"fix-error",messages:[{role:"system",content:"Analyze the error and provide a fix code block."},{role:"user",content:`Error: ${e.message}
Stack: ${e.stack}
Context: ${JSON.stringify(t)}`}],requirements:{tier:"pro"}});return r.info(`[SelfHealing] Proposed fix: ${n.content.substring(0,50)}...`),null}},c=class{async generateTests(e,t="typescript"){return(await o.generateCompletion({taskId:"gen-tests",messages:[{role:"system",content:`Generate comprehensive unit tests for this ${t} code using Vitest.`},{role:"user",content:e}],requirements:{tier:"pro"}})).content}},m=new i,u=new a,C=new c;export{i as AutonomousCoder,a as SelfHealingEngine,c as TestGenerator,m as autoCoder,u as selfHealer,C as testGenerator};
