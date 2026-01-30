const fs = require("fs");
const path = require("path");

const APP_DIR = "/var/www/michat";

// Parse a .env file into a key-value object
function parseEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const env = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key) env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

// Load .env first, then .env.production overrides it
const envVars = {
  NODE_ENV: "production",
  ...parseEnvFile(path.join(APP_DIR, ".env")),
  ...parseEnvFile(path.join(APP_DIR, ".env.production")),
};

module.exports = {
  apps: [
    {
      name: "michat",
      script: "npm",
      args: "start",
      cwd: APP_DIR,
      // Restart policy
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 3000,
      // Logging
      error_file: "/root/.pm2/logs/michat-error.log",
      out_file: "/root/.pm2/logs/michat-out.log",
      merge_logs: true,
      // Environment — read from .env.production at PM2 start time
      env: envVars,
    },
  ],
};
