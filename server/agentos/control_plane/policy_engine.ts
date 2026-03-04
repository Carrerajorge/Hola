export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface PolicyContext {
  toolName: string;
  args: any;
  userRole: string;
  mode: string;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  risk: RiskLevel;
  requiresApproval?: boolean;
}

export class PolicyEngine {
  
  // Mejora #31: PII Redaction
  // Detecta y censura emails, tarjetas de crédito y teléfonos
  public sanitizeInput(text: string): string {
    if (!text) return "";
    let sanitized = text;

    // Email
    sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "[EMAIL_REDACTED]");
    // Credit Card (simple Luhn-like check pattern)
    sanitized = sanitized.replace(/\b(?:\d[ -]*?){13,16}\b/g, "[CARD_REDACTED]");
    // Phone (Generic international)
    sanitized = sanitized.replace(/\b\+?[0-9]{1,4}?[-. ]?\(?[0-9]{1,3}?\)?[-. ]?[0-9]{1,4}[-. ]?[0-9]{1,4}[-. ]?[0-9]{1,9}\b/g, "[PHONE_REDACTED]");

    return sanitized;
  }

  // Mejora #32: Jailbreak Detection
  // Detecta intentos de manipulación del sistema
  public detectJailbreak(text: string): boolean {
    const patterns = [
        /ignore (all )?previous instructions/i,
        /ignora (todas )?las instrucciones anteriores/i,
        /do anything now/i,
        /dan mode/i,
        /act as a developer mode/i,
        /you are now uncensored/i
    ];
    return patterns.some(p => p.test(text));
  }

  async evaluate(ctx: PolicyContext): Promise<PolicyResult> {
    
    // 1. Critical Safety Checks (Hardcoded Invariants)
    if (this.isDangerousCommand(ctx.toolName, ctx.args)) {
      return {
        allowed: false,
        reason: "Violates safety invariant: Dangerous system command detected",
        risk: "CRITICAL"
      };
    }

    // 2. Jailbreak Check on Args (if strings)
    const argsStr = JSON.stringify(ctx.args);
    if (this.detectJailbreak(argsStr)) {
        return {
            allowed: false,
            reason: "Jailbreak attempt detected in arguments",
            risk: "CRITICAL"
        };
    }

    // 3. Mode-based Governance
    if (ctx.mode === "SAFE" && (ctx.toolName === "shell_execute" || ctx.toolName === "terminal_exec")) {
      return {
        allowed: false,
        reason: "Shell execution disabled in SAFE mode",
        risk: "HIGH"
      };
    }

    // 4. Default Allow (for now, pending RBAC integration)
    return {
      allowed: true,
      risk: "LOW"
    };
  }

  private isDangerousCommand(tool: string, args: any): boolean {
    if (tool !== "shell_execute" && tool !== "exec" && tool !== "terminal_exec") return false;
    const cmd = args.command || args.code || "";
    // Basic blocklist - to be expanded via OPA/Kyverno rules later
    const blocklist = ["rm -rf /", "mkfs", ":(){ :|:& };:", "> /dev/sda", "dd if="];
    return blocklist.some(b => cmd.includes(b));
  }
}
