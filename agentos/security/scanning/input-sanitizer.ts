// Input sanitization and prompt injection detection
// Treats all external content as untrusted. Validates schemas, detects injection patterns, strips dangerous content.

export interface SanitizationResult {
  safe: boolean;
  sanitized: string;
  threats: ThreatDetection[];
  originalHash: string;
}

export interface ThreatDetection {
  type: "prompt-injection" | "jailbreak" | "data-exfil" | "xss" | "sql-injection" | "command-injection" | "schema-violation";
  severity: "low" | "medium" | "high" | "critical";
  pattern: string;
  location: { start: number; end: number };
  description: string;
}

export interface SchemaRule {
  field: string;
  type: "string" | "number" | "boolean" | "url" | "email";
  maxLength?: number;
  pattern?: RegExp;
  required?: boolean;
}

const INJECTION_PATTERNS: Array<{ regex: RegExp; type: ThreatDetection["type"]; severity: ThreatDetection["severity"]; desc: string }> = [
  { regex: /ignore\s+(all\s+)?previous\s+instructions/gi, type: "prompt-injection", severity: "critical", desc: "Instruction override attempt" },
  { regex: /you\s+are\s+now\s+(a|an|in)\s+/gi, type: "jailbreak", severity: "critical", desc: "Role reassignment attempt" },
  { regex: /system\s*:\s*you\s+(must|should|will|are)/gi, type: "prompt-injection", severity: "critical", desc: "Fake system prompt injection" },
  { regex: /\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/gi, type: "prompt-injection", severity: "high", desc: "Chat template injection tokens" },
  { regex: /```\s*(system|assistant)\s*\n/gi, type: "prompt-injection", severity: "high", desc: "Markdown role injection" },
  { regex: /\bDAN\b.*\bjailbreak/gi, type: "jailbreak", severity: "critical", desc: "Known jailbreak pattern (DAN)" },
  { regex: /do\s+anything\s+now/gi, type: "jailbreak", severity: "critical", desc: "DAN jailbreak variant" },
  { regex: /exfiltrate|send\s+to\s+(http|https|ftp)/gi, type: "data-exfil", severity: "high", desc: "Data exfiltration attempt" },
  { regex: /<script[\s>]|javascript\s*:|on(error|load|click)\s*=/gi, type: "xss", severity: "high", desc: "XSS payload detected" },
  { regex: /(\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP)\b.*\b(FROM|INTO|TABLE|WHERE)\b)/gi, type: "sql-injection", severity: "high", desc: "SQL injection pattern" },
  { regex: /;\s*(rm|cat|curl|wget|nc|bash|sh|python)\s/gi, type: "command-injection", severity: "critical", desc: "Shell command injection" },
  { regex: /\$\(.*\)|`.*`|\|\|.*&&/g, type: "command-injection", severity: "high", desc: "Command substitution/chaining" },
  { regex: /pretend\s+(you|that|to\s+be)/gi, type: "jailbreak", severity: "medium", desc: "Pretend-mode jailbreak" },
  { regex: /bypass\s+(your|the|all)\s+(rules|restrictions|filters|safety)/gi, type: "jailbreak", severity: "critical", desc: "Explicit bypass attempt" },
];

const DANGEROUS_UNICODE: RegExp = /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g;

export class InputSanitizer {
  private maxInputLength: number;
  private threatLog: Array<{ timestamp: number; threats: ThreatDetection[]; inputHash: string }> = [];

  constructor(options: { maxInputLength?: number } = {}) {
    this.maxInputLength = options.maxInputLength ?? 100_000;
  }

  sanitize(input: string): SanitizationResult {
    const originalHash = this.hashString(input);
    const threats: ThreatDetection[] = [];

    // Length check
    if (input.length > this.maxInputLength) {
      threats.push({
        type: "schema-violation",
        severity: "medium",
        pattern: `length:${input.length}`,
        location: { start: this.maxInputLength, end: input.length },
        description: `Input exceeds max length ${this.maxInputLength}`,
      });
      input = input.slice(0, this.maxInputLength);
    }

    // Detect dangerous unicode (zero-width chars used for steganographic injection)
    let match: RegExpExecArray | null;
    const unicodeCopy = new RegExp(DANGEROUS_UNICODE.source, DANGEROUS_UNICODE.flags);
    while ((match = unicodeCopy.exec(input)) !== null) {
      threats.push({
        type: "prompt-injection",
        severity: "medium",
        pattern: `U+${match[0].charCodeAt(0).toString(16).toUpperCase()}`,
        location: { start: match.index, end: match.index + 1 },
        description: "Dangerous invisible unicode character",
      });
    }

    // Strip dangerous unicode
    let sanitized = input.replace(DANGEROUS_UNICODE, "");

    // Run injection pattern detection
    for (const pat of INJECTION_PATTERNS) {
      const re = new RegExp(pat.regex.source, pat.regex.flags);
      while ((match = re.exec(sanitized)) !== null) {
        threats.push({
          type: pat.type,
          severity: pat.severity,
          pattern: match[0].slice(0, 80),
          location: { start: match.index, end: match.index + match[0].length },
          description: pat.desc,
        });
      }
    }

    // Neutralize critical threats by wrapping detected patterns
    for (const threat of threats.filter((t) => t.severity === "critical")) {
      const segment = sanitized.slice(threat.location.start, threat.location.end);
      sanitized = sanitized.replace(segment, `[BLOCKED:${threat.type}]`);
    }

    const hasCritical = threats.some((t) => t.severity === "critical" || t.severity === "high");

    if (threats.length > 0) {
      this.threatLog.push({ timestamp: Date.now(), threats, inputHash: originalHash });
    }

    return { safe: !hasCritical, sanitized, threats, originalHash };
  }

  validateSchema(data: Record<string, unknown>, rules: SchemaRule[]): ThreatDetection[] {
    const violations: ThreatDetection[] = [];
    for (const rule of rules) {
      const value = data[rule.field];
      if (rule.required && (value === undefined || value === null)) {
        violations.push({
          type: "schema-violation", severity: "medium", pattern: rule.field,
          location: { start: 0, end: 0 }, description: `Missing required field: ${rule.field}`,
        });
        continue;
      }
      if (value === undefined) continue;
      if (rule.type === "string" && typeof value !== "string") {
        violations.push({
          type: "schema-violation", severity: "medium", pattern: rule.field,
          location: { start: 0, end: 0 }, description: `Field ${rule.field} must be string`,
        });
      }
      if (rule.type === "number" && typeof value !== "number") {
        violations.push({
          type: "schema-violation", severity: "medium", pattern: rule.field,
          location: { start: 0, end: 0 }, description: `Field ${rule.field} must be number`,
        });
      }
      if (typeof value === "string" && rule.maxLength && value.length > rule.maxLength) {
        violations.push({
          type: "schema-violation", severity: "low", pattern: rule.field,
          location: { start: 0, end: value.length }, description: `Field ${rule.field} exceeds max length ${rule.maxLength}`,
        });
      }
      if (typeof value === "string" && rule.pattern && !rule.pattern.test(value)) {
        violations.push({
          type: "schema-violation", severity: "medium", pattern: rule.field,
          location: { start: 0, end: 0 }, description: `Field ${rule.field} fails pattern validation`,
        });
      }
    }
    return violations;
  }

  getThreatLog(): typeof this.threatLog {
    return [...this.threatLog];
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return `sha_${Math.abs(hash).toString(36)}`;
  }
}
