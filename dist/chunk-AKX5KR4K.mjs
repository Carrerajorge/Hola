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
import o from"path";import i from"os";var p=process.env.OPENCLAW_ENABLED==="true",l=["python","python3","node","npm","npx","pnpm","yarn","bun","git","curl","wget","jq","cat","ls","find","grep","sed","awk","echo","mkdir","cp","mv","rm","touch","head","tail","wc","sort","uniq","diff","tar","gzip","gunzip","zip","unzip","docker","docker-compose","make","cmake"];function _(){let e=process.env.OPENCLAW_ENABLED==="true",r=process.env.OPENCLAW_WORKSPACE_DIR?o.resolve(process.env.OPENCLAW_WORKSPACE_DIR):process.cwd(),n=o.join(r,"server","openclaw","skills"),a=o.join(i.homedir(),".iliagpt","skills");return{gateway:{enabled:e,path:process.env.OPENCLAW_WS_PATH||"/ws/openclaw"},tools:{enabled:e,safeBins:process.env.OPENCLAW_SAFE_BINS?process.env.OPENCLAW_SAFE_BINS.split(",").map(s=>s.trim()):l,workspaceRoot:process.env.OPENCLAW_WORKSPACE_ROOT||"/tmp/openclaw-workspaces",execTimeout:Number(process.env.OPENCLAW_EXEC_TIMEOUT)||12e4,execSecurity:process.env.OPENCLAW_EXEC_SECURITY||"warn"},plugins:{enabled:e,directory:process.env.OPENCLAW_PLUGINS_DIR||"~/.iliagpt/plugins"},skills:{enabled:e,directory:process.env.OPENCLAW_SKILLS_DIR?o.resolve(process.env.OPENCLAW_SKILLS_DIR):n,extraDirectories:process.env.OPENCLAW_SKILLS_EXTRA_DIRS?process.env.OPENCLAW_SKILLS_EXTRA_DIRS.split(",").map(s=>s.trim()).filter(Boolean):[a],workspaceDirectory:r,includeBuiltins:process.env.OPENCLAW_SKILLS_INCLUDE_BUILTINS!=="false",autoImportClawi:process.env.OPENCLAW_SKILLS_AUTO_IMPORT_CLAWI!=="false",maxSkillFileBytes:Number(process.env.OPENCLAW_SKILL_MAX_BYTES)||256e3},streaming:{enabled:e,blockMinChars:Number(process.env.OPENCLAW_BLOCK_MIN_CHARS)||50,blockMaxChars:Number(process.env.OPENCLAW_BLOCK_MAX_CHARS)||500,previewMode:process.env.OPENCLAW_PREVIEW_MODE||"partial"}}}export{_ as a};
