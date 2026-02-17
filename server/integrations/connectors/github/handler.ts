/**
 * GitHub Connector Handler
 *
 * Executes GitHub REST API v3 operations using direct fetch.
 * Each operation maps to a ConnectorCapability declared in the manifest.
 */

import type { ConnectorHandlerFactory } from "../../kernel/connectorRegistry";
import type {
  ResolvedCredential,
  ConnectorOperationResult,
} from "../../kernel/types";

const BASE_URL = "https://api.github.com";

// ─── Helpers ───────────────────────────────────────────────────────

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "IliaGPT",
  };
}

function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

async function githubFetch(
  url: string,
  token: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<{ status: number; data: unknown; rateLimitRemaining?: number; rateLimitReset?: number }> {
  const opts: RequestInit = {
    method,
    headers: {
      ...headers(token),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };

  const res = await fetch(url, opts);
  const rateLimitRemaining = res.headers.get("x-ratelimit-remaining")
    ? Number(res.headers.get("x-ratelimit-remaining"))
    : undefined;
  const rateLimitReset = res.headers.get("x-ratelimit-reset")
    ? Number(res.headers.get("x-ratelimit-reset"))
    : undefined;

  let data: unknown;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, data, rateLimitRemaining, rateLimitReset };
}

function errorResult(
  code: string,
  message: string,
  statusCode: number,
  retryable: boolean,
  details?: unknown
): ConnectorOperationResult {
  return {
    success: false,
    error: { code, message, retryable, statusCode, details },
  };
}

// ─── Handler Factory ───────────────────────────────────────────────

export const githubHandler: ConnectorHandlerFactory = {
  async execute(
    operationId: string,
    input: Record<string, unknown>,
    credential: ResolvedCredential
  ): Promise<ConnectorOperationResult> {
    const token = credential.accessToken;
    const startTime = Date.now();

    try {
      switch (operationId) {
        // ── List Repos ───────────────────────────────────────────
        case "github_list_repos": {
          const query = qs({
            sort: input.sort,
            per_page: input.per_page,
            page: input.page,
          });
          const { status, data, rateLimitRemaining, rateLimitReset } =
            await githubFetch(`${BASE_URL}/user/repos${query}`, token);

          if (status !== 200) {
            return errorResult("GITHUB_API_ERROR", `GitHub API returned ${status}`, status, status >= 500, data);
          }
          return {
            success: true,
            data,
            metadata: {
              latencyMs: Date.now() - startTime,
              rateLimitRemaining,
              rateLimitReset,
            },
          };
        }

        // ── Read File ────────────────────────────────────────────
        case "github_read_file": {
          const { owner, repo, path: filePath, ref } = input as {
            owner: string;
            repo: string;
            path: string;
            ref?: string;
          };
          const query = qs({ ref });
          const { status, data, rateLimitRemaining, rateLimitReset } =
            await githubFetch(
              `${BASE_URL}/repos/${encodeURIComponent(String(owner))}/${encodeURIComponent(String(repo))}/contents/${filePath}${query}`,
              token
            );

          if (status !== 200) {
            return errorResult("GITHUB_API_ERROR", `GitHub API returned ${status}`, status, status >= 500, data);
          }

          // Decode base64 content
          const fileData = data as Record<string, unknown>;
          if (fileData.encoding === "base64" && typeof fileData.content === "string") {
            const raw = fileData.content as string;
            fileData.content = Buffer.from(raw.replace(/\n/g, ""), "base64").toString("utf-8");
            delete fileData.encoding;
          }

          return {
            success: true,
            data: fileData,
            metadata: {
              latencyMs: Date.now() - startTime,
              rateLimitRemaining,
              rateLimitReset,
            },
          };
        }

        // ── List Issues ──────────────────────────────────────────
        case "github_list_issues": {
          const { owner, repo, state, labels, per_page } = input as {
            owner: string;
            repo: string;
            state?: string;
            labels?: string;
            per_page?: number;
          };
          const query = qs({ state, labels, per_page });
          const { status, data, rateLimitRemaining, rateLimitReset } =
            await githubFetch(
              `${BASE_URL}/repos/${encodeURIComponent(String(owner))}/${encodeURIComponent(String(repo))}/issues${query}`,
              token
            );

          if (status !== 200) {
            return errorResult("GITHUB_API_ERROR", `GitHub API returned ${status}`, status, status >= 500, data);
          }
          return {
            success: true,
            data,
            metadata: {
              latencyMs: Date.now() - startTime,
              rateLimitRemaining,
              rateLimitReset,
            },
          };
        }

        // ── Create Issue ─────────────────────────────────────────
        case "github_create_issue": {
          const { owner, repo, title, body: issueBody, labels } = input as {
            owner: string;
            repo: string;
            title: string;
            body?: string;
            labels?: string[];
          };
          const payload: Record<string, unknown> = { title };
          if (issueBody !== undefined) payload.body = issueBody;
          if (labels !== undefined) payload.labels = labels;

          const { status, data, rateLimitRemaining, rateLimitReset } =
            await githubFetch(
              `${BASE_URL}/repos/${encodeURIComponent(String(owner))}/${encodeURIComponent(String(repo))}/issues`,
              token,
              "POST",
              payload
            );

          if (status !== 201) {
            return errorResult("GITHUB_API_ERROR", `GitHub API returned ${status}`, status, status >= 500, data);
          }
          return {
            success: true,
            data,
            metadata: {
              latencyMs: Date.now() - startTime,
              rateLimitRemaining,
              rateLimitReset,
            },
          };
        }

        // ── List Pull Requests ───────────────────────────────────
        case "github_list_prs": {
          const { owner, repo, state, per_page } = input as {
            owner: string;
            repo: string;
            state?: string;
            per_page?: number;
          };
          const query = qs({ state, per_page });
          const { status, data, rateLimitRemaining, rateLimitReset } =
            await githubFetch(
              `${BASE_URL}/repos/${encodeURIComponent(String(owner))}/${encodeURIComponent(String(repo))}/pulls${query}`,
              token
            );

          if (status !== 200) {
            return errorResult("GITHUB_API_ERROR", `GitHub API returned ${status}`, status, status >= 500, data);
          }
          return {
            success: true,
            data,
            metadata: {
              latencyMs: Date.now() - startTime,
              rateLimitRemaining,
              rateLimitReset,
            },
          };
        }

        // ── Search Code ──────────────────────────────────────────
        case "github_search_code": {
          const { query: searchQuery, per_page } = input as {
            query: string;
            per_page?: number;
          };
          const queryParams = qs({ q: searchQuery, per_page });
          const { status, data, rateLimitRemaining, rateLimitReset } =
            await githubFetch(`${BASE_URL}/search/code${queryParams}`, token);

          if (status !== 200) {
            return errorResult("GITHUB_API_ERROR", `GitHub API returned ${status}`, status, status >= 500, data);
          }
          return {
            success: true,
            data,
            metadata: {
              latencyMs: Date.now() - startTime,
              rateLimitRemaining,
              rateLimitReset,
            },
          };
        }

        default:
          return errorResult(
            "UNKNOWN_OPERATION",
            `Unknown GitHub operation: ${operationId}`,
            400,
            false
          );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult("GITHUB_FETCH_ERROR", message, 0, true);
    }
  },

  async healthCheck(credential?: ResolvedCredential) {
    const startTime = Date.now();
    try {
      if (!credential) {
        return { healthy: false, latencyMs: 0 };
      }
      const { status } = await githubFetch(`${BASE_URL}/user`, credential.accessToken);
      return {
        healthy: status === 200,
        latencyMs: Date.now() - startTime,
      };
    } catch {
      return { healthy: false, latencyMs: Date.now() - startTime };
    }
  },
};
