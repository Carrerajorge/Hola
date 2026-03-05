import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";
import type {
  ResolvedCredential,
  ConnectorOperationResult,
} from "../../kernel/types";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function notionHeaders(credential: ResolvedCredential): Record<string, string> {
  return {
    Authorization: `Bearer ${credential.accessToken}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionFetch(
  method: "GET" | "POST" | "PATCH",
  path: string,
  credential: ResolvedCredential,
  body?: Record<string, unknown>,
): Promise<ConnectorOperationResult> {
  const url = `${NOTION_API}${path}`;
  const init: RequestInit = {
    method,
    headers: notionHeaders(credential),
  };

  if (body && (method === "POST" || method === "PATCH")) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const data = await res.json();

  if (!res.ok) {
    return {
      success: false,
      error:
        data.message ?? data.code ?? `Notion API error (${res.status})`,
      data: undefined,
    };
  }

  return { success: true, data };
}

/**
 * Convert a plain text string into Notion block children (simple paragraphs).
 */
function textToBlocks(
  text: string,
): Array<Record<string, unknown>> {
  return text.split("\n").map((line) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: { content: line },
        },
      ],
    },
  }));
}

export const createNotionHandler: ConnectorHandlerFactory = () => {
  return {
    async execute(
      operationId: string,
      params: Record<string, unknown>,
      credential: ResolvedCredential,
    ): Promise<ConnectorOperationResult> {
      switch (operationId) {
        /* ── Search pages & databases ──────────────────────── */
        case "notion_search": {
          const body: Record<string, unknown> = {
            query: params.query ?? "",
          };
          if (params.filter) body.filter = params.filter;
          if (params.page_size !== undefined)
            body.page_size = params.page_size;

          return notionFetch("POST", "/search", credential, body);
        }

        /* ── Read page (properties + block children) ───────── */
        case "notion_read_page": {
          const pageId = String(params.pageId);

          const [pageResult, blocksResult] = await Promise.all([
            notionFetch("GET", `/pages/${pageId}`, credential),
            notionFetch(
              "GET",
              `/blocks/${pageId}/children?page_size=100`,
              credential,
            ),
          ]);

          if (!pageResult.success) return pageResult;
          if (!blocksResult.success) return blocksResult;

          return {
            success: true,
            data: {
              page: pageResult.data,
              blocks: (blocksResult.data as Record<string, unknown>).results,
            },
          };
        }

        /* ── Create a new page ─────────────────────────────── */
        case "notion_create_page": {
          const parentId = String(params.parent_id);
          const title = String(params.title);
          const content = params.content
            ? String(params.content)
            : undefined;

          /*
           * Notion parent can be either a page_id or a database_id.
           * We try page_id first; if the caller knows it's a database
           * the parent object will still work (Notion accepts either).
           */
          const body: Record<string, unknown> = {
            parent: { page_id: parentId },
            properties: {
              title: {
                title: [
                  {
                    type: "text",
                    text: { content: title },
                  },
                ],
              },
            },
          };

          if (content) {
            body.children = textToBlocks(content);
          }

          const result = await notionFetch(
            "POST",
            "/pages",
            credential,
            body,
          );

          /* If page_id parent fails, retry as database parent */
          if (
            !result.success &&
            typeof result.error === "string" &&
            result.error.includes("validation_error")
          ) {
            (body.parent as Record<string, unknown>) = {
              database_id: parentId,
            };
            return notionFetch("POST", "/pages", credential, body);
          }

          return result;
        }

        /* ── Query a database ──────────────────────────────── */
        case "notion_query_database": {
          const dbId = String(params.database_id);
          const body: Record<string, unknown> = {};

          if (params.filter) body.filter = params.filter;
          if (params.sorts) body.sorts = params.sorts;
          if (params.page_size !== undefined)
            body.page_size = params.page_size;

          return notionFetch(
            "POST",
            `/databases/${dbId}/query`,
            credential,
            body,
          );
        }

        /* ── List databases ────────────────────────────────── */
        case "notion_list_databases": {
          const body: Record<string, unknown> = {
            filter: { property: "object", value: "database" },
          };
          if (params.page_size !== undefined)
            body.page_size = params.page_size;

          return notionFetch("POST", "/search", credential, body);
        }

        default:
          return {
            success: false,
            error: `Unknown Notion operation: ${operationId}`,
            data: undefined,
          };
      }
    },
  };
};
