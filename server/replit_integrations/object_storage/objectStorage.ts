import { S3Client, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "stream";
import { resolveLocalUploadPath, isPathWithinLocalUploadsDir } from "../../lib/localUploads";


import { Storage, File } from "@google-cloud/storage"; import { Response } from "express"; import { randomUUID } from "crypto"; import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const LOCAL_OBJECT_UPLOADS_PREFIX = "/objects/uploads/";

function isS3Provider() {
  return String(process.env.OBJECT_STORAGE_PROVIDER || "").toLowerCase() === "s3";
}

function getS3Config() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || "auto";
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const prefix = (process.env.S3_PRIVATE_PREFIX || "iliagpt/private").replace(/^\/+|\/+$/g, "");

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 config missing: set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (and optionally S3_PRIVATE_PREFIX)");
  }

  return { endpoint, region, bucket, accessKeyId, secretAccessKey, prefix };
}

function getS3Client() {
  const { endpoint, region, accessKeyId, secretAccessKey } = getS3Config();
  return new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

function toS3Key(prefix: string, objectName: string) {
  const p = prefix.replace(/^\/+|\/+$/g, "");
  const o = objectName.replace(/^\/+/, "");
  return p ? `${p}/${o}` : o;
}

// The object storage client is used to interact with the object storage service.
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// The object storage service is used to interact with the object storage service.
export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    if (String(process.env.OBJECT_STORAGE_PROVIDER || "").toLowerCase() === "s3") {
      const bucket = process.env.S3_BUCKET || "";
      const prefix = (process.env.S3_PRIVATE_PREFIX || "iliagpt/private").replace(/^\/+|\/+$/g, "");
      if (!bucket) throw new Error("S3_BUCKET not set");
      return [`/${bucket}/${prefix}`];
    }

    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }  

  getPrivateObjectDir(): string {
    if (String(process.env.OBJECT_STORAGE_PROVIDER || "").toLowerCase() === "s3") {
      const bucket = process.env.S3_BUCKET || "";
      const prefix = (process.env.S3_PRIVATE_PREFIX || "iliagpt/private").replace(/^\/+|\/+$/g, "");
      if (!bucket) throw new Error("S3_BUCKET not set");
      return `/${bucket}/${prefix}`;
    }

    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  // Search for a public object from the search paths.
  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      // Full path format: /<bucket_name>/<object_name>
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      // Check if file exists
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  // Downloads an object to the response.
  async downloadObject(file: File, res: Response, cacheTtlSec: number = 3600) {
    try {
      // Get file metadata
      const [metadata] = await file.getMetadata();
      // Get the ACL policy for the object.
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      // Set appropriate headers
      res.set({
        "Content-Type": metadata.contentType || "application/octet-stream",
        "Content-Length": metadata.size,
        "Cache-Control": `${
          isPublic ? "public" : "private"
        }, max-age=${cacheTtlSec}`,
      });

      // Stream the file to the response
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

  // Gets the upload URL for an object entity.
  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    // Sign URL for PUT method with TTL
    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  // Gets the object entity file from the object path.
  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

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
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  // Gets the object entity file content as a Buffer
  async getObjectEntityBuffer(objectPath: string): Promise<Buffer> {
    const localFallbackBuffer = await readLocalUploadFallbackBuffer(objectPath);
    if (localFallbackBuffer) {
      return localFallbackBuffer;
    }

    const objectFile = await this.getObjectEntityFile(objectPath);
    const [content] = await objectFile.download();
    return content;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (isS3Provider()) {
      // Con forcePathStyle:true, la URL suele ser: https://<endpoint>/<bucket>/<key>?X-Amz-...
      const url = new URL(rawPath);
      const parts = url.pathname.split("/").filter(Boolean);

      // parts[0] = bucket, el resto = key
      if (parts.length >= 2) {
        const key = parts.slice(1).join("/");
        return `/objects/${key}`;
      }
      return rawPath;
    }

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

  // Tries to set the ACL policy for the object entity and return the normalized path.
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  // Checks if the user can access the object entity.
  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

function isValidLocalObjectId(objectId: string): boolean {
  if (!objectId || typeof objectId !== "string") return false;
  if (objectId.length > 512) return false;
  if (objectId.includes("..") || objectId.includes("//")) return false;
  if (objectId.includes("\0") || objectId.includes("%00")) return false;
  if (objectId.includes("%2e%2e") || objectId.includes("%2E%2E")) return false;
  if (objectId.startsWith("/")) return false;
  if (!/^[a-zA-Z0-9._\-\/]+$/.test(objectId)) return false;
  const normalized = path.normalize(objectId);
  if (normalized.startsWith("..") || normalized.startsWith("/")) return false;
  return true;
}

async function readLocalUploadFallbackBuffer(objectPath: string): Promise<Buffer | null> {
  if (!objectPath.startsWith(LOCAL_OBJECT_UPLOADS_PREFIX)) {
    return null;
  }

  const objectId = objectPath.slice(LOCAL_OBJECT_UPLOADS_PREFIX.length);
  if (!isValidLocalObjectId(objectId)) {
    throw new ObjectNotFoundError();
  }

  const localFilePath = resolveLocalUploadPath(objectId);
  if (!isPathWithinLocalUploadsDir(localFilePath)) {
    throw new ObjectNotFoundError();
  }

  try {
    return await fs.readFile(localFilePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new ObjectNotFoundError();
    }
    throw error;
  }
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  if (isS3Provider()) {
    const s3 = getS3Client();

    if (method !== "PUT") {
      throw new Error(`S3 signing not implemented for method ${method}`);
    }

    const cmd = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectName,
      ContentType: "application/octet-stream",
    });

    return await getSignedUrl(s3, cmd, { expiresIn: ttlSec });
  }

  // ---- Replit sidecar (original) ----
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };

  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}
