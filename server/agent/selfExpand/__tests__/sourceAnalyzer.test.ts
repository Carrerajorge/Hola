import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { analyzeSource } from "../sourceAnalyzer";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";

const TEST_DIR = "/tmp/selfexpand-test-analyzer";

beforeAll(async () => {
  await mkdir(join(TEST_DIR, "src"), { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("sourceAnalyzer", () => {
  it("extracts exported functions from a JS file", async () => {
    await writeFile(
      join(TEST_DIR, "src/index.js"),
      `
module.exports = function parsePdf(buffer) {
  return { text: buffer.toString() };
};

module.exports.version = "1.0.0";
`.trim()
    );

    const result = await analyzeSource({
      clonePath: TEST_DIR,
      extractPaths: ["src/"],
    });

    expect(result.language).toBe("javascript");
    expect(result.suggestedPortStrategy).toBe("transpile-js");
    expect(result.entryExports.length).toBeGreaterThanOrEqual(1);
    expect(result.entryExports[0].name).toBe("parsePdf");
    expect(result.entryExports[0].kind).toBe("function");
  });

  it("extracts exported functions from a TS file", async () => {
    await writeFile(
      join(TEST_DIR, "src/util.ts"),
      `
export function compress(data: Buffer): Buffer {
  return data;
}

export class Compressor {
  run(input: string): string {
    return input;
  }
}
`.trim()
    );

    const result = await analyzeSource({
      clonePath: TEST_DIR,
      extractPaths: ["src/util.ts"],
    });

    expect(result.language).toBe("typescript");
    expect(result.suggestedPortStrategy).toBe("direct-copy");
    const names = result.entryExports.map((e) => e.name);
    expect(names).toContain("compress");
    expect(names).toContain("Compressor");
  });

  it("detects native bindings from package.json", async () => {
    await writeFile(
      join(TEST_DIR, "package.json"),
      JSON.stringify({
        name: "native-pkg",
        dependencies: { "node-gyp": "^9.0.0" },
        scripts: { install: "node-gyp rebuild" },
      })
    );

    const result = await analyzeSource({
      clonePath: TEST_DIR,
      extractPaths: ["src/"],
    });

    expect(result.hasNativeBindings).toBe(true);
  });

  it("respects maxFiles limit", async () => {
    const bigDir = join(TEST_DIR, "many");
    await mkdir(bigDir, { recursive: true });
    for (let i = 0; i < 60; i++) {
      await writeFile(join(bigDir, `f${i}.js`), `module.exports = ${i};`);
    }

    const result = await analyzeSource({
      clonePath: TEST_DIR,
      extractPaths: ["many/"],
      maxFiles: 50,
    });

    // Should still succeed but cap at 50 files
    expect(result.totalLines).toBeLessThanOrEqual(60);
  });

  it("returns empty exports for non-code files", async () => {
    await writeFile(join(TEST_DIR, "src/readme.md"), "# Hello");

    const result = await analyzeSource({
      clonePath: TEST_DIR,
      extractPaths: ["src/readme.md"],
    });

    expect(result.entryExports).toHaveLength(0);
  });
});
