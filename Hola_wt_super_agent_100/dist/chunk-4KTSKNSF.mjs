import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{Va as f,Ya as r,f as i,hb as q}from"./chunk-SFS5HO6Q.mjs";q();f();import{eq as o,sql as R}from"drizzle-orm";var l={free:{dailyRequests:3,model:"grok-4-1-fast-non-reasoning"},go:{dailyRequests:50,model:"grok-4-1-fast-non-reasoning"},plus:{dailyRequests:200,model:"grok-4-1-fast-non-reasoning"},pro:{dailyRequests:-1,model:"grok-4-1-fast-non-reasoning"},admin:{dailyRequests:-1,model:"grok-4-1-fast-non-reasoning"}},d=process.env.ADMIN_EMAIL||"";function A(){let y=new Date,s=new Date(y);return s.setDate(s.getDate()+1),s.setHours(0,0,0,0),s}var g=class{async checkAndIncrementUsage(s){let[e]=await r.select().from(i).where(o(i.id,s));if(!e)return{allowed:!1,remaining:0,limit:0,resetAt:null,plan:"free",message:"Usuario no encontrado"};let t=d&&e.email?.toLowerCase()===d.toLowerCase()||e.role==="admin",a=t?"admin":e.plan||"free",n=l[a]||l.free;if(t||n.dailyRequests===-1)return{allowed:!0,remaining:-1,limit:-1,resetAt:null,plan:a};let c=new Date,_=A(),u=await r.execute(R`
      UPDATE users
      SET
        daily_requests_used = CASE
          WHEN daily_requests_reset_at IS NULL OR NOW() >= daily_requests_reset_at
          THEN 1
          ELSE COALESCE(daily_requests_used, 0) + 1
        END,
        daily_requests_reset_at = CASE
          WHEN daily_requests_reset_at IS NULL OR NOW() >= daily_requests_reset_at
          THEN ${_}
          ELSE daily_requests_reset_at
        END,
        daily_requests_limit = ${n.dailyRequests},
        updated_at = NOW()
      WHERE id = ${s}
        AND (
          -- Allow if reset needed
          daily_requests_reset_at IS NULL
          OR NOW() >= daily_requests_reset_at
          -- Or if under limit
          OR COALESCE(daily_requests_used, 0) < ${n.dailyRequests}
        )
      RETURNING
        daily_requests_used as used,
        daily_requests_reset_at as reset_at
    `);if(u.rows.length===0)return{allowed:!1,remaining:0,limit:n.dailyRequests,resetAt:e.dailyRequestsResetAt,plan:a,message:"Has alcanzado el l\xEDmite diario de solicitudes. Actualiza tu plan para continuar."};let m=u.rows[0];return{allowed:!0,remaining:n.dailyRequests-m.used,limit:n.dailyRequests,resetAt:m.reset_at,plan:a}}async getUsageStatus(s){let[e]=await r.select().from(i).where(o(i.id,s));if(!e)return{allowed:!1,remaining:0,limit:0,resetAt:null,plan:"free"};let t=d&&e.email?.toLowerCase()===d.toLowerCase()||e.role==="admin",a=t?"admin":e.plan||"free",n=a!=="free"&&a!=="admin",c=l[a]||l.free;if(t||c.dailyRequests===-1)return{allowed:!0,remaining:-1,limit:-1,resetAt:null,plan:a,isAdmin:t,isPaid:n||t};let _=new Date,u=e.dailyRequestsResetAt,m=e.dailyRequestsUsed||0;(!u||_>=u)&&(m=0);let w=c.dailyRequests-m;return{allowed:w>0,remaining:w,limit:c.dailyRequests,resetAt:e.dailyRequestsResetAt,plan:a,isAdmin:!1,isPaid:n}}async updateUserPlan(s,e){let t=l[e]||l.free;await r.update(i).set({plan:e,dailyRequestsLimit:t.dailyRequests,dailyRequestsUsed:0,dailyRequestsResetAt:null,updatedAt:new Date}).where(o(i.id,s))}async hasTokenQuota(s){let[e]=await r.select().from(i).where(o(i.id,s));if(!e)return!1;if(e.role==="admin"||e.plan==="pro"||d&&e.email?.toLowerCase()===d.toLowerCase())return!0;let t=e.tokensConsumed||0,a=e.tokensLimit||1e5;return t<a}async recordTokenUsage(s,e){let[t]=await r.select().from(i).where(o(i.id,s));if(!t)return;let a=t.tokensConsumed||0;await r.update(i).set({tokensConsumed:a+e,updatedAt:new Date}).where(o(i.id,s))}},C=new g;export{g as a,C as b};
