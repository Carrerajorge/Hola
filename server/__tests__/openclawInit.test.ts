import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  initSkills: vi.fn(async () => {}),
  readFile: vi.fn(async () => JSON.stringify({ version: "2026.3.22" })),
  resolveEmbeddedOpenClawControlUiRootSync: vi.fn(() => "/tmp/openclaw/dist/control-ui"),
  resolveEmbeddedOpenClawPackageJsonPathSync: vi.fn(() => "/tmp/openclaw/package.json"),
  getOpenClawConfig: vi.fn(() => ({
    gateway: { enabled: true, path: "/ws/openclaw" },
    tools: {
      enabled: true,
      safeBins: ["node"],
      workspaceRoot: "/tmp/openclaw-workspaces",
      execTimeout: 30_000,
      execSecurity: "warn" as const,
    },
    plugins: { enabled: true, directory: "/tmp/openclaw/plugins" },
    skills: {
      enabled: true,
      directory: "/tmp/openclaw/skills",
      extraDirectories: [],
      workspaceDirectory: "/tmp/openclaw-workspace",
      includeBuiltins: true,
      autoImportClawi: true,
      maxSkillFileBytes: 256_000,
    },
    streaming: {
      enabled: true,
      blockMinChars: 50,
      blockMaxChars: 500,
      previewMode: "partial" as const,
    },
  })),
  skillRegistry: {
    list: vi.fn(() => [{ id: "peekaboo", name: "peekaboo" }]),
  },
}));

vi.mock("../openclaw/config", () => ({
  getOpenClawConfig: state.getOpenClawConfig,
}));

vi.mock("../openclaw/skills/skillLoader", () => ({
  initSkills: state.initSkills,
}));

vi.mock("../openclaw/skills/skillRegistry", () => ({
  skillRegistry: state.skillRegistry,
}));

vi.mock("node:fs/promises", () => ({
  readFile: state.readFile,
}));

vi.mock("../services/openClawEmbeddedAssets", () => ({
  resolveEmbeddedOpenClawControlUiRootSync: state.resolveEmbeddedOpenClawControlUiRootSync,
  resolveEmbeddedOpenClawPackageJsonPathSync: state.resolveEmbeddedOpenClawPackageJsonPathSync,
}));

describe("initializeOpenClaw", () => {
  beforeEach(async () => {
    vi.resetModules();
    state.initSkills.mockClear();
    state.readFile.mockClear();
    state.resolveEmbeddedOpenClawControlUiRootSync.mockClear();
    state.resolveEmbeddedOpenClawPackageJsonPathSync.mockClear();
    state.getOpenClawConfig.mockClear();
    state.skillRegistry.list.mockClear();
  });

  it("bootstraps skills and runtime plugins only once", async () => {
    const mod = await import("../openclaw/index");

    const first = await mod.initializeOpenClaw({} as any);
    const second = await mod.initializeOpenClaw({} as any);

    expect(state.getOpenClawConfig).toHaveBeenCalledTimes(1);
    expect(state.initSkills).toHaveBeenCalledTimes(1);
    expect(state.resolveEmbeddedOpenClawPackageJsonPathSync).toHaveBeenCalledTimes(1);
    expect(state.resolveEmbeddedOpenClawControlUiRootSync).toHaveBeenCalledTimes(1);
    expect(state.readFile).toHaveBeenCalledTimes(1);
    expect(first.version).toBe("2026.3.22");
    expect(first.controlUiReady).toBe(true);
    expect(first.pluginsPreloaded).toBe(false);
    expect(first.skillsRegistered).toBe(1);
    expect(second).toEqual(first);
  });
});
