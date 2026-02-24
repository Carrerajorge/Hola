import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{Ya as o,e as i}from"./chunk-A63JEV4L.mjs";import{eq as d,sql as q}from"drizzle-orm";var u={free:{dailyRequests:3,model:"grok-4-1-fast-non-reasoning"},go:{dailyRequests:50,model:"grok-4-1-fast-non-reasoning"},plus:{dailyRequests:200,model:"grok-4-1-fast-non-reasoning"},pro:{dailyRequests:-1,model:"grok-4-1-fast-non-reasoning"},admin:{dailyRequests:-1,model:"grok-4-1-fast-non-reasoning"}},m=String(process.env.ADMIN_EMAIL||"").toLowerCase().trim();function A(){let y=new Date,t=new Date(y);return t.setDate(t.getDate()+1),t.setHours(0,0,0,0),t}var R=class{async checkAndIncrementUsage(t){let[e]=await o.select().from(i).where(d(i.id,t));if(!e)return{allowed:!1,remaining:0,limit:0,resetAt:null,plan:"free",message:"Usuario no encontrado"};let s=String(e.role||"").toLowerCase().trim(),l=s==="admin"||s==="superadmin"||s==="team_admin",n=m&&String(e.email||"").toLowerCase().trim()===m||l,a=n?"admin":e.plan||"free",r=u[a]||u.free;if(n||r.dailyRequests===-1)return{allowed:!0,remaining:-1,limit:-1,resetAt:null,plan:a};let _=new Date,w=A(),c=await o.execute(q`
      UPDATE users
      SET
        daily_requests_used = CASE
          WHEN daily_requests_reset_at IS NULL OR NOW() >= daily_requests_reset_at
          THEN 1
          ELSE COALESCE(daily_requests_used, 0) + 1
        END,
        daily_requests_reset_at = CASE
          WHEN daily_requests_reset_at IS NULL OR NOW() >= daily_requests_reset_at
          THEN ${w}
          ELSE daily_requests_reset_at
        END,
        daily_requests_limit = ${r.dailyRequests},
        updated_at = NOW()
      WHERE id = ${t}
        AND (
          -- Allow if reset needed
          daily_requests_reset_at IS NULL
          OR NOW() >= daily_requests_reset_at
          -- Or if under limit
          OR COALESCE(daily_requests_used, 0) < ${r.dailyRequests}
        )
      RETURNING
        daily_requests_used as used,
        daily_requests_reset_at as reset_at
    `);if(c.rows.length===0)return{allowed:!1,remaining:0,limit:r.dailyRequests,resetAt:e.dailyRequestsResetAt,plan:a,message:"Has alcanzado el l\xEDmite diario de solicitudes. Actualiza tu plan para continuar."};let g=c.rows[0];return{allowed:!0,remaining:r.dailyRequests-g.used,limit:r.dailyRequests,resetAt:g.reset_at,plan:a}}async getUsageStatus(t){let[e]=await o.select().from(i).where(d(i.id,t));if(!e)return{allowed:!1,remaining:0,limit:0,resetAt:null,plan:"free"};let s=String(e.role||"").toLowerCase().trim(),l=s==="admin"||s==="superadmin"||s==="team_admin",n=m&&e.email?.toLowerCase()===m.toLowerCase()||l,a=n?"admin":e.plan||"free",r=a!=="free"&&a!=="admin",_=u[a]||u.free;if(n||_.dailyRequests===-1)return{allowed:!0,remaining:-1,limit:-1,resetAt:null,plan:a,isAdmin:n,isPaid:r||n};let w=new Date,c=e.dailyRequestsResetAt,g=e.dailyRequestsUsed||0;(!c||w>=c)&&(g=0);let f=_.dailyRequests-g;return{allowed:f>0,remaining:f,limit:_.dailyRequests,resetAt:e.dailyRequestsResetAt,plan:a,isAdmin:!1,isPaid:r}}async updateUserPlan(t,e){let s=u[e]||u.free;await o.update(i).set({plan:e,dailyRequestsLimit:s.dailyRequests,dailyRequestsUsed:0,dailyRequestsResetAt:null,updatedAt:new Date}).where(d(i.id,t))}async hasTokenQuota(t){let[e]=await o.select().from(i).where(d(i.id,t));if(!e)return!1;let s=String(e.role||"").toLowerCase().trim();if(s==="admin"||s==="superadmin"||s==="team_admin"||e.plan==="pro"||m&&e.email?.toLowerCase()===m.toLowerCase())return!0;let n=e.tokensConsumed||0,a=e.tokensLimit||1e5;return n<a}async recordTokenUsage(t,e){let[s]=await o.select().from(i).where(d(i.id,t));if(!s)return;let l=s.tokensConsumed||0;await o.update(i).set({tokensConsumed:l+e,updatedAt:new Date}).where(d(i.id,t))}},E=new R;export{R as a,E as b};
