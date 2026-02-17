/**
 * Google Drive Connector Manifest
 *
 * Declares authentication, rate limits, and all capabilities (LLM tools)
 * for the Google Drive integration.  Each capability maps 1-to-1 to a
 * Gemini FunctionDeclaration via ConnectorRegistry.
 */

import type { ConnectorManifest } from "../../kernel/types";

export const manifest: ConnectorManifest = {
  connectorId: "google-drive",
  version: "1.0.0",
  displayName: "Google Drive",
  description: "List, read, search, and upload files in Google Drive.",
  iconUrl: "/icons/connectors/google-drive.svg",
  category: "storage",

  authType: "oauth2",
  providerId: "google",
  authConfig: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    pkce: false,
    offlineAccess: true,
    providerId: "google",
  },

  rateLimit: {
    requestsPerMinute: 30,
    requestsPerHour: 500,
  },

  requiredEnvVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],

  capabilities: [
    // ── gdrive_list_files ──────────────────────────────────────────
    {
      operationId: "gdrive_list_files",
      name: "List Files",
      description: "List files in Google Drive with optional query, MIME type filter, and folder scope.",
      requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["drive", "list", "files"],
      inputSchema: {
        type: "object",
        description: "Parameters for listing Google Drive files.",
        properties: {
          query: {
            type: "string",
            description:
              "Drive query filter (e.g. \"name contains 'report'\"). Uses Drive query syntax. Optional.",
          },
          mimeType: {
            type: "string",
            description:
              "Filter by MIME type (e.g. 'application/pdf', 'application/vnd.google-apps.spreadsheet'). Optional.",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of files to return. Defaults to 10.",
            default: 10,
          },
          folderId: {
            type: "string",
            description:
              "Restrict results to a specific folder ID. Optional.",
          },
          pageToken: {
            type: "string",
            description: "Token for fetching the next page of results.",
          },
        },
        required: [],
      },
      outputSchema: {
        type: "object",
        description: "A page of Drive file metadata.",
        properties: {
          files: {
            type: "array",
            description: "List of file metadata objects.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "The file ID." },
                name: { type: "string", description: "The file name." },
                mimeType: { type: "string", description: "MIME type of the file." },
                size: { type: "string", description: "File size in bytes (string for large values)." },
                modifiedTime: { type: "string", description: "Last modified ISO 8601 timestamp." },
                createdTime: { type: "string", description: "Created ISO 8601 timestamp." },
                webViewLink: { type: "string", description: "URL to view in browser." },
                parents: {
                  type: "array",
                  items: { type: "string" },
                  description: "Parent folder IDs.",
                },
              },
            },
          },
          nextPageToken: {
            type: "string",
            description: "Token for the next page, if more results exist.",
          },
        },
      },
    },

    // ── gdrive_read_file ───────────────────────────────────────────
    {
      operationId: "gdrive_read_file",
      name: "Read File",
      description: "Read text content of a file by ID. Exports Google Docs/Sheets/Slides to text.",
      requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["drive", "read", "file"],
      inputSchema: {
        type: "object",
        description: "Parameters for reading a file from Google Drive.",
        properties: {
          fileId: {
            type: "string",
            description: "The Google Drive file ID.",
          },
        },
        required: ["fileId"],
      },
      outputSchema: {
        type: "object",
        description: "File content and metadata.",
        properties: {
          id: { type: "string", description: "The file ID." },
          name: { type: "string", description: "The file name." },
          mimeType: { type: "string", description: "Original MIME type." },
          content: {
            type: "string",
            description: "Text content of the file. For Google Docs, exported as plain text; for spreadsheets, exported as CSV.",
          },
          size: { type: "string", description: "File size in bytes." },
          modifiedTime: { type: "string", description: "Last modified ISO 8601 timestamp." },
        },
      },
    },

    // ── gdrive_search ──────────────────────────────────────────────
    {
      operationId: "gdrive_search",
      name: "Search Files",
      description: "Full-text search across Google Drive files.",
      requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["drive", "search"],
      inputSchema: {
        type: "object",
        description: "Parameters for searching Google Drive.",
        properties: {
          query: {
            type: "string",
            description: "Full-text search query string.",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of results to return. Defaults to 10.",
            default: 10,
          },
          pageToken: {
            type: "string",
            description: "Token for fetching the next page of results.",
          },
        },
        required: ["query"],
      },
      outputSchema: {
        type: "object",
        description: "Search results.",
        properties: {
          files: {
            type: "array",
            description: "List of matching files.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "The file ID." },
                name: { type: "string", description: "The file name." },
                mimeType: { type: "string", description: "MIME type." },
                size: { type: "string", description: "File size in bytes." },
                modifiedTime: { type: "string", description: "Last modified ISO 8601 timestamp." },
                webViewLink: { type: "string", description: "URL to view in browser." },
                parents: {
                  type: "array",
                  items: { type: "string" },
                  description: "Parent folder IDs.",
                },
              },
            },
          },
          nextPageToken: {
            type: "string",
            description: "Token for the next page.",
          },
        },
      },
    },

    // ── gdrive_upload_file ─────────────────────────────────────────
    {
      operationId: "gdrive_upload_file",
      name: "Upload File",
      description: "Upload a text file to Google Drive, optionally into a specific folder.",
      requiredScopes: ["https://www.googleapis.com/auth/drive.file"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      tags: ["drive", "upload", "file"],
      inputSchema: {
        type: "object",
        description: "Parameters for uploading a file to Google Drive.",
        properties: {
          name: {
            type: "string",
            description: "Name for the file in Drive.",
          },
          content: {
            type: "string",
            description: "Text content to upload.",
          },
          mimeType: {
            type: "string",
            description: "MIME type of the content (e.g. 'text/plain', 'text/csv', 'application/json').",
          },
          folderId: {
            type: "string",
            description: "ID of the parent folder. Uploads to root if omitted. Optional.",
          },
        },
        required: ["name", "content", "mimeType"],
      },
      outputSchema: {
        type: "object",
        description: "Uploaded file metadata.",
        properties: {
          id: { type: "string", description: "The new file ID." },
          name: { type: "string", description: "The file name in Drive." },
          mimeType: { type: "string", description: "MIME type of the file." },
          webViewLink: { type: "string", description: "URL to view the file in browser." },
          size: { type: "string", description: "File size in bytes." },
        },
      },
    },
  ],
};
