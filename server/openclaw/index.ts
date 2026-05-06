import type { Server } from "node:http";
import { readFile } from "node:fs/promises";
import { getOpenClawConfig } from "./config";
import { initSkills } from "./skills/skillLoader";
import { skillRegistry } from "./skills/skillRegistry";
import {
  resolveEmbeddedOpenClawControlUiRootSync,
  resolveEmbeddedOpenClawPackageJsonPathSync,
} from "../services/openClawEmbeddedAssets";

export type OpenClawInitResult = {
  version: string;
  controlUiReady: boolean;
  pluginsPreloaded: boolean;
  skillsRegistered: number;
};

let cached: OpenClawInitResult | null = null;

export async function initializeOpenClaw(
  _httpServer: Server,
): Promise<OpenClawInitResult> {
  if (cached) {
    return cached;
  }

  const config = getOpenClawConfig();

  await initSkills(config);

  let version = "unknown";
  try {
    const pkgPath = resolveEmbeddedOpenClawPackageJsonPathSync();
    if (pkgPath) {
      const raw = await readFile(pkgPath, "utf8");
      const parsed = JSON.parse(raw);
      version = parsed.version || version;
    }
  } catch {}

  let controlUiReady = false;
  try {
    const uiRoot = resolveEmbeddedOpenClawControlUiRootSync();
    controlUiReady = Boolean(uiRoot);
  } catch {}

  const skillsRegistered = skillRegistry.list().length;

  cached = {
    version,
    controlUiReady,
    pluginsPreloaded: false,
    skillsRegistered,
  };

  console.info(
    `[OpenClaw] Initialized: v${version}, ${skillsRegistered} skills, controlUI=${controlUiReady}`,
  );

  return cached;
}
