#!/bin/bash
set -e

HOLA_DIR="/Users/luis/.openclaw/workspace/Hola"
cd $HOLA_DIR

# 1. Update package.json to include openclaw
echo "Updating package.json..."
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json'));
pkg.dependencies.openclaw = 'file:./openclaw-engine';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
"

# 2. Run npm install
echo "Running npm install..."
npm install

# 3. Update server/index.ts to start OpenClaw
echo "Updating server/index.ts..."
cat << 'EOF' > patch_server.js
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
EOF
node patch_server.js

# 4. Commit and push
echo "Committing and pushing..."
git add package.json package-lock.json server/index.ts openclaw-engine
git commit -m "feat: Integrate OpenClaw Engine v2026.3.7-beta.1 at code level" || echo "Nothing to commit"
git push origin main || echo "Push failed or not needed"

echo "Done! Monitor GitHub Actions manually or automatically."
