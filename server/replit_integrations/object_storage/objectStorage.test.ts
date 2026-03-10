import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";

const uploadsDir = path.resolve(process.cwd(), "uploads");
const createdObjectIds = new Set<string>();

afterEach(async () => {
  await Promise.all(
    Array.from(createdObjectIds, async (objectId) => {
      await fs.rm(path.resolve(uploadsDir, objectId), { force: true });
    }),
  );
  createdObjectIds.clear();
});

describe("ObjectStorageService local upload fallback", () => {
  it("reads buffers from local fallback object paths", async () => {
    const service = new ObjectStorageService();
    const objectId = `object-storage-local-${Date.now()}.txt`;
    createdObjectIds.add(objectId);

    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.resolve(uploadsDir, objectId), "preview-from-local-upload", "utf8");

    const buffer = await service.getObjectEntityBuffer(`/objects/uploads/${objectId}`);

    expect(buffer.toString("utf8")).toBe("preview-from-local-upload");
  });

  it("raises object not found when the local fallback file is missing", async () => {
    const service = new ObjectStorageService();

    await expect(
      service.getObjectEntityBuffer(`/objects/uploads/missing-${Date.now()}.txt`),
    ).rejects.toBeInstanceOf(ObjectNotFoundError);
  });
});
