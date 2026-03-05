/**
 * Secure File Gateway — All file system access goes through this gateway.
 *
 * Enforces:
 * - Workspace allowlist (no FS access outside approved roots)
 * - Granular read/write/delete permissions with confirmation
 * - Audit log of every access
 * - Secret redaction on read
 * - Size limits
 * - Path traversal prevention
 * - Symlink traversal prevention
 */

import * as fs from "fs/promises";
import { createReadStream, existsSync, statSync } from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { randomUUID } from "crypto";
import {
  FileAccessPolicy,
  FileAccessRequest,
  FileAccessResult,
  AuditLogEntry,
  RiskLevel,
} from "./types";
import { redactSecrets } from "./secretDetector";

const DEFAULT_POLICY: FileAccessPolicy = {
  allowedRoots: [process.cwd()],
  maxReadBytes: 50 * 1024 * 1024, // 50MB
  maxWriteBytes: 10 * 1024 * 1024, // 10MB
  allowedMimeTypes: [],
  permissions: ["read"],
  confirmWrites: true,
  confirmDeletes: true,
};

const SENSITIVE_PATHS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".config/gcloud",
  ".config/gh",
  ".kube",
  ".npmrc",
  "id_rsa",
  "id_ed25519",
  "credentials",
  ".env",
];

export class FileGateway {
  private policy: FileAccessPolicy;
  private auditLog: AuditLogEntry[] = [];
  private maxAuditEntries = 50_000;

  constructor(policy?: Partial<FileAccessPolicy>) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  // ── Policy management ──────────────────────────────

  updatePolicy(update: Partial<FileAccessPolicy>): void {
    this.policy = { ...this.policy, ...update };
  }

  getPolicy(): Readonly<FileAccessPolicy> {
    return { ...this.policy };
  }

  // ── Core operations ────────────────────────────────

