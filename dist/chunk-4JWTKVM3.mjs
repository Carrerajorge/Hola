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
import{EventEmitter as r}from"events";var a=class extends r{constructor(){super(...arguments);this.statuses=new Map;this.autoReplyEnabled=new Map;this.autoReplyToContacts=new Map;this.autoReplyPrompt=new Map;this.processedMessages=new Set}ensureStatus(t){let s=this.statuses.get(t);if(s)return s;let e={state:"disconnected",me:null,qr:null,error:null,updatedAt:Date.now()};return this.statuses.set(t,e),e}getStatus(t){return this.ensureStatus(t)}async startWithOptions(t,s){let n={state:"connected",me:{id:s?.phone?`${String(s.phone).replace(/\D/g,"")}@s.whatsapp.net`:`${t}@s.whatsapp.net`},qr:null,error:null,updatedAt:Date.now()};return this.statuses.set(t,n),this.emit("status",t,n),n}async restart(t,s){return await this.disconnect(t),this.startWithOptions(t,s)}async disconnect(t){let s={state:"disconnected",me:null,qr:null,error:null,updatedAt:Date.now()};this.statuses.set(t,s),this.emit("status",t,s)}async shutdownAll(){let t=Array.from(this.statuses.keys());for(let s of t)await this.disconnect(s)}setAutoReply(t,s){this.autoReplyEnabled.set(t,s)}isAutoReplyEnabled(t){return this.autoReplyEnabled.get(t)??!1}setAutoReplyToContacts(t,s){this.autoReplyToContacts.set(t,s)}isAutoReplyToContactsEnabled(t){return this.autoReplyToContacts.get(t)??!1}setAutoReplyPrompt(t,s){this.autoReplyPrompt.set(t,s)}getAutoReplyPrompt(t){return this.autoReplyPrompt.get(t)??""}markMessageProcessed(t){return t?this.processedMessages.has(t)?!0:(this.processedMessages.add(t),!1):!1}async sendText(t,s,e){this.emit("outbound_message",t,{to:s,text:e,timestamp:Date.now()})}},u=new a;export{u as a};
