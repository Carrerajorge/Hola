#!/usr/bin/env node
/**
 * Minimal cross-platform env runner (replacement for cross-env).
 *
 * Usage:
 *   node scripts/with-env.cjs KEY=value OTHER=1 -- command arg1 arg2
 */

const { spawn } = require("node:child_process");

const args = process.argv.slice(2);
const env = { ...process.env };

let i = 0;
for (; i < args.length; i++) {
  const a = args[i];
  if (a === "--") {
    i++;
    break;
  }
  const m = a.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) break;
  env[m[1]] = m[2];
}

const cmd = args[i];
const cmdArgs = args.slice(i + 1);

if (!cmd) {
  console.error("Usage: node scripts/with-env.cjs KEY=value -- command [args...]");
  process.exit(1);
}

const child = spawn(cmd, cmdArgs, {
  stdio: "inherit",
  env,
  // On Windows, rely on the shell for command resolution.
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code == null ? 1 : code);
});

child.on("error", (err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});

