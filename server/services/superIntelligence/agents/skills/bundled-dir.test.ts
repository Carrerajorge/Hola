import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureEnv } from "../../test-utils/env.js";
import { writeSkill } from "../skills.e2e-test-helpers.js";
import { resolveBundledSkillsDir } from "./bundled-dir.js";

describe("resolveBundledSkillsDir", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["OPENCLAW_BUNDLED_SKILLS_DIR"]);
  });

  afterEach(() => {
    envSnapshot.restore();
  });

  it("returns OPENCLAW_BUNDLED_SKILLS_DIR override when set", async () => {
    const overrideDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-bundled-override-"));
    process.env.OPENCLAW_BUNDLED_SKILLS_DIR = ` ${overrideDir} `;
    expect(resolveBundledSkillsDir()).toBe(overrideDir);
  });

  it("resolves bundled skills under a flattened dist layout", async () => {
    delete process.env.OPENCLAW_BUNDLED_SKILLS_DIR;

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-bundled-"));
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "openclaw" }));

    await writeSkill({
      dir: path.join(root, "skills", "peekaboo"),
      name: "peekaboo",
      description: "peekaboo",
    });

    const distDir = path.join(root, "dist");
    await fs.mkdir(distDir, { recursive: true });
    const argv1 = path.join(distDir, "index.js");
    await fs.writeFile(argv1, "// stub", "utf-8");

    const moduleUrl = pathToFileURL(path.join(distDir, "skills.js")).href;
    const execPath = path.join(root, "bin", "node");
    await fs.mkdir(path.dirname(execPath), { recursive: true });

    const resolved = resolveBundledSkillsDir({
      argv1,
      moduleUrl,
      cwd: distDir,
      execPath,
    });

    expect(resolved).toBe(path.join(root, "skills"));
  });

  it("prefers embedded server/openclaw skills from the app root layout", async () => {
    delete process.env.OPENCLAW_BUNDLED_SKILLS_DIR;

    const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-app-root-"));
    const embeddedRoot = path.join(appRoot, "server", "openclaw");
    await fs.mkdir(embeddedRoot, { recursive: true });
    await fs.writeFile(path.join(embeddedRoot, "package.json"), JSON.stringify({ name: "openclaw" }));
    await writeSkill({
      dir: path.join(embeddedRoot, "skills", "peekaboo"),
      name: "peekaboo",
      description: "peekaboo",
    });

    // Competing top-level `skills/` paths should not win over the embedded package.
    await fs.mkdir(path.join(appRoot, "skills"), { recursive: true });
    await fs.writeFile(path.join(appRoot, "skills", "README.md"), "not the bundled OpenClaw skills");

    const moduleUrl = pathToFileURL(
      path.join(
        appRoot,
        "server",
        "services",
        "superIntelligence",
        "agents",
        "skills",
        "bundled-dir.js",
      ),
    ).href;

    const resolved = resolveBundledSkillsDir({
      cwd: appRoot,
      moduleUrl,
    });

    expect(resolved).toBe(path.join(embeddedRoot, "skills"));
  });
});
