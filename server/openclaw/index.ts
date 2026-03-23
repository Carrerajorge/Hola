import type { Server as HttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { getOpenClawConfig } from "./config";
import { initSkills } from "./skills/skillLoader";
import { skillRegistry } from "./skills/skillRegistry";
import {
  resolveEmbeddedOpenClawControlUiRootSync,
  resolveEmbeddedOpenClawPackageJsonPathSync,
} from "../services/openClawEmbeddedAssets";

export type OpenClawBootstrapState = {
  initializedAt: string;
  version: string | null;
  controlUiReady: boolean;
  skillsRegistered: number;
  pluginsPreloaded: boolean;
  warnings: string[];
};

let bootstrapPromise: Promise<OpenClawBootstrapState> | null = null;
let bootstrapState: OpenClawBootstrapState | null = null;

async function loadEmbeddedVersion(): Promise<string | null> {
  const packageJsonPath = resolveEmbeddedOpenClawPackageJsonPathSync({
    moduleUrl: import.meta.url,
    argv1: process.argv[1],
    cwd: process.cwd(),
  });

  if (!packageJsonPath) {
    return null;
  }

  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : null;
  } catch {
    return null;
  }
}

export function getOpenClawBootstrapState(): OpenClawBootstrapState | null {
  return bootstrapState;
}

export async function initializeOpenClaw(
  _httpServer: HttpServer,
): Promise<OpenClawBootstrapState> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    const warnings: string[] = [];
    const config = getOpenClawConfig();
    const version = await loadEmbeddedVersion();
    const controlUiReady = Boolean(
      resolveEmbeddedOpenClawControlUiRootSync({
        moduleUrl: import.meta.url,
        argv1: process.argv[1],
        cwd: process.cwd(),
      }),
    );

    // Keep bootstrap fail-open and lightweight. Runtime/plugin loading is deferred
    // until an actual OpenClaw agent run needs it, which avoids startup-time
    // self-resolution edge cases in local/dev packaging layouts.
    const pluginsPreloaded = false;

    try {
      if (config.skills.enabled) {
        await initSkills(config);
      } else {
        skillRegistry.clear();
      }
    } catch (error) {
      warnings.push(
        `[skills] ${(error as Error)?.message || String(error)}`,
      );
    }

    const state: OpenClawBootstrapState = {
      initializedAt: new Date().toISOString(),
      version,
      controlUiReady,
      skillsRegistered: skillRegistry.list().length,
      pluginsPreloaded,
      warnings,
    };

    bootstrapState = state;

    const label = version ? `v${version}` : "embedded";
    console.info(
      `[OpenClaw] bootstrap ready (${label}) skills=${state.skillsRegistered} controlUi=${state.controlUiReady ? "ok" : "missing"} plugins=${state.pluginsPreloaded ? "ok" : "warn"}`,
    );
    if (warnings.length > 0) {
      console.warn(`[OpenClaw] bootstrap warnings: ${warnings.join(" | ")}`);
    }

    return state;
  })().catch((error) => {
    bootstrapPromise = null;
    throw error;
  });

  return bootstrapPromise;
}
