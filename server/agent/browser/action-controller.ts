import { browserSessionManager } from "./session-manager";
import { ActionResult, PageState, SessionEventCallback } from "./types";
import { urlSecurity } from "./security/url-security";
import { jsSandbox } from "./security/js-sandbox";
import { selectorSanitizer } from "./security/selector-sanitizer";
import { sessionSecurity } from "./security/session-security";
import { browserAuditLogger } from "./security/audit-logger";

export type ActionType = "navigate" | "click" | "type" | "scroll" | "wait" | "screenshot" | "getState" | "evaluate" | "download";

export interface ActionCommand {
  type: ActionType;
  params: Record<string, any>;
}

export interface ActionControllerConfig {
  maxActionsPerSession?: number;
  actionTimeout?: number;
  screenshotOnEveryAction?: boolean;
  /** Maximum wait time allowed (prevents resource exhaustion) */
  maxWaitTimeMs?: number;
  /** Maximum scroll amount per action */
  maxScrollAmount?: number;
  /** Maximum text length for type action */
  maxTypeTextLength?: number;
  /** Maximum sequence length */
  maxSequenceLength?: number;
  /** Enable security validation on all actions */
  enableSecurityValidation?: boolean;
}

const DEFAULT_CONFIG: ActionControllerConfig = {
  maxActionsPerSession: 100,
  actionTimeout: 30000,
  screenshotOnEveryAction: true,
  maxWaitTimeMs: 30000,
  maxScrollAmount: 10000,
  maxTypeTextLength: 50000,
  maxSequenceLength: 50,
  enableSecurityValidation: true,
};

class ActionController {
  private config: ActionControllerConfig;
  private actionCounts: Map<string, number> = new Map();

