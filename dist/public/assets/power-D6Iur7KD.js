import{j as e}from"./vendor-ui-B55BoJIU.js";import{a as r}from"./vendor-react-CI18adIO.js";import{g as m}from"./index-D_DPX_hy.js";import"./vendor-visualization-COwTq0iH.js";import"./mermaid-core-fv_j_7Ws.js";const u={turbo:"⚡",research:"🔬",creative:"🎨",code:"💻",analyst:"📊",stealth:"🥷"},v={streaming:"📡","parallel-tools":"⚙️","long-term-memory":"🧠","web-search":"🔍","deep-research":"📚","code-execution":"💻","file-operations":"📁",shell:"🖥️","data-analysis":"📈",excel:"📊",visualization:"📉","image-generation":"🖼️","creative-writing":"✍️",chat:"💬",completion:"✅"};function N(){const[a,c]=r.useState(null),[n,x]=r.useState([]),[g,d]=r.useState(!0),[t,l]=r.useState(!1),[i,h]=r.useState(0);r.useEffect(()=>{p(),b()},[]),r.useEffect(()=>{if(i>0){const s=setTimeout(()=>{h(i-1),i<=1&&p()},1e3);return()=>clearTimeout(s)}},[i]);async function p(){try{const o=await(await m("/api/power/status")).json();c(o)}catch(s){console.error("Failed to fetch power status:",s)}finally{d(!1)}}async function b(){try{const o=await(await m("/api/power/presets")).json();x(o.presets||[])}catch(s){console.error("Failed to fetch presets:",s)}}async function w(s){try{(await(await m(`/api/power/preset/${s}`,{method:"POST"})).json()).success&&p()}catch(o){console.error("Failed to apply preset:",o)}}async function j(){l(!0);try{const o=await(await m("/api/power/boost",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({duration:3e5})})).json();o.success&&(h(Math.floor(o.expiresIn/1e3)),p())}catch(s){console.error("Failed to activate boost:",s)}finally{l(!1)}}if(g)return e.jsx("div",{className:"power-panel loading",children:e.jsx("div",{className:"power-loader",children:"⚡ Cargando Power Mode..."})});if(!a)return e.jsx("div",{className:"power-panel error",children:e.jsx("p",{children:"Error al cargar Power Mode"})});const f=a.powerLevel>=80?"#00ff88":a.powerLevel>=60?"#ffcc00":a.powerLevel>=40?"#ff9900":"#ff4444";return e.jsxs("div",{className:"power-panel",children:[e.jsx("style",{children:`
        .power-panel {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 16px;
          padding: 24px;
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .power-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        
        .power-title {
          font-size: 24px;
          font-weight: 700;
          background: linear-gradient(90deg, #00ff88, #00ccff);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        
        .power-level-container {
          position: relative;
          width: 100%;
          height: 24px;
          background: rgba(255,255,255,0.1);
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 20px;
        }
        
        .power-level-bar {
          height: 100%;
          border-radius: 12px;
          transition: width 0.5s ease, background 0.3s ease;
        }
        
        .power-level-text {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-weight: 700;
          font-size: 14px;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }
        
        .power-mode {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255,255,255,0.1);
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 14px;
        }
        
        .power-mode-icon {
          font-size: 20px;
        }
        
        .presets-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 24px;
        }
        
        .preset-btn {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          padding: 16px;
          color: white;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: center;
        }
        
        .preset-btn:hover {
          background: rgba(255,255,255,0.15);
          border-color: rgba(255,255,255,0.3);
          transform: translateY(-2px);
        }
        
        .preset-btn.active {
          background: rgba(0,255,136,0.2);
          border-color: #00ff88;
        }
        
        .preset-icon {
          font-size: 28px;
          display: block;
          margin-bottom: 8px;
        }
        
        .preset-name {
          font-weight: 600;
          text-transform: capitalize;
        }
        
        .capabilities {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 24px;
        }
        
        .capability {
          background: rgba(0,204,255,0.1);
          border: 1px solid rgba(0,204,255,0.3);
          padding: 6px 12px;
          border-radius: 16px;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        
        .boost-btn {
          width: 100%;
          background: linear-gradient(135deg, #ff6b00, #ff9500);
          border: none;
          border-radius: 12px;
          padding: 16px;
          color: white;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        
        .boost-btn:hover:not(:disabled) {
          transform: scale(1.02);
          box-shadow: 0 8px 24px rgba(255,107,0,0.3);
        }
        
        .boost-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }
        
        .boost-active {
          background: linear-gradient(135deg, #00ff88, #00ccff);
        }
        
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-top: 20px;
        }
        
        .stat-card {
          background: rgba(255,255,255,0.05);
          border-radius: 12px;
          padding: 16px;
          text-align: center;
        }
        
        .stat-value {
          font-size: 24px;
          font-weight: 700;
          color: #00ccff;
        }
        
        .stat-label {
          font-size: 12px;
          color: rgba(255,255,255,0.6);
          margin-top: 4px;
        }
        
        .power-loader {
          text-align: center;
          padding: 40px;
          font-size: 18px;
          animation: pulse 1.5s infinite;
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}),e.jsxs("div",{className:"power-header",children:[e.jsx("h2",{className:"power-title",children:"⚡ Power Mode"}),e.jsxs("div",{className:"power-mode",children:[e.jsx("span",{className:"power-mode-icon",children:u[a.mode]||"🔋"}),e.jsx("span",{style:{textTransform:"capitalize"},children:a.mode})]})]}),e.jsxs("div",{className:"power-level-container",children:[e.jsx("div",{className:"power-level-bar",style:{width:`${a.powerLevel}%`,background:`linear-gradient(90deg, ${f}, ${f}88)`}}),e.jsxs("span",{className:"power-level-text",children:[a.powerLevel,"% POWER"]})]}),e.jsx("h3",{style:{marginBottom:"12px",fontSize:"14px",opacity:.7},children:"PRESETS"}),e.jsx("div",{className:"presets-grid",children:n.map(s=>e.jsxs("button",{className:`preset-btn ${a.mode===s.name?"active":""}`,onClick:()=>w(s.name),title:s.description,children:[e.jsx("span",{className:"preset-icon",children:u[s.name]||"⚙️"}),e.jsx("span",{className:"preset-name",children:s.name})]},s.name))}),e.jsx("h3",{style:{marginBottom:"12px",fontSize:"14px",opacity:.7},children:"CAPACIDADES"}),e.jsx("div",{className:"capabilities",children:a.capabilities.map(s=>e.jsxs("span",{className:"capability",children:[v[s]||"•"," ",s]},s))}),e.jsx("button",{className:`boost-btn ${i>0?"boost-active":""}`,onClick:j,disabled:t||i>0,children:i>0?e.jsxs(e.Fragment,{children:["🚀 BOOST ACTIVO - ",Math.floor(i/60),":",(i%60).toString().padStart(2,"0")]}):t?e.jsx(e.Fragment,{children:"⏳ Activando..."}):e.jsx(e.Fragment,{children:"🚀 ACTIVAR POWER BOOST (5 min)"})}),e.jsxs("div",{className:"stats-grid",children:[e.jsxs("div",{className:"stat-card",children:[e.jsx("div",{className:"stat-value",children:a.config.maxTools}),e.jsx("div",{className:"stat-label",children:"Herramientas"})]}),e.jsxs("div",{className:"stat-card",children:[e.jsxs("div",{className:"stat-value",children:[Math.round(a.config.contextWindow/1e3),"K"]}),e.jsx("div",{className:"stat-label",children:"Contexto"})]}),e.jsxs("div",{className:"stat-card",children:[e.jsx("div",{className:"stat-value",children:a.config.memory==="persistent"?"∞":"Sesión"}),e.jsx("div",{className:"stat-label",children:"Memoria"})]})]})]})}function C(){const[a,c]=r.useState(null),[n,x]=r.useState(null),[g,d]=r.useState(!0);return r.useEffect(()=>{Promise.all([fetch("/api/power/stats").then(t=>t.json()),fetch("/api/power/capabilities").then(t=>t.json())]).then(([t,l])=>{c(t),x(l),d(!1)}).catch(t=>{console.error("Failed to load power data:",t),d(!1)})},[]),e.jsxs("div",{style:{minHeight:"100vh",background:"linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #16213e 100%)",padding:"40px 20px"},children:[e.jsx("style",{children:`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        
        @keyframes glow {
          0%, 100% { filter: drop-shadow(0 0 10px rgba(0,255,136,0.5)); }
          50% { filter: drop-shadow(0 0 20px rgba(0,255,136,0.8)); }
        }
        
        .power-page-container {
          max-width: 1200px;
          margin: 0 auto;
        }
        
        .power-hero {
          text-align: center;
          margin-bottom: 40px;
        }
        
        .power-logo {
          font-size: 80px;
          animation: float 3s ease-in-out infinite, glow 2s ease-in-out infinite;
        }
        
        .power-hero-title {
          font-size: 48px;
          font-weight: 800;
          background: linear-gradient(135deg, #00ff88, #00ccff, #ff6b00);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin: 20px 0 10px;
        }
        
        .power-hero-subtitle {
          font-size: 18px;
          color: rgba(255,255,255,0.6);
        }
        
        .power-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          margin-bottom: 24px;
        }
        
        @media (max-width: 768px) {
          .power-grid {
            grid-template-columns: 1fr;
          }
        }
        
        .power-card {
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border-radius: 16px;
          padding: 24px;
          color: white;
          border: 1px solid rgba(255,255,255,0.1);
        }
        
        .power-card-title {
          font-size: 20px;
          font-weight: 700;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .feature-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        
        .feature-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          background: rgba(255,255,255,0.05);
          border-radius: 8px;
        }
        
        .feature-icon {
          font-size: 20px;
        }
        
        .feature-name {
          font-size: 14px;
        }
        
        .feature-check {
          margin-left: auto;
          color: #00ff88;
        }
        
        .stat-row {
          display: flex;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .stat-row:last-child {
          border-bottom: none;
        }
        
        .stat-label {
          color: rgba(255,255,255,0.6);
        }
        
        .stat-value {
          font-weight: 600;
          color: #00ccff;
        }
        
        .version-badge {
          display: inline-block;
          background: linear-gradient(135deg, #ff6b00, #ff9500);
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }
      `}),e.jsxs("div",{className:"power-page-container",children:[e.jsxs("div",{className:"power-hero",children:[e.jsx("div",{className:"power-logo",children:"⚡"}),e.jsx("h1",{className:"power-hero-title",children:"ILIAGPT Power Mode"}),e.jsx("p",{className:"power-hero-subtitle",children:a?.codename||"El poder de la IA en tus manos"}),a&&e.jsx("span",{className:"version-badge",children:a.version})]}),e.jsxs("div",{className:"power-grid",children:[e.jsx(N,{}),e.jsxs("div",{className:"power-card",children:[e.jsx("h3",{className:"power-card-title",children:"🎯 Características Activas"}),n&&e.jsx("div",{className:"feature-grid",children:Object.entries(n.features).map(([t,l])=>e.jsxs("div",{className:"feature-item",children:[e.jsxs("span",{className:"feature-icon",children:[t==="streaming"&&"📡",t==="imageGeneration"&&"🖼️",t==="codeExecution"&&"💻",t==="webSearch"&&"🔍",t==="documentGeneration"&&"📄",t==="dataAnalysis"&&"📊",t==="multiAgent"&&"🤖",t==="memory"&&"🧠"]}),e.jsx("span",{className:"feature-name",children:y(t)}),e.jsx("span",{className:"feature-check",children:l?"✓":"✗"})]},t))})]})]}),e.jsxs("div",{className:"power-grid",children:[e.jsxs("div",{className:"power-card",children:[e.jsx("h3",{className:"power-card-title",children:"📊 Estadísticas del Sistema"}),a&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"stat-row",children:[e.jsx("span",{className:"stat-label",children:"Uptime"}),e.jsx("span",{className:"stat-value",children:a.system.uptime})]}),e.jsxs("div",{className:"stat-row",children:[e.jsx("span",{className:"stat-label",children:"Memoria Usada"}),e.jsx("span",{className:"stat-value",children:a.system.memory.used})]}),e.jsxs("div",{className:"stat-row",children:[e.jsx("span",{className:"stat-label",children:"Node.js"}),e.jsx("span",{className:"stat-value",children:a.system.nodeVersion})]}),e.jsxs("div",{className:"stat-row",children:[e.jsx("span",{className:"stat-label",children:"Plataforma"}),e.jsx("span",{className:"stat-value",children:a.system.platform})]})]})]}),e.jsxs("div",{className:"power-card",children:[e.jsx("h3",{className:"power-card-title",children:"🔢 Recursos Disponibles"}),n&&a&&e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"stat-row",children:[e.jsx("span",{className:"stat-label",children:"Modelos AI"}),e.jsx("span",{className:"stat-value",children:n.models||a.usage.models})]}),e.jsxs("div",{className:"stat-row",children:[e.jsx("span",{className:"stat-label",children:"Herramientas"}),e.jsx("span",{className:"stat-value",children:n.tools})]}),e.jsxs("div",{className:"stat-row",children:[e.jsx("span",{className:"stat-label",children:"Usuarios"}),e.jsx("span",{className:"stat-value",children:a.usage.users})]}),e.jsxs("div",{className:"stat-row",children:[e.jsx("span",{className:"stat-label",children:"Conversaciones"}),e.jsx("span",{className:"stat-value",children:a.usage.conversations})]})]})]})]}),e.jsxs("div",{className:"power-card",style:{marginTop:24},children:[e.jsx("h3",{className:"power-card-title",children:"🚀 Cómo Usar Power Mode"}),e.jsxs("div",{style:{color:"rgba(255,255,255,0.8)",lineHeight:1.8},children:[e.jsxs("p",{children:[e.jsx("strong",{children:"1. Selecciona un Preset:"})," Elige el modo que mejor se adapte a tu tarea."]}),e.jsxs("p",{children:[e.jsx("strong",{children:"2. Power Boost:"})," Actívalo para máximo rendimiento por 5 minutos."]}),e.jsxs("p",{children:[e.jsx("strong",{children:"3. Personaliza:"})," Ajusta la configuración según tus necesidades."]}),e.jsxs("p",{style:{marginTop:16,padding:16,background:"rgba(0,255,136,0.1)",borderRadius:8},children:["💡 ",e.jsx("strong",{children:"Tip:"})," El modo ",e.jsx("strong",{children:"Turbo"})," es ideal para tareas rápidas. Usa ",e.jsx("strong",{children:"Research"})," para investigaciones profundas y ",e.jsx("strong",{children:"Code"})," para programación."]})]})]})]})]})}function y(a){return{streaming:"Streaming",imageGeneration:"Imágenes",codeExecution:"Código",webSearch:"Búsqueda",documentGeneration:"Documentos",dataAnalysis:"Análisis",multiAgent:"Multi-Agente",memory:"Memoria"}[a]||a}export{C as default};
