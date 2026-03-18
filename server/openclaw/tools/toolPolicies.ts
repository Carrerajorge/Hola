import path from "node:path";

export interface ExecPolicyConfig {
  safeBins: string[];
  security: "ask" | "warn" | "allow";
  timeout: number;
}

export class ToolPolicyEngine {
  private readonly safeBinsSet: Set<string>;
  private readonly config: ExecPolicyConfig;

  constructor(config: ExecPolicyConfig) {
    this.config = config;
    this.safeBinsSet = new Set(config.safeBins.map((value) => value.toLowerCase()));
  }

  get security() {
    return this.config.security;
  }

  get timeout() {
    return this.config.timeout;
  }

  isCommandAllowed(command: string): { allowed: boolean; binary: string; reason?: string } {
    const trimmed = command.trim();
    const tokens = trimmed.split(/\s+/);

    let index = 0;
    while (index < tokens.length && tokens[index].includes("=")) {
      index += 1;
    }

    const binaryToken = index < tokens.length ? tokens[index] : tokens[0] || "";
    const binary = path.basename(binaryToken).toLowerCase();

    if (!this.safeBinsSet.has(binary)) {
      return {
        allowed: false,
        binary,
        reason: `Binary '${binary}' is not in safe-bins allowlist`,
      };
    }

    const dangerousPatterns = [
      /rm\s+(-rf?|--recursive).*\//,
      />\s*\/dev\/sd/,
      /mkfs\./,
      /dd\s+if=/,
      /:\(\)\s*\{\s*:\|:\s*&\s*\}/,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmed)) {
        return { allowed: false, binary, reason: "Command matches a dangerous pattern" };
      }
    }

    return { allowed: true, binary };
  }
}
