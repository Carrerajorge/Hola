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
var u="https://api.figma.com/v1",m=class{constructor(){this.accessToken=null}setAccessToken(e){this.accessToken=e}getAccessToken(){return this.accessToken}async request(e){if(!this.accessToken)throw new Error("Figma access token not configured");if(!/^\/[\w\-\/.,?=&%]+$/.test(e))throw new Error("Invalid Figma API endpoint");let r=`${u}${e}`;if(new URL(r).origin!==new URL(u).origin)throw new Error("Figma API endpoint resolves to unexpected origin");let n=await fetch(r,{headers:{"X-Figma-Token":this.accessToken}});if(!n.ok){let a=await n.text();throw new Error(`Figma API error: ${n.status} - ${a}`)}return n.json()}async getFile(e){return this.request(`/files/${e}`)}async getFileNodes(e,r){let t=r.join(",");return this.request(`/files/${e}/nodes?ids=${encodeURIComponent(t)}`)}async getImages(e,r,t="png",n=2){let a=r.join(",");return(await this.request(`/images/${e}?ids=${encodeURIComponent(a)}&format=${t}&scale=${n}`)).images}async getTeamProjects(e){return this.request(`/teams/${e}/projects`)}async getProjectFiles(e){return(await this.request(`/projects/${e}/files`)).files.map(t=>({key:t.key,name:t.name,thumbnailUrl:t.thumbnail_url,lastModified:t.last_modified}))}async getLocalVariables(e){return this.request(`/files/${e}/variables/local`)}async getStyles(e){return this.request(`/files/${e}/styles`)}extractDesignTokens(e){let r=[],t=(n,a="")=>{if(n.fills&&Array.isArray(n.fills)&&n.fills.forEach((s,o)=>{if(s.type==="SOLID"&&s.color){let{r:c,g:i,b:g,a:l=1}=s.color;r.push({name:`${a}${n.name}-fill-${o}`,type:"color",value:{r:Math.round(c*255),g:Math.round(i*255),b:Math.round(g*255),a:l,hex:`#${Math.round(c*255).toString(16).padStart(2,"0")}${Math.round(i*255).toString(16).padStart(2,"0")}${Math.round(g*255).toString(16).padStart(2,"0")}`}})}}),n.style){let s=n.style;s.fontFamily&&r.push({name:`${a}${n.name}-typography`,type:"typography",value:{fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeightPx,letterSpacing:s.letterSpacing}})}n.children&&n.children.forEach(s=>{t(s,`${a}${n.name}/`)})};return e.document&&t(e.document),r}generateReactCode(e,r=0){let t="  ".repeat(r),n=e.type,a=e.name?.replace(/[^a-zA-Z0-9]/g,"")||"Component",s="",o=[];if(e.absoluteBoundingBox){let{width:i,height:g}=e.absoluteBoundingBox;o.push(`width: ${Math.round(i)}px`),o.push(`height: ${Math.round(g)}px`)}if(e.fills&&e.fills[0]?.type==="SOLID"){let{r:i,g,b:l,a:p=1}=e.fills[0].color,h=`#${Math.round(i*255).toString(16).padStart(2,"0")}${Math.round(g*255).toString(16).padStart(2,"0")}${Math.round(l*255).toString(16).padStart(2,"0")}`;o.push(`backgroundColor: '${h}'`)}e.cornerRadius&&o.push(`borderRadius: ${e.cornerRadius}px`);let c=o.length>0?` style={{ ${o.join(", ")} }}`:"";switch(n){case"TEXT":s=`${t}<p${c}>${e.characters||""}</p>`;break;case"FRAME":case"GROUP":case"COMPONENT":case"INSTANCE":let i=e.children?.map(g=>this.generateReactCode(g,r+1)).join(`
`)||"";s=`${t}<div${c}>
${i}
${t}</div>`;break;case"RECTANGLE":s=`${t}<div${c} />`;break;case"ELLIPSE":o.push("borderRadius: '50%'"),s=`${t}<div style={{ ${o.join(", ")} }} />`;break;case"VECTOR":case"LINE":s=`${t}{/* Vector: ${e.name} */}`;break;default:if(e.children){let g=e.children.map(l=>this.generateReactCode(l,r+1)).join(`
`);s=`${t}<div${c}>
${g}
${t}</div>`}else s=`${t}<div${c} />`}return s}async getDesignContext(e,r){let t=await this.getFile(e),n=this.extractDesignTokens(t),a=t.document;if(r){let i=await this.getFileNodes(e,[r]);i.nodes&&i.nodes[r]&&(a=i.nodes[r].document)}let s=`
import React from 'react';

export function ${a.name?.replace(/[^a-zA-Z0-9]/g,"")||"FigmaComponent"}() {
  return (
${this.generateReactCode(a,2)}
  );
}
`.trim(),c=`:root {
${n.filter(i=>i.type==="color").map(i=>`  --${i.name.replace(/[^a-zA-Z0-9-]/g,"-")}: ${i.value.hex};`).join(`
`)}
}`;return{html:this.generateReactCode(a).replace(/className/g,"class"),css:c,react:s,tokens:n}}parseFileUrl(e){let r=e.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);if(!r)return null;let t=r[1],n=e.match(/node-id=([^&]+)/),a=n?decodeURIComponent(n[1]):void 0;return{fileKey:t,nodeId:a}}},y=new m;export{y as a};