  constructor(config: Partial<ActionControllerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async executeAction(sessionId: string, command: ActionCommand): Promise<ActionResult> {
    const startTime = Date.now();

    // Validate action type
    const validTypes: ActionType[] = [
      "navigate", "click", "type", "scroll", "wait",
      "screenshot", "getState", "evaluate", "download",
    ];
    if (!validTypes.includes(command.type)) {
      browserAuditLogger.log({
        category: "policy",
        severity: "warning",
        sessionId,
        action: "invalid_action_type",
        details: { type: command.type },
        blocked: true,
        riskScore: 50,
      });
      return {
        success: false,
        action: { type: command.type, params: {}, timestamp: new Date() },
        error: `Unknown action type: ${command.type}`,
        duration: 0,
      };
    }

    // Check action count limit
    const count = (this.actionCounts.get(sessionId) || 0) + 1;
    if (count > this.config.maxActionsPerSession!) {
      browserAuditLogger.logSessionViolation(sessionId, "action_limit_exceeded", {
        count,
        limit: this.config.maxActionsPerSession,
      });
      return {
        success: false,
        action: { type: command.type, params: command.params, timestamp: new Date() },
        error: `Maximum actions (${this.config.maxActionsPerSession}) exceeded for session`,
        duration: 0,
      };
    }

    // Check session security
    const sessionCheck = sessionSecurity.recordAction(sessionId);
    if (!sessionCheck.allowed) {
      browserAuditLogger.logSessionViolation(sessionId, "session_security_blocked", {
        reason: sessionCheck.reason,
      });
      return {
        success: false,
        action: { type: command.type, params: command.params, timestamp: new Date() },
        error: sessionCheck.reason || "Session security check failed",
        duration: 0,
      };
    }

    this.actionCounts.set(sessionId, count);

    // Run security validation for the specific action
    if (this.config.enableSecurityValidation) {
      const validation = await this.validateAction(sessionId, command);
      if (!validation.allowed) {
        return {
          success: false,
          action: { type: command.type, params: command.params, timestamp: new Date() },
          error: validation.reason || "Action blocked by security policy",
          duration: Date.now() - startTime,
        };
      }
    }

    switch (command.type) {
      case "navigate":
        return browserSessionManager.navigate(sessionId, command.params.url);

      case "click": {
        const sanitizedSelector = this.sanitizeSelector(sessionId, command.params.selector);
        if (!sanitizedSelector) {
          return {
            success: false,
            action: { type: "click", params: command.params, timestamp: new Date() },
            error: "Selector validation failed",
            duration: Date.now() - startTime,
          };
        }
        return browserSessionManager.click(sessionId, sanitizedSelector);
      }

      case "type": {
        const sanitizedSelector = this.sanitizeSelector(sessionId, command.params.selector);
        if (!sanitizedSelector) {
          return {
            success: false,
            action: { type: "type", params: command.params, timestamp: new Date() },
            error: "Selector validation failed",
            duration: Date.now() - startTime,
          };
        }
        // Truncate text if too long
        const text = typeof command.params.text === "string"
          ? command.params.text.slice(0, this.config.maxTypeTextLength!)
          : String(command.params.text || "");
        return browserSessionManager.type(sessionId, sanitizedSelector, text);
      }

      case "scroll": {
        const direction = command.params.direction === "up" ? "up" : "down";
        const amount = Math.min(
          Math.max(0, Number(command.params.amount) || 300),
          this.config.maxScrollAmount!
        );
        return browserSessionManager.scroll(sessionId, direction, amount);
      }

      case "wait": {
        const ms = Math.min(
          Math.max(0, Number(command.params.ms) || 1000),
          this.config.maxWaitTimeMs!
        );
        return browserSessionManager.wait(sessionId, ms);
      }

      case "evaluate": {
        // JavaScript execution is validated in validateAction
        return browserSessionManager.evaluate(sessionId, command.params.script);
      }

      case "screenshot": {
        const screenshot = await browserSessionManager.getScreenshot(sessionId);
        return {
          success: !!screenshot,
          action: { type: "screenshot", params: {}, timestamp: new Date() },
          screenshot: screenshot || undefined,
          duration: Date.now() - startTime,
        };
      }

      case "getState": {
        const state = await browserSessionManager.getPageState(sessionId);
        return {
          success: !!state,
          action: { type: "getState", params: {}, timestamp: new Date() },
          data: state,
          duration: Date.now() - startTime,
        };
      }

      default:
        return {
          success: false,
          action: { type: command.type, params: command.params, timestamp: new Date() },
          error: `Unknown action type: ${command.type}`,
          duration: Date.now() - startTime,
        };
    }
  }

  /**
   * Validate an action against security policies
   */
  private async validateAction(
    sessionId: string,
    command: ActionCommand
  ): Promise<{ allowed: boolean; reason?: string }> {
    switch (command.type) {
      case "navigate": {
        if (!command.params.url || typeof command.params.url !== "string") {
          return { allowed: false, reason: "Navigation requires a valid URL" };
        }
        const urlCheck = await urlSecurity.validateUrl(command.params.url);
        if (!urlCheck.allowed) {
          browserAuditLogger.logNavigation(sessionId, command.params.url, false, urlCheck.reason);
          if (urlCheck.riskLevel === "critical") {
            browserAuditLogger.logSSRFAttempt(sessionId, command.params.url, urlCheck.reason || "");
          }
          return { allowed: false, reason: urlCheck.reason };
        }
        browserAuditLogger.logNavigation(sessionId, command.params.url, true);
        return { allowed: true };
      }

      case "evaluate": {
        if (!command.params.script || typeof command.params.script !== "string") {
          return { allowed: false, reason: "Evaluate requires a script string" };
        }
        const scriptCheck = jsSandbox.validateScript(command.params.script);
        if (!scriptCheck.allowed) {
          browserAuditLogger.logJsExecution(sessionId, command.params.script, false, scriptCheck.reason);
          return { allowed: false, reason: scriptCheck.reason };
        }
        browserAuditLogger.logJsExecution(sessionId, command.params.script, true);
        return { allowed: true };
      }

      case "click":
      case "type": {
        if (!command.params.selector || typeof command.params.selector !== "string") {
          return { allowed: false, reason: `${command.type} requires a valid selector` };
        }
        const selectorCheck = selectorSanitizer.validate(command.params.selector);
        if (!selectorCheck.valid) {
          browserAuditLogger.logSelectorBlocked(sessionId, command.params.selector, selectorCheck.reason || "");
          return { allowed: false, reason: selectorCheck.reason };
        }
        return { allowed: true };
      }

      case "wait": {
        const ms = Number(command.params.ms);
        if (isNaN(ms) || ms < 0) {
          return { allowed: false, reason: "Wait time must be a positive number" };
        }
        if (ms > this.config.maxWaitTimeMs!) {
          return { allowed: false, reason: `Wait time exceeds maximum of ${this.config.maxWaitTimeMs}ms` };
        }
        return { allowed: true };
      }

      case "scroll": {
        const amount = Number(command.params.amount);
        if (amount && (isNaN(amount) || amount < 0)) {
          return { allowed: false, reason: "Scroll amount must be a positive number" };
        }
        return { allowed: true };
      }

      default:
        return { allowed: true };
    }
  }

  /**
   * Sanitize a CSS selector, returning null if invalid
   */
  private sanitizeSelector(sessionId: string, selector: string): string | null {
    if (!selector || typeof selector !== "string") return null;

    const result = selectorSanitizer.validate(selector);
    if (!result.valid) {
      browserAuditLogger.logSelectorBlocked(sessionId, selector, result.reason || "validation_failed");
      return null;
    }

    return result.sanitizedSelector || selector;
  }

  async executeSequence(
    sessionId: string,
    commands: ActionCommand[],
    onAction?: (index: number, result: ActionResult) => void
  ): Promise<ActionResult[]> {
    // Limit sequence length
    if (commands.length > this.config.maxSequenceLength!) {
      browserAuditLogger.logSessionViolation(sessionId, "sequence_too_long", {
        length: commands.length,
        maxLength: this.config.maxSequenceLength,
      });
      return [{
        success: false,
        action: { type: "navigate", params: {}, timestamp: new Date() },
        error: `Sequence length (${commands.length}) exceeds maximum (${this.config.maxSequenceLength})`,
        duration: 0,
      }];
    }

    const results: ActionResult[] = [];

    for (let i = 0; i < commands.length; i++) {
      const result = await this.executeAction(sessionId, commands[i]);
      results.push(result);

      if (onAction) {
        onAction(i, result);
      }

      if (!result.success) {
        break;
      }
    }

    return results;
  }

  resetActionCount(sessionId: string): void {
    this.actionCounts.delete(sessionId);
  }

  getActionCount(sessionId: string): number {
    return this.actionCounts.get(sessionId) || 0;
  }
}

export const actionController = new ActionController();
