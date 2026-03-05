import fs from "fs/promises";
import { getConfigDir, getConfigPath } from "./paths.js";

export type NodeConfig = {
  serverUrl: string;
  nodeId: string;
  nodeToken: string;
  // Safety: node will only operate under these roots for any fs ops (future).
  allowedRoots: string[];
  deviceName?: string;
};

export async function loadConfig(): Promise<NodeConfig | null> {
  try {
    const raw = await fs.readFile(getConfigPath(), "utf8");
    const cfg = JSON.parse(raw);
    if (!cfg?.serverUrl || !cfg?.nodeToken || !cfg?.nodeId) return null;
    return {
      serverUrl: String(cfg.serverUrl),
      nodeId: String(cfg.nodeId),
      nodeToken: String(cfg.nodeToken),
      allowedRoots: Array.isArray(cfg.allowedRoots) ? cfg.allowedRoots.map(String) : [],
      deviceName: cfg.deviceName ? String(cfg.deviceName) : undefined,
    };
  } catch {
    return null;
  }
}

export async function saveConfig(cfg: NodeConfig): Promise<void> {
  await fs.mkdir(getConfigDir(), { recursive: true });
  await fs.writeFile(getConfigPath(), JSON.stringify(cfg, null, 2), "utf8");
}
