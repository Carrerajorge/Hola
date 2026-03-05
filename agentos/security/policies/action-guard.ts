// Action guard that prevents unauthorized, illegal, or unethical actions
// Checks against policy before executing any web action, API call, or system command

import { PolicyEngine, PolicySubject, PolicyAction, PolicyDecision } from "./opa-policies";
import { InputSanitizer, SanitizationResult } from "../scanning/input-sanitizer";

export interface ActionRequest {
  agentId: string;
  actionType: "web-navigation" | "api-call" | "system-command" | "file-access" | "data-query" | "external-communication";
  target: string;
  parameters: Record<string, unknown>;
  justification: string;
}

export interface ActionVerdict {
  permitted: boolean;
  actionId: string;
  reason: string;
  sanitizedParams: Record<string, unknown>;
  policyDecision: PolicyDecision;
  inputScanResult?: SanitizationResult;
  requiredApproval?: { approver: string; deadline: number };
  restrictions?: string[];
}

type ActionCheckFn = (request: ActionRequest) => { blocked: boolean; reason: string };

// Blocked domains, commands, and patterns for ethical/legal compliance
const BLOCKED_DOMAINS = new Set([
  "darkweb.", ".onion", "illegal", "exploit-db.com",
]);

const BLOCKED_COMMANDS = new Set([
  "rm -rf /", "mkfs", "dd if=/dev/zero", ":(){ :|:& };:",
  "chmod -R 777 /", "shutdown", "reboot", "halt",
]);

const BLOCKED_ACTION_PATTERNS = [
  { pattern: /password\s*spray|brute\s*force|credential\s*stuff/i, reason: "Credential attack detected" },
  { pattern: /scrape.*personal\s*data|harvest.*email/i, reason: "PII harvesting detected" },
  { pattern: /bypass.*captcha|circumvent.*security/i, reason: "Security circumvention detected" },
  { pattern: /spam|phish|impersonat/i, reason: "Social engineering / spam detected" },
  { pattern: /cryptocurrency.*mix|money.*launder/i, reason: "Financial crime pattern detected" },
];

export class ActionGuard {
  private policyEngine: PolicyEngine;
  private sanitizer: InputSanitizer;
  private customChecks: ActionCheckFn[] = [];
  private verdictLog: ActionVerdict[] = [];

  constructor(policyEngine?: PolicyEngine, sanitizer?: InputSanitizer) {
    this.policyEngine = policyEngine ?? new PolicyEngine();
    this.sanitizer = sanitizer ?? new InputSanitizer();
  }

  async evaluate(request: ActionRequest, subject: PolicySubject): Promise<ActionVerdict> {
    const actionId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Ethical/legal pre-check
    const ethicalCheck = this.checkEthicalConstraints(request);
    if (ethicalCheck.blocked) {
      return this.createVerdict(actionId, false, ethicalCheck.reason, request, {
        allowed: false, reason: ethicalCheck.reason, auditRef: actionId,
      });
    }

    // 2. Sanitize all string parameters
    const sanitizedParams: Record<string, unknown> = {};
    let inputScanResult: SanitizationResult | undefined;
    for (const [key, value] of Object.entries(request.parameters)) {
      if (typeof value === "string") {
        const result = this.sanitizer.sanitize(value);
        sanitizedParams[key] = result.sanitized;
        if (!result.safe) {
          inputScanResult = result;
          return this.createVerdict(actionId, false, `Parameter "${key}" contains threats: ${result.threats.map((t) => t.description).join(", ")}`, request, {
            allowed: false, reason: "Input sanitization failed", auditRef: actionId,
          }, inputScanResult);
        }
      } else {
        sanitizedParams[key] = value;
      }
    }

    // 3. Map action to policy resource and evaluate
    const policyAction = this.mapToPolicy(request);
    const policyDecision = this.policyEngine.evaluate(subject, policyAction);

    // 4. Run custom checks
    for (const check of this.customChecks) {
      const result = check(request);
      if (result.blocked) {
        return this.createVerdict(actionId, false, result.reason, request, policyDecision);
      }
    }

    // 5. Rate-limit check (simple sliding window)
    const recentActions = this.verdictLog.filter(
      (v) => v.permitted && Date.now() - parseInt(v.actionId.split("_")[1], 36) < 60_000
    );
    if (recentActions.length > 100) {
      return this.createVerdict(actionId, false, "Rate limit exceeded: >100 actions/min", request, policyDecision);
    }

    const verdict = this.createVerdict(
      actionId,
      policyDecision.allowed,
      policyDecision.reason,
      request,
      policyDecision,
      inputScanResult,
    );
    verdict.sanitizedParams = sanitizedParams;

    if (policyDecision.requiredEscalation) {
      verdict.requiredApproval = {
        approver: policyDecision.requiredEscalation.level,
        deadline: Date.now() + policyDecision.requiredEscalation.timeout,
      };
    }

    return verdict;
  }

  addCustomCheck(check: ActionCheckFn): void {
    this.customChecks.push(check);
  }

  getVerdictLog(agentId?: string): ActionVerdict[] {
    return agentId
      ? this.verdictLog.filter((_, i) => this.verdictLog[i].reason.includes(agentId))
      : [...this.verdictLog];
  }

  private checkEthicalConstraints(request: ActionRequest): { blocked: boolean; reason: string } {
    // Check blocked domains
    if (request.actionType === "web-navigation" || request.actionType === "api-call") {
      for (const domain of BLOCKED_DOMAINS) {
        if (request.target.toLowerCase().includes(domain)) {
          return { blocked: true, reason: `Blocked domain: ${domain}` };
        }
      }
    }

    // Check blocked commands
    if (request.actionType === "system-command") {
      for (const cmd of BLOCKED_COMMANDS) {
        if (request.target.includes(cmd)) {
          return { blocked: true, reason: `Dangerous command blocked: ${cmd}` };
        }
      }
    }

    // Check intent patterns
    const fullText = `${request.target} ${request.justification} ${JSON.stringify(request.parameters)}`;
    for (const { pattern, reason } of BLOCKED_ACTION_PATTERNS) {
      if (pattern.test(fullText)) {
        return { blocked: true, reason };
      }
    }

    return { blocked: false, reason: "" };
  }

  private mapToPolicy(request: ActionRequest): PolicyAction {
    const typeMap: Record<ActionRequest["actionType"], PolicyAction["resource"]["type"]> = {
      "web-navigation": "web",
      "api-call": "api",
      "system-command": "system",
      "file-access": "file",
      "data-query": "database",
      "external-communication": "api",
    };
    return {
      verb: request.actionType === "data-query" ? "read" : "execute",
      resource: {
        type: typeMap[request.actionType],
        identifier: request.target,
        sensitivity: "internal",
      },
      context: { justification: request.justification, params: request.parameters },
    };
  }

  private createVerdict(
    actionId: string, permitted: boolean, reason: string,
    _request: ActionRequest, policyDecision: PolicyDecision,
    inputScanResult?: SanitizationResult,
  ): ActionVerdict {
    const verdict: ActionVerdict = {
      permitted, actionId, reason, sanitizedParams: {},
      policyDecision, inputScanResult,
    };
    this.verdictLog.push(verdict);
    if (this.verdictLog.length > 10_000) this.verdictLog = this.verdictLog.slice(-5_000);
    return verdict;
  }
}
