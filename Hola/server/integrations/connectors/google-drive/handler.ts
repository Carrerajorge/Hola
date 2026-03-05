/**
 * Google Drive Connector Handler
 *
 * Implements execute() and healthCheck() for every capability declared
 * in the Google Drive manifest.  Uses the official googleapis library.
 */

import { google } from "googleapis";
import { Readable } from "node:stream";
import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";
import type {
  ResolvedCredential,
  ConnectorOperationResult,
} from "../../kernel/types";

// ─── Helpers ────────────────────────────────────────────────────────

/** Build an authenticated Drive client from a resolved credential. */
function buildDriveClient(credential: ResolvedCredential) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: credential.accessToken });
  return google.drive({ version: "v3", auth });
}

/** Standard fields to request for file list responses. */
const FILE_FIELDS =
  "id, name, mimeType, size, modifiedTime, createdTime, webViewLink, parents";

/** Map of Google Workspace MIME types to their export targets. */
const EXPORT_MAP: Record<string, { mimeType: string; label: string }> = {
  "application/vnd.google-apps.document": {
    mimeType: "text/plain",
    label: "Google Doc → text",
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "text/csv",
    label: "Google Sheet → CSV",
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "text/plain",
    label: "Google Slides → text",
  },
  "application/vnd.google-apps.drawing": {
    mimeType: "image/svg+xml",
    label: "Google Drawing → SVG",
  },
};

/** Max bytes to read from a binary file before truncating. */
const MAX_CONTENT_BYTES = 512_000; // ~500 KB

/** Wrap a successful result. */
function ok(data: unknown): ConnectorOperationResult {
  return { success: true, data };
}

/** Wrap an error result. */
function fail(
  code: string,
  message: string,
  retryable: boolean,
  statusCode?: number
): ConnectorOperationResult {
  return {
    success: false,
    error: { code, message, retryable, statusCode },
  };
}

// ─── Handler ────────────────────────────────────────────────────────

