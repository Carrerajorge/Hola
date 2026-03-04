const fs = require('fs');
const path = "/Users/luis/Desktop/Hola/server/routes/chatAiRouter.ts";

try {
  let content = fs.readFileSync(path, 'utf8');

  // 1. Inject Import
  if (!content.includes('import { AgentOS }')) {
    const importMarker = 'import { browserWorker } from "../agent/browser-worker";';
    const newImport = `import { browserWorker } from "../agent/browser-worker";\nimport { AgentOS } from "../agentos/index";`;
    content = content.replace(importMarker, newImport);
    console.log("Injected AgentOS import.");
  } else {
    console.log("AgentOS import already present.");
  }

  // 2. Inject Logic in /chat/stream
  // Look for: const effectiveUserId = getOrCreateSecureUserId(req);
  // This line appears multiple times? 
  // In /chat/stream handler:
  // router.post("/chat/stream", validate({ body: streamChatRequestSchema }), async (req, res) => {
  // ...
  // const effectiveUserId = getOrCreateSecureUserId(req);

  const logicMarker = 'const effectiveUserId = getOrCreateSecureUserId(req);';
  const logicInjection = `const effectiveUserId = getOrCreateSecureUserId(req);

      // [AgentOS] Governance Hook
      try {
        const agentOS = AgentOS.getInstance();
        if (agentOS.status === "ready") {
           // Log interception (non-blocking for now)
           console.log(\`[AgentOS] Governance: Intercepting request \${requestId} for \${effectiveUserId}\`);
           // In future: await agentOS.control.policy.evaluate({ ... });
        }
      } catch (e) {
        console.warn("[AgentOS] Hook failed:", e);
      }`;

  // We only want to replace it inside the /chat/stream route.
  // The file has multiple getOrCreateSecureUserId calls.
  // The /chat/stream route starts with: router.post("/chat/stream",
  
  // Let's use a more specific marker sequence if possible, or just replace the one inside the stream handler.
  // The stream handler has:
  // const {
  //   messages: clientMessages,
  //   ...
  // } = req.body;
  // ...
  // const effectiveUserId = getOrCreateSecureUserId(req);

  // Regex replace might be risky if it matches multiple.
  // But let's look at the structure.
  
  // Alternative: Find `router.post("/chat/stream"` and then search forward.
  
  const streamRouteStart = content.indexOf('router.post("/chat/stream"');
  if (streamRouteStart === -1) {
    console.error("Could not find /chat/stream route start.");
    process.exit(1);
  }

  const markerInStream = content.indexOf(logicMarker, streamRouteStart);
  if (markerInStream !== -1) {
    // Check if already injected
    if (!content.includes('[AgentOS] Governance Hook')) {
       // We construct the new content slice
       const before = content.substring(0, markerInStream);
       const after = content.substring(markerInStream + logicMarker.length);
       content = before + logicInjection + after;
       console.log("Injected AgentOS logic into /chat/stream.");
    } else {
       console.log("AgentOS logic already present.");
    }
  } else {
    console.error("Could not find insertion point in /chat/stream.");
  }

  fs.writeFileSync(path, content, 'utf8');
  console.log("Successfully updated chatAiRouter.ts");

} catch (e) {
  console.error("Error:", e);
}
