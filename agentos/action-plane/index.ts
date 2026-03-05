/**
 * AgentOS Action-Plane — Public API
 */

// Types
export type {
  ActionResult,
  ActionStatus,
  AuditEntry,
  BrowserSession,
  CallDirection,
  CallStatus,
  CapabilityMatch,
  CapabilityRequest,
  ConsentRecord,
  MCPServerConfig,
  MCPTool,
  NavigationGoal,
  TelephonyCall,
  TranscriptSegment,
  WebAction,
} from "./types";

// Browser Controller
export { BrowserController } from "./web/browser-controller";
export type { PlaywrightPage, PlaywrightBrowser } from "./web/browser-controller";

// MCP Client
export { MCPClient } from "./mcp/mcp-client";
export type { MCPClientConfig, MCPTransport } from "./mcp/mcp-client";

// Telephony Controller
export { TelephonyController } from "./telephony/telephony-controller";
export type {
  TelephonyControllerConfig,
  TelephonyProvider,
  TTSEngine,
  STTEngine,
  ScriptStep,
} from "./telephony/telephony-controller";

// Capability Discovery
export { CapabilityDiscovery, BuiltinCatalogProvider } from "./capabilities/capability-discovery";
export type {
  CapabilityDiscoveryConfig,
  CapabilitySearchProvider,
  ApprovalGate,
  CapabilityInstaller,
} from "./capabilities/capability-discovery";
