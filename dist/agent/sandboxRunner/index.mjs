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
import N from"express";import{randomUUID as E}from"crypto";import{spawn as f}from"child_process";import h from"path";import I from"fs/promises";var m=N();m.use(N.json({limit:"256kb"}));var g=Number(process.env.SANDBOX_RUNNER_PORT||"8080"),D=process.env.SANDBOX_RUNNER_TOKEN||"",v=process.env.AGENT_WORKSPACE_ROOT||"/workspace_root",R=process.env.SHELL_COMMAND_DOCKER_IMAGE||"debian:bookworm-slim",S=Number(process.env.SANDBOX_RUNNER_JOB_TTL_MS||String(10*6e4)),p=new Map;function w(e,t){if(!D)return t.status(500).json({error:"SANDBOX_RUNNER_TOKEN_NOT_CONFIGURED"}),!1;let n=String(e.headers.authorization||"");return n.startsWith("Bearer ")?n.slice(7)!==D?(t.status(403).json({error:"FORBIDDEN"}),!1):!0:(t.status(401).json({error:"UNAUTHORIZED"}),!1)}function M(e){return/^[a-zA-Z0-9_-]{8,128}$/.test(e)}function d(e,t){e.events.push(t),e.events.length>2e3&&e.events.splice(0,e.events.length-2e3)}function A(e){let{runId:t,command:n,timeoutMs:o}=e,u=E(),c=Date.now(),l=h.resolve(v,t),r=["run","--rm","-i","--network",process.env.SHELL_COMMAND_DOCKER_NETWORK||"none","--security-opt","no-new-privileges","--cap-drop","ALL","--pids-limit",process.env.SHELL_COMMAND_DOCKER_PIDS||"256","--cpus",process.env.SHELL_COMMAND_DOCKER_CPUS||"1","--memory",process.env.SHELL_COMMAND_DOCKER_MEMORY||"512m","-v",`${l}:/workspace`,"-w","/workspace",R,"/usr/bin/bash","-lc",n],s=f("docker",r,{cwd:l,env:{...process.env},shell:!1,windowsHide:!0}),a={jobId:u,runId:t,command:n,createdAt:Date.now(),timeoutMs:o,proc:s,events:[],done:!1},_=!1,O=setTimeout(()=>{_=!0;try{s.kill("SIGKILL")}catch{}},o);return s.stdout.on("data",i=>d(a,{type:"stdout",chunk:i.toString(),ts:Date.now()})),s.stderr.on("data",i=>d(a,{type:"stderr",chunk:i.toString(),ts:Date.now()})),s.on("close",(i,b)=>{clearTimeout(O),d(a,{type:"exit",exitCode:typeof i=="number"?i:b?1:0,signal:b?String(b):null,wasKilled:_,durationMs:Date.now()-c,ts:Date.now()}),a.done=!0}),s.on("error",i=>{clearTimeout(O),d(a,{type:"stderr",chunk:`Failed to spawn docker: ${i.message}
`,ts:Date.now()}),d(a,{type:"exit",exitCode:1,signal:null,wasKilled:_,durationMs:Date.now()-c,ts:Date.now()}),a.done=!0}),a}m.get("/health",(e,t)=>{t.json({status:"ok"})});m.post("/v1/shell/run",async(e,t)=>{if(!w(e,t))return;let n=String(e.body?.runId||""),o=String(e.body?.command||"").trim(),u=Number(e.body?.timeoutMs||3e4),c=Math.min(Math.max(u,1e3),6e5);if(!M(n))return t.status(400).json({error:"INVALID_RUN_ID"});if(!o)return t.status(400).json({error:"INVALID_COMMAND"});let l=h.resolve(v,n);try{await I.mkdir(l,{recursive:!0})}catch(s){return t.status(500).json({error:"WORKSPACE_CREATE_FAILED",message:s?.message||String(s)})}let r=A({runId:n,command:o,timeoutMs:c});p.set(r.jobId,r),t.json({jobId:r.jobId,streamUrl:`/v1/shell/stream/${r.jobId}`})});m.get("/v1/shell/stream/:jobId",(e,t)=>{if(!w(e,t))return;let n=String(e.params.jobId||""),o=p.get(n);if(!o)return t.status(404).json({error:"NOT_FOUND"});t.setHeader("Content-Type","text/event-stream"),t.setHeader("Cache-Control","no-cache, no-transform"),t.setHeader("Connection","keep-alive");let u=0,c=()=>{for(;u<o.events.length;){let r=o.events[u++];t.write(`event: shell
`),t.write(`data: ${JSON.stringify(r)}

`)}o.done&&(t.write(`event: done
`),t.write(`data: {}

`),t.end())},l=setInterval(c,150);e.on("close",()=>clearInterval(l)),c()});setInterval(()=>{let e=Date.now();for(let[t,n]of p.entries())e-n.createdAt>S&&p.delete(t)},6e4).unref();m.listen(g,()=>{console.log(`[sandbox-runner] listening on :${g} workspaceRoot=${v}`)});
