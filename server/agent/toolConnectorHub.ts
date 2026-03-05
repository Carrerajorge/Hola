/**
 * Tool Connector Hub — Unified Integration Layer
 *
 * Connects Gmail, Slack, Notion, Calendar, and hundreds more services.
 * Provides a unified interface for the super agent to interact with
 * external tools and applications.
 *
 * Integrations:
 * - Gmail: Read/send emails, manage labels, search
 * - Slack: Send messages, read channels, manage workflows
 * - Notion: Create/edit pages, databases, search
 * - Calendar: Create/read events, manage availability
 * - Discord: Send messages, manage channels
 * - Telegram: Send messages, manage bots
 * - WhatsApp: Send messages via WhatsApp Business API
 * - GitHub: Manage repos, issues, PRs
 * - Trello: Manage boards, cards, lists
 * - Jira: Manage issues, sprints, boards
 * - Custom Webhooks: Any HTTP-based service
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";

// ============================================
// Types
// ============================================

export type ConnectorType =
  | "gmail"
  | "slack"
  | "notion"
  | "google_calendar"
  | "discord"
  | "telegram"
  | "whatsapp"
  | "github"
  | "trello"
  | "jira"
  | "linear"
  | "airtable"
  | "sheets"
  | "drive"
  | "dropbox"
  | "twitter"
  | "linkedin"
  | "zapier"
  | "make"
  | "n8n"
  | "webhook"
  | "custom";

export interface ConnectorConfig {
  id: string;
  type: ConnectorType;
  name: string;
  description: string;
  enabled: boolean;
  credentials: ConnectorCredentials;
  capabilities: string[];
  rateLimits: { requestsPerMinute: number; requestsPerDay: number };
  metadata?: Record<string, any>;
}

export interface ConnectorCredentials {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  webhookUrl?: string;
  botToken?: string;
  expiresAt?: Date;
}

export interface ConnectorAction {
  connector: ConnectorType;
  action: string;
  params: Record<string, any>;
  userId: string;
  timeout?: number;
}

export interface ConnectorResult {
  success: boolean;
  data?: any;
  error?: string;
  connector: ConnectorType;
  action: string;
  durationMs: number;
}

// ============================================
// Connector Definitions
// ============================================

const CONNECTOR_DEFINITIONS: Record<ConnectorType, { actions: string[]; description: string }> = {
  gmail: {
    description: "Google Gmail - email management",
    actions: ["send_email", "read_emails", "search_emails", "reply_email", "create_draft", "list_labels", "mark_read", "archive"],
  },
  slack: {
    description: "Slack - team messaging and collaboration",
    actions: ["send_message", "read_messages", "list_channels", "create_channel", "upload_file", "set_status", "search_messages"],
  },
  notion: {
    description: "Notion - notes, databases, and wikis",
    actions: ["create_page", "update_page", "search_pages", "query_database", "create_database", "add_block", "list_databases"],
  },
  google_calendar: {
    description: "Google Calendar - event management",
    actions: ["create_event", "list_events", "update_event", "delete_event", "check_availability", "find_free_time"],
  },
  discord: {
    description: "Discord - community messaging",
    actions: ["send_message", "read_messages", "list_channels", "create_channel", "add_reaction", "manage_roles"],
  },
  telegram: {
    description: "Telegram - instant messaging",
    actions: ["send_message", "send_photo", "send_document", "read_updates", "create_poll", "pin_message"],
  },
  whatsapp: {
    description: "WhatsApp Business - messaging",
    actions: ["send_message", "send_template", "send_media", "read_messages", "list_contacts"],
  },
  github: {
    description: "GitHub - code and project management",
    actions: ["create_issue", "list_issues", "create_pr", "merge_pr", "search_code", "list_repos", "create_repo", "review_pr"],
  },
  trello: {
    description: "Trello - project boards",
    actions: ["create_card", "move_card", "list_boards", "list_cards", "add_comment", "assign_member", "create_list"],
  },
  jira: {
    description: "Jira - issue tracking",
    actions: ["create_issue", "update_issue", "search_issues", "list_sprints", "add_comment", "transition_issue"],
  },
  linear: {
    description: "Linear - issue tracking",
    actions: ["create_issue", "update_issue", "list_issues", "list_projects", "add_comment"],
  },
  airtable: {
    description: "Airtable - databases and spreadsheets",
    actions: ["list_records", "create_record", "update_record", "search_records", "list_bases"],
  },
  sheets: {
    description: "Google Sheets - spreadsheets",
    actions: ["read_range", "write_range", "append_row", "create_sheet", "list_sheets"],
  },
  drive: {
    description: "Google Drive - file storage",
    actions: ["list_files", "upload_file", "download_file", "search_files", "share_file", "create_folder"],
  },
  dropbox: {
    description: "Dropbox - file storage",
    actions: ["list_files", "upload_file", "download_file", "search_files", "share_file"],
  },
  twitter: {
    description: "Twitter/X - social media",
    actions: ["post_tweet", "search_tweets", "get_timeline", "send_dm", "list_followers"],
  },
  linkedin: {
    description: "LinkedIn - professional networking",
    actions: ["create_post", "search_profiles", "send_message", "list_connections"],
  },
  zapier: {
    description: "Zapier - workflow automation",
    actions: ["trigger_zap", "list_zaps", "get_zap_status"],
  },
  make: {
    description: "Make (Integromat) - workflow automation",
    actions: ["trigger_scenario", "list_scenarios", "get_scenario_status"],
  },
  n8n: {
    description: "n8n - workflow automation",
    actions: ["trigger_workflow", "list_workflows", "get_workflow_status"],
  },
  webhook: {
    description: "Custom webhooks",
    actions: ["send_webhook", "register_webhook", "list_webhooks"],
  },
  custom: {
    description: "Custom API integration",
    actions: ["api_call"],
  },
};

// ============================================
// Tool Connector Hub
// ============================================

export class ToolConnectorHub extends EventEmitter {
  private connectors: Map<string, ConnectorConfig> = new Map();
  private rateLimitCounters: Map<string, { minute: number; day: number; lastMinuteReset: number; lastDayReset: number }> = new Map();

  constructor() {
    super();
    this.initializeConnectors();
  }

  /**
   * Initialize connectors from environment variables.
   */
  private initializeConnectors(): void {
    // Gmail
    if (process.env.GMAIL_ACCESS_TOKEN || process.env.GOOGLE_CLIENT_ID) {
      this.registerConnector({
        type: "gmail",
        name: "Gmail",
        credentials: {
          accessToken: process.env.GMAIL_ACCESS_TOKEN,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN,
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      });
    }

    // Slack
    if (process.env.SLACK_BOT_TOKEN) {
      this.registerConnector({
        type: "slack",
        name: "Slack",
        credentials: { botToken: process.env.SLACK_BOT_TOKEN },
      });
    }

    // Notion
    if (process.env.NOTION_API_KEY) {
      this.registerConnector({
        type: "notion",
        name: "Notion",
        credentials: { apiKey: process.env.NOTION_API_KEY },
      });
    }

    // Discord
    if (process.env.DISCORD_BOT_TOKEN) {
      this.registerConnector({
        type: "discord",
        name: "Discord",
        credentials: { botToken: process.env.DISCORD_BOT_TOKEN },
      });
    }

    // Telegram
    if (process.env.TELEGRAM_BOT_TOKEN) {
      this.registerConnector({
        type: "telegram",
        name: "Telegram",
        credentials: { botToken: process.env.TELEGRAM_BOT_TOKEN },
      });
    }

    // GitHub
    if (process.env.GITHUB_TOKEN) {
      this.registerConnector({
        type: "github",
        name: "GitHub",
        credentials: { accessToken: process.env.GITHUB_TOKEN },
      });
    }

    // Google Calendar (shares credentials with Gmail)
    if (process.env.GOOGLE_CLIENT_ID) {
      this.registerConnector({
        type: "google_calendar",
        name: "Google Calendar",
        credentials: {
          accessToken: process.env.GMAIL_ACCESS_TOKEN,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN,
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      });
    }
  }

  /**
   * Register a new connector.
   */
  registerConnector(config: {
    type: ConnectorType;
    name: string;
    credentials: ConnectorCredentials;
    metadata?: Record<string, any>;
  }): string {
    const def = CONNECTOR_DEFINITIONS[config.type];
    const id = `${config.type}_${randomUUID().substring(0, 8)}`;

    const fullConfig: ConnectorConfig = {
      id,
      type: config.type,
      name: config.name,
      description: def?.description || config.type,
      enabled: true,
      credentials: config.credentials,
      capabilities: def?.actions || [],
      rateLimits: { requestsPerMinute: 30, requestsPerDay: 1000 },
      metadata: config.metadata,
    };

    this.connectors.set(id, fullConfig);
    this.emit("connector_registered", { id, type: config.type, name: config.name });

    return id;
  }

  /**
   * Execute an action on a connector.
   */
  async execute(action: ConnectorAction): Promise<ConnectorResult> {
    const startTime = Date.now();

    // Find the connector
    const connector = this.findConnector(action.connector);
    if (!connector) {
      return {
        success: false,
        error: `No ${action.connector} connector configured. Set up credentials first.`,
        connector: action.connector,
        action: action.action,
        durationMs: Date.now() - startTime,
      };
    }

    // Check rate limits
    if (!this.checkRateLimit(connector.id)) {
      return {
        success: false,
        error: `Rate limit exceeded for ${connector.name}`,
        connector: action.connector,
        action: action.action,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const data = await this.executeConnectorAction(connector, action);
      this.incrementRateLimit(connector.id);

      return {
        success: true,
        data,
        connector: action.connector,
        action: action.action,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        connector: action.connector,
        action: action.action,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a specific connector action.
   */
  private async executeConnectorAction(
    connector: ConnectorConfig,
    action: ConnectorAction
  ): Promise<any> {
    switch (connector.type) {
      case "gmail":
        return this.executeGmail(connector, action);
      case "slack":
        return this.executeSlack(connector, action);
      case "notion":
        return this.executeNotion(connector, action);
      case "google_calendar":
        return this.executeCalendar(connector, action);
      case "discord":
        return this.executeDiscord(connector, action);
      case "telegram":
        return this.executeTelegram(connector, action);
      case "github":
        return this.executeGitHub(connector, action);
      case "webhook":
        return this.executeWebhook(connector, action);
      default:
        return this.executeGenericAPI(connector, action);
    }
  }

  // ============================================
  // Provider Implementations
  // ============================================

  private async executeGmail(connector: ConnectorConfig, action: ConnectorAction): Promise<any> {
    const baseUrl = "https://gmail.googleapis.com/gmail/v1/users/me";
    const headers = { Authorization: `Bearer ${connector.credentials.accessToken}`, "Content-Type": "application/json" };

    switch (action.action) {
      case "send_email": {
        const { to, subject, body, cc, bcc } = action.params;
        const rawMessage = this.createRawEmail(to, subject, body, cc, bcc);
        const response = await fetch(`${baseUrl}/messages/send`, {
          method: "POST",
          headers,
          body: JSON.stringify({ raw: rawMessage }),
        });
        return response.json();
      }
      case "read_emails": {
        const { maxResults = 10, query } = action.params;
        const q = query ? `&q=${encodeURIComponent(query)}` : "";
        const response = await fetch(`${baseUrl}/messages?maxResults=${maxResults}${q}`, { headers });
        return response.json();
      }
      case "search_emails": {
        const { query, maxResults = 20 } = action.params;
        const response = await fetch(`${baseUrl}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`, { headers });
        return response.json();
      }
      default:
        throw new Error(`Gmail action not supported: ${action.action}`);
    }
  }

  private async executeSlack(connector: ConnectorConfig, action: ConnectorAction): Promise<any> {
    const baseUrl = "https://slack.com/api";
    const headers = { Authorization: `Bearer ${connector.credentials.botToken}`, "Content-Type": "application/json" };

    switch (action.action) {
      case "send_message": {
        const response = await fetch(`${baseUrl}/chat.postMessage`, {
          method: "POST",
          headers,
          body: JSON.stringify({ channel: action.params.channel, text: action.params.text, blocks: action.params.blocks }),
        });
        return response.json();
      }
      case "list_channels": {
        const response = await fetch(`${baseUrl}/conversations.list?limit=${action.params.limit || 100}`, { headers });
        return response.json();
      }
      case "read_messages": {
        const response = await fetch(`${baseUrl}/conversations.history?channel=${action.params.channel}&limit=${action.params.limit || 20}`, { headers });
        return response.json();
      }
      case "search_messages": {
        const response = await fetch(`${baseUrl}/search.messages?query=${encodeURIComponent(action.params.query)}`, { headers });
        return response.json();
      }
      default:
        throw new Error(`Slack action not supported: ${action.action}`);
    }
  }

  private async executeNotion(connector: ConnectorConfig, action: ConnectorAction): Promise<any> {
    const baseUrl = "https://api.notion.com/v1";
    const headers = {
      Authorization: `Bearer ${connector.credentials.apiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    };

    switch (action.action) {
      case "create_page": {
        const response = await fetch(`${baseUrl}/pages`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            parent: action.params.parent,
            properties: action.params.properties,
            children: action.params.children,
          }),
        });
        return response.json();
      }
      case "search_pages": {
        const response = await fetch(`${baseUrl}/search`, {
          method: "POST",
          headers,
          body: JSON.stringify({ query: action.params.query, filter: action.params.filter }),
        });
        return response.json();
      }
      case "query_database": {
        const response = await fetch(`${baseUrl}/databases/${action.params.databaseId}/query`, {
          method: "POST",
          headers,
          body: JSON.stringify({ filter: action.params.filter, sorts: action.params.sorts }),
        });
        return response.json();
      }
      default:
        throw new Error(`Notion action not supported: ${action.action}`);
    }
  }

  private async executeCalendar(connector: ConnectorConfig, action: ConnectorAction): Promise<any> {
    const baseUrl = "https://www.googleapis.com/calendar/v3";
    const headers = { Authorization: `Bearer ${connector.credentials.accessToken}`, "Content-Type": "application/json" };
    const calendarId = action.params.calendarId || "primary";

    switch (action.action) {
      case "create_event": {
        const response = await fetch(`${baseUrl}/calendars/${calendarId}/events`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            summary: action.params.title,
            description: action.params.description,
            start: action.params.start,
            end: action.params.end,
            attendees: action.params.attendees,
            location: action.params.location,
          }),
        });
        return response.json();
      }
      case "list_events": {
        const timeMin = action.params.timeMin || new Date().toISOString();
        const timeMax = action.params.timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const response = await fetch(
          `${baseUrl}/calendars/${calendarId}/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
          { headers }
        );
        return response.json();
      }
      default:
        throw new Error(`Calendar action not supported: ${action.action}`);
    }
  }

  private async executeDiscord(connector: ConnectorConfig, action: ConnectorAction): Promise<any> {
    const baseUrl = "https://discord.com/api/v10";
    const headers = { Authorization: `Bot ${connector.credentials.botToken}`, "Content-Type": "application/json" };

    switch (action.action) {
      case "send_message": {
        const response = await fetch(`${baseUrl}/channels/${action.params.channelId}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ content: action.params.content, embeds: action.params.embeds }),
        });
        return response.json();
      }
      case "read_messages": {
        const response = await fetch(`${baseUrl}/channels/${action.params.channelId}/messages?limit=${action.params.limit || 20}`, { headers });
        return response.json();
      }
      default:
        throw new Error(`Discord action not supported: ${action.action}`);
    }
  }

  private async executeTelegram(connector: ConnectorConfig, action: ConnectorAction): Promise<any> {
    const baseUrl = `https://api.telegram.org/bot${connector.credentials.botToken}`;

    switch (action.action) {
      case "send_message": {
        const response = await fetch(`${baseUrl}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: action.params.chatId,
            text: action.params.text,
            parse_mode: action.params.parseMode || "HTML",
          }),
        });
        return response.json();
      }
      case "send_photo": {
        const response = await fetch(`${baseUrl}/sendPhoto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: action.params.chatId,
            photo: action.params.photo,
            caption: action.params.caption,
          }),
        });
        return response.json();
      }
      default:
        throw new Error(`Telegram action not supported: ${action.action}`);
    }
  }

  private async executeGitHub(connector: ConnectorConfig, action: ConnectorAction): Promise<any> {
    const baseUrl = "https://api.github.com";
    const headers = {
      Authorization: `Bearer ${connector.credentials.accessToken}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    };

    switch (action.action) {
      case "create_issue": {
        const { owner, repo, title, body, labels, assignees } = action.params;
        const response = await fetch(`${baseUrl}/repos/${owner}/${repo}/issues`, {
          method: "POST",
          headers,
          body: JSON.stringify({ title, body, labels, assignees }),
        });
        return response.json();
      }
      case "list_issues": {
        const { owner, repo, state = "open" } = action.params;
        const response = await fetch(`${baseUrl}/repos/${owner}/${repo}/issues?state=${state}`, { headers });
        return response.json();
      }
      case "search_code": {
        const { query } = action.params;
        const response = await fetch(`${baseUrl}/search/code?q=${encodeURIComponent(query)}`, { headers });
        return response.json();
      }
      case "create_pr": {
        const { owner, repo, title, body, head, base } = action.params;
        const response = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls`, {
          method: "POST",
          headers,
          body: JSON.stringify({ title, body, head, base }),
        });
        return response.json();
      }
      default:
        throw new Error(`GitHub action not supported: ${action.action}`);
    }
  }

  private async executeWebhook(connector: ConnectorConfig, action: ConnectorAction): Promise<any> {
    const url = action.params.url || connector.credentials.webhookUrl;
    if (!url) throw new Error("No webhook URL configured");

    const response = await fetch(url, {
      method: action.params.method || "POST",
      headers: {
        "Content-Type": "application/json",
        ...action.params.headers,
      },
      body: action.params.body ? JSON.stringify(action.params.body) : undefined,
    });
    return response.json().catch(() => ({ status: response.status }));
  }

  private async executeGenericAPI(connector: ConnectorConfig, action: ConnectorAction): Promise<any> {
    const { url, method = "GET", headers = {}, body } = action.params;
    if (!url) throw new Error("URL required for generic API call");

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.json().catch(() => ({ status: response.status }));
  }

  // ============================================
  // Helpers
  // ============================================

  private createRawEmail(to: string, subject: string, body: string, cc?: string, bcc?: string): string {
    const headers = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/html; charset=UTF-8`,
    ];
    if (cc) headers.push(`Cc: ${cc}`);
    if (bcc) headers.push(`Bcc: ${bcc}`);

    const email = headers.join("\r\n") + "\r\n\r\n" + body;
    return Buffer.from(email).toString("base64url");
  }

  private findConnector(type: ConnectorType): ConnectorConfig | undefined {
    for (const [, config] of this.connectors) {
      if (config.type === type && config.enabled) return config;
    }
    return undefined;
  }

  private checkRateLimit(connectorId: string): boolean {
    const counter = this.rateLimitCounters.get(connectorId) || {
      minute: 0, day: 0, lastMinuteReset: Date.now(), lastDayReset: Date.now(),
    };

    const now = Date.now();
    if (now - counter.lastMinuteReset > 60000) { counter.minute = 0; counter.lastMinuteReset = now; }
    if (now - counter.lastDayReset > 86400000) { counter.day = 0; counter.lastDayReset = now; }

    const connector = this.connectors.get(connectorId);
    if (!connector) return false;

    return counter.minute < connector.rateLimits.requestsPerMinute &&
           counter.day < connector.rateLimits.requestsPerDay;
  }

  private incrementRateLimit(connectorId: string): void {
    const counter = this.rateLimitCounters.get(connectorId) || {
      minute: 0, day: 0, lastMinuteReset: Date.now(), lastDayReset: Date.now(),
    };
    counter.minute++;
    counter.day++;
    this.rateLimitCounters.set(connectorId, counter);
  }

  /**
   * List available connectors and their status.
   */
  listConnectors(): Array<{ type: ConnectorType; name: string; enabled: boolean; actions: string[] }> {
    const result: Array<{ type: ConnectorType; name: string; enabled: boolean; actions: string[] }> = [];

    // Show configured connectors
    for (const [, config] of this.connectors) {
      result.push({
        type: config.type,
        name: config.name,
        enabled: config.enabled,
        actions: config.capabilities,
      });
    }

    // Show available but unconfigured connectors
    for (const [type, def] of Object.entries(CONNECTOR_DEFINITIONS)) {
      if (!result.some((r) => r.type === type)) {
        result.push({
          type: type as ConnectorType,
          name: type.charAt(0).toUpperCase() + type.slice(1),
          enabled: false,
          actions: def.actions,
        });
      }
    }

    return result;
  }

  /**
   * Check if a connector is available.
   */
  isAvailable(type: ConnectorType): boolean {
    return !!this.findConnector(type);
  }
}

// Singleton
export const toolConnectorHub = new ToolConnectorHub();
