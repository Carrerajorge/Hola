/**
 * Gmail Connector Handler
 *
 * Implements execute() and healthCheck() for every capability declared
 * in the Gmail manifest.  Uses the official googleapis library.
 */

import { google } from "googleapis";
import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";
import type {
  ResolvedCredential,
  ConnectorOperationResult,
} from "../../kernel/types";

// ─── Helpers ────────────────────────────────────────────────────────

/** Build an authenticated Gmail client from a resolved credential. */
function buildGmailClient(credential: ResolvedCredential) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: credential.accessToken });
  return google.gmail({ version: "v1", auth });
}

/** Extract a header value from a Gmail message payload. */
function getHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined | null,
  name: string
): string {
  if (!headers) return "";
  const header = headers.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value ?? "";
}

/** Decode a base64url-encoded string. */
function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

/** Walk MIME parts to find the body with the preferred MIME type. */
function findBody(
  payload: any,
  mimeType: string
): string {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = findBody(part, mimeType);
      if (found) return found;
    }
  }
  return "";
}

/** Extract attachment metadata from a Gmail message payload. */
function extractAttachments(payload: any): Array<{
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}> {
  const attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    attachmentId: string;
  }> = [];

  function walk(part: any) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId,
      });
    }
    if (part.parts) {
      for (const child of part.parts) walk(child);
    }
  }

  walk(payload);
  return attachments;
}

/** Build an RFC 2822 raw message encoded as base64url. */
function buildRawMessage(params: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}): string {
  const lines: string[] = [];
  lines.push(`To: ${params.to}`);
  if (params.cc) lines.push(`Cc: ${params.cc}`);
  if (params.bcc) lines.push(`Bcc: ${params.bcc}`);
  lines.push(`Subject: ${params.subject}`);
  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("MIME-Version: 1.0");
  lines.push("");
  lines.push(params.body);

  const raw = lines.join("\r\n");
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Fetch a single message and return a summary object. */
async function fetchMessageSummary(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string
) {
  const msg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "To", "Subject", "Date"],
  });

  const headers = msg.data.payload?.headers;

  return {
    id: msg.data.id ?? messageId,
    threadId: msg.data.threadId ?? "",
    snippet: msg.data.snippet ?? "",
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    date: getHeader(headers, "Date"),
    labelIds: msg.data.labelIds ?? [],
  };
}

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
    const gmail = buildGmailClient(credential);

    try {
      switch (operationId) {
        // ── List Emails ──────────────────────────────────────────
        case "gmail_list_emails": {
          const query = (input.query as string) || undefined;
          const maxResults = (input.maxResults as number) || 10;
          const pageToken = (input.pageToken as string) || undefined;

          const listRes = await gmail.users.messages.list({
            userId: "me",
            q: query,
            maxResults,
            pageToken,
          });

          const messages = listRes.data.messages ?? [];
          const emails = await Promise.all(
            messages.map((m) => fetchMessageSummary(gmail, m.id!))
          );

          return ok({
            emails,
            nextPageToken: listRes.data.nextPageToken ?? null,
            resultSizeEstimate: listRes.data.resultSizeEstimate ?? 0,
          });
        }

        // ── Read Email ───────────────────────────────────────────
        case "gmail_read_email": {
          const emailId = input.emailId as string;
          if (!emailId) {
            return fail("INVALID_INPUT", "emailId is required.", false);
          }

          const msg = await gmail.users.messages.get({
            userId: "me",
            id: emailId,
            format: "full",
          });

          const payload = msg.data.payload;
          const headers = payload?.headers;

          const textBody = findBody(payload, "text/plain");
          const htmlBody = findBody(payload, "text/html");
          const attachments = extractAttachments(payload);

          return ok({
            id: msg.data.id,
            threadId: msg.data.threadId,
            from: getHeader(headers, "From"),
            to: getHeader(headers, "To"),
            cc: getHeader(headers, "Cc"),
            bcc: getHeader(headers, "Bcc"),
            subject: getHeader(headers, "Subject"),
            date: getHeader(headers, "Date"),
            body: textBody,
            htmlBody: htmlBody || null,
            labelIds: msg.data.labelIds ?? [],
            attachments,
          });
        }

        // ── Send Email ───────────────────────────────────────────
        case "gmail_send_email": {
          const to = input.to as string;
          const subject = input.subject as string;
          const body = input.body as string;

          if (!to || !subject || !body) {
            return fail(
              "INVALID_INPUT",
              "to, subject, and body are required.",
              false
            );
          }

          const raw = buildRawMessage({
            to,
            subject,
            body,
            cc: (input.cc as string) || undefined,
            bcc: (input.bcc as string) || undefined,
          });

          const sendRes = await gmail.users.messages.send({
            userId: "me",
            requestBody: { raw },
          });

          return ok({
            id: sendRes.data.id,
            threadId: sendRes.data.threadId,
            labelIds: sendRes.data.labelIds ?? [],
          });
        }

        // ── Search Emails ────────────────────────────────────────
        case "gmail_search_emails": {
          const query = input.query as string;
          if (!query) {
            return fail("INVALID_INPUT", "query is required.", false);
          }

          const maxResults = (input.maxResults as number) || 10;
          const pageToken = (input.pageToken as string) || undefined;

          const listRes = await gmail.users.messages.list({
            userId: "me",
            q: query,
            maxResults,
            pageToken,
          });

          const messages = listRes.data.messages ?? [];
          const emails = await Promise.all(
            messages.map((m) => fetchMessageSummary(gmail, m.id!))
          );

          return ok({
            emails,
            nextPageToken: listRes.data.nextPageToken ?? null,
            resultSizeEstimate: listRes.data.resultSizeEstimate ?? 0,
          });
        }

        // ── Create Draft ─────────────────────────────────────────
        case "gmail_create_draft": {
          const to = input.to as string;
          const subject = input.subject as string;
          const body = input.body as string;

          if (!to || !subject || !body) {
            return fail(
              "INVALID_INPUT",
              "to, subject, and body are required.",
              false
            );
          }

          const raw = buildRawMessage({ to, subject, body });

          const draftRes = await gmail.users.drafts.create({
            userId: "me",
            requestBody: {
              message: { raw },
            },
          });

          return ok({
            id: draftRes.data.id,
            messageId: draftRes.data.message?.id ?? null,
            threadId: draftRes.data.message?.threadId ?? null,
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

      return fail("GMAIL_API_ERROR", message, retryable, statusCode);
    }
  },

  async healthCheck(credential?: ResolvedCredential) {
    const start = Date.now();
    if (!credential) {
      return { healthy: false, latencyMs: 0 };
    }
    try {
      const gmail = buildGmailClient(credential);
      await gmail.users.getProfile({ userId: "me" });
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  },
};
