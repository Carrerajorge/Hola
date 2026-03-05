/**
 * GitHub Connector Manifest
 *
 * Provides repository management, issue tracking, pull request listing,
 * file reading, and code search via the GitHub REST API v3.
 */

import type { ConnectorManifest } from "../../kernel/types";

export const githubManifest: ConnectorManifest = {
  connectorId: "github",
  version: "1.0.0",
  displayName: "GitHub",
  description: "Access GitHub repositories, issues, pull requests, and code search.",
  iconUrl: "/icons/connectors/github.svg",
  category: "dev",
  authType: "oauth2",
  authConfig: {
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user"],
    pkce: false,
    offlineAccess: false,
  },
  baseUrl: "https://api.github.com",
  rateLimit: {
    requestsPerMinute: 30,
    requestsPerHour: 1000,
  },
  requiredEnvVars: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  capabilities: [
    // ── github_list_repos ──────────────────────────────────────────
    {
      operationId: "github_list_repos",
      name: "List Repositories",
      description: "List repositories for the authenticated GitHub user with optional sorting and pagination.",
      requiredScopes: ["repo"],
      inputSchema: {
        type: "object",
        description: "Parameters for listing user repositories.",
        properties: {
          sort: {
            type: "string",
            description: "Sort field: created, updated, pushed, or full_name.",
            enum: ["created", "updated", "pushed", "full_name"],
          },
          per_page: {
            type: "integer",
            description: "Number of results per page (max 100).",
          },
          page: {
            type: "integer",
            description: "Page number for pagination.",
          },
        },
        required: [],
      },
      outputSchema: {
        type: "array",
        description: "List of repository objects.",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            full_name: { type: "string" },
            description: { type: "string" },
            html_url: { type: "string" },
            private: { type: "boolean" },
            language: { type: "string" },
            stargazers_count: { type: "integer" },
            updated_at: { type: "string" },
          },
        },
      },
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["repos", "list"],
    },

    // ── github_read_file ───────────────────────────────────────────
    {
      operationId: "github_read_file",
      name: "Read File",
      description: "Read and decode a file from a GitHub repository by path and optional ref (branch/tag/SHA).",
      requiredScopes: ["repo"],
      inputSchema: {
        type: "object",
        description: "Parameters for reading a file from a repository.",
        properties: {
          owner: {
            type: "string",
            description: "Repository owner (user or organization).",
          },
          repo: {
            type: "string",
            description: "Repository name.",
          },
          path: {
            type: "string",
            description: "File path relative to the repository root.",
          },
          ref: {
            type: "string",
            description: "Git ref (branch, tag, or commit SHA). Defaults to the default branch.",
          },
        },
        required: ["owner", "repo", "path"],
      },
      outputSchema: {
        type: "object",
        description: "File contents and metadata.",
        properties: {
          name: { type: "string" },
          path: { type: "string" },
          size: { type: "integer" },
          content: { type: "string", description: "Decoded UTF-8 file content." },
          sha: { type: "string" },
          html_url: { type: "string" },
        },
      },
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["file", "read", "code"],
    },

    // ── github_list_issues ─────────────────────────────────────────
    {
      operationId: "github_list_issues",
      name: "List Issues",
      description: "List issues for a GitHub repository with optional state and label filters.",
      requiredScopes: ["repo"],
      inputSchema: {
        type: "object",
        description: "Parameters for listing repository issues.",
        properties: {
          owner: {
            type: "string",
            description: "Repository owner (user or organization).",
          },
          repo: {
            type: "string",
            description: "Repository name.",
          },
          state: {
            type: "string",
            description: "Filter by issue state.",
            enum: ["open", "closed", "all"],
          },
          labels: {
            type: "string",
            description: "Comma-separated list of label names to filter by.",
          },
          per_page: {
            type: "integer",
            description: "Number of results per page (max 100).",
          },
        },
        required: ["owner", "repo"],
      },
      outputSchema: {
        type: "array",
        description: "List of issue objects.",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            number: { type: "integer" },
            title: { type: "string" },
            state: { type: "string" },
            html_url: { type: "string" },
            created_at: { type: "string" },
            updated_at: { type: "string" },
            labels: { type: "array", items: { type: "object" } },
          },
        },
      },
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["issues", "list"],
    },

    // ── github_create_issue ────────────────────────────────────────
    {
      operationId: "github_create_issue",
      name: "Create Issue",
      description: "Create a new issue in a GitHub repository. Requires user confirmation before execution.",
      requiredScopes: ["repo"],
      inputSchema: {
        type: "object",
        description: "Parameters for creating a new issue.",
        properties: {
          owner: {
            type: "string",
            description: "Repository owner (user or organization).",
          },
          repo: {
            type: "string",
            description: "Repository name.",
          },
          title: {
            type: "string",
            description: "Issue title.",
          },
          body: {
            type: "string",
            description: "Issue body in Markdown format.",
          },
          labels: {
            type: "array",
            description: "List of label names to apply to the issue.",
            items: { type: "string" },
          },
        },
        required: ["owner", "repo", "title"],
      },
      outputSchema: {
        type: "object",
        description: "Created issue object.",
        properties: {
          id: { type: "integer" },
          number: { type: "integer" },
          title: { type: "string" },
          html_url: { type: "string" },
          state: { type: "string" },
          created_at: { type: "string" },
        },
      },
      dataAccessLevel: "write",
      confirmationRequired: true,
      idempotent: false,
      tags: ["issues", "create"],
    },

    // ── github_list_prs ────────────────────────────────────────────
    {
      operationId: "github_list_prs",
      name: "List Pull Requests",
      description: "List pull requests for a GitHub repository with optional state filter and pagination.",
      requiredScopes: ["repo"],
      inputSchema: {
        type: "object",
        description: "Parameters for listing pull requests.",
        properties: {
          owner: {
            type: "string",
            description: "Repository owner (user or organization).",
          },
          repo: {
            type: "string",
            description: "Repository name.",
          },
          state: {
            type: "string",
            description: "Filter by pull request state.",
            enum: ["open", "closed", "all"],
          },
          per_page: {
            type: "integer",
            description: "Number of results per page (max 100).",
          },
        },
        required: ["owner", "repo"],
      },
      outputSchema: {
        type: "array",
        description: "List of pull request objects.",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            number: { type: "integer" },
            title: { type: "string" },
            state: { type: "string" },
            html_url: { type: "string" },
            created_at: { type: "string" },
            merged_at: { type: "string" },
            user: { type: "object" },
          },
        },
      },
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["pull-requests", "list"],
    },

    // ── github_search_code ─────────────────────────────────────────
    {
      operationId: "github_search_code",
      name: "Search Code",
      description: "Search for code across GitHub repositories using the GitHub code search API.",
      requiredScopes: ["repo"],
      inputSchema: {
        type: "object",
        description: "Parameters for searching code on GitHub.",
        properties: {
          query: {
            type: "string",
            description: "GitHub code search query (supports qualifiers like repo:, language:, path:).",
          },
          per_page: {
            type: "integer",
            description: "Number of results per page (max 100).",
          },
        },
        required: ["query"],
      },
      outputSchema: {
        type: "object",
        description: "Code search results.",
        properties: {
          total_count: { type: "integer" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                path: { type: "string" },
                repository: { type: "object" },
                html_url: { type: "string" },
                score: { type: "number" },
              },
            },
          },
        },
      },
      dataAccessLevel: "read",
      confirmationRequired: false,
      idempotent: true,
      tags: ["search", "code"],
    },
  ],
};
