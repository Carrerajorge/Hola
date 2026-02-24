import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{Queue as c,Worker as i,QueueEvents as a}from"bullmq";import u from"ioredis";var t=process.env.REDIS_URL,o=null;function s(){return!t&&!process.env.REDIS_HOST?(console.warn("[QueueFactory] No REDIS_URL configured, queues disabled"),null):(o||(t?o=new u(t,{maxRetriesPerRequest:null}):o=new u({host:process.env.REDIS_HOST||"localhost",port:parseInt(process.env.REDIS_PORT||"6379"),password:process.env.REDIS_PASSWORD||void 0,maxRetriesPerRequest:null}),o.on("error",e=>console.warn("[QueueFactory] Redis error:",e.message))),o)}var E={UPLOAD:"upload-queue",PROCESSING:"processing-queue"},l=new Map;function d(e){let r=s();if(!r)return null;let n=new c(e,{connection:r,defaultJobOptions:{attempts:3,backoff:{type:"exponential",delay:1e3},removeOnComplete:{age:24*3600,count:1e3},removeOnFail:{age:168*3600}}});return l.set(e,n),n}function O(e,r){let n=s();return n?new i(e,r,{connection:n,concurrency:parseInt(process.env.WORKER_CONCURRENCY||"5")}):null}export{E as a,l as b,d as c,O as d};
