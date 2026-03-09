const fs = require('fs');
const file = 'server/index.ts';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('import { startGateway }')) {
  // Insert import near the top
  code = code.replace(
    'import { env } from "./config/env";',
    'import { env } from "./config/env";\nimport { startGateway } from "openclaw";'
  );

  // Insert startup logic before server.listen
  const listenBlock = "const server = (httpServer.listen as any)(listenOptions, async () => {";
  const openclawStartup = `
  // START OPENCLAW ENGINE natively
  try {
    log("Initializing OpenClaw Engine v2026.3.7-beta.1");
    await startGateway({
      workspaceDir: process.cwd(),
      headless: true,
      port: 11000,
    });
    log("OpenClaw Engine initialized successfully");
  } catch (err) {
    log("[FATAL] OpenClaw initialization failed: " + err.message);
  }

`;
  code = code.replace(listenBlock, openclawStartup + listenBlock);
  fs.writeFileSync(file, code);
  console.log('Patched server/index.ts');
} else {
  console.log('server/index.ts already patched');
}
