import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import{a as h}from"./chunk-7TVOF32I.mjs";import{Ya as u,e as a,l as m}from"./chunk-A63JEV4L.mjs";import"./chunk-X6OJ7PYT.mjs";import"./chunk-2FP5DEJW.mjs";import{eq as c,sql as F}from"drizzle-orm";import{randomUUID as M}from"crypto";import{createRequire as L}from"module";var O=L(import.meta.url),S=null;function z(){if(!S)try{S=O("nodemailer")}catch{console.log("nodemailer not installed, email notifications disabled")}return S}var P=(process.env.ADMIN_EMAIL||"").trim(),N={free:0,go:1,plus:2,pro:3,business:4},j={go:5,plus:10,pro:200,business:25},g=new Map,A=1440*60*1e3,H=new Set(["bif","clp","djf","gnf","jpy","kmf","krw","mga","pyg","rwf","ugx","vnd","vuv","xaf","xof","xpf"]),B=new Set(["bhd","jod","kwd","omr","tnd"]);function Y(e){let r=String(e||"").toLowerCase().trim();return r?H.has(r)?0:B.has(r)?3:2:2}function q(e,r){let t=typeof e=="number"?e:Number(e||0);if(!Number.isFinite(t))return"0.00";let n=Y(r),s=Math.pow(10,n);return(t/s).toFixed(n)}function D(e){return typeof e!="number"||!Number.isFinite(e)||e<=0?null:new Date(e*1e3)}function R(e){let r=e?.customer;return r?typeof r=="string"?r:typeof r=="object"&&typeof r.id=="string"?r.id:null:null}async function T(e){if(!e)return null;let[r]=await u.select({id:a.id}).from(a).where(c(a.stripeCustomerId,e)).limit(1);return r?.id||null}async function k(e){let{invoice:r,status:t,userId:n,plan:s}=e,i=typeof r?.id=="string"?r.id:null;if(!i)return;let d=typeof r?.currency=="string"?r.currency:"eur",o=d.toUpperCase(),p=t==="completed"?typeof r?.amount_paid=="number"?r.amount_paid:0:typeof r?.amount_due=="number"?r.amount_due:0,x=q(p,d),E=D(r?.status_transitions?.paid_at)||D(r?.created)||new Date,_=typeof r?.billing_reason=="string"?r.billing_reason:"",I=["stripe"];s&&I.push(String(s)),_&&I.push(`(${_})`);let $=I.join(" ").trim(),[v]=await u.select({id:m.id}).from(m).where(c(m.stripePaymentId,i)).limit(1);if(v){let C={amount:x,currency:o,status:t,method:"stripe",description:$,createdAt:E};n&&(C.userId=n),await u.update(m).set(C).where(c(m.id,v.id));return}await u.insert(m).values({userId:n||null,amount:x,currency:o,status:t,method:"stripe",description:$,stripePaymentId:i,createdAt:E})}function l(e){if(!e)return"";let r=e;return r=r.replace(/\u00A0/g," "),r=r.replace(/[\u200B\u200C\u200D\uFEFF]/g,""),r=r.replace(/\r\n/g,`
`),r=r.replace(/\r/g,`
`),r=r.replace(/\t/g," "),r=r.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g,""),r=r.normalize("NFC"),r=r.replace(/ {2,}/g," "),r=r.trim(),r}function ee(e){let r=[...e].map(t=>{let n=t.charCodeAt(0);return n>127||n<32?`\\u${n.toString(16).padStart(4,"0")}`:t}).join("");return{original:e,hex:r,cleaned:l(e)}}function f(e){let r=g.get(e);return r?Date.now()-r>A?(g.delete(e),!1):!0:!1}function y(e){if(g.set(e,Date.now()),g.size>1e3){let r=Date.now()-A;for(let[t,n]of g.entries())n<r&&g.delete(t)}}async function re(e){try{let[r]=await u.select().from(a).where(c(a.id,e));return r?{plan:r.subscriptionPlan||r.plan||"free",status:r.subscriptionStatus||"inactive",currentPeriodEnd:r.subscriptionPeriodEnd?new Date(r.subscriptionPeriodEnd):null,stripeCustomerId:r.stripeCustomerId??null,stripeSubscriptionId:r.stripeSubscriptionId??null}:{plan:"free",status:"inactive"}}catch(r){return console.error("Error getting user subscription:",r),{plan:"free",status:"inactive"}}}async function b(e,r){try{let t={updatedAt:new Date};return r.plan!==void 0&&(t.plan=r.plan,t.subscriptionPlan=r.plan),r.status!==void 0&&(t.subscriptionStatus=r.status),r.currentPeriodEnd!==void 0&&(t.subscriptionPeriodEnd=r.currentPeriodEnd),r.stripeCustomerId!==void 0&&(t.stripeCustomerId=r.stripeCustomerId),r.stripeSubscriptionId!==void 0&&(t.stripeSubscriptionId=r.stripeSubscriptionId),await u.update(a).set(t).where(c(a.id,e)),!0}catch(t){return console.error("Error updating user subscription:",t),!1}}function te(e){return e.plan!=="free"&&e.status==="active"}function se(e,r){return(N[r]||0)>(N[e]||0)}async function U(e){try{e.correlationId||(e.correlationId=`PAY-${Date.now()}-${M().slice(0,8).toUpperCase()}`),e.userName=l(e.userName),e.userEmail=l(e.userEmail),e.plan=l(e.plan),e.utmSource=l(e.utmSource),e.utmMedium=l(e.utmMedium),e.utmCampaign=l(e.utmCampaign),e.referrer=l(e.referrer),e.device=l(e.device),e.browser=l(e.browser);let r=await G(e);return await W(e),r}catch(r){return console.error("Error notifying admin of purchase:",r),!1}}async function G(e){try{let r=await z();if(!r)return console.log("Email skipped: nodemailer not available"),!1;let t=r.createTransport({host:process.env.SMTP_HOST||"smtp.gmail.com",port:parseInt(process.env.SMTP_PORT||"587"),secure:!1,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}),n=j[e.plan]||e.amount/100,s=`
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; background: #f3f4f6; margin: 0; padding: 20px; }
    .container { max-width: 700px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0 0 10px 0; font-size: 28px; }
    .highlight { background: rgba(255,255,255,0.2); padding: 15px 30px; border-radius: 10px; display: inline-block; font-size: 32px; font-weight: bold; margin-top: 10px; }
    .content { padding: 30px; }
    .section { background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .section-title { font-size: 14px; text-transform: uppercase; color: #6b7280; font-weight: 600; margin-bottom: 15px; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 10px 0; vertical-align: top; }
    td:first-child { font-weight: 500; color: #374151; width: 40%; }
    td:last-child { color: #1f2937; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
    .badge-green { background: #d1fae5; color: #065f46; }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; }
    .correlation { background: #fef3c7; padding: 10px 15px; border-radius: 8px; font-family: monospace; font-size: 13px; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>\u{1F389} \xA1Nueva Compra!</h1>
      <div class="highlight">+$${n} USD</div>
    </div>
    
    <div class="content">
      <!-- User Info -->
      <div class="section">
        <div class="section-title">\u{1F464} Informaci\xF3n del Usuario</div>
        <table>
          <tr>
            <td>Nombre:</td>
            <td><strong>${e.userName||"No especificado"}</strong></td>
          </tr>
          <tr>
            <td>Email:</td>
            <td>${e.userEmail}</td>
          </tr>
          <tr>
            <td>ID Usuario:</td>
            <td><code style="background:#e5e7eb;padding:2px 6px;border-radius:4px;font-size:12px;">${e.userId}</code></td>
          </tr>
        </table>
      </div>
      
      <!-- Transaction Details -->
      <div class="section">
        <div class="section-title">\u{1F4B3} Detalles de la Transacci\xF3n</div>
        <table>
          <tr>
            <td>Plan:</td>
            <td><span class="badge badge-green">${e.plan.toUpperCase()}</span></td>
          </tr>
          <tr>
            <td>Monto:</td>
            <td><strong>$${n} ${e.currency.toUpperCase()}</strong>/mes</td>
          </tr>
          <tr>
            <td>M\xE9todo de Pago:</td>
            <td>${e.paymentMethod||"Tarjeta"}</td>
          </tr>
          <tr>
            <td>Fecha/Hora:</td>
            <td>${e.timestamp.toLocaleString("es-PE",{timeZone:"America/Lima"})} (Lima)</td>
          </tr>
          ${e.sessionId?`
          <tr>
            <td>Session ID:</td>
            <td><code style="font-size:11px;">${e.sessionId}</code></td>
          </tr>
          `:""}
          ${e.intentId?`
          <tr>
            <td>Intent ID:</td>
            <td><code style="font-size:11px;">${e.intentId}</code></td>
          </tr>
          `:""}
          ${e.stripePaymentId?`
          <tr>
            <td>Invoice ID:</td>
            <td><code style="font-size:11px;">${e.stripePaymentId}</code></td>
          </tr>
          `:""}
        </table>
      </div>
      
      <!-- Tracking Info -->
      <div class="section">
        <div class="section-title">\u{1F4CA} Informaci\xF3n de Tracking</div>
        <table>
          ${e.ipAddress?`
          <tr>
            <td>IP / Pa\xEDs:</td>
            <td>${e.ipAddress} ${e.country?`(${e.country})`:""}</td>
          </tr>
          `:""}
          ${e.device||e.browser?`
          <tr>
            <td>Dispositivo:</td>
            <td>${e.browser||""} ${e.device?`en ${e.device}`:""}</td>
          </tr>
          `:""}
          ${e.referrer?`
          <tr>
            <td>Referrer:</td>
            <td>${e.referrer}</td>
          </tr>
          `:""}
          ${e.utmSource||e.utmMedium||e.utmCampaign?`
          <tr>
            <td>UTM:</td>
            <td>
              ${e.utmSource?`source: <span class="badge badge-blue">${e.utmSource}</span>`:""}
              ${e.utmMedium?`medium: <span class="badge badge-blue">${e.utmMedium}</span>`:""}
              ${e.utmCampaign?`campaign: <span class="badge badge-blue">${e.utmCampaign}</span>`:""}
            </td>
          </tr>
          `:""}
        </table>
      </div>
      
      <!-- Correlation ID -->
      <div class="correlation">
        <strong>\u{1F517} Correlation ID:</strong> ${e.correlationId}
      </div>
    </div>
    
    <div class="footer">
      <p>Ver detalles en <a href="https://dashboard.stripe.com" style="color:#10b981;">Dashboard de Stripe</a></p>
      <p>IliaGPT - Sistema de Pagos</p>
    </div>
  </div>
</body>
</html>
`;return P?(await t.sendMail({from:process.env.SMTP_FROM||"IliaGPT <noreply@iliagpt.com>",to:P,subject:`Pago confirmado \u2013 ${e.userId.slice(0,8)} \u2013 $${n} ${e.currency.toUpperCase()}`,html:s}),console.log(`[Stripe] Purchase notification email sent to ${P} | Correlation: ${e.correlationId}`),!0):(console.log("[Stripe] ADMIN_EMAIL not configured, skipping purchase notification email"),!0)}catch(r){return console.error("Error sending purchase email:",r),!1}}async function W(e){try{console.log("PURCHASE_LOG:",JSON.stringify({type:"NEW_PURCHASE",correlationId:e.correlationId,userId:e.userId,userEmail:e.userEmail,userName:e.userName,plan:e.plan,amount:e.amount,currency:e.currency,paymentMethod:e.paymentMethod,sessionId:e.sessionId,intentId:e.intentId,stripePaymentId:e.stripePaymentId,ipAddress:e.ipAddress,country:e.country,utmSource:e.utmSource,utmMedium:e.utmMedium,utmCampaign:e.utmCampaign,referrer:e.referrer,device:e.device,browser:e.browser,timestamp:e.timestamp.toISOString()}));try{await u.execute(F`
        INSERT INTO payments_log (
          correlation_id, user_id, email, name, plan, amount, currency,
          payment_method, session_id, intent_id, invoice_id,
          ip_address, country, utm_source, utm_medium, utm_campaign,
          referrer, device, browser, created_at
        ) VALUES (
          ${e.correlationId},
          ${e.userId},
          ${e.userEmail},
          ${e.userName||null},
          ${e.plan},
          ${e.amount},
          ${e.currency},
          ${e.paymentMethod||null},
          ${e.sessionId||null},
          ${e.intentId||null},
          ${e.stripePaymentId||null},
          ${e.ipAddress||null},
          ${e.country||null},
          ${e.utmSource||null},
          ${e.utmMedium||null},
          ${e.utmCampaign||null},
          ${e.referrer||null},
          ${e.device||null},
          ${e.browser||null},
          NOW()
        )
      `)}catch(r){r.message?.includes("does not exist")||console.error("Error inserting payment log:",r)}}catch(r){console.error("Error logging purchase:",r)}}async function ne(e,r){if(r&&f(r)){console.log(`[Stripe] Event ${r} already processed, skipping`);return}let t=e.metadata?.userId;if(!t){console.error("No userId in subscription metadata");return}let n=w(e.items.data[0]?.price?.id);await b(t,{plan:n,status:"active",stripeSubscriptionId:e.id,currentPeriodEnd:new Date((e.current_period_end??0)*1e3)});let[s]=await u.select().from(a).where(c(a.id,t));s&&await U({userId:t,userEmail:s.email||"unknown",userName:s.displayName||s.name||s.fullName||[s.firstName,s.lastName].filter(Boolean).join(" ")||void 0,plan:n,amount:e.items.data[0]?.price?.unit_amount||0,currency:e.currency||"usd",timestamp:new Date,stripePaymentId:e.latest_invoice,sessionId:e.metadata?.checkoutSessionId,ipAddress:e.metadata?.ipAddress,country:e.metadata?.country,utmSource:e.metadata?.utmSource,utmMedium:e.metadata?.utmMedium,utmCampaign:e.metadata?.utmCampaign,referrer:e.metadata?.referrer,device:e.metadata?.device,browser:e.metadata?.browser}),r&&y(r)}async function ae(e,r){if(r&&f(r)){console.log(`[Stripe] Event ${r} already processed, skipping`);return}let t=e.metadata?.userId;if(!t)return;let n=e.status==="active"?"active":e.status==="past_due"?"past_due":e.status==="canceled"?"cancelled":"inactive";await b(t,{status:n,currentPeriodEnd:new Date((e.current_period_end??0)*1e3)}),r&&y(r)}async function de(e,r){if(r&&f(r)){console.log(`[Stripe] Event ${r} already processed, skipping`);return}let t=e.metadata?.userId;t&&(await b(t,{plan:"free",status:"cancelled",stripeSubscriptionId:null,currentPeriodEnd:e.current_period_end?new Date((e.current_period_end??0)*1e3):null}),r&&y(r))}async function oe(e,r){if(r&&f(r)){console.log(`[Stripe] Event ${r} already processed, skipping`);return}let t=e?.subscription,n=R(e),s=null,i=null;try{if(t){let o=await h().subscriptions.retrieve(t);if(s=o?.metadata?.userId||null,i=w(o?.items?.data?.[0]?.price?.id),s&&(await b(s,{status:"active",currentPeriodEnd:new Date((o.current_period_end??o.currentPeriodEnd??0)*1e3)}),e?.billing_reason==="subscription_cycle")){let[p]=await u.select().from(a).where(c(a.id,s));p&&await U({userId:s,userEmail:p.email||"unknown",userName:p.displayName||p.name||p.fullName||[p.firstName,p.lastName].filter(Boolean).join(" ")||void 0,plan:i||"go",amount:e?.amount_paid||o?.items?.data?.[0]?.price?.unit_amount||0,currency:e?.currency||"usd",timestamp:new Date,stripePaymentId:e?.id,intentId:e?.payment_intent})}}s||(s=await T(n)),await k({invoice:e,status:"completed",userId:s,plan:i}),r&&y(r)}catch(d){console.error("Error handling payment succeeded:",d)}}async function ue(e,r){if(r&&f(r)){console.log(`[Stripe] Event ${r} already processed, skipping`);return}let t=e?.subscription,n=R(e),s=null,i=null;try{if(t){let o=await h().subscriptions.retrieve(t);s=o?.metadata?.userId||null,i=w(o?.items?.data?.[0]?.price?.id)}if(s||(s=await T(n)),s){await b(s,{status:"past_due"});let[d]=await u.select().from(a).where(c(a.id,s));d&&console.log("PAYMENT_FAILED:",{correlationId:`FAIL-${Date.now()}-${M().slice(0,8)}`,userId:s,email:d.email,subscriptionId:t,invoiceId:e.id,amount:e.amount_due,timestamp:new Date().toISOString()})}await k({invoice:e,status:"failed",userId:s,plan:i}),r&&y(r)}catch(d){console.error("Error handling payment failed:",d)}}function w(e){let r={price_go_monthly:"go",price_plus_monthly:"plus",price_pro_monthly:"pro",price_business_monthly:"business"};return e===process.env.STRIPE_PRICE_GO?"go":e===process.env.STRIPE_PRICE_PLUS?"plus":e===process.env.STRIPE_PRICE_PRO?"pro":e===process.env.STRIPE_PRICE_BUSINESS?"business":e&&r[e]||"go"}function ie(e){return!(!e||!e.plan||!["free","go","plus","pro","business"].includes(e.plan)||!e.status||!["active","cancelled","past_due","trialing","inactive"].includes(e.status))}function le(e){return e.replace(/[^a-zA-Z0-9-_]/g,"").substring(0,100)}export{se as canUpgrade,ee as debugText,re as getUserSubscription,ue as handlePaymentFailed,oe as handlePaymentSucceeded,ne as handleSubscriptionCreated,de as handleSubscriptionDeleted,ae as handleSubscriptionUpdated,te as isPaidUser,U as notifyAdminOfPurchase,l as sanitizeText,le as sanitizeUserId,b as updateUserSubscription,ie as validateSubscriptionData};
