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
import{AsyncLocalStorage as g}from"async_hooks";var n=new g;function i(){return n.getStore()}function x(e,t){return n.run(e,t)}function l(e){let t=n.getStore();t&&Object.assign(t,e)}import a from"pino";var c=["password","token","secret","key","authorization","cookie","stripe","access_token","refresh_token"],s=!0,d=a({level:process.env.LOG_LEVEL||(s?"info":"debug"),redact:{paths:c.flatMap(e=>[e,`*.${e}`,`*.*.${e}`]),remove:!0},transport:s?{target:"pino-roll",options:{file:"logs/app",size:"10m",frequency:"daily",extension:".log",mkdir:!0}}:{target:"pino-pretty",options:{colorize:!0,ignore:"pid,hostname",translateTime:"HH:MM:ss"}},base:{env:"production"}}),o=class e{constructor(t,r={}){this.logger=t,this.staticContext=r}getMergedContext(t){let r=i();return{...this.staticContext,...t,...r}}debug(t,r){this.logger.debug(this.getMergedContext(r),t)}info(t,r){this.logger.info(this.getMergedContext(r),t)}warn(t,r){this.logger.warn(this.getMergedContext(r),t)}error(t,r){this.logger.error(this.getMergedContext(r),t)}child(t){return new e(this.logger.child(t),{...this.staticContext,...t})}};function u(e){let t=e?{component:e}:{};return new o(d,t)}var m=u();export{x as a,l as b,u as c,m as d};
