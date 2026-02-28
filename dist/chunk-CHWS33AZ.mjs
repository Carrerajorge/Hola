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
import{Ja as a,l as y,ob as d}from"./chunk-PNGSAWMQ.mjs";import{e as r}from"./chunk-6EWVFNKC.mjs";import{and as T,asc as C,eq as u,gt as S,gte as H,lt as W,sql as p}from"drizzle-orm";var A={free:{dailyRequests:3,model:"grok-4-1-fast-non-reasoning"},go:{dailyRequests:50,model:"grok-4-1-fast-non-reasoning"},plus:{dailyRequests:200,model:"grok-4-1-fast-non-reasoning"},pro:{dailyRequests:-1,model:"grok-4-1-fast-non-reasoning"},admin:{dailyRequests:-1,model:"grok-4-1-fast-non-reasoning"}},U=process.env.ADMIN_EMAIL||"",F=new Set(["admin","superadmin"]),k={free:1e5,go:1e6,plus:5e6,pro:null,business:null,enterprise:null,admin:null};function B(s){return String(s||"").toLowerCase().trim()}function b(s){let t=String(s.email||"").toLowerCase().trim(),e=B(s.role);return U&&t===U.toLowerCase()||F.has(e)}function $(s,t){let e=new Date(s),n=e.getDate();return e.setMonth(e.getMonth()+t),e.getDate()!==n&&e.setDate(0),e}function x(s){if(!s)return null;if(s instanceof Date)return Number.isFinite(s.getTime())?s:null;if(typeof s=="string"||typeof s=="number"){let t=new Date(s);return Number.isFinite(t.getTime())?t:null}return null}function O(s,t){if(t)return"admin";let e=String(s.subscriptionStatus||"").toLowerCase().trim(),n=String(s.subscriptionPlan||"").toLowerCase().trim(),i=String(s.plan||"free").toLowerCase().trim();return e==="active"&&n?n:i||"free"}function M(s,t){let e=typeof s.monthlyTokenLimit=="number"?s.monthlyTokenLimit:null;return e&&e>0?e:t in k?k[t]??null:k.free}function P(s,t){let e=x(s.subscriptionPeriodEnd),n=e&&e.getTime()>t.getTime()?e:new Date(t.getFullYear(),t.getMonth()+1,1);for(;n.getTime()<=t.getTime();)n=$(n,1);return n}function G(){let s=new Date,t=new Date(s);return t.setDate(t.getDate()+1),t.setHours(0,0,0,0),t}var N=class{async checkAndIncrementUsage(t){let[e]=await d.select().from(r).where(u(r.id,t));if(!e)return{allowed:!1,remaining:0,limit:0,resetAt:null,plan:"free",message:"Usuario no encontrado"};let n=b(e),i=n?"admin":e.plan||"free",o=A[i]||A.free;if(n||o.dailyRequests===-1)return{allowed:!0,remaining:-1,limit:-1,resetAt:null,plan:i};let m=new Date,l=G(),c=await d.execute(p`
      UPDATE users
      SET
        daily_requests_used = CASE
          WHEN daily_requests_reset_at IS NULL OR NOW() >= daily_requests_reset_at
          THEN 1
          ELSE COALESCE(daily_requests_used, 0) + 1
        END,
        daily_requests_reset_at = CASE
          WHEN daily_requests_reset_at IS NULL OR NOW() >= daily_requests_reset_at
          THEN ${l}
          ELSE daily_requests_reset_at
        END,
        daily_requests_limit = ${o.dailyRequests},
        updated_at = NOW()
      WHERE id = ${t}
        AND (
          -- Allow if reset needed
          daily_requests_reset_at IS NULL
          OR NOW() >= daily_requests_reset_at
          -- Or if under limit
          OR COALESCE(daily_requests_used, 0) < ${o.dailyRequests}
        )
      RETURNING
        daily_requests_used as used,
        daily_requests_reset_at as reset_at
    `);if(c.rows.length===0)return{allowed:!1,remaining:0,limit:o.dailyRequests,resetAt:e.dailyRequestsResetAt,plan:i,message:"Has alcanzado el l\xEDmite diario de solicitudes. Actualiza tu plan para continuar."};let f=c.rows[0];return{allowed:!0,remaining:o.dailyRequests-f.used,limit:o.dailyRequests,resetAt:f.reset_at,plan:i}}async getUsageStatus(t){let[e]=await d.select().from(r).where(u(r.id,t));if(!e)return{allowed:!1,remaining:0,limit:0,resetAt:null,plan:"free"};let n=b(e),i=n?"admin":e.plan||"free",o=i!=="free"&&i!=="admin",m=A[i]||A.free;if(n||m.dailyRequests===-1)return{allowed:!0,remaining:-1,limit:-1,resetAt:null,plan:i,isAdmin:n,isPaid:o||n};let l=new Date,c=e.dailyRequestsResetAt,f=e.dailyRequestsUsed||0;(!c||l>=c)&&(f=0);let g=m.dailyRequests-f;return{allowed:g>0,remaining:g,limit:m.dailyRequests,resetAt:e.dailyRequestsResetAt,plan:i,isAdmin:!1,isPaid:o}}async updateUserPlan(t,e){let n=A[e]||A.free;await d.update(r).set({plan:e,dailyRequestsLimit:n.dailyRequests,dailyRequestsUsed:0,dailyRequestsResetAt:null,updatedAt:new Date}).where(u(r.id,t))}async hasTokenQuota(t){let[e]=await d.select().from(r).where(u(r.id,t));if(!e)return!1;let n=b(e),i=O(e,n),o=M(e,i);if(o===null)return!0;let m=new Date,l=P(e,m),c=$(l,-1),f=x(e.tokensResetAt),g=typeof e.monthlyTokensUsed=="number"?e.monthlyTokensUsed:0;if(f)m.getTime()>=f.getTime()&&(g=0,await d.update(r).set({monthlyTokensUsed:0,tokensResetAt:l,updatedAt:new Date}).where(u(r.id,t)));else{let[L]=await d.select({tokensIn:p`COALESCE(SUM(${y.tokensIn}), 0)`,tokensOut:p`COALESCE(SUM(${y.tokensOut}), 0)`}).from(y).where(T(u(y.userId,t),H(y.createdAt,c),W(y.createdAt,l))),R=L?.tokensIn??0,E=L?.tokensOut??0;g=Math.max(0,R+E),await d.update(r).set({monthlyTokensUsed:g,tokensResetAt:l,updatedAt:new Date}).where(u(r.id,t))}if(g<o)return!0;let[{extraCredits:h=0}={extraCredits:0}]=await d.select({extraCredits:p`COALESCE(SUM(${a.creditsRemaining}), 0)`}).from(a).where(T(u(a.userId,t),S(a.creditsRemaining,0),S(a.expiresAt,m)));return(h??0)>0}async recordTokenUsage(t,e){typeof e!="number"||!Number.isFinite(e)||e<=0||await d.transaction(async n=>{let[i]=await n.select().from(r).where(u(r.id,t)).limit(1);if(!i)return;let o=b(i),m=O(i,o),l=M(i,m),c=new Date,f=P(i,c),g=await n.execute(p`
        UPDATE users
        SET
          tokens_consumed = COALESCE(tokens_consumed, 0) + ${e},
          monthly_tokens_used = CASE
            WHEN tokens_reset_at IS NULL OR NOW() >= tokens_reset_at
            THEN ${e}
            ELSE COALESCE(monthly_tokens_used, 0) + ${e}
          END,
          tokens_reset_at = ${f},
          updated_at = NOW()
        WHERE id = ${t}
        RETURNING monthly_tokens_used as monthly_used
      `);if(!g?.rows?.length)return;let h=Number(g.rows[0]?.monthly_used||0),L=Math.max(0,h-e),R=0;if(l!==null){let _=Math.max(0,h-l),w=Math.max(0,L-l);R=Math.max(0,_-w)}if(R<=0)return;let E=R,q=0,I=await n.select({id:a.id,creditsRemaining:a.creditsRemaining}).from(a).where(T(u(a.userId,t),S(a.creditsRemaining,0),S(a.expiresAt,c))).orderBy(C(a.expiresAt),C(a.createdAt));for(let _ of I){if(E<=0)break;let w=typeof _.creditsRemaining=="number"?_.creditsRemaining:Number(_.creditsRemaining||0);if(!Number.isFinite(w)||w<=0)continue;let D=Math.min(w,E);await n.update(a).set({creditsRemaining:Math.max(0,w-D)}).where(u(a.id,_.id)),E-=D,q+=D}q>0&&await n.update(r).set({creditsBalance:p`GREATEST(COALESCE(${r.creditsBalance}, 0) - ${q}, 0)`,updatedAt:new Date}).where(u(r.id,t))})}},Y=new N;export{N as a,Y as b};
