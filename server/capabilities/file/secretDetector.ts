/**
 * Secret Detector — Automatically detects and redacts secrets in file content.
 */

import { SecretPattern } from "./types";

const SECRET_PATTERNS: SecretPattern[] = [
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/g, redactWith: "[REDACTED:AWS_KEY]" },
  { name: "AWS Secret Key", pattern: /(?:aws_secret_access_key|secret_key)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi, redactWith: "[REDACTED:AWS_SECRET]" },
  { name: "GitHub Token", pattern: /gh[pous]_[A-Za-z0-9_]{36,255}/g, redactWith: "[REDACTED:GITHUB_TOKEN]" },
  { name: "Generic API Key", pattern: /(?:api[_-]?key|apikey|api_secret)\s*[:=]\s*["']?([A-Za-z0-9\-_.]{20,100})["']?/gi, redactWith: "[REDACTED:API_KEY]" },
  { name: "Bearer Token", pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, redactWith: "[REDACTED:BEARER_TOKEN]" },
  { name: "Private Key Block", pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, redactWith: "[REDACTED:PRIVATE_KEY]" },
  { name: "JWT Token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, redactWith: "[REDACTED:JWT]" },
  { name: "Password in URL", pattern: /:\/\/[^:]+:([^@]{8,})@/g, redactWith: "://[REDACTED:PASS]@" },
  { name: "Slack Token", pattern: /xox[bporas]-[0-9]+-[0-9]+-[a-zA-Z0-9]+/g, redactWith: "[REDACTED:SLACK_TOKEN]" },
  { name: "Stripe Key", pattern: /sk_(?:live|test)_[A-Za-z0-9]{20,}/g, redactWith: "[REDACTED:STRIPE_KEY]" },
  { name: "OpenAI Key", pattern: /sk-[A-Za-z0-9]{20,}/g, redactWith: "[REDACTED:OPENAI_KEY]" },
];

export interface DetectedSecret {
  patternName: string;
  startIndex: number;
  endIndex: number;
  redactedWith: string;
}

export function detectSecrets(content: string): DetectedSecret[] {
  const detected: DetectedSecret[] = [];

  for (const sp of SECRET_PATTERNS) {
    const regex = new RegExp(sp.pattern.source, sp.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      detected.push({
        patternName: sp.name,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        redactedWith: sp.redactWith,
      });
    }
  }

  return detected.sort((a, b) => a.startIndex - b.startIndex);
}

export function redactSecrets(content: string): { redacted: string; secretCount: number; patterns: string[] } {
  const secrets = detectSecrets(content);
  if (secrets.length === 0) {
    return { redacted: content, secretCount: 0, patterns: [] };
  }

  const patterns = [...new Set(secrets.map((s) => s.patternName))];
  let result = content;

  // Apply redactions in reverse order to preserve indices
  for (let i = secrets.length - 1; i >= 0; i--) {
    const s = secrets[i];
    result = result.slice(0, s.startIndex) + s.redactedWith + result.slice(s.endIndex);
  }

  return { redacted: result, secretCount: secrets.length, patterns };
}

export function hasSecrets(content: string): boolean {
  return detectSecrets(content).length > 0;
}
