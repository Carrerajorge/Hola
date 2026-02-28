import os from "os";
import path from "path";

export function getConfigDir(): string {
  const home = os.homedir();
  // Cross-platform-ish without extra deps.
  // - Windows: %APPDATA%\iliagpt-node
  // - macOS: ~/Library/Application Support/iliagpt-node
  // - Linux: ~/.config/iliagpt-node
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "iliagpt-node");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "iliagpt-node");
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdg, "iliagpt-node");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}
