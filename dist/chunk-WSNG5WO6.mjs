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
import{a as f}from"./chunk-F7574FHZ.mjs";var u=class{constructor(){this.skills=new Map}register(t){this.skills.set(t.id,t)}registerMany(t){for(let i of t)this.register(i)}get(t){return this.skills.get(t)}list(){return Array.from(this.skills.values())}getPromptForSkills(t){let i=[];for(let s of t){let o=this.skills.get(s);o?.prompt&&i.push(`## Skill: ${o.name}
${o.prompt}`)}return i.join(`

`)}getToolsForSkills(t){let i=new Set;for(let s of t){let o=this.skills.get(s);if(o?.tools)for(let r of o.tools)i.add(r)}return Array.from(i)}remove(t){return this.skills.delete(t)}clear(){this.skills.clear()}resolve(t){let i=t?.length?t.map(s=>this.skills.get(s)).filter(Boolean):this.list();return{skills:i,prompt:this.getPromptForSkills(i.map(s=>s.id)),tools:Array.from(new Set(i.flatMap(s=>s.tools||[])))}}},m=new u;import p from"fs/promises";import n from"path";import h from"os";function b(e){return e&&(e.startsWith("~/")?n.join(h.homedir(),e.slice(2)):e)}function F(e){let t=e.map(i=>i.trim()).filter(Boolean).map(i=>n.resolve(b(i)));return Array.from(new Set(t))}function v(e){return e.toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/-+/g,"-").replace(/^-+|-+$/g,"")||"skill"}function w(e){let t=e.trim();return t.startsWith('"')&&t.endsWith('"')||t.startsWith("'")&&t.endsWith("'")?t.slice(1,-1).trim():t}function x(e){let t=e.trim();return!t.startsWith("[")||!t.endsWith("]")?[]:t.slice(1,-1).split(",").map(i=>w(i)).filter(Boolean)}function _(e){if(!e.startsWith("---"))return{frontmatter:{},body:e};let t=`
---`,i=e.indexOf(t,3);if(i===-1)return{frontmatter:{},body:e};let s=e.slice(3,i).trim(),o=e.slice(i+t.length).replace(/^\s*\n/,""),r={};for(let a of s.split(`
`)){let l=a.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);l&&(r[l[1]]=w(l[2]))}return{frontmatter:r,body:o}}async function g(e){try{return(await p.stat(e)).isFile()}catch{return!1}}async function k(e){try{return(await p.stat(e)).isDirectory()}catch{return!1}}async function A(e){let t=[],i=n.join(e,"SKILL.md");await g(i)&&t.push(i);let s=[];try{s=await p.readdir(e)}catch{return t}for(let r of s){if(r.startsWith("."))continue;let a=n.join(e,r);if(!await k(a))continue;let l=n.join(a,"SKILL.md");await g(l)&&t.push(l)}let o=n.join(e,"skills");if(await k(o))try{let r=await p.readdir(o);for(let a of r){if(a.startsWith("."))continue;let l=n.join(o,a,"SKILL.md");await g(l)&&t.push(l)}}catch{}return Array.from(new Set(t.map(r=>n.resolve(r))))}function C(e){let t=[e.skills.directory,...e.skills.extraDirectories],i=[n.join(e.skills.workspaceDirectory,"skills"),n.join(e.skills.workspaceDirectory,".agents","skills")],s=e.skills.autoImportClawi?[n.join(h.homedir(),"Desktop","clawi","openclaw","skills")]:[];return F([...t,...i,...s])}function L(e){let{frontmatter:t,body:i}=_(e.content),s=n.basename(n.dirname(e.filePath)),o=s&&s!=="."?s:n.basename(e.filePath,".md"),r=t.name?.trim()||o||"Unnamed Skill",a=t.description?.trim()||`Skill loaded from ${n.dirname(e.filePath)}`,l=x(t.tools||""),c=i.trim()||e.content.trim();return{id:v(r),name:r,description:a,prompt:c,tools:l,source:"filesystem",filePath:e.filePath,updatedAt:e.updatedAtMs,metadata:{frontmatter:t}}}function P(e,t){let i=new Map;for(let s of e)i.set(s.id,s);for(let s of t)i.set(s.id,s);return Array.from(i.values())}async function y(e){let t=C(e),i=[],s=[],o=[];for(let r of t){if(!await k(r))continue;let a=await A(r),l=[];for(let c of a)try{let d=await p.stat(c);if(d.size>e.skills.maxSkillFileBytes){s.push({filePath:c,reason:`File too large (${d.size} bytes)`});continue}let S=await p.readFile(c,"utf-8");l.push(L({filePath:c,content:S,updatedAtMs:d.mtimeMs})),i.push(c)}catch(d){s.push({filePath:c,reason:d?.message||"Failed to read SKILL.md"})}o=P(o,l)}return{skills:o,scannedRoots:t,loadedFiles:i,skippedFiles:s}}function R(){return[{id:"coding-agent",name:"Coding Agent",description:"Full programming assistant with shell, filesystem, and git capabilities",prompt:`You are an expert software engineer. You have access to shell execution (openclaw_exec), file reading (openclaw_read), file writing (openclaw_write), and file editing (openclaw_edit) tools.

When coding:
- Read existing files before modifying them
- Use git for version control when appropriate
- Run tests after making changes
- Handle errors gracefully
- Follow the project's existing code style`,tools:["openclaw_exec","openclaw_read","openclaw_write","openclaw_edit","openclaw_list"],source:"builtin"},{id:"github",name:"GitHub Operations",description:"Create issues, pull requests, review code, manage repos",prompt:`You can interact with GitHub using the gh CLI tool via openclaw_exec.

Common operations:
- gh issue create --title "..." --body "..."
- gh pr create --title "..." --body "..."
- gh pr list
- gh repo clone owner/repo
- gh api repos/{owner}/{repo}/issues`,tools:["openclaw_exec","openclaw_read"],source:"builtin"},{id:"data-analysis",name:"Data Analysis",description:"Analyze CSV/JSON data, generate charts and reports",prompt:`You are a data analyst. Use Python (via openclaw_exec) to analyze data files.

Approach:
- Read data with pandas
- Perform analysis (describe, groupby, pivot)
- Generate visualizations with matplotlib/seaborn
- Save outputs to workspace`,tools:["openclaw_exec","openclaw_read","openclaw_write"],source:"builtin"},{id:"web-scraper",name:"Web Scraper",description:"Scrape and extract content from websites",prompt:`You can scrape web content using curl or Python (requests/beautifulsoup).

Approach:
- Use curl for simple fetches
- Use Python with requests + BeautifulSoup for complex scraping
- Respect robots.txt
- Handle rate limiting`,tools:["openclaw_exec","openclaw_write"],source:"builtin"},{id:"devops",name:"DevOps Assistant",description:"Docker, deployment, CI/CD, infrastructure management",prompt:`You are a DevOps engineer. You can manage containers, deployments, and infrastructure.

Tools available:
- docker / docker-compose for containerization
- git for version control
- curl for API calls
- Shell commands for system management

Always be careful with destructive operations.`,tools:["openclaw_exec","openclaw_read","openclaw_write","openclaw_list"],source:"builtin"}]}async function B(e){m.clear();let t=e.skills.includeBuiltins?R():[];m.registerMany(t);let i=await y(e);if(m.registerMany(i.skills),f.info(`[OpenClaw:Skills] ${m.list().length} skills registered (builtin=${t.length}, filesystem=${i.skills.length}, files=${i.loadedFiles.length})`),i.skippedFiles.length>0){let s=i.skippedFiles.slice(0,5);f.warn(`[OpenClaw:Skills] Skipped ${i.skippedFiles.length} invalid skill files: `+s.map(o=>`${o.filePath} (${o.reason})`).join("; "))}}export{y as a,m as b,B as c};