export const handler: ConnectorHandlerFactory = {
  async execute(
    operationId: string,
    input: Record<string, unknown>,
    credential: ResolvedCredential
  ): Promise<ConnectorOperationResult> {
    const drive = buildDriveClient(credential);

    try {
      switch (operationId) {
        // ── List Files ───────────────────────────────────────────
        case "gdrive_list_files": {
          const maxResults = (input.maxResults as number) || 10;
          const pageToken = (input.pageToken as string) || undefined;
          const mimeType = (input.mimeType as string) || undefined;
          const folderId = (input.folderId as string) || undefined;
          const userQuery = (input.query as string) || undefined;

          // Build the Drive query string
          const queryParts: string[] = ["trashed = false"];
          if (userQuery) queryParts.push(`(${userQuery})`);
          if (mimeType) queryParts.push(`mimeType = '${mimeType}'`);
          if (folderId) queryParts.push(`'${folderId}' in parents`);

          const listRes = await drive.files.list({
            q: queryParts.join(" and "),
            pageSize: maxResults,
            pageToken,
            fields: `nextPageToken, files(${FILE_FIELDS})`,
            orderBy: "modifiedTime desc",
          });

          return ok({
            files: listRes.data.files ?? [],
            nextPageToken: listRes.data.nextPageToken ?? null,
          });
        }

        // ── Read File ────────────────────────────────────────────
        case "gdrive_read_file": {
          const fileId = input.fileId as string;
          if (!fileId) {
            return fail("INVALID_INPUT", "fileId is required.", false);
          }

          // First, get file metadata to determine MIME type
          const meta = await drive.files.get({
            fileId,
            fields: "id, name, mimeType, size, modifiedTime",
          });

          const fileMimeType = meta.data.mimeType ?? "";
          const exportTarget = EXPORT_MAP[fileMimeType];

          let content: string;

          if (exportTarget) {
            // Google Workspace file — export to text-friendly format
            const exportRes = await drive.files.export(
              { fileId, mimeType: exportTarget.mimeType },
              { responseType: "text" }
            );
            content = typeof exportRes.data === "string"
              ? exportRes.data
              : String(exportRes.data);
          } else {
            // Binary or plain file — download content directly
            const downloadRes = await drive.files.get(
              { fileId, alt: "media" },
              { responseType: "stream" }
            );

            const chunks: Buffer[] = [];
            let totalBytes = 0;

            await new Promise<void>((resolve, reject) => {
              const stream = downloadRes.data as unknown as Readable;
              stream.on("data", (chunk: Buffer) => {
                if (totalBytes < MAX_CONTENT_BYTES) {
                  chunks.push(chunk);
                  totalBytes += chunk.length;
                }
              });
              stream.on("end", resolve);
              stream.on("error", reject);
            });

            const buffer = Buffer.concat(chunks);

            // Attempt to decode as UTF-8; if the content is binary, return a truncated note
            const isTextLikely =
              fileMimeType.startsWith("text/") ||
              fileMimeType.includes("json") ||
              fileMimeType.includes("xml") ||
              fileMimeType.includes("csv") ||
              fileMimeType.includes("javascript") ||
              fileMimeType.includes("typescript");

            if (isTextLikely) {
              content = buffer.toString("utf-8");
            } else {
              content = `[Binary file: ${meta.data.name} (${fileMimeType}, ${meta.data.size ?? "unknown"} bytes). Content not displayed.]`;
            }
          }

          return ok({
            id: meta.data.id,
            name: meta.data.name,
            mimeType: fileMimeType,
            content,
            size: meta.data.size ?? null,
            modifiedTime: meta.data.modifiedTime ?? null,
          });
        }

        // ── Search Files ─────────────────────────────────────────
        case "gdrive_search": {
          const query = input.query as string;
          if (!query) {
            return fail("INVALID_INPUT", "query is required.", false);
          }

          const maxResults = (input.maxResults as number) || 10;
          const pageToken = (input.pageToken as string) || undefined;

          // Use Drive fullText search
          const listRes = await drive.files.list({
            q: `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`,
            pageSize: maxResults,
            pageToken,
            fields: `nextPageToken, files(${FILE_FIELDS})`,
            orderBy: "modifiedTime desc",
          });

          return ok({
            files: listRes.data.files ?? [],
            nextPageToken: listRes.data.nextPageToken ?? null,
          });
        }

        // ── Upload File ──────────────────────────────────────────
        case "gdrive_upload_file": {
          const name = input.name as string;
          const content = input.content as string;
          const mimeType = input.mimeType as string;
          const folderId = (input.folderId as string) || undefined;

          if (!name || !content || !mimeType) {
            return fail(
              "INVALID_INPUT",
              "name, content, and mimeType are required.",
              false
            );
          }

          const fileMetadata: Record<string, unknown> = { name };
          if (folderId) {
            fileMetadata.parents = [folderId];
          }

          // Create a readable stream from the content string
          const media = {
            mimeType,
            body: Readable.from(Buffer.from(content, "utf-8")),
          };

          const createRes = await drive.files.create({
            requestBody: fileMetadata,
            media,
            fields: "id, name, mimeType, webViewLink, size",
          });

          return ok({
            id: createRes.data.id,
            name: createRes.data.name,
            mimeType: createRes.data.mimeType,
            webViewLink: createRes.data.webViewLink ?? null,
            size: createRes.data.size ?? null,
          });
        }

        default:
          return fail(
            "UNKNOWN_OPERATION",
            `Unknown operationId: ${operationId}`,
            false
          );
      }
    } catch (err: unknown) {
      const isGaxios = err && typeof err === "object" && "response" in err;
      const statusCode = isGaxios ? (err as any).response?.status : undefined;
      const message =
        err instanceof Error ? err.message : String(err);
      const retryable =
        statusCode === 429 || (statusCode !== undefined && statusCode >= 500);

      return fail("DRIVE_API_ERROR", message, retryable, statusCode);
    }
  },

  async healthCheck(credential?: ResolvedCredential) {
    const start = Date.now();
    if (!credential) {
      return { healthy: false, latencyMs: 0 };
    }
    try {
      const drive = buildDriveClient(credential);
      await drive.about.get({ fields: "user" });
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  },
};
