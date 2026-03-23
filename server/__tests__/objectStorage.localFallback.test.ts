import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetLocalUploadsDirForTests } from "../lib/localUploads";
import { ObjectStorageService } from "../objectStorage";

describe("ObjectStorageService local upload fallback", () => {
  let tempUploadsDir = "";

  beforeEach(async () => {
    tempUploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), "iliagpt-uploads-"));
    process.env.LOCAL_UPLOADS_DIR = tempUploadsDir;
    resetLocalUploadsDirForTests();
  });

  afterEach(async () => {
    delete process.env.LOCAL_UPLOADS_DIR;
    resetLocalUploadsDirForTests();
    if (tempUploadsDir) {
      await fs.rm(tempUploadsDir, { recursive: true, force: true });
    }
  });

  it("reads /objects/uploads files from the configured writable uploads directory", async () => {
    const expected = Buffer.from("hola");
    await fs.writeFile(path.join(tempUploadsDir, "fixture.bin"), expected);

    const service = new ObjectStorageService();
    const file = await service.getObjectEntityFile("/objects/uploads/fixture.bin");
    const content = await service.getFileContent(file);

    expect(content.equals(expected)).toBe(true);
  });

  it("uses local mode for direct uploads", () => {
    const service = new ObjectStorageService();
    expect(service.supportsDirectUploadSigning()).toBe(false);
  });
});
