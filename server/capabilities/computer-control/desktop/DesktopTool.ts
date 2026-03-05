/**
 * DesktopTool — Cross-platform desktop UI control via accessibility APIs.
 *
 * Platform backends:
 * - macOS: AppleScript + osascript (Accessibility API)
 * - Windows: PowerShell + UIAutomation
 * - Linux: xdotool + AT-SPI (xdg-utils)
 *
 * Features:
 * - Click, type, key-combo, scroll, drag-drop
 * - Window management (list, focus, minimize, maximize, close)
 * - Screenshot capture
 * - Arm/disarm switch (must be explicitly armed before interaction)
 * - Session recording for audit
 */

import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { EventEmitter } from "events";
import { ControlAuditEntry, RiskLevel } from "../types";

const execAsync = promisify(exec);

export type Platform = "darwin" | "win32" | "linux";

export interface DesktopAction {
  type: "click" | "doubleClick" | "rightClick" | "type" | "keyCombo" | "scroll" | "drag" | "screenshot" | "focusWindow" | "listWindows" | "moveWindow" | "resizeWindow" | "minimizeWindow" | "maximizeWindow" | "closeWindow";
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  text?: string;
  keys?: string[];
  scrollDelta?: number;
  windowId?: string;
  windowTitle?: string;
  width?: number;
  height?: number;
}

export interface DesktopActionResult {
  id: string;
  action: DesktopAction;
  success: boolean;
  output?: string;
  screenshotPath?: string;
  error?: string;
  durationMs: number;
  platform: Platform;
}

export interface WindowInfo {
  id: string;
  title: string;
  app: string;
  x: number;
  y: number;
  width: number;
  height: number;
  focused: boolean;
}

export class DesktopTool extends EventEmitter {
  private platform: Platform;
  private armed = false;
  private sessionActions: DesktopActionResult[] = [];
  private auditLog: ControlAuditEntry[] = [];
  private screenshotDir: string;

  constructor(screenshotDir?: string) {
    super();
    this.platform = os.platform() as Platform;
    this.screenshotDir = screenshotDir || path.join(os.tmpdir(), "iliagpt-desktop-screenshots");
  }

  // ── Arm/Disarm Switch ──────────────────────────

  arm(): void {
    this.armed = true;
    this.emit("armed");
  }

  disarm(): void {
    this.armed = false;
    this.emit("disarmed");
  }

  isArmed(): boolean {
    return this.armed;
  }

  // ── Main Execute ───────────────────────────────

  async execute(
    action: DesktopAction,
    userId: string,
    sessionId: string,
  ): Promise<DesktopActionResult> {
    const id = randomUUID();
    const start = Date.now();

    if (!this.armed && action.type !== "listWindows" && action.type !== "screenshot") {
      const result: DesktopActionResult = {
        id,
        action,
        success: false,
        error: "Desktop control is not armed. Call arm() first.",
        durationMs: Date.now() - start,
        platform: this.platform,
      };
      this.sessionActions.push(result);
      return result;
    }

    try {
      let output: string | undefined;
      let screenshotPath: string | undefined;

      switch (action.type) {
        case "click":
        case "doubleClick":
        case "rightClick":
          output = await this.performClick(action);
          break;
        case "type":
          output = await this.performType(action);
          break;
        case "keyCombo":
          output = await this.performKeyCombo(action);
          break;
        case "scroll":
          output = await this.performScroll(action);
          break;
        case "screenshot":
          screenshotPath = await this.performScreenshot();
          break;
        case "listWindows":
          output = await this.performListWindows();
          break;
        case "focusWindow":
          output = await this.performFocusWindow(action);
          break;
        case "moveWindow":
          output = await this.performMoveWindow(action);
          break;
        case "resizeWindow":
          output = await this.performResizeWindow(action);
          break;
        case "minimizeWindow":
          output = await this.performMinimizeWindow(action);
          break;
        case "maximizeWindow":
          output = await this.performMaximizeWindow(action);
          break;
        case "closeWindow":
          output = await this.performCloseWindow(action);
          break;
        default:
          throw new Error(`Unsupported desktop action: ${action.type}`);
      }

      const result: DesktopActionResult = {
        id,
        action,
        success: true,
        output,
        screenshotPath,
        durationMs: Date.now() - start,
        platform: this.platform,
      };

      this.sessionActions.push(result);
      this.logAudit(id, userId, sessionId, action, true);
      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const result: DesktopActionResult = {
        id,
        action,
        success: false,
        error: errMsg,
        durationMs: Date.now() - start,
        platform: this.platform,
      };
      this.sessionActions.push(result);
      this.logAudit(id, userId, sessionId, action, false, errMsg);
      return result;
    }
  }

  // ── Platform-specific implementations ──────────