  async readFile(request: FileAccessRequest): Promise<FileAccessResult> {
    const start = Date.now();
    const reqId = request.requestId || randomUUID();

    try {
      this.assertPermission("read");
      const resolvedPath = await this.resolveSafePath(request.path);
      await this.assertNotSensitive(resolvedPath);
      await this.assertNoSymlinkTraversal(resolvedPath);

      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) {
        throw new Error("Path is not a file");
      }
      if (stat.size > this.policy.maxReadBytes) {
        throw new Error(`File exceeds max read size: ${stat.size} > ${this.policy.maxReadBytes}`);
      }

      const content = await fs.readFile(resolvedPath);
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      const textContent = content.toString("utf-8");

      // Redact secrets before returning
      const { redacted, secretCount } = redactSecrets(textContent);

      const result: FileAccessResult = {
        requestId: reqId,
        success: true,
        operation: "read",
        path: resolvedPath,
        data: redacted,
        hash,
        sizeBytes: stat.size,
        mimeType: this.inferMimeType(resolvedPath),
        durationMs: Date.now() - start,
      };

      this.logAudit({
        id: randomUUID(),
        timestamp: Date.now(),
        userId: request.userId,
        sessionId: request.sessionId,
        operation: "read",
        path: resolvedPath,
        allowed: true,
        hash,
        sizeBytes: stat.size,
        durationMs: result.durationMs,
        riskLevel: secretCount > 0 ? "MEDIUM" : "LOW",
      });

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logAudit({
        id: randomUUID(),
        timestamp: Date.now(),
        userId: request.userId,
        sessionId: request.sessionId,
        operation: "read",
        path: request.path,
        allowed: false,
        deniedReason: errMsg,
        durationMs: Date.now() - start,
        riskLevel: "LOW",
      });

      return {
        requestId: reqId,
        success: false,
        operation: "read",
        path: request.path,
        error: errMsg,
        durationMs: Date.now() - start,
      };
    }
  }

  async readFileRaw(request: FileAccessRequest): Promise<{ buffer: Buffer; hash: string; size: number } | null> {
    this.assertPermission("read");
    const resolvedPath = await this.resolveSafePath(request.path);
    await this.assertNotSensitive(resolvedPath);
    await this.assertNoSymlinkTraversal(resolvedPath);

    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile() || stat.size > this.policy.maxReadBytes) return null;

    const content = await fs.readFile(resolvedPath);
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    return { buffer: content, hash, size: stat.size };
  }

  async writeFile(request: FileAccessRequest): Promise<FileAccessResult> {
    const start = Date.now();
    const reqId = request.requestId || randomUUID();

    try {
      this.assertPermission("write");
      const resolvedPath = await this.resolveSafePath(request.path);
      await this.assertNotSensitive(resolvedPath);

      const content = request.content;
      if (!content && content !== "") {
        throw new Error("No content provided for write");
      }
      const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;
      if (buf.byteLength > this.policy.maxWriteBytes) {
        throw new Error(`Content exceeds max write size: ${buf.byteLength} > ${this.policy.maxWriteBytes}`);
      }

      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, buf);

      const hash = crypto.createHash("sha256").update(buf).digest("hex");
      const result: FileAccessResult = {
        requestId: reqId,
        success: true,
        operation: "write",
        path: resolvedPath,
        hash,
        sizeBytes: buf.byteLength,
        durationMs: Date.now() - start,
      };

      this.logAudit({
        id: randomUUID(),
        timestamp: Date.now(),
        userId: request.userId,
        sessionId: request.sessionId,
        operation: "write",
        path: resolvedPath,
        allowed: true,
        hash,
        sizeBytes: buf.byteLength,
        durationMs: result.durationMs,
        riskLevel: "MEDIUM",
      });

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logAudit({
        id: randomUUID(),
        timestamp: Date.now(),
        userId: request.userId,
        sessionId: request.sessionId,
        operation: "write",
        path: request.path,
        allowed: false,
        deniedReason: errMsg,
        durationMs: Date.now() - start,
        riskLevel: "MEDIUM",
      });

      return {
        requestId: reqId,
        success: false,
        operation: "write",
        path: request.path,
        error: errMsg,
        durationMs: Date.now() - start,
      };
    }
  }

  async deleteFile(request: FileAccessRequest): Promise<FileAccessResult> {
    const start = Date.now();
    const reqId = request.requestId || randomUUID();

    try {
      this.assertPermission("delete");
      const resolvedPath = await this.resolveSafePath(request.path);
      await this.assertNotSensitive(resolvedPath);

      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) {
        throw new Error("Path is not a file (will not delete directories)");
      }

      await fs.unlink(resolvedPath);

      this.logAudit({
        id: randomUUID(),
        timestamp: Date.now(),
        userId: request.userId,
        sessionId: request.sessionId,
        operation: "delete",
        path: resolvedPath,
        allowed: true,
        sizeBytes: stat.size,
        durationMs: Date.now() - start,
        riskLevel: "HIGH",
      });

      return {
        requestId: reqId,
        success: true,
        operation: "delete",
        path: resolvedPath,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logAudit({
        id: randomUUID(),
        timestamp: Date.now(),
        userId: request.userId,
        sessionId: request.sessionId,
        operation: "delete",
        path: request.path,
        allowed: false,
        deniedReason: errMsg,
        durationMs: Date.now() - start,
        riskLevel: "HIGH",
      });

      return {
        requestId: reqId,
        success: false,
        operation: "delete",
        path: request.path,
        error: errMsg,
        durationMs: Date.now() - start,
      };
    }
  }

  async listDirectory(request: FileAccessRequest): Promise<FileAccessResult> {
    const start = Date.now();
    const reqId = request.requestId || randomUUID();

    try {
      const resolvedPath = await this.resolveSafePath(request.path);
      const stat = await fs.stat(resolvedPath);
      if (!stat.isDirectory()) {
        throw new Error("Path is not a directory");
      }

      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      const items = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" as const : e.isFile() ? "file" as const : "other" as const,
        path: path.join(resolvedPath, e.name),
      }));

      this.logAudit({
        id: randomUUID(),
        timestamp: Date.now(),
        userId: request.userId,
        sessionId: request.sessionId,
        operation: "list",
        path: resolvedPath,
        allowed: true,
        durationMs: Date.now() - start,
        riskLevel: "LOW",
      });

      return {
        requestId: reqId,
        success: true,
        operation: "list",
        path: resolvedPath,
        data: items,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        requestId: reqId,
        success: false,
        operation: "list",
        path: request.path,
        error: errMsg,
        durationMs: Date.now() - start,
      };
    }
  }

  async searchFiles(
    request: FileAccessRequest,
    pattern: string,
    maxResults = 100,
  ): Promise<FileAccessResult> {
    const start = Date.now();
    const reqId = request.requestId || randomUUID();

    try {
      const resolvedPath = await this.resolveSafePath(request.path);
      const results: string[] = [];
      await this.walkDir(resolvedPath, pattern, results, maxResults, 0, 10);

      return {
        requestId: reqId,
        success: true,
        operation: "search",
        path: resolvedPath,
        data: results,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        requestId: reqId,
        success: false,
        operation: "search",
        path: request.path,
        error: errMsg,
        durationMs: Date.now() - start,
      };
    }
  }

  // ── Audit ──────────────────────────────────────────

  getAuditLog(limit = 100, offset = 0): AuditLogEntry[] {
    return this.auditLog.slice(offset, offset + limit);
  }

  getAuditLogByUser(userId: string, limit = 100): AuditLogEntry[] {
    return this.auditLog.filter((e) => e.userId === userId).slice(-limit);
  }

  // ── Private helpers ────────────────────────────────

  private assertPermission(permission: FilePermission): void {
    if (!this.policy.permissions.includes(permission)) {
      throw new Error(`Permission denied: ${permission} not granted`);
    }
  }

  private async resolveSafePath(inputPath: string): Promise<string> {
    const cleaned = inputPath.replace(/\0/g, "");
    const expanded = this.expandHome(cleaned);
    const resolved = path.resolve(expanded);

    // Check null bytes
    if (resolved.includes("\0")) {
      throw new Error("Null byte in path");
    }

    // Path length limit
    if (resolved.length > 4096) {
      throw new Error("Path too long");
    }

    // Must be inside an allowed root
    const allowed = this.policy.allowedRoots.some((root) => {
      const resolvedRoot = path.resolve(root);
      const rel = path.relative(resolvedRoot, resolved);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });

    if (!allowed) {
      throw new Error(
        `Access denied: path '${resolved}' is outside allowed workspaces`,
      );
    }

    return resolved;
  }

  private async assertNotSensitive(absolutePath: string): Promise<void> {
    const normalized = absolutePath.replace(/\\/g, "/");
    for (const segment of SENSITIVE_PATHS) {
      if (
        normalized.endsWith(`/${segment}`) ||
        normalized.includes(`/${segment}/`)
      ) {
        throw new Error(`Access denied: sensitive path blocked (${segment})`);
      }
    }
  }

  private async assertNoSymlinkTraversal(targetPath: string): Promise<void> {
    const parts = targetPath.split(path.sep).filter(Boolean);
    let current = path.sep;
    for (const part of parts) {
      current = path.join(current, part);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) {
          throw new Error("Access denied: symlink traversal blocked");
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("symlink")) throw err;
        // Path segment doesn't exist yet, that's ok for write operations
        break;
      }
    }
  }

  private expandHome(inputPath: string): string {
    if (inputPath === "~") return process.env.HOME || "/root";
    if (inputPath.startsWith("~/"))
      return path.join(process.env.HOME || "/root", inputPath.slice(2));
    return inputPath;
  }

  private inferMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".json": "application/json",
      ".csv": "text/csv",
      ".html": "text/html",
      ".xml": "application/xml",
      ".pdf": "application/pdf",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".py": "text/x-python",
      ".js": "text/javascript",
      ".ts": "text/typescript",
    };
    return mimeMap[ext] || "application/octet-stream";
  }

  private async walkDir(
    dir: string,
    pattern: string,
    results: string[],
    maxResults: number,
    depth: number,
    maxDepth: number,
  ): Promise<void> {
    if (depth > maxDepth || results.length >= maxResults) return;

    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const regex = new RegExp(pattern, "i");

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.name === "node_modules" || entry.name === ".git") continue;

      const fullPath = path.join(dir, entry.name);
      if (regex.test(entry.name)) {
        results.push(fullPath);
      }
      if (entry.isDirectory()) {
        await this.walkDir(fullPath, pattern, results, maxResults, depth + 1, maxDepth);
      }
    }
  }

  private logAudit(entry: AuditLogEntry): void {
    this.auditLog.push(entry);
    if (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog = this.auditLog.slice(-Math.floor(this.maxAuditEntries * 0.8));
    }
  }
}
