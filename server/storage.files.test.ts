import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const insertValuesMock = vi.fn();
const insertReturningMock = vi.fn();
const updateMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const executeMock = vi.fn();
const readSelectMock = vi.fn();
const readFromMock = vi.fn();
const readWhereMock = vi.fn();
const readOrderByMock = vi.fn();
const readExecuteMock = vi.fn();

const filesTable = {
  id: "files.id",
  userId: "files.user_id",
  storagePath: "files.storage_path",
  createdAt: "files.created_at",
};

const fileJobsTable = {
  fileId: "file_jobs.file_id",
  retries: "file_jobs.retries",
};

const fileChunksTable = {
  fileId: "file_chunks.file_id",
  chunkIndex: "file_chunks.chunk_index",
};

vi.mock("./lib/cache", () => ({
  cache: {
    remember: (_key: string, _ttl: number, factory: () => Promise<unknown>) => factory(),
  },
}));

vi.mock("./db", () => ({
  db: {
    insert: (...args: any[]) => insertMock(...args),
    update: (...args: any[]) => updateMock(...args),
    execute: (...args: any[]) => executeMock(...args),
  },
  dbRead: {
    select: (...args: any[]) => readSelectMock(...args),
    execute: (...args: any[]) => readExecuteMock(...args),
  },
}));

vi.mock("../shared/schema", () => ({
  files: filesTable,
  fileJobs: fileJobsTable,
  fileChunks: fileChunksTable,
  users: {
    id: "users.id",
    username: "users.username",
  },
}));

vi.mock("./services/knowledgeBase", () => ({
  knowledgeBaseService: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  desc: vi.fn((value: unknown) => value),
  and: vi.fn((...parts: unknown[]) => parts),
  isNull: vi.fn((value: unknown) => value),
  ilike: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ left, right })),
  or: vi.fn((...parts: unknown[]) => parts),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
}));

async function loadStorage() {
  return (await import("./storage")).storage;
}

describe("storage file schema drift resilience", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    insertMock.mockReset();
    insertValuesMock.mockReset();
    insertReturningMock.mockReset();
    updateMock.mockReset();
    updateSetMock.mockReset();
    updateWhereMock.mockReset();
    executeMock.mockReset();
    readSelectMock.mockReset();
    readFromMock.mockReset();
    readWhereMock.mockReset();
    readOrderByMock.mockReset();
    readExecuteMock.mockReset();

    insertMock.mockReturnValue({
      values: (...args: any[]) => {
        insertValuesMock(...args);
        return {
          returning: (...returningArgs: any[]) => insertReturningMock(...returningArgs),
        };
      },
    });

    updateWhereMock.mockResolvedValue(undefined);
    updateSetMock.mockReturnValue({
      where: updateWhereMock,
    });
    updateMock.mockReturnValue({
      set: updateSetMock,
    });

    readWhereMock.mockResolvedValue(undefined);
    readOrderByMock.mockResolvedValue([]);
    readFromMock.mockReturnValue({
      where: readWhereMock,
      orderBy: readOrderByMock,
    });
    readSelectMock.mockReturnValue({
      from: readFromMock,
    });
  });

  it("retries file creation without newer columns when production schema is behind", async () => {
    insertReturningMock
      .mockRejectedValueOnce({ code: "42703", message: 'column "processing_progress" does not exist' })
      .mockResolvedValueOnce(undefined);

    readWhereMock.mockRejectedValueOnce({
      code: "42703",
      message: 'column "processing_progress" does not exist',
    });
    readExecuteMock.mockResolvedValueOnce({
      rows: [
        {
          id: "file_legacy",
          user_id: "user_1",
          name: "plan.xlsx",
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 2048,
          storage_path: "/objects/library/file_legacy",
          status: "processing",
          created_at: new Date("2026-03-09T12:00:00.000Z"),
        },
      ],
    });

    const storage = await loadStorage();
    const file = await storage.createFile({
      id: "file_legacy",
      userId: "user_1",
      name: "plan.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 2048,
      storagePath: "/objects/library/file_legacy",
      status: "processing",
      processingProgress: 10,
      uploadedChunks: 1,
    });

    expect(file.id).toBe("file_legacy");
    expect(file.processingProgress).toBe(0);
    expect(insertValuesMock).toHaveBeenCalledTimes(2);
    expect(insertValuesMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        id: "file_legacy",
        processingProgress: 10,
        uploadedChunks: 1,
      }),
    );
    expect(insertValuesMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        id: "file_legacy",
        name: "plan.xlsx",
        status: "processing",
      }),
    );
    expect(insertValuesMock.mock.calls[1]?.[0]).not.toHaveProperty("processingProgress");
    expect(insertValuesMock.mock.calls[1]?.[0]).not.toHaveProperty("uploadedChunks");
  });

  it("falls back to a minimal file query when newer columns are missing", async () => {
    readWhereMock.mockRejectedValueOnce({
      cause: { message: 'column "processing_progress" does not exist' },
      message: "Failed query",
    });
    readExecuteMock.mockResolvedValueOnce({
      rows: [
        {
          id: "file_read_legacy",
          user_id: "user_2",
          name: "legacy.pdf",
          type: "application/pdf",
          size: 1024,
          storage_path: "/objects/library/file_read_legacy",
          status: "ready",
          created_at: new Date("2026-03-09T13:00:00.000Z"),
        },
      ],
    });

    const storage = await loadStorage();
    const file = await storage.getFile("file_read_legacy");

    expect(file?.id).toBe("file_read_legacy");
    expect(file?.processingProgress).toBe(0);
    expect(file?.uploadedChunks).toBe(0);
  });

  it("treats missing file_chunks storage as non-fatal during async processing", async () => {
    insertReturningMock.mockRejectedValueOnce({
      code: "42P01",
      message: 'relation "file_chunks" does not exist',
    });

    const storage = await loadStorage();
    const result = await storage.createFileChunks([
      {
        fileId: "file_1",
        content: "Chunk",
        chunkIndex: 0,
        pageNumber: 1,
        metadata: null,
      },
    ]);

    expect(result).toEqual([]);
  });
});
