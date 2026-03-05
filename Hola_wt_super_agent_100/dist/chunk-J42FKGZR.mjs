import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{Ya as o,Za as m,hb as A}from"./chunk-SFS5HO6Q.mjs";function te(e){return{claims:{sub:String(e.id),email:e.email??null,first_name:e.firstName||"",last_name:e.lastName||"",role:e.role||"user"},role:e.role||"user",expires_at:Math.floor(Date.now()/1e3)+10080*60}}A();import{sql as v}from"drizzle-orm";function $(e){if(!e)return null;if(typeof e.authUserId=="string"&&e.authUserId)return e.authUserId;let t=e?.passport?.user;if(typeof t=="string"&&t)return t;let n=t?.claims?.sub||t?.id||t?.sub;return typeof n=="string"&&n?n:null}function S(e,t){return $(e)===t}A();import y from"crypto";import{sql as c}from"drizzle-orm";var g={digits:6,period:30,algorithm:"SHA1"},C=async()=>{try{await o.execute(c`
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
    `),await o.execute(c`
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
    `),await o.execute(c`CREATE INDEX IF NOT EXISTS idx_2fa_user ON user_2fa(user_id)`),await o.execute(c`CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(user_id)`),await o.execute(c`CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address)`)}catch{}};C();function F(){let e=y.randomBytes(20);return k(e)}function k(e){let t="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",n="",s=0,r=0;for(let a of e)for(r=r<<8|a,s+=8;s>=5;)n+=t[r>>>s-5&31],s-=5;return s>0&&(n+=t[r<<5-s&31]),n}function H(e){let t="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",n=e.toUpperCase().replace(/=+$/,""),s=0,r=0,a=[];for(let i of n){let u=t.indexOf(i);u!==-1&&(r=r<<5|u,s+=5,s>=8&&(a.push(r>>>s-8&255),s-=8))}return Buffer.from(a)}function W(e,t){let n=Math.floor((t||Date.now())/1e3/g.period),s=Buffer.alloc(8);s.writeBigInt64BE(BigInt(n));let r=H(e),a=y.createHmac("sha1",r);a.update(s);let i=a.digest(),u=i[i.length-1]&15;return(((i[u]&127)<<24|(i[u+1]&255)<<16|(i[u+2]&255)<<8|i[u+3]&255)%Math.pow(10,g.digits)).toString().padStart(g.digits,"0")}function I(e,t){let n=Date.now();for(let s of[-1,0,1]){let r=n+s*g.period*1e3;if(W(e,r)===t)return!0}return!1}function h(e=10){let t=[];for(let n=0;n<e;n++){let s=y.randomBytes(4).toString("hex").toUpperCase();t.push(`${s.slice(0,4)}-${s.slice(4)}`)}return t}function V(e,t,n="IliaGPT"){let s=encodeURIComponent(t),r=encodeURIComponent(n);return`otpauth://totp/${r}:${s}?secret=${e}&issuer=${r}&algorithm=${g.algorithm}&digits=${g.digits}&period=${g.period}`}async function ae(e){let t=F(),n=h(),s=await o.execute(c`SELECT email FROM users WHERE id = ${e}`),r=String(s.rows?.[0]?.email||"user@iliagpt.com");await o.execute(c`
    INSERT INTO user_2fa (user_id, secret, backup_codes)
    VALUES (${e}, ${t}, ${JSON.stringify(n)})
    ON CONFLICT (user_id) DO UPDATE SET
      secret = ${t},
      backup_codes = ${JSON.stringify(n)},
      is_enabled = false,
      updated_at = NOW()
  `);let a=V(t,r);return{secret:t,qrCodeUrl:a,backupCodes:n}}async function ue(e,t){let n=await o.execute(c`
    SELECT secret FROM user_2fa WHERE user_id = ${e} AND is_enabled = false
  `);if(!n.rows?.length)return!1;let s=String(n.rows[0].secret||"");return I(s,t)?(await o.execute(c`
      UPDATE user_2fa SET is_enabled = true, verified_at = NOW() WHERE user_id = ${e}
    `),!0):!1}async function ce(e,t){let n=await o.execute(c`
    SELECT secret, backup_codes FROM user_2fa WHERE user_id = ${e} AND is_enabled = true
  `);if(!n.rows?.length)return!1;let s=String(n.rows[0].secret||""),r=n.rows[0].backup_codes;if(I(s,t))return!0;let a=r,i=a.indexOf(t);return i!==-1?(a.splice(i,1),await o.execute(c`
      UPDATE user_2fa SET backup_codes = ${JSON.stringify(a)} WHERE user_id = ${e}
    `),!0):!1}async function R(e){return(await o.execute(c`
    SELECT is_enabled FROM user_2fa WHERE user_id = ${e}
  `)).rows?.[0]?.is_enabled===!0}async function de(e){return await o.execute(c`DELETE FROM user_2fa WHERE user_id = ${e}`),!0}async function le(e){let t=h();return await o.execute(c`
    UPDATE user_2fa SET backup_codes = ${JSON.stringify(t)}, updated_at = NOW()
    WHERE user_id = ${e}
  `),t}A();import B from"crypto";import{sql as f}from"drizzle-orm";async function K(){try{await o.execute(f`
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
    `),await o.execute(f`CREATE INDEX IF NOT EXISTS idx_login_approvals_user ON login_approvals(user_id)`),await o.execute(f`CREATE INDEX IF NOT EXISTS idx_login_approvals_expires ON login_approvals(expires_at)`)}catch{}}K();function q(e){return{id:String(e.id),userId:String(e.user_id),status:String(e.status),metadata:e.metadata||{},createdAt:e.created_at?new Date(e.created_at):new Date(0),expiresAt:e.expires_at?new Date(e.expires_at):new Date(0),decidedAt:e.decided_at?new Date(e.decided_at):null,decidedBySid:e.decided_by_sid?String(e.decided_by_sid):null}}async function N(e){let t=B.randomUUID(),n=e.ttlMs??300*1e3,s=new Date(Date.now()+n),r=e.metadata??{};return await o.execute(f`
    INSERT INTO login_approvals (id, user_id, status, metadata, expires_at)
    VALUES (${t}, ${e.userId}, 'pending', ${JSON.stringify(r)}, ${s})
  `),{id:t,expiresAt:s}}async function _e(e){let n=(await m.execute(f`
    SELECT id, user_id, status, metadata, created_at, expires_at, decided_at, decided_by_sid
    FROM login_approvals
    WHERE id = ${e}
  `))?.rows?.[0];return n?q(n):null}async function me(e){let t=new Date,n=e.decidedBySid??null,s=await o.execute(f`
    UPDATE login_approvals
    SET status = ${e.decision},
        decided_at = ${t},
        decided_by_sid = ${n}
    WHERE id = ${e.id}
      AND user_id = ${e.userId}
      AND status = 'pending'
      AND expires_at > NOW()
  `);return{updated:s?.rowCount?s.rowCount>0:!1}}async function w(e){await o.execute(f`
    UPDATE login_approvals
    SET status = 'expired'
    WHERE id = ${e}
      AND status = 'pending'
      AND expires_at <= NOW()
  `)}import{createRequire as X}from"module";var Y=X(import.meta.url),p=null;try{p=Y("web-push")}catch{p=null}var b=null,O=null;function J(){let e=process.env.VAPID_PUBLIC_KEY||"",t=process.env.VAPID_PRIVATE_KEY||"";return e&&t?{publicKey:e,privateKey:t}:null}function j(){let e=J();return e?{keys:e,isEphemeral:!1}:p?(b||(b=p.generateVAPIDKeys()),{keys:b,isEphemeral:!0}):null}function P(){let e=process.env.VAPID_SUBJECT||"mailto:admin@iliagpt.com",t=j();if(!t||!p)return null;let n=`${e}:${t.keys.publicKey}`;return O!==n&&(p.setVapidDetails(e,t.keys.publicKey,t.keys.privateKey),O=n),{publicKey:t.keys.publicKey,isEphemeral:t.isEphemeral}}function be(){return P()}async function D(e,t){if(!P()||!p)return{ok:!1,error:"WEB_PUSH_NOT_CONFIGURED"};try{let s=JSON.stringify(t??{});return await p.sendNotification(e,s),{ok:!0}}catch(s){return{ok:!1,error:s?.message||"WEB_PUSH_FAILED",statusCode:s?.statusCode}}}async function G(e){let t=e.userId,n=e.excludeSid??null,s=await m.execute(v`
    SELECT sid, sess
    FROM sessions
    WHERE expire > NOW()
      AND (
        sess #>> '{passport,user,claims,sub}' = ${t}
        OR sess #>> '{passport,user,id}' = ${t}
        OR sess ->> 'authUserId' = ${t}
        OR sess #>> '{passport,user}' = ${t}
      )
  `),r=s?.rows??s,a=[];for(let i of Array.isArray(r)?r:[]){if(n&&String(i?.sid)===n)continue;let u=i?.sess;if(!S(u,t)||!u?.security?.pushApprovalsEnabled)continue;let _=u?.push?.subscription;_&&a.push({sid:String(i.sid),subscription:_})}return a}async function we(e){let[t,n]=await Promise.all([R(e.userId),G({userId:e.userId,excludeSid:e.excludeSid})]),s={totp:t,push:n.length>0},r=s.totp||s.push;return{totpEnabled:t,pushTargets:n,methods:s,requiresMfa:r}}async function Q(e){await new Promise((t,n)=>{if(!e?.save)return t();e.save(s=>{if(s)return n(s);t()})})}async function z(e){if(e.length!==0)try{await Promise.all(e.map(t=>o.execute(v`
          UPDATE sessions
          SET sess = sess #- '{push,subscription}'
          WHERE sid = ${t}
        `)))}catch{}}async function Oe(e){let t=e.ttlMs??3e5,n=e.req?.session;if(!n)throw Object.assign(new Error("No active session"),{code:"NO_SESSION"});let s={totp:!!e.totpEnabled,push:e.pushTargets.length>0};if(!s.totp&&!s.push)throw Object.assign(new Error("MFA not required"),{code:"MFA_NOT_REQUIRED"});let r=e.req?.ip||e.req?.socket?.remoteAddress||null,a=e.req?.headers?.["user-agent"]||null,i=null,u=0;if(s.push)try{i=(await N({userId:e.userId,ttlMs:t,metadata:{email:e.email||null,ip:r,userAgent:a,requestedAt:new Date().toISOString()}})).id;let d=a||"Navegador",L={title:"Aprobar inicio de sesi\xF3n",body:`Nuevo intento desde ${`${/Mobile|Android|iPhone|iPad/i.test(d)?"M\xF3vil":"Desktop"}`} (${r||"IP desconocida"})`,requireInteraction:!0,actions:[{action:"approve",title:"Aprobar"},{action:"deny",title:"Rechazar"}],data:{url:`/login/approve?approvalId=${i}`,actionUrls:{approve:`/login/approve?approvalId=${i}&action=approve`,deny:`/login/approve?approvalId=${i}&action=deny`},approvalId:i}},T=await Promise.all(e.pushTargets.map(E=>D(E.subscription,L)));u=T.filter(E=>E.ok).length;let U=e.pushTargets.filter((E,M)=>{let x=T[M]?.statusCode;return x===404||x===410}).map(E=>E.sid);await z(U)}catch(l){console.warn("[MFA] Failed to create/send push approval:",l?.message||l)}if(!s.totp&&s.push&&u===0)throw i&&await w(i).catch(()=>{}),Object.assign(new Error("PUSH_DELIVERY_FAILED"),{code:"PUSH_DELIVERY_FAILED"});let _=l=>{if(!l||typeof l!="object")return;let d={...l};return d.claims=d.claims&&typeof d.claims=="object"?{...d.claims}:{},d.claims.sub||(d.claims.sub=e.userId),e.email&&!d.claims.email&&(d.claims.email=e.email),d.expires_at||(d.expires_at=Math.floor(Date.now()/1e3)+10080*60),d};return n.pendingMfa={userId:e.userId,methods:s,approvalId:i,createdAt:Date.now(),expiresAt:Date.now()+t,sessionUser:_(e.sessionUser)},await Q(n),{methods:s,approvalId:i,expiresAt:Date.now()+t,pushSent:u}}export{ae as a,ue as b,ce as c,R as d,de as e,le as f,be as g,S as h,_e as i,me as j,w as k,te as l,we as m,Oe as n};
