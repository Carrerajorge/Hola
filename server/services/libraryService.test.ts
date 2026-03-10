import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryService } from "./libraryService";
import { consumeLocalUploadIntent, clearLocalUploadIntent } from "../lib/localUploadIntents";

describe("LibraryService.generateUploadUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to local uploads when object storage is unavailable", async () => {
    const service = new LibraryService();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const objectStorage = (service as any).objectStorage;
    vi.spyOn(service as any, "logActivity").mockResolvedValue(undefined);

    vi.spyOn(objectStorage, "getObjectEntityUploadURL").mockRejectedValue(new Error("sidecar unavailable"));

    const result = await service.generateUploadUrl(
      "user-123",
      "report.pdf",
      "application/pdf"
    );

    expect(result.uploadUrl).toMatch(/^\/api\/local-upload\/[0-9a-f-]{36}$/i);
    expect(result.objectPath).toBe(`/objects/uploads/${result.fileUuid}`);
    expect(result.storagePath).toBe(`/objects/uploads/${result.fileUuid}`);
    expect(
      consumeLocalUploadIntent(result.fileUuid, "user-123")
    ).toMatchObject({ storagePath: result.storagePath });
    expect(warnSpy).toHaveBeenCalled();

    clearLocalUploadIntent(result.fileUuid);
  });
});
