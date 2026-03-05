/**
 * COMPUTER-CONTROL-PLANE Types
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ControlMode = "SAFE" | "SUPERVISED" | "AUTOPILOT";

export interface ControlPolicy {
  mode: ControlMode;
  /** Commands that can run without confirmation */
  autoApprovePatterns: string[];
  /** Commands that always require confirmation */
  requireConfirmPatterns: string[];
  /** Commands that are completely blocked */
  blockPatterns: string[];
  /** Max concurrent commands */
  maxConcurrent: number;
  /** Default timeout in ms */
  defaultTimeoutMs: number;
  /** Max timeout in ms */
  maxTimeoutMs: number;
  /** Enable kill-switch (stops all active commands) */
  killSwitchEnabled: boolean;
  /** Binary allowlist (empty = all allowed) */
  binaryAllowlist: string[];
  /** Path allowlist for command execution */
  pathAllowlist: string[];
}

export interface CommandRiskAssessment {
  command: string;
  riskLevel: RiskLevel;
  reasons: string[];
  requiresConfirmation: boolean;
  blocked: boolean;
  suggestedAlternative?: string;
}

export interface ControlAuditEntry {
  id: string;
  timestamp: number;
  userId: string;
  sessionId: string;
  tool: "shell" | "desktop" | "browser";
  action: string;
  riskLevel: RiskLevel;
  approved: boolean;
  deniedReason?: string;
  result?: { exitCode?: number; success: boolean; durationMs: number };
  metadata?: Record<string, unknown>;
}
