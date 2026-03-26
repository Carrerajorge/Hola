import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeWindowsShellArgs,
  depsInstalled,
  hasLocalPackage,
  shouldUseShellForCommand,
} from "../../scripts/ui.js";

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempUiDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-ui-test-"));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "ui-test" }), "utf8");
  return dir;
}

describe("scripts/ui windows spawn behavior", () => {
  it("enables shell for Windows command launchers that require cmd.exe", () => {
    expect(
      shouldUseShellForCommand("C:\\Users\\dev\\AppData\\Local\\pnpm\\pnpm.CMD", "win32"),
    ).toBe(true);
    expect(shouldUseShellForCommand("C:\\tools\\pnpm.bat", "win32")).toBe(true);
  });

  it("does not enable shell for non-shell launchers", () => {
    expect(shouldUseShellForCommand("C:\\Program Files\\nodejs\\node.exe", "win32")).toBe(false);
    expect(shouldUseShellForCommand("/usr/local/bin/pnpm", "linux")).toBe(false);
  });

  it("allows safe forwarded args when shell mode is required on Windows", () => {
    expect(() =>
      assertSafeWindowsShellArgs(["run", "build", "--filter", "@openclaw/ui"], "win32"),
    ).not.toThrow();
  });

  it("rejects dangerous forwarded args when shell mode is required on Windows", () => {
    expect(() => assertSafeWindowsShellArgs(["run", "build", "evil&calc"], "win32")).toThrow(
      /unsafe windows shell argument/i,
    );
    expect(() => assertSafeWindowsShellArgs(["run", "build", "%PATH%"], "win32")).toThrow(
      /unsafe windows shell argument/i,
    );
  });

  it("does not reject args on non-windows platforms", () => {
    expect(() => assertSafeWindowsShellArgs(["contains&metacharacters"], "linux")).not.toThrow();
  });

  it("requires packages to exist in the UI-local node_modules tree", () => {
    const rootDir = createTempUiDir();
    const nestedUiDir = path.join(rootDir, "ui");
    fs.mkdirSync(nestedUiDir, { recursive: true });
    fs.writeFileSync(path.join(nestedUiDir, "package.json"), JSON.stringify({ name: "ui-test" }), "utf8");

    const parentPackageDir = path.join(rootDir, "node_modules", "@noble", "ed25519");
    fs.mkdirSync(parentPackageDir, { recursive: true });
    fs.writeFileSync(path.join(parentPackageDir, "package.json"), JSON.stringify({ name: "@noble/ed25519" }), "utf8");

    expect(hasLocalPackage("@noble/ed25519", nestedUiDir)).toBe(false);

    const childPackageDir = path.join(nestedUiDir, "node_modules", "@noble", "ed25519");
    fs.mkdirSync(childPackageDir, { recursive: true });
    fs.writeFileSync(path.join(childPackageDir, "package.json"), JSON.stringify({ name: "@noble/ed25519" }), "utf8");

    expect(hasLocalPackage("@noble/ed25519", nestedUiDir)).toBe(true);
  });

  it("treats missing UI-local dependencies as not installed even if parent node_modules has them", () => {
    const rootDir = createTempUiDir();
    const nestedUiDir = path.join(rootDir, "ui");
    fs.mkdirSync(path.join(rootDir, "node_modules", "vite"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "node_modules", "dompurify"), { recursive: true });
    fs.mkdirSync(nestedUiDir, { recursive: true });
    fs.writeFileSync(path.join(nestedUiDir, "package.json"), JSON.stringify({ name: "ui-test" }), "utf8");

    expect(depsInstalled("build", nestedUiDir, ["vite", "dompurify"])).toBe(false);

    fs.mkdirSync(path.join(nestedUiDir, "node_modules", "vite"), { recursive: true });
    fs.mkdirSync(path.join(nestedUiDir, "node_modules", "dompurify"), { recursive: true });

    expect(depsInstalled("build", nestedUiDir, ["vite", "dompurify"])).toBe(true);
  });
});
