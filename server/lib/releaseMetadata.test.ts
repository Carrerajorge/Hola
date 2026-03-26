import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  clearReleaseMetadataCacheForTests,
  getReleaseMetadata,
} from "./releaseMetadata";

const ORIGINAL_ENV = { ...process.env };

describe("releaseMetadata", () => {
  let tempDir: string | null = null;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    clearReleaseMetadataCacheForTests();
  });

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    clearReleaseMetadataCacheForTests();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("prefers the generated release manifest over loose env values", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "release-manifest-"));
    const manifestPath = path.join(tempDir, "release-manifest.json");

    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        app_version: "34a7a3fc",
        app_sha: "34a7a3fc55c160c3a44cb75d5742893422bea8c8",
        image_tag: "sha-34a7a3fc",
        package_version: "2.1.0",
        built_at: "2026-03-26T00:00:00Z",
      }),
      "utf-8",
    );

    process.env.RELEASE_MANIFEST_PATH = manifestPath;
    process.env.APP_VERSION = "stale-env-version";
    process.env.APP_SHA = "stale-env-sha";
    process.env.IMAGE_TAG = "sha-stale-env";
    process.env.npm_package_version = "9.9.9";

    const metadata = getReleaseMetadata();

    expect(metadata).toMatchObject({
      app_version: "34a7a3fc",
      app_sha: "34a7a3fc55c160c3a44cb75d5742893422bea8c8",
      image_tag: "sha-34a7a3fc",
      package_version: "2.1.0",
      built_at: "2026-03-26T00:00:00Z",
      source: "manifest",
    });
  });

  it("falls back to env metadata when no manifest is available", () => {
    delete process.env.RELEASE_MANIFEST_PATH;
    process.env.APP_VERSION = "env-version";
    process.env.APP_SHA = "env-full-sha";
    process.env.IMAGE_TAG = "sha-env-version";
    process.env.BUILD_TIMESTAMP = "2026-03-26T01:02:03Z";
    process.env.npm_package_version = "3.4.5";

    const metadata = getReleaseMetadata();

    expect(metadata).toMatchObject({
      app_version: "env-version",
      app_sha: "env-full-sha",
      image_tag: "sha-env-version",
      package_version: "3.4.5",
      built_at: "2026-03-26T01:02:03Z",
      source: "env",
    });
  });
});
