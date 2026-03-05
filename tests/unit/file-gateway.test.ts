import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { FileGateway } from "../../server/capabilities/file/FileGateway";
import { FileAccessRequest } from "../../server/capabilities/file/types";

describe("FileGateway", () => {
  let gateway: FileGateway;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "filegateway-test-"));
    gateway = new FileGateway({
      allowedRoots: [tmpDir],
      permissions: ["read", "write", "delete"],
      maxReadBytes: 10 * 1024 * 1024,
      maxWriteBytes: 5 * 1024 * 1024,
      confirmWrites: false,
      confirmDeletes: false,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeRequest(operation: string, filePath: string, content?: string): FileAccessRequest {
    return {
      requestId: "test-req",
      userId: "test-user",
      sessionId: "test-session",
      operation: operation as any,
      path: filePath,
      content,
      timestamp: Date.now(),
    };
  }

  describe("readFile", () => {
    it("should read a file within allowed workspace", async () => {
      const testFile = path.join(tmpDir, "test.txt");
      await fs.writeFile(testFile, "hello world");

      const result = await gateway.readFile(makeRequest("read", testFile));
      expect(result.success).toBe(true);
      expect(result.data).toBe("hello world");
      expect(result.hash).toBeDefined();
      expect(result.sizeBytes).toBe(11);
    });

    it("should deny reading files outside allowed roots", async () => {
      const result = await gateway.readFile(makeRequest("read", "/etc/passwd"));
      expect(result.success).toBe(false);
      expect(result.error).toContain("outside allowed workspaces");
    });

    it("should redact secrets in file content", async () => {
      const testFile = path.join(tmpDir, "secrets.txt");
      await fs.writeFile(testFile, "API_KEY=sk-1234567890abcdefghijklmnopqrstuvwxyz");

      const result = await gateway.readFile(makeRequest("read", testFile));
      expect(result.success).toBe(true);
      expect(String(result.data)).toContain("[REDACTED:");
    });

    it("should deny reading sensitive paths", async () => {
      const sshDir = path.join(tmpDir, ".ssh");
      await fs.mkdir(sshDir, { recursive: true });
      const keyFile = path.join(sshDir, "id_rsa");
      await fs.writeFile(keyFile, "private-key");

      const result = await gateway.readFile(makeRequest("read", keyFile));
      expect(result.success).toBe(false);
      expect(result.error).toContain("sensitive path blocked");
    });
  });

  describe("writeFile", () => {
    it("should write a file within allowed workspace", async () => {
      const testFile = path.join(tmpDir, "output.txt");

      const result = await gateway.writeFile(makeRequest("write", testFile, "new content"));
      expect(result.success).toBe(true);

      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("new content");
    });

    it("should deny writing outside workspace", async () => {
      const result = await gateway.writeFile(makeRequest("write", "/tmp/evil.txt", "bad"));
      // Depending on if /tmp is in allowed roots or not
      expect(result.success).toBe(false);
    });

    it("should create parent directories for nested writes", async () => {
      const nestedFile = path.join(tmpDir, "sub", "dir", "file.txt");
      const result = await gateway.writeFile(makeRequest("write", nestedFile, "nested"));
      expect(result.success).toBe(true);

      const content = await fs.readFile(nestedFile, "utf-8");
      expect(content).toBe("nested");
    });
  });

  describe("deleteFile", () => {
    it("should delete a file within workspace", async () => {
      const testFile = path.join(tmpDir, "todelete.txt");
      await fs.writeFile(testFile, "delete me");

      const result = await gateway.deleteFile(makeRequest("delete", testFile));
      expect(result.success).toBe(true);

      const exists = await fs.access(testFile).then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it("should deny delete without permission", async () => {
      const restrictedGateway = new FileGateway({
        allowedRoots: [tmpDir],
        permissions: ["read"],
      });

      const testFile = path.join(tmpDir, "protected.txt");
      await fs.writeFile(testFile, "protected");

      const result = await restrictedGateway.deleteFile(makeRequest("delete", testFile));
      expect(result.success).toBe(false);
      expect(result.error).toContain("Permission denied");
    });
  });

  describe("listDirectory", () => {
    it("should list directory contents", async () => {
      await fs.writeFile(path.join(tmpDir, "file1.txt"), "a");
      await fs.writeFile(path.join(tmpDir, "file2.txt"), "b");
      await fs.mkdir(path.join(tmpDir, "subdir"));

      const result = await gateway.listDirectory(makeRequest("list", tmpDir));
      expect(result.success).toBe(true);
      const items = result.data as any[];
      expect(items.length).toBe(3);
      expect(items.some((i: any) => i.name === "file1.txt" && i.type === "file")).toBe(true);
      expect(items.some((i: any) => i.name === "subdir" && i.type === "directory")).toBe(true);
    });
  });

  describe("searchFiles", () => {
    it("should search files by pattern", async () => {
      await fs.writeFile(path.join(tmpDir, "hello.ts"), "a");
      await fs.writeFile(path.join(tmpDir, "world.ts"), "b");
      await fs.writeFile(path.join(tmpDir, "readme.md"), "c");

      const result = await gateway.searchFiles(makeRequest("search", tmpDir), "\\.ts$");
      expect(result.success).toBe(true);
      const found = result.data as string[];
      expect(found.length).toBe(2);
    });
  });

  describe("audit log", () => {
    it("should record audit entries for operations", async () => {
      const testFile = path.join(tmpDir, "audit-test.txt");
      await fs.writeFile(testFile, "audit test");

      await gateway.readFile(makeRequest("read", testFile));
      await gateway.readFile(makeRequest("read", "/nonexistent/file"));

      const log = gateway.getAuditLog(10);
      expect(log.length).toBe(2);
      expect(log[0].allowed).toBe(true);
      expect(log[1].allowed).toBe(false);
    });
  });

  describe("policy management", () => {
    it("should allow policy updates", () => {
      gateway.updatePolicy({ maxReadBytes: 100 });
      expect(gateway.getPolicy().maxReadBytes).toBe(100);
    });
  });
});
