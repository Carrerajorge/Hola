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
import{ob as a,pb as m}from"./chunk-PNGSAWMQ.mjs";function re(e){return{id:String(e.id),claims:{sub:String(e.id),email:e.email??null,first_name:e.firstName||"",last_name:e.lastName||"",role:e.role||"user"},role:e.role||"user",expires_at:Math.floor(Date.now()/1e3)+10080*60}}import{sql as L}from"drizzle-orm";function $(e){if(!e)return null;if(typeof e.authUserId=="string"&&e.authUserId)return e.authUserId;let t=e?.passport?.user;if(typeof t=="string"&&t)return t;let s=t?.claims?.sub||t?.id||t?.sub;return typeof s=="string"&&s?s:null}function x(e,t){return $(e)===t}import y from"crypto";import{sql as c}from"drizzle-orm";var p={digits:6,period:30,algorithm:"SHA1"},C=async()=>{try{await a.execute(c`
      CREATE TABLE IF NOT EXISTS user_2fa (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) UNIQUE NOT NULL,
        secret VARCHAR(255) NOT NULL,
        is_enabled BOOLEAN DEFAULT false,
        backup_codes JSONB DEFAULT '[]',
        verified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `),await a.execute(c`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255),
        email VARCHAR(255),
        ip_address VARCHAR(45),
        user_agent TEXT,
        success BOOLEAN,
        failure_reason VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `),await a.execute(c`CREATE INDEX IF NOT EXISTS idx_2fa_user ON user_2fa(user_id)`),await a.execute(c`CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(user_id)`),await a.execute(c`CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address)`)}catch{}};C();function F(){let e=y.randomBytes(20);return k(e)}function k(e){let t="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",s="",n=0,r=0;for(let o of e)for(r=r<<8|o,n+=8;n>=5;)s+=t[r>>>n-5&31],n-=5;return n>0&&(s+=t[r<<5-n&31]),s}function H(e){let t="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",s=e.toUpperCase().replace(/=+$/,""),n=0,r=0,o=[];for(let i of s){let u=t.indexOf(i);u!==-1&&(r=r<<5|u,n+=5,n>=8&&(o.push(r>>>n-8&255),n-=8))}return Buffer.from(o)}function W(e,t){let s=Math.floor((t||Date.now())/1e3/p.period),n=Buffer.alloc(8);n.writeBigInt64BE(BigInt(s));let r=H(e),o=y.createHmac("sha1",r);o.update(n);let i=o.digest(),u=i[i.length-1]&15;return(((i[u]&127)<<24|(i[u+1]&255)<<16|(i[u+2]&255)<<8|i[u+3]&255)%Math.pow(10,p.digits)).toString().padStart(p.digits,"0")}var A=new Map,V=2*p.period*1e3,B=1e4;function K(){if(A.size<=B)return;let e=Date.now();for(let[t,s]of A.entries())e>s&&A.delete(t)}function R(e,t,s){if(s){let r=`${s}:${t}`,o=A.get(r);if(o&&Date.now()<=o)return!1}let n=Date.now();for(let r of[-1,0,1]){let o=n+r*p.period*1e3;if(W(e,o)===t)return s&&(K(),A.set(`${s}:${t}`,Date.now()+V)),!0}return!1}function h(e=10){let t=[];for(let s=0;s<e;s++){let n=y.randomBytes(4).toString("hex").toUpperCase();t.push(`${n.slice(0,4)}-${n.slice(4)}`)}return t}function q(e,t,s="IliaGPT"){let n=encodeURIComponent(t),r=encodeURIComponent(s);return`otpauth://totp/${r}:${n}?secret=${e}&issuer=${r}&algorithm=${p.algorithm}&digits=${p.digits}&period=${p.period}`}async function de(e){let t=F(),s=h(),n=await a.execute(c`SELECT email FROM users WHERE id = ${e}`),r=String(n.rows?.[0]?.email||"user@iliagpt.com");await a.execute(c`
    INSERT INTO user_2fa (user_id, secret, backup_codes)
    VALUES (${e}, ${t}, ${JSON.stringify(s)})
    ON CONFLICT (user_id) DO UPDATE SET
      secret = ${t},
      backup_codes = ${JSON.stringify(s)},
      is_enabled = false,
      updated_at = NOW()
  `);let o=q(t,r);return{secret:t,qrCodeUrl:o,backupCodes:s}}async function le(e,t){let s=await a.execute(c`
    SELECT secret FROM user_2fa WHERE user_id = ${e} AND is_enabled = false
  `);if(!s.rows?.length)return!1;let n=String(s.rows[0].secret||"");return R(n,t,e)?(await a.execute(c`
      UPDATE user_2fa SET is_enabled = true, verified_at = NOW() WHERE user_id = ${e}
    `),!0):!1}async function pe(e,t){let s=await a.execute(c`
    SELECT secret, backup_codes FROM user_2fa WHERE user_id = ${e} AND is_enabled = true
  `);if(!s.rows?.length)return!1;let n=String(s.rows[0].secret||""),r=s.rows[0].backup_codes;if(R(n,t,e))return!0;let o=r,i=o.indexOf(t);return i!==-1?(o.splice(i,1),await a.execute(c`
      UPDATE user_2fa SET backup_codes = ${JSON.stringify(o)} WHERE user_id = ${e}
    `),!0):!1}async function I(e){let s=(await a.execute(c`
    SELECT is_enabled FROM user_2fa WHERE user_id = ${e}
  `)).rows?.[0]?.is_enabled;return s===!0||s==="true"||s===1||s==="1"||s==="t"}async function ge(e){return await a.execute(c`DELETE FROM user_2fa WHERE user_id = ${e}`),!0}async function fe(e){let t=h();return await a.execute(c`
    UPDATE user_2fa SET backup_codes = ${JSON.stringify(t)}, updated_at = NOW()
    WHERE user_id = ${e}
  `),t}import X from"crypto";import{sql as f}from"drizzle-orm";async function Y(){try{await a.execute(f`
      CREATE TABLE IF NOT EXISTS login_approvals (
        id VARCHAR(255) PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        decided_at TIMESTAMP,
        decided_by_sid VARCHAR(255)
      )
    `),await a.execute(f`CREATE INDEX IF NOT EXISTS idx_login_approvals_user ON login_approvals(user_id)`),await a.execute(f`CREATE INDEX IF NOT EXISTS idx_login_approvals_expires ON login_approvals(expires_at)`)}catch{}}Y();function J(e){return{id:String(e.id),userId:String(e.user_id),status:String(e.status),metadata:e.metadata||{},createdAt:e.created_at?new Date(e.created_at):new Date(0),expiresAt:e.expires_at?new Date(e.expires_at):new Date(0),decidedAt:e.decided_at?new Date(e.decided_at):null,decidedBySid:e.decided_by_sid?String(e.decided_by_sid):null}}async function w(e){let t=X.randomUUID(),s=e.ttlMs??300*1e3,n=new Date(Date.now()+s),r=e.metadata??{};return await a.execute(f`
    INSERT INTO login_approvals (id, user_id, status, metadata, expires_at)
    VALUES (${t}, ${e.userId}, 'pending', ${JSON.stringify(r)}, ${n})
  `),{id:t,expiresAt:n}}async function ye(e){let s=(await m.execute(f`
    SELECT id, user_id, status, metadata, created_at, expires_at, decided_at, decided_by_sid
    FROM login_approvals
    WHERE id = ${e}
  `))?.rows?.[0];return s?J(s):null}async function Te(e){let t=new Date,s=e.decidedBySid??null,n=await a.execute(f`
    UPDATE login_approvals
    SET status = ${e.decision},
        decided_at = ${t},
        decided_by_sid = ${s}
    WHERE id = ${e.id}
      AND user_id = ${e.userId}
      AND status = 'pending'
      AND expires_at > NOW()
  `);return{updated:n?.rowCount?n.rowCount>0:!1}}async function N(e){await a.execute(f`
    UPDATE login_approvals
    SET status = 'expired'
    WHERE id = ${e}
      AND status = 'pending'
      AND expires_at <= NOW()
  `)}import{createRequire as j}from"module";var G=j(import.meta.url),g=null;try{g=G("web-push")}catch{g=null}var T=null,O=null;function Q(){let e=process.env.VAPID_PUBLIC_KEY||"",t=process.env.VAPID_PRIVATE_KEY||"";return e&&t?{publicKey:e,privateKey:t}:null}function z(){let e=Q();return e?{keys:e,isEphemeral:!1}:g?(T||(T=g.generateVAPIDKeys()),{keys:T,isEphemeral:!0}):null}function P(){let e=process.env.VAPID_SUBJECT||"mailto:admin@iliagpt.com",t=z();if(!t||!g)return null;let s=`${e}:${t.keys.publicKey}`;return O!==s&&(g.setVapidDetails(e,t.keys.publicKey,t.keys.privateKey),O=s),{publicKey:t.keys.publicKey,isEphemeral:t.isEphemeral}}function xe(){return P()}async function D(e,t){if(!P()||!g)return{ok:!1,error:"WEB_PUSH_NOT_CONFIGURED"};try{let n=JSON.stringify(t??{});return await g.sendNotification(e,n),{ok:!0}}catch(n){return{ok:!1,error:n?.message||"WEB_PUSH_FAILED",statusCode:n?.statusCode}}}async function Z(e){let t=e.userId,s=e.excludeSid??null,n=await m.execute(L`
    SELECT sid, sess
    FROM sessions
    WHERE expire > NOW()
      AND (
        sess #>> '{passport,user,claims,sub}' = ${t}
        OR sess #>> '{passport,user,id}' = ${t}
        OR sess ->> 'authUserId' = ${t}
        OR sess #>> '{passport,user}' = ${t}
      )
  `),r=n?.rows??n,o=[];for(let i of Array.isArray(r)?r:[]){if(s&&String(i?.sid)===s)continue;let u=i?.sess;if(!x(u,t)||!u?.security?.pushApprovalsEnabled)continue;let _=u?.push?.subscription;_&&o.push({sid:String(i.sid),subscription:_})}return o}async function De(e){let[t,s]=await Promise.all([I(e.userId),Z({userId:e.userId,excludeSid:e.excludeSid})]),n={totp:t,push:s.length>0},r=n.totp||n.push;return{totpEnabled:t,pushTargets:s,methods:n,requiresMfa:r}}async function ee(e){await new Promise((t,s)=>{if(!e?.save)return t();e.save(n=>{if(n)return s(n);t()})})}async function te(e){if(e.length!==0)try{await Promise.all(e.map(t=>a.execute(L`
          UPDATE sessions
          SET sess = sess #- '{push,subscription}'
          WHERE sid = ${t}
        `)))}catch{}}async function Le(e){let t=e.ttlMs??3e5,s=e.req?.session;if(!s)throw Object.assign(new Error("No active session"),{code:"NO_SESSION"});let n={totp:!!e.totpEnabled,push:e.pushTargets.length>0};if(!n.totp&&!n.push)throw Object.assign(new Error("MFA not required"),{code:"MFA_NOT_REQUIRED"});let r=e.req?.ip||e.req?.socket?.remoteAddress||null,o=e.req?.headers?.["user-agent"]||null,i=null,u=0;if(n.push)try{i=(await w({userId:e.userId,ttlMs:t,metadata:{email:e.email||null,ip:r,userAgent:o,requestedAt:new Date().toISOString()}})).id;let d=o||"Navegador",v={title:"Aprobar inicio de sesi\xF3n",body:`Nuevo intento desde ${`${/Mobile|Android|iPhone|iPad/i.test(d)?"M\xF3vil":"Desktop"}`} (${r||"IP desconocida"})`,requireInteraction:!0,actions:[{action:"approve",title:"Aprobar"},{action:"deny",title:"Rechazar"}],data:{url:`/login/approve?approvalId=${i}`,actionUrls:{approve:`/login/approve?approvalId=${i}&action=approve`,deny:`/login/approve?approvalId=${i}&action=deny`},approvalId:i}},b=await Promise.all(e.pushTargets.map(E=>D(E.subscription,v)));u=b.filter(E=>E.ok).length;let U=e.pushTargets.filter((E,M)=>{let S=b[M]?.statusCode;return S===404||S===410}).map(E=>E.sid);await te(U)}catch(l){console.warn("[MFA] Failed to create/send push approval:",l?.message||l)}if(!n.totp&&n.push&&u===0)throw i&&await N(i).catch(()=>{}),Object.assign(new Error("PUSH_DELIVERY_FAILED"),{code:"PUSH_DELIVERY_FAILED"});let _=l=>{if(!l||typeof l!="object")return;let d={...l};return d.claims=d.claims&&typeof d.claims=="object"?{...d.claims}:{},d.claims.sub||(d.claims.sub=e.userId),e.email&&!d.claims.email&&(d.claims.email=e.email),d.expires_at||(d.expires_at=Math.floor(Date.now()/1e3)+10080*60),d};return s.pendingMfa={userId:e.userId,methods:n,approvalId:i,createdAt:Date.now(),expiresAt:Date.now()+t,sessionUser:_(e.sessionUser)},await ee(s),{methods:n,approvalId:i,expiresAt:Date.now()+t,pushSent:u}}export{de as a,le as b,pe as c,I as d,ge as e,fe as f,xe as g,x as h,ye as i,Te as j,N as k,re as l,De as m,Le as n};
