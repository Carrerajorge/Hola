/**
 * AgentOS Action-Plane — Core Types
 *
 * Type definitions for web actions, MCP tools, telephony calls,
 * action results, browser sessions, and consent records.
 */

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export type ActionStatus = "pending" | "running" | "success" | "failure" | "cancelled" | "needs_consent";

export interface ActionResult<T = unknown> {
  actionId: string;
  status: ActionStatus;
  /** Payload returned on success. */
  data?: T;
  /** Human-readable error description. */
  error?: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Audit trail entries produced during execution. */
  auditLog: AuditEntry[];
  timestamp: Date;
}

export interface AuditEntry {
  timestamp: Date;
  level: "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export interface ConsentRecord {
  id: string;
  /** What action is being consented to. */
  actionDescription: string;
  /** Who granted consent (user id, session id, etc.). */
  grantedBy: string;
  grantedAt: Date;
  /** Optional expiry — consent is revoked after this time. */
  expiresAt?: Date;
  /** Scope tags for the consent (e.g. ["telephony", "outbound-call"]). */
  scopes: string[];
  revoked: boolean;
}

// ---------------------------------------------------------------------------
// Web / Browser
// ---------------------------------------------------------------------------

export type NavigationGoal = "click" | "type" | "navigate" | "scroll" | "screenshot" | "download" | "extract";

export interface WebAction {
  id: string;
  sessionId: string;
  goal: NavigationGoal;
  /** CSS selector, URL, or text payload depending on goal. */
  target: string;
  /** Optional value for "type" actions. */
  value?: string;
  /** Timeout in milliseconds for this action. */
  timeoutMs: number;
}

export interface BrowserSession {
  id: string;
  /** Origin URL the session started at. */
  origin: string;
  /** Current page URL. */
  currentUrl: string;
  /** Whether the session is still alive. */
  alive: boolean;
  createdAt: Date;
  /** Cookies / storage snapshot (opaque blob). */
  stateSnapshot?: string;
  /** Page title. */
  title?: string;
  /** Viewport dimensions. */
  viewport: { width: number; height: number };
}

// ---------------------------------------------------------------------------
// MCP (Model Context Protocol)
// ---------------------------------------------------------------------------

export interface MCPTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** JSON Schema for the tool's output. */
  outputSchema?: Record<string, unknown>;
  /** Server that provides this tool. */
  serverId: string;
  /** Version tag. */
  version?: string;
  /** Whether the tool is currently available. */
  available: boolean;
}

export interface MCPServerConfig {
  id: string;
  name: string;
  /** Transport: stdio, HTTP SSE, WebSocket. */
  transport: "stdio" | "sse" | "websocket";
  /** Connection endpoint (command, URL, etc.). */
  endpoint: string;
  /** Optional environment variables for stdio servers. */
  env?: Record<string, string>;
  /** Capabilities advertised by the server. */
  capabilities?: string[];
}

// ---------------------------------------------------------------------------
// Telephony
// ---------------------------------------------------------------------------

export type CallDirection = "outbound" | "inbound";
export type CallStatus = "ringing" | "in_progress" | "completed" | "failed" | "cancelled";

export interface TelephonyCall {
  id: string;
  direction: CallDirection;
  from: string;
  to: string;
  status: CallStatus;
  /** SIP / PSTN provider identifier. */
  provider: string;
  startedAt?: Date;
  endedAt?: Date;
  /** Transcription segments captured during the call. */
  transcript: TranscriptSegment[];
  /** Consent record authorising this call. */
  consentId: string;
  /** Recording URL if recording was enabled. */
  recordingUrl?: string;
}

export interface TranscriptSegment {
  speaker: "agent" | "human" | "unknown";
  text: string;
  startSec: number;
  endSec: number;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Capability Discovery
// ---------------------------------------------------------------------------

export interface CapabilityRequest {
  id: string;
  /** Natural-language description of what is needed. */
  description: string;
  /** Category hint: "tool", "data", "permission", "sdk". */
  category: "tool" | "data" | "permission" | "sdk";
  /** Whether user approval is required before acquisition. */
  requiresApproval: boolean;
  status: "searching" | "found" | "approved" | "denied" | "installed";
}

export interface CapabilityMatch {
  requestId: string;
  source: string;
  name: string;
  installCommand?: string;
  documentationUrl?: string;
  confidence: number;
}
