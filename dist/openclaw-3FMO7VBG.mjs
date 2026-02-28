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
import{a as s}from"./chunk-AKX5KR4K.mjs";import{a}from"./chunk-F7574FHZ.mjs";import"./chunk-VLL76GHB.mjs";import"./chunk-JL5GVIQJ.mjs";async function p(o){let t=s(),e=[];if(t.gateway.enabled){let{initGateway:i}=await import("./wsServer-2R3NACGL.mjs");await i(o,t),e.push("gateway")}if(t.tools.enabled){let{registerOpenClawTools:i}=await import("./adapter-4SI2LRT4.mjs");i(t),e.push("tools")}if(t.plugins.enabled){let{initPlugins:i}=await import("./pluginLoader-QXZUA7ZX.mjs");await i(t),e.push("plugins")}if(t.skills.enabled){let{initSkills:i}=await import("./skillLoader-BFHKIVCV.mjs");await i(t),e.push("skills")}try{let{init:i}=await import("./capabilityExpander-B6GG33DW.mjs"),n=await i();n>0&&e.push(`selfExpand(${n} restored)`)}catch(i){a.warn(`[OpenClaw] selfExpand init failed: ${i?.message||i}`)}if(t.streaming.enabled){let{initStreaming:i}=await import("./adapter-5XRQOEG6.mjs");i(t),e.push("streaming")}e.length>0?a.info(`[OpenClaw] Initialized: [${e.join(", ")}]`):a.info("[OpenClaw] All modules disabled (set ENABLE_OPENCLAW_* env vars to enable)")}export{p as initializeOpenClaw};
