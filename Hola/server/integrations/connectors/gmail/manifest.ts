/**
 * Gmail Connector Manifest
 *
 * Declares authentication, rate limits, and all capabilities (LLM tools)
 * for the Gmail integration.  Each capability maps 1-to-1 to a Gemini
 * FunctionDeclaration via ConnectorRegistry.
 */

import type { ConnectorManifest } from "../../kernel/types";

export const manifest: ConnectorManifest = {
  connectorId: "gmail",
  version: "1.0.0",
  displayName: "Gmail",
  description: "Read, send, search, and draft emails through Gmail.",
  iconUrl: "/icons/connectors/gmail.svg",
  category: "email",

  authType: "oauth2",
  providerId: "google",
  authConfig: {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
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
    // ── gmail_list_emails ──────────────────────────────────────────
    {
      operationId: "gmail_list_emails",
      name: "List Emails",
      description: "List recent emails from the inbox with optional query filter and pagination.",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["email", "list", "inbox"],
      inputSchema: {
        type: "object",
        description: "Parameters for listing inbox emails.",
        properties: {
          query: {
            type: "string",
            description: "Gmail search query (e.g. 'from:alice subject:meeting'). Optional.",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of emails to return. Defaults to 10.",
            default: 10,
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
        description: "A page of email summaries.",
        properties: {
          emails: {
            type: "array",
            description: "List of email summaries.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "The email message ID." },
                threadId: { type: "string", description: "The thread ID." },
                snippet: { type: "string", description: "Short preview of the email body." },
                from: { type: "string", description: "Sender address." },
                to: { type: "string", description: "Recipient address." },
                subject: { type: "string", description: "Email subject line." },
                date: { type: "string", description: "ISO 8601 date string." },
                labelIds: {
                  type: "array",
                  items: { type: "string" },
                  description: "Gmail label IDs applied to this message.",
                },
              },
            },
          },
          nextPageToken: {
            type: "string",
            description: "Token for the next page, if more results exist.",
          },
          resultSizeEstimate: {
            type: "number",
            description: "Estimated total number of matching messages.",
          },
        },
      },
    },

    // ── gmail_read_email ───────────────────────────────────────────
    {
      operationId: "gmail_read_email",
      name: "Read Email",
      description: "Read the full content of a single email by its message ID.",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["email", "read"],
      inputSchema: {
        type: "object",
        description: "Parameters for reading a single email.",
        properties: {
          emailId: {
            type: "string",
            description: "The Gmail message ID to read.",
          },
        },
        required: ["emailId"],
      },
      outputSchema: {
        type: "object",
        description: "Full email content.",
        properties: {
          id: { type: "string", description: "The email message ID." },
          threadId: { type: "string", description: "The thread ID." },
          from: { type: "string", description: "Sender address." },
          to: { type: "string", description: "Recipient address(es)." },
          cc: { type: "string", description: "CC recipients." },
          bcc: { type: "string", description: "BCC recipients." },
          subject: { type: "string", description: "Email subject line." },
          date: { type: "string", description: "ISO 8601 date string." },
          body: { type: "string", description: "Plain-text body of the email." },
          htmlBody: { type: "string", description: "HTML body of the email, if available." },
          labelIds: {
            type: "array",
            items: { type: "string" },
            description: "Gmail label IDs.",
          },
          attachments: {
            type: "array",
            description: "List of attachment metadata.",
            items: {
              type: "object",
              properties: {
                filename: { type: "string", description: "Attachment filename." },
                mimeType: { type: "string", description: "MIME type." },
                size: { type: "number", description: "Size in bytes." },
                attachmentId: { type: "string", description: "Attachment ID for downloading." },
              },
            },
          },
        },
      },
    },

    // ── gmail_send_email ───────────────────────────────────────────
    {
      operationId: "gmail_send_email",
      name: "Send Email",
      description: "Send an email on behalf of the authenticated user.",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.send"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      tags: ["email", "send"],
      inputSchema: {
        type: "object",
        description: "Parameters for sending an email.",
        properties: {
          to: {
            type: "string",
            description: "Recipient email address.",
          },
          subject: {
            type: "string",
            description: "Email subject line.",
          },
          body: {
            type: "string",
            description: "Plain-text body of the email.",
          },
          cc: {
            type: "string",
            description: "CC recipient email addresses, comma-separated. Optional.",
          },
          bcc: {
            type: "string",
            description: "BCC recipient email addresses, comma-separated. Optional.",
          },
        },
        required: ["to", "subject", "body"],
      },
      outputSchema: {
        type: "object",
        description: "Result of sending the email.",
        properties: {
          id: { type: "string", description: "The sent message ID." },
          threadId: { type: "string", description: "The thread ID of the sent message." },
          labelIds: {
            type: "array",
            items: { type: "string" },
            description: "Labels applied to the sent message.",
          },
        },
      },
    },

    // ── gmail_search_emails ────────────────────────────────────────
    {
      operationId: "gmail_search_emails",
      name: "Search Emails",
      description: "Search emails using a Gmail query string (supports full Gmail search syntax).",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["email", "search"],
      inputSchema: {
        type: "object",
        description: "Parameters for searching emails.",
        properties: {
          query: {
            type: "string",
            description: "Gmail search query (e.g. 'has:attachment from:bob after:2025/01/01').",
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
          emails: {
            type: "array",
            description: "List of matching email summaries.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "The email message ID." },
                threadId: { type: "string", description: "The thread ID." },
                snippet: { type: "string", description: "Short preview of the email body." },
                from: { type: "string", description: "Sender address." },
                to: { type: "string", description: "Recipient address." },
                subject: { type: "string", description: "Email subject line." },
                date: { type: "string", description: "ISO 8601 date string." },
                labelIds: {
                  type: "array",
                  items: { type: "string" },
                  description: "Gmail label IDs.",
                },
              },
            },
          },
          nextPageToken: {
            type: "string",
            description: "Token for the next page.",
          },
          resultSizeEstimate: {
            type: "number",
            description: "Estimated total results.",
          },
        },
      },
    },

    // ── gmail_create_draft ─────────────────────────────────────────
    {
      operationId: "gmail_create_draft",
      name: "Create Draft",
      description: "Create a draft email without sending it.",
      requiredScopes: ["https://www.googleapis.com/auth/gmail.modify"],
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      tags: ["email", "draft"],
      inputSchema: {
        type: "object",
        description: "Parameters for creating an email draft.",
        properties: {
          to: {
            type: "string",
            description: "Recipient email address.",
          },
          subject: {
            type: "string",
            description: "Email subject line.",
          },
          body: {
            type: "string",
            description: "Plain-text body of the draft.",
          },
        },
        required: ["to", "subject", "body"],
      },
      outputSchema: {
        type: "object",
        description: "Created draft metadata.",
        properties: {
          id: { type: "string", description: "The draft ID." },
          messageId: { type: "string", description: "The underlying message ID." },
          threadId: { type: "string", description: "The thread ID." },
        },
      },
    },
  ],
};
