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
  async evaluate(ctx: PolicyContext): Promise<PolicyResult> {
    // 1. Critical Safety Checks (Hardcoded Invariants)
    if (this.isDangerousCommand(ctx.toolName, ctx.args)) {
      return {
        allowed: false,
        reason: "Violates safety invariant: Dangerous system command detected",
        risk: "CRITICAL"
      };
    }

    // 2. Mode-based Governance
    if (ctx.mode === "SAFE" && ctx.toolName === "shell_execute") {
      return {
        allowed: false,
        reason: "Shell execution disabled in SAFE mode",
        risk: "HIGH"
      };
    }

    // 3. Default Allow (for now, pending RBAC integration)
    return {
      allowed: true,
      risk: "LOW"
    };
  }

  private isDangerousCommand(tool: string, args: any): boolean {
    if (tool !== "shell_execute" && tool !== "exec") return false;
    const cmd = args.command || args.code || "";
    // Basic blocklist - to be expanded via OPA/Kyverno rules later
    const blocklist = ["rm -rf /", "mkfs", ":(){ :|:& };:"];
    return blocklist.some(b => cmd.includes(b));
  }
}
