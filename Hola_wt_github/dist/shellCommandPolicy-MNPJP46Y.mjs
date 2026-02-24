import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import"./chunk-2FP5DEJW.mjs";var n=[{pattern:/\brm\b[\s\S]*-\S*r\S*f/i,reason:"rm -rf"},{pattern:/\bmkfs(\.|\s)/i,reason:"mkfs"},{pattern:/\bdd\b\s+if=/i,reason:"dd if="},{pattern:/>\s*\/dev\//i,reason:"> /dev/*"},{pattern:/\bsudo\b/i,reason:"sudo"},{pattern:/\bchmod\b\s+777\b/i,reason:"chmod 777"},{pattern:/\b(curl|wget)\b.*\|\s*sh\b/i,reason:"curl|sh / wget|sh"},{pattern:/\b(shutdown|reboot)\b/i,reason:"shutdown/reboot"}];function o(r){let e=String(r||"");for(let t of n)if(t.pattern.test(e))return t;return null}function s(){let r=(process.env.SHELL_COMMAND_SANDBOX_MODE||"").toLowerCase().trim();return r==="host"||r==="docker"||r==="runner"?r:"production".toLowerCase()==="production"?"runner":"host"}export{n as SHELL_DANGEROUS_PATTERNS,o as getDangerousShellMatch,s as getShellSandboxMode};
