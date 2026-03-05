/**
 * ComputerControlPlane — Unified orchestrator for Shell, Desktop, and Browser tools.
 *
 * Provides:
 * - Single entry point for all computer control actions
 * - Policy engine with SAFE/SUPERVISED/AUTOPILOT modes
 * - Risk engine aggregating risk from all sub-tools
 * - Global kill-switch
 * - Unified audit trail
 * - Human-in-the-loop escalation
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { ShellTool, ShellCommandRequest, ShellCommandResult } from "./shell/ShellTool";
import { DesktopTool, DesktopAction, DesktopActionResult } from "./desktop/DesktopTool";
import { BrowserTool, BrowserAction, BrowserActionResult } from "./browser/BrowserTool";
import { ControlPolicy, ControlMode, RiskLevel, ControlAuditEntry } from "./types";

export interface ComputerControlConfig {
  mode: ControlMode;
  shellEnabled: boolean;
  desktopEnabled: boolean;
  browserEnabled: boolean;
  shellPolicy?: Partial<ControlPolicy>;
  globalKillSwitch: boolean;
}

const DEFAULT_CONFIG: ComputerControlConfig = {
  mode: "SUPERVISED",
  shellEnabled: true,
  desktopEnabled: true,
  browserEnabled: true,
  globalKillSwitch: false,
};

export interface ControlPlaneStatus {
  mode: ControlMode;
  shellEnabled: boolean;
  desktopEnabled: boolean;
  browserEnabled: boolean;
  desktopArmed: boolean;
  killSwitchActive: boolean;
  activeShellCommands: number;
  activeBrowserSessions: number;
  totalAuditEntries: number;
}

export class ComputerControlPlane extends EventEmitter {
  private config: ComputerControlConfig;
  private shell: ShellTool;
  private desktop: DesktopTool;
  private browser: BrowserTool;
  private globalKillSwitch = false;
  private auditLog: ControlAuditEntry[] = [];

  constructor(config?: Partial<ComputerControlConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.shell = new ShellTool({
      mode: this.config.mode,
      ...(this.config.shellPolicy || {}),
    } as any);

    this.desktop = new DesktopTool();
    this.browser = new BrowserTool();

    // Forward events
    this.shell.on("confirmation_required", (data) => this.emit("confirmation_required", { tool: "shell", ...data }));
    this.shell.on("output", (data) => this.emit("shell_output", data));
    this.shell.on("kill_switch_activated", () => this.emit("kill_switch", { tool: "shell", active: true }));

    this.desktop.on("armed", () => this.emit("desktop_armed"));
    this.desktop.on("disarmed", () => this.emit("desktop_disarmed"));
  }

  // ── Shell Operations ───────────────────────────

  async executeCommand(request: ShellCommandRequest): Promise<ShellCommandResult> {
    this.assertNotKilled("shell");
    this.assertEnabled("shell");
    return await this.shell.execute(request);
  }

  assessCommandRisk(command: string) {
    return this.shell.assessRisk(command);
  }

  // ── Desktop Operations ─────────────────────────

  async executeDesktopAction(
    action: DesktopAction,
    userId: string,
    sessionId: string,
  ): Promise<DesktopActionResult> {
    this.assertNotKilled("desktop");
    this.assertEnabled("desktop");
    return await this.desktop.execute(action, userId, sessionId);
  }

  armDesktop(): void {
    this.desktop.arm();
  }

  disarmDesktop(): void {
    this.desktop.disarm();
  }

  isDesktopArmed(): boolean {
    return this.desktop.isArmed();
  }

  // ── Browser Operations ─────────────────────────

  async createBrowserSession(options?: { viewport?: { width: number; height: number } }): Promise<string> {
    this.assertNotKilled("browser");
    this.assertEnabled("browser");
    return await this.browser.createSession(options);
  }

  async executeBrowserAction(
    sessionId: string,
    action: BrowserAction,
    userId: string,
    userSessionId: string,
  ): Promise<BrowserActionResult> {
    this.assertNotKilled("browser");
    this.assertEnabled("browser");
    return await this.browser.execute(sessionId, action, userId, userSessionId);
  }

  async closeBrowserSession(sessionId: string): Promise<void> {
    await this.browser.closeSession(sessionId);
  }

  // ── Global Kill Switch ─────────────────────────

  activateKillSwitch(): void {
    this.globalKillSwitch = true;
    this.shell.activateKillSwitch();
    this.desktop.disarm();
    this.browser.shutdown().catch(() => {});
    this.emit("global_kill_switch", { active: true });
  }

  deactivateKillSwitch(): void {
    this.globalKillSwitch = false;
    this.shell.deactivateKillSwitch();
    this.emit("global_kill_switch", { active: false });
  }

  isKillSwitchActive(): boolean {
    return this.globalKillSwitch;
  }

  // ── Mode Management ────────────────────────────

  setMode(mode: ControlMode): void {
    this.config.mode = mode;
    this.shell.updatePolicy({ mode });
    this.emit("mode_changed", { mode });
  }

  getMode(): ControlMode {
    return this.config.mode;
  }

  // ── Status ─────────────────────────────────────

  getStatus(): ControlPlaneStatus {
    return {
      mode: this.config.mode,
      shellEnabled: this.config.shellEnabled,
      desktopEnabled: this.config.desktopEnabled,
      browserEnabled: this.config.browserEnabled,
      desktopArmed: this.desktop.isArmed(),
      killSwitchActive: this.globalKillSwitch,
      activeShellCommands: this.shell.getActiveProcessCount(),
      activeBrowserSessions: this.browser.getActiveSessions().length,
      totalAuditEntries: this.getAuditLog().length,
    };
  }

  // ── Audit ──────────────────────────────────────

  getAuditLog(limit = 200): ControlAuditEntry[] {
    const shellLog = this.shell.getAuditLog(limit);
    const browserLog = this.browser.getAuditLog(limit);
    return [...shellLog, ...browserLog]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // ── Private ────────────────────────────────────

  private assertNotKilled(tool: string): void {
    if (this.globalKillSwitch) {
      throw new Error(`Global kill switch is active. Cannot use ${tool}.`);
    }
  }

  private assertEnabled(tool: "shell" | "desktop" | "browser"): void {
    const map = {
      shell: this.config.shellEnabled,
      desktop: this.config.desktopEnabled,
      browser: this.config.browserEnabled,
    };
    if (!map[tool]) {
      throw new Error(`${tool} is disabled in the control plane configuration.`);
    }
  }

  async shutdown(): Promise<void> {
    await this.browser.shutdown();
  }
}
