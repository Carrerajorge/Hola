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
import"./chunk-JL5GVIQJ.mjs";import{randomUUID as b}from"crypto";function O(){let e=process.env.SHELL_COMMAND_RUNNER_URL||"http://sandbox-runner:8080",r=process.env.SHELL_COMMAND_RUNNER_TOKEN||process.env.SANDBOX_RUNNER_TOKEN||"";if(!r)throw new Error("RUNNER_TOKEN_NOT_CONFIGURED");return{runnerUrl:e,token:r}}async function k(e){let{runnerUrl:r,token:N}=O(),x=`pkg-${b()}`,a=await fetch(`${r}/v1/shell/run`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${N}`},body:JSON.stringify({runId:x,command:e.command,timeoutMs:e.timeoutMs})});if(!a.ok){let n=await a.text().catch(()=>"");throw new Error(`RUNNER_RUN_FAILED: ${a.status} ${n}`)}let u=await a.json(),E=u.streamUrl.startsWith("http")?u.streamUrl:`${r}${u.streamUrl}`,o=await fetch(E,{headers:{Authorization:`Bearer ${N}`}});if(!o.ok||!o.body){let n=await o.text().catch(()=>"");throw new Error(`RUNNER_STREAM_FAILED: ${o.status} ${n}`)}let U=new TextDecoder,s="",l="",c="",d=null,f=null,g=!1,h=0,p=(n,i)=>{if(n.length>=e.maxOutputBytes)return n;let m=e.maxOutputBytes-n.length;return n+i.slice(0,m)};for await(let n of o.body)for(s+=U.decode(n,{stream:!0});;){let i=s.indexOf(`

`);if(i===-1)break;let m=s.slice(0,i);s=s.slice(i+2);let R=m.split(`
`).find(w=>w.startsWith("data: "));if(!R)continue;let y=R.slice(6).trim();if(y==="{}")continue;let t;try{t=JSON.parse(y)}catch{continue}t.type==="stdout"&&(l=p(l,String(t.chunk||""))),t.type==="stderr"&&(c=p(c,String(t.chunk||""))),t.type==="exit"&&(d=typeof t.exitCode=="number"?t.exitCode:1,f=t.signal?String(t.signal):null,g=!!t.wasKilled,h=Number(t.durationMs||0))}return{ok:d===0&&!g,exitCode:d,signal:f||null,stdout:l,stderr:c,durationMs:h}}export{k as runViaSandboxRunner};