  private async performClick(action: DesktopAction): Promise<string> {
    const { x = 0, y = 0 } = action;
    const clickType = action.type === "doubleClick" ? 2 : 1;
    const button = action.type === "rightClick" ? 3 : 1;

    switch (this.platform) {
      case "darwin": {
        const script = action.type === "rightClick"
          ? `tell application "System Events" to click at {${x}, ${y}} using {command down}`
          : `do shell script "cliclick c:${x},${y}"`;
        // Fallback to AppleScript mouse move+click
        const asScript = `
          tell application "System Events"
            set position of first window to {${x}, ${y}}
          end tell
        `;
        return await this.runOsascript(
          `do shell script "cliclick ${action.type === "doubleClick" ? "dc" : "c"}:${x},${y}" 2>/dev/null || true`,
        );
      }
      case "linux":
        return await this.runShell(
          `xdotool mousemove ${x} ${y} && xdotool click --repeat ${clickType} ${button}`,
        );
      case "win32":
        return await this.runPowershell(
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x},${y}); [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")`,
        );
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  private async performType(action: DesktopAction): Promise<string> {
    const text = action.text || "";
    // Sanitize: prevent command injection via the text
    const safeText = text.replace(/['"\\`$]/g, "");

    switch (this.platform) {
      case "darwin":
        return await this.runOsascript(
          `tell application "System Events" to keystroke "${safeText}"`,
        );
      case "linux":
        return await this.runShell(`xdotool type --clearmodifiers "${safeText}"`);
      case "win32":
        return await this.runPowershell(
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${safeText}")`,
        );
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  private async performKeyCombo(action: DesktopAction): Promise<string> {
    const keys = action.keys || [];
    if (keys.length === 0) throw new Error("No keys specified for keyCombo");

    switch (this.platform) {
      case "darwin": {
        const modMap: Record<string, string> = { ctrl: "control", alt: "option", shift: "shift", meta: "command", cmd: "command" };
        const modifiers = keys.slice(0, -1).map((k) => modMap[k.toLowerCase()] || k).filter(Boolean);
        const key = keys[keys.length - 1];
        const using = modifiers.length > 0 ? ` using {${modifiers.map((m) => `${m} down`).join(", ")}}` : "";
        return await this.runOsascript(
          `tell application "System Events" to key code ${this.keyNameToCode(key)}${using}`,
        );
      }
      case "linux": {
        const combo = keys.join("+");
        return await this.runShell(`xdotool key "${combo}"`);
      }
      case "win32": {
        const winKeys = keys.map((k) => {
          if (k.toLowerCase() === "ctrl") return "^";
          if (k.toLowerCase() === "alt") return "%";
          if (k.toLowerCase() === "shift") return "+";
          return k;
        });
        return await this.runPowershell(
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("${winKeys.join("")}")`,
        );
      }
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  private async performScroll(action: DesktopAction): Promise<string> {
    const delta = action.scrollDelta || 3;

    switch (this.platform) {
      case "darwin":
        return await this.runOsascript(
          `do shell script "cliclick "scroll:${delta > 0 ? delta : -delta},${delta > 0 ? "up" : "down"}"" 2>/dev/null || true`,
        );
      case "linux": {
        const button = delta > 0 ? 4 : 5;
        return await this.runShell(`xdotool click --repeat ${Math.abs(delta)} ${button}`);
      }
      case "win32":
        return await this.runPowershell(`[System.Windows.Forms.SendKeys]::SendWait("{PGDN}")`);
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  private async performScreenshot(): Promise<string> {
    await fs.mkdir(this.screenshotDir, { recursive: true });
    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(this.screenshotDir, filename);

    switch (this.platform) {
      case "darwin":
        await this.runShell(`screencapture -x "${filepath}"`);
        break;
      case "linux":
        await this.runShell(
          `import -window root "${filepath}" 2>/dev/null || scrot "${filepath}" 2>/dev/null || gnome-screenshot -f "${filepath}" 2>/dev/null || true`,
        );
        break;
      case "win32":
        await this.runPowershell(
          `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bmp.Save("${filepath.replace(/\\/g, "\\\\")}"); }`,
        );
        break;
    }

    return filepath;
  }

  private async performListWindows(): Promise<string> {
    switch (this.platform) {
      case "darwin":
        return await this.runOsascript(`
          tell application "System Events"
            set windowList to ""
            repeat with proc in (every process whose visible is true)
              repeat with w in (every window of proc)
                set windowList to windowList & (name of proc) & " | " & (name of w) & "\\n"
              end repeat
            end repeat
            return windowList
          end tell
        `);
      case "linux":
        return await this.runShell("wmctrl -l 2>/dev/null || xdotool search --name '' getwindowname 2>/dev/null || echo 'wmctrl not available'");
      case "win32":
        return await this.runPowershell(
          "Get-Process | Where-Object {$_.MainWindowTitle} | Format-Table Id, MainWindowTitle -AutoSize",
        );
      default:
        return "Unsupported platform";
    }
  }

  private async performFocusWindow(action: DesktopAction): Promise<string> {
    const title = action.windowTitle || "";
    switch (this.platform) {
      case "darwin":
        return await this.runOsascript(
          `tell application "${title}" to activate`,
        );
      case "linux":
        return await this.runShell(`wmctrl -a "${title}" 2>/dev/null || xdotool search --name "${title}" windowactivate 2>/dev/null`);
      case "win32":
        return await this.runPowershell(
          `(Get-Process | Where-Object {$_.MainWindowTitle -like "*${title}*"} | Select-Object -First 1).MainWindowHandle | ForEach-Object { [void][System.Runtime.InteropServices.Marshal]::SetForegroundWindow($_) }`,
        );
      default:
        throw new Error(`Unsupported platform: ${this.platform}`);
    }
  }

  private async performMoveWindow(action: DesktopAction): Promise<string> {
    const { x = 0, y = 0, windowTitle = "" } = action;
    switch (this.platform) {
      case "darwin":
        return await this.runOsascript(
          `tell application "System Events" to set position of first window of process "${windowTitle}" to {${x}, ${y}}`,
        );
      case "linux":
        return await this.runShell(`wmctrl -r "${windowTitle}" -e 0,${x},${y},-1,-1 2>/dev/null`);
      default:
        return "Not implemented for this platform";
    }
  }

  private async performResizeWindow(action: DesktopAction): Promise<string> {
    const { width = 800, height = 600, windowTitle = "" } = action;
    switch (this.platform) {
      case "darwin":
        return await this.runOsascript(
          `tell application "System Events" to set size of first window of process "${windowTitle}" to {${width}, ${height}}`,
        );
      case "linux":
        return await this.runShell(`wmctrl -r "${windowTitle}" -e 0,-1,-1,${width},${height} 2>/dev/null`);
      default:
        return "Not implemented for this platform";
    }
  }

  private async performMinimizeWindow(action: DesktopAction): Promise<string> {
    const title = action.windowTitle || "";
    switch (this.platform) {
      case "darwin":
        return await this.runOsascript(
          `tell application "System Events" to set miniaturized of first window of process "${title}" to true`,
        );
      case "linux":
        return await this.runShell(`xdotool search --name "${title}" windowminimize 2>/dev/null`);
      default:
        return "Not implemented for this platform";
    }
  }

  private async performMaximizeWindow(action: DesktopAction): Promise<string> {
    const title = action.windowTitle || "";
    switch (this.platform) {
      case "darwin":
        return await this.runOsascript(
          `tell application "System Events" to set value of attribute "AXFullScreen" of first window of process "${title}" to true`,
        );
      case "linux":
        return await this.runShell(`wmctrl -r "${title}" -b add,maximized_vert,maximized_horz 2>/dev/null`);
      default:
        return "Not implemented for this platform";
    }
  }

  private async performCloseWindow(action: DesktopAction): Promise<string> {
    const title = action.windowTitle || "";
    switch (this.platform) {
      case "darwin":
        return await this.runOsascript(
          `tell application "${title}" to close first window`,
        );
      case "linux":
        return await this.runShell(`wmctrl -c "${title}" 2>/dev/null`);
      default:
        return "Not implemented for this platform";
    }
  }

  // ── Helpers ────────────────────────────────────

  private async runShell(cmd: string): Promise<string> {
    const { stdout } = await execAsync(cmd, { timeout: 10_000 });
    return stdout.trim();
  }

  private async runOsascript(script: string): Promise<string> {
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 10_000 });
    return stdout.trim();
  }

  private async runPowershell(script: string): Promise<string> {
    const { stdout } = await execAsync(`powershell -NoProfile -Command "${script}"`, { timeout: 10_000 });
    return stdout.trim();
  }

  private keyNameToCode(key: string): number {
    const map: Record<string, number> = {
      a: 0, b: 11, c: 8, d: 2, e: 14, f: 3, g: 5, h: 4, i: 34, j: 38,
      k: 40, l: 37, m: 46, n: 45, o: 31, p: 35, q: 12, r: 15, s: 1,
      t: 17, u: 32, v: 9, w: 13, x: 7, y: 16, z: 6,
      return: 36, escape: 53, tab: 48, space: 49, delete: 51,
      up: 126, down: 125, left: 123, right: 124,
      f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97,
    };
    return map[key.toLowerCase()] ?? 0;
  }

  getSessionActions(): DesktopActionResult[] {
    return [...this.sessionActions];
  }

  clearSession(): void {
    this.sessionActions = [];
  }

  private logAudit(
    id: string,
    userId: string,
    sessionId: string,
    action: DesktopAction,
    approved: boolean,
    deniedReason?: string,
  ): void {
    this.auditLog.push({
      id,
      timestamp: Date.now(),
      userId,
      sessionId,
      tool: "desktop",
      action: `${action.type}${action.windowTitle ? ` (${action.windowTitle})` : ""}`,
      riskLevel: this.assessDesktopRisk(action),
      approved,
      deniedReason,
    });
  }

  private assessDesktopRisk(action: DesktopAction): RiskLevel {
    if (action.type === "closeWindow") return "HIGH";
    if (action.type === "listWindows" || action.type === "screenshot") return "LOW";
    if (action.type === "type" || action.type === "keyCombo") return "MEDIUM";
    return "MEDIUM";
  }
}
