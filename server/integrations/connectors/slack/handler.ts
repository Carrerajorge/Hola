import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";
import type {
  ResolvedCredential,
  ConnectorOperationResult,
} from "../../kernel/types";

const SLACK_API = "https://slack.com/api";

async function slackFetch(
  method: "GET" | "POST",
  endpoint: string,
  credential: ResolvedCredential,
  body?: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<ConnectorOperationResult> {
  const url = new URL(`${SLACK_API}/${endpoint}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.accessToken}`,
  };

  const init: RequestInit = { method, headers };

  if (method === "POST" && body) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), init);
  const data = await res.json();

  if (!res.ok || data.ok === false) {
    return {
      success: false,
      error: data.error ?? `Slack API error (${res.status})`,
      data: undefined,
    };
  }

  return { success: true, data };
}

export const createSlackHandler: ConnectorHandlerFactory = () => {
  return {
    async execute(
      operationId: string,
      params: Record<string, unknown>,
      credential: ResolvedCredential,
    ): Promise<ConnectorOperationResult> {
      switch (operationId) {
        /* ── Post a message ────────────────────────────────── */
        case "slack_post_message": {
          const body: Record<string, unknown> = {
            channel: params.channel,
            text: params.text,
          };
          if (params.thread_ts) body.thread_ts = params.thread_ts;

          return slackFetch("POST", "chat.postMessage", credential, body);
        }

        /* ── List channels ─────────────────────────────────── */
        case "slack_list_channels": {
          const query: Record<string, string> = {};
          if (params.limit !== undefined)
            query.limit = String(params.limit);
          if (params.cursor) query.cursor = String(params.cursor);

          return slackFetch("GET", "conversations.list", credential, undefined, query);
        }

        /* ── Read channel history ──────────────────────────── */
        case "slack_read_messages": {
          const query: Record<string, string> = {
            channel: String(params.channel),
          };
          if (params.limit !== undefined)
            query.limit = String(params.limit);
          if (params.oldest) query.oldest = String(params.oldest);
          if (params.latest) query.latest = String(params.latest);

          return slackFetch(
            "GET",
            "conversations.history",
            credential,
            undefined,
            query,
          );
        }

        /* ── Search messages ───────────────────────────────── */
        case "slack_search_messages": {
          const query: Record<string, string> = {
            query: String(params.query),
          };
          if (params.count !== undefined)
            query.count = String(params.count);

          return slackFetch(
            "GET",
            "search.messages",
            credential,
            undefined,
            query,
          );
        }

        default:
          return {
            success: false,
            error: `Unknown Slack operation: ${operationId}`,
            data: undefined,
          };
      }
    },
  };
};
