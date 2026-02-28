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
import{ob as i}from"./chunk-PNGSAWMQ.mjs";import{sql as a}from"drizzle-orm";import{randomUUID as m}from"crypto";var l={"gpt-4o":{input:2.5,output:10},"gpt-4o-mini":{input:.15,output:.6},"gpt-4-turbo":{input:10,output:30},"gpt-4":{input:30,output:60},"gpt-3.5-turbo":{input:.5,output:1.5},o1:{input:15,output:60},"o1-mini":{input:3,output:12},"o3-mini":{input:1.1,output:4.4},"claude-opus-4-20250514":{input:15,output:75},"claude-sonnet-4-20250514":{input:3,output:15},"claude-3-5-sonnet-20241022":{input:3,output:15},"claude-3-5-haiku-20241022":{input:.8,output:4},"claude-3-haiku-20240307":{input:.25,output:1.25},"gemini-2.5-pro":{input:1.25,output:10},"gemini-2.5-flash":{input:.15,output:.6},"gemini-2.0-flash":{input:.1,output:.4},"gemini-1.5-pro":{input:1.25,output:5},"gemini-1.5-flash":{input:.075,output:.3},"grok-3":{input:3,output:15},"grok-3-mini":{input:.3,output:.5},"grok-2":{input:2,output:10},"deepseek-chat":{input:.14,output:.28},"deepseek-reasoner":{input:.55,output:2.19},_default:{input:1,output:3}};function g(c,t,e){let r=l[c]||Object.entries(l).find(([n])=>c.startsWith(n))?.[1]||l._default,o=t/1e6*r.input,s=e/1e6*r.output;return Math.round((o+s)*1e6)/1e6}var p=class{constructor(){this.inMemoryBuffer=[]}start(){this.flushInterval=setInterval(()=>this.flush(),3e4)}stop(){this.flushInterval&&(clearInterval(this.flushInterval),this.flushInterval=void 0),this.flush()}recordUsage(t){let e={id:m(),userId:t.userId,chatId:t.chatId,model:t.model,provider:t.provider,promptTokens:t.promptTokens,completionTokens:t.completionTokens,totalTokens:t.promptTokens+t.completionTokens,costUsd:g(t.model,t.promptTokens,t.completionTokens),latencyMs:t.latencyMs,createdAt:new Date};return this.inMemoryBuffer.push(e),e}async getSummary(t){let e=t.days||30,r=new Date(Date.now()-e*864e5).toISOString();try{let s=(await i.execute(a`
        SELECT
          COUNT(*)::int as total_requests,
          COALESCE(SUM(total_tokens), 0)::int as total_tokens,
          COALESCE(SUM(cost_usd), 0)::numeric as total_cost,
          COALESCE(AVG(latency_ms), 0)::int as avg_latency
        FROM model_usage_log
        WHERE created_at >= ${r}::timestamptz
        ${t.userId?a`AND user_id = ${t.userId}`:a``}
      `)).rows[0]||{},n=await i.execute(a`
        SELECT
          model,
          provider,
          COUNT(*)::int as requests,
          SUM(total_tokens)::int as tokens,
          SUM(cost_usd)::numeric as cost_usd,
          AVG(latency_ms)::int as avg_latency
        FROM model_usage_log
        WHERE created_at >= ${r}::timestamptz
        ${t.userId?a`AND user_id = ${t.userId}`:a``}
        GROUP BY model, provider
        ORDER BY cost_usd DESC
      `),d=await i.execute(a`
        SELECT
          DATE(created_at) as date,
          COUNT(*)::int as requests,
          SUM(total_tokens)::int as tokens,
          SUM(cost_usd)::numeric as cost_usd
        FROM model_usage_log
        WHERE created_at >= ${r}::timestamptz
        ${t.userId?a`AND user_id = ${t.userId}`:a``}
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);return{totalCostUsd:parseFloat(s.total_cost)||0,totalTokens:s.total_tokens||0,totalRequests:s.total_requests||0,avgLatencyMs:s.avg_latency||0,byModel:n.rows.map(u=>({model:u.model,provider:u.provider,requests:u.requests,tokens:u.tokens,costUsd:parseFloat(u.cost_usd),avgLatencyMs:u.avg_latency})),byDay:d.rows.map(u=>({date:u.date,requests:u.requests,tokens:u.tokens,costUsd:parseFloat(u.cost_usd)}))}}catch{return this.getInMemorySummary(t.userId)}}getRealtimeMetrics(t=6e4){let e=Date.now()-t,r=this.inMemoryBuffer.filter(s=>s.createdAt.getTime()>e);if(r.length===0)return{successRate:1,avgLatencyMs:0,p50LatencyMs:0,p95LatencyMs:0,p99LatencyMs:0,errorRate:0,requestsPerMinute:0};let o=r.map(s=>s.latencyMs).sort((s,n)=>s-n);return{successRate:1,avgLatencyMs:Math.round(o.reduce((s,n)=>s+n,0)/o.length),p50LatencyMs:o[Math.floor(o.length*.5)]||0,p95LatencyMs:o[Math.floor(o.length*.95)]||0,p99LatencyMs:o[Math.floor(o.length*.99)]||0,errorRate:0,requestsPerMinute:r.length/(t/6e4)}}async flush(){if(this.inMemoryBuffer.length===0)return;let t=this.inMemoryBuffer.splice(0,100);try{for(let e of t)await i.execute(a`
          INSERT INTO model_usage_log (id, user_id, chat_id, model, provider, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, created_at)
          VALUES (${e.id}, ${e.userId}, ${e.chatId||null}, ${e.model}, ${e.provider},
                  ${e.promptTokens}, ${e.completionTokens}, ${e.totalTokens},
                  ${e.costUsd}, ${e.latencyMs}, ${e.createdAt.toISOString()})
        `)}catch{this.inMemoryBuffer.unshift(...t)}}getInMemorySummary(t){let e=this.inMemoryBuffer;t&&(e=e.filter(o=>o.userId===t));let r=new Map;for(let o of e){let s=o.model,n=r.get(s)||{requests:0,tokens:0,costUsd:0,latencies:[]};n.requests++,n.tokens+=o.totalTokens,n.costUsd+=o.costUsd,n.latencies.push(o.latencyMs),r.set(s,n)}return{totalCostUsd:e.reduce((o,s)=>o+s.costUsd,0),totalTokens:e.reduce((o,s)=>o+s.totalTokens,0),totalRequests:e.length,avgLatencyMs:e.length>0?Math.round(e.reduce((o,s)=>o+s.latencyMs,0)/e.length):0,byModel:Array.from(r.entries()).map(([o,s])=>({model:o,provider:e.find(n=>n.model===o)?.provider||"unknown",requests:s.requests,tokens:s.tokens,costUsd:s.costUsd,avgLatencyMs:Math.round(s.latencies.reduce((n,d)=>n+d,0)/s.latencies.length)})),byDay:[]}}},h=new p;export{g as a,p as b,h as c};
