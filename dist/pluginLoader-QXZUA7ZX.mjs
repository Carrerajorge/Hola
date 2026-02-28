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
import{a as n}from"./chunk-62BGFGIM.mjs";import{a as e}from"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-JL5GVIQJ.mjs";var t=class{constructor(){this.plugins=new Map}async register(i){if(this.plugins.has(i.id)){e.warn(`[OpenClaw:Plugins] Plugin ${i.id} already registered, skipping`);return}if(i.hooks)for(let[r,s]of Object.entries(i.hooks))s&&n.register(r,s);i.setup&&await i.setup({}),this.plugins.set(i.id,i),e.info(`[OpenClaw:Plugins] Plugin registered: ${i.id} (${i.title||"untitled"})`)}async unregister(i){let r=this.plugins.get(i);r&&(r.shutdown&&await r.shutdown({}),this.plugins.delete(i),e.info(`[OpenClaw:Plugins] Plugin unregistered: ${i}`))}get(i){return this.plugins.get(i)}list(){return Array.from(this.plugins.values())}async shutdownAll(){for(let i of this.plugins.values())try{await i.shutdown?.({})}catch(r){e.error(`[OpenClaw:Plugins] Plugin ${i.id} shutdown error: ${r.message}`)}this.plugins.clear(),n.clear()}},o=new t;async function f(l){await o.register({id:"builtin-audit",title:"Audit Logger",hooks:{before_tool_call:async i=>{e.info(`[Audit] Tool call: ${i.toolName} by ${i.userId} (run: ${i.runId})`)},after_tool_call:async i=>{e.info(`[Audit] Tool result: ${i.toolName} (run: ${i.runId})`)},error:async i=>{e.error(`[Audit] Error in run ${i.runId}: ${i.error?.message}`)}}}),e.info("[OpenClaw:Plugins] Plugin system initialized")}export{f as initPlugins};
