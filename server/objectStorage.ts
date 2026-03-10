import { Response } from "express";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { randomUUID } from "crypto";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// Mock File class to maintain compatible signature with @google-cloud/storage
export class File {
  public name: string;
  public bucketName: string;
  private fullPath: string;

  constructor(bucketName: string, objectName: string) {
    this.name = objectName;
    this.bucketName = bucketName;
    
    // Default to /uploads/objects inside the project cwd
    const baseUploadsDir = path.join(process.cwd(), "uploads", "objects");
    this.fullPath = path.join(baseUploadsDir, bucketName, objectName);
  }

  async exists(): Promise<[boolean]> {
    try {
      await fs.access(this.fullPath);
      return [true];
    } catch {
      return [false];
    }
  }

  async getMetadata(): Promise<[any]> {
    try {
      const metaPath = this.fullPath + ".meta.json";
      const data = await fs.readFile(metaPath, "utf-8");
      return [JSON.parse(data)];
    } catch {
      // Fallback for basic stat
      try {
        const stats = await fs.stat(this.fullPath);
        return [{ size: stats.size, contentType: "application/octet-stream" }];
      } catch {
        return [{}];
      }
    }
  }

  async setMetadata(meta: any): Promise<void> {
    const metaPath = this.fullPath + ".meta.json";
    let existing = {};
    try {
      existing = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    } catch {}
    
    const updated = { ...existing, ...meta.metadata };
    await fs.mkdir(path.dirname(metaPath), { recursive: true });
    await fs.writeFile(metaPath, JSON.stringify(updated));
  }

  createReadStream() {
    return fsSync.createReadStream(this.fullPath);
  }

  async download(): Promise<[Buffer]> {
    return [await fs.readFile(this.fullPath)];
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "public-bucket";
    return Array.from(
      new Set(
        pathsStr.split(",").map((p) => p.trim()).filter(Boolean)
      )
    );
  }

  getPrivateObjectDir(): string {
    return process.env.PRIVATE_OBJECT_DIR || "private-bucket/internal";
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `/${searchPath}/${filePath}`;
      const { bucketName, objectName } = this.parseObjectPath(fullPath);
      const file = new File(bucketName, objectName);
      
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }
    return null;
  }

  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      const [metadata] = await file.getMetadata();
      // Basic ACL parsing from metadata if needed
      const isPublic = metadata?.custom?.aclPolicy?.visibility === "public";
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      });
      const stream = file.createReadStream();
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        }
      });
      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const { uploadURL } = await this.getObjectEntityUploadURLWithPath();
    return uploadURL;
  }

  async getObjectEntityUploadURLWithPath(uploadId?: string): Promise<{ uploadURL: string; storagePath: string }> {
    // Generate the path and throw naturally forcing the filesRouter fallback to use local storage mechanism.
    // That route already implements `local-upload` for everything!
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = uploadId || randomUUID();
    const entityId = `uploads/${objectId}`;
    
    // We explicitly throw an error here to immediately trigger the local fallback in filesRouter.ts.
    // The existing filesRouter.ts already gracefully handles local uploads and multipart local chunks perfectly.
    // By throwing instead of hanging for 3 seconds on Replit API, uploads are instantaneous and local!
    throw new Error("Local fallback triggered intentionally for Native Server deployment.");
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    
    // E.g. /objects/uploads/uuid -> We map it to the dummy File
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }
    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = this.parseObjectPath(objectEntityPath);
    
    const objectFile = new File(bucketName, objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      // Local fallback in filesRouter saves directly to uploads/objectId, not uploads/objects/bucket/...
      // So check the fallback path as well!
      const fallbackFile = new File("..", `../uploads/${entityId.replace('uploads/', '')}`);
      const [fallbackExists] = await fallbackFile.exists();
      if(fallbackExists) return fallbackFile;
      
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }
    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: any
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    // Safe-cast to our File
    await objectFile.setMetadata({
       metadata: {
         "custom:aclPolicy": JSON.stringify(aclPolicy),
       }
    });
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: any;
  }): Promise<boolean> {
    // Basic bypass for the mock implementation
    return true; 
  }

  async getFileContent(file: File): Promise<Buffer> {
    const [content] = await file.download();
    return content;
  }

  private parseObjectPath(pathstr: string): {
    bucketName: string;
    objectName: string;
  } {
    if (!pathstr.startsWith("/")) {
      pathstr = `/${pathstr}`;
    }
    const pathParts = pathstr.split("/");
    if (pathParts.length < 3) {
      // Create a dummy bucket
      return { bucketName: "default", objectName: pathParts.slice(1).join("/") };
    }
    const bucketName = pathParts[1];
    const objectName = pathParts.slice(2).join("/");
    return { bucketName, objectName };
  }
}

// Ensure variable is still correctly exported for filesRouter.ts that might use it
export const objectStorageClient = {} as any;
