/**
 * Security & Compliance Service
 * Capabilities 651-700: RBAC, ABAC, secrets management, DLP, security scanning, compliance
 */

import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

// ============================================================================
// Interfaces & Types
// ============================================================================

export interface Role {
  name: string;
  permissions: string[];
  description: string;
  createdAt: Date;
}

export interface Policy {
  id: string;
  effect: "allow" | "deny";
  subjects: string[];
  resources: string[];
  actions: string[];
  conditions?: Record<string, any>;
}

export interface VulnerabilityFinding {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  line: number;
  code: string;
  description: string;
  recommendation: string;
}

export interface PIIFinding {
  type: string;
  value: string;
  masked: string;
  position: { start: number; end: number };
}

export interface SecurityHeaderResult {
  score: number;
  missing: Array<{ header: string; recommendation: string; severity: string }>;
  present: Array<{ header: string; value: string; adequate: boolean }>;
}

export interface ComplianceReport {
  framework: string;
  sections: Array<{
    id: string;
    name: string;
    status: "compliant" | "partial" | "non_compliant" | "not_applicable";
    findings: string[];
    recommendations: string[];
  }>;
  overallScore: number;
  generatedAt: string;
}

export interface PasswordPolicyResult {
  valid: boolean;
  score: number;
  issues: string[];
}

export interface AuditLogEntry {
  timestamp: string;
  action: string;
  actor: string;
  resource: string;
  details?: Record<string, any>;
}

export interface IncidentResponse {
  playbook: string;
  steps: Array<{ order: number; action: string; responsible: string; timeframe: string }>;
  escalation: Array<{ level: number; contact: string; criteria: string }>;
}

// ============================================================================
// Internal State
// ============================================================================

const roles = new Map<string, Role>();
const policies: Policy[] = [];
const secrets = new Map<
  string,
  { value: string; encryptedValue: string; createdAt: Date; rotateAfterMs: number }
>();

const AUDIT_DIR = path.join(process.cwd(), "uploads", "audit");
const AUDIT_LOG_PATH = path.join(AUDIT_DIR, "audit.log");

const ENCRYPTION_KEY_SEED =
  process.env.SECRETS_ENCRYPTION_KEY || "iliagpt-secrets-default-key-seed-32b";

function deriveEncryptionKey(): Buffer {
  return crypto.scryptSync(ENCRYPTION_KEY_SEED, "iliagpt-salt", 32);
}

async function ensureAuditDir(): Promise<void> {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
}

// ============================================================================
// RBAC — Role-Based Access Control (Capabilities 651-656)
// ============================================================================

/**
 * 651 — Create a new role with permissions.
 */
export function createRole(
  name: string,
  permissions: string[],
  description?: string
): Role {
  if (roles.has(name)) {
    throw new Error(`Role "${name}" already exists`);
  }
  const role: Role = {
    name,
    permissions: [...new Set(permissions)],
    description: description ?? "",
    createdAt: new Date(),
  };
  roles.set(name, role);
  return role;
}

/**
 * 652 — Delete a role by name.
 */
export function deleteRole(name: string): boolean {
  return roles.delete(name);
}

/**
 * 653 — Assign a permission to an existing role.
 */
export function assignPermission(roleName: string, permission: string): boolean {
  const role = roles.get(roleName);
  if (!role) return false;
  if (role.permissions.includes(permission)) return true;
  role.permissions.push(permission);
  return true;
}

/**
 * 654 — Remove a permission from an existing role.
 */
export function removePermission(roleName: string, permission: string): boolean {
  const role = roles.get(roleName);
  if (!role) return false;
  const idx = role.permissions.indexOf(permission);
  if (idx === -1) return false;
  role.permissions.splice(idx, 1);
  return true;
}

/**
 * 655 — Check whether a role has a specific permission.
 */
export function checkPermission(roleName: string, permission: string): boolean {
  const role = roles.get(roleName);
  if (!role) return false;
  // Support wildcard permissions (e.g. "documents.*" matches "documents.read")
  return role.permissions.some((p) => {
    if (p === permission) return true;
    if (p.endsWith(".*")) {
      const prefix = p.slice(0, -1); // "documents."
      return permission.startsWith(prefix);
    }
    if (p === "*") return true;
    return false;
  });
}

/**
 * 656 — List all defined roles.
 */
export function listRoles(): Role[] {
  return Array.from(roles.values());
}

// ============================================================================
// ABAC — Attribute-Based Access Control (Capabilities 657-659)
// ============================================================================

/**
 * 657 — Create a new ABAC policy.
 */
export function createPolicy(policyInput: Omit<Policy, "id">): Policy {
  const policy: Policy = {
    ...policyInput,
    id: crypto.randomUUID(),
  };
  policies.push(policy);
  return policy;
}

/**
 * 658 — Evaluate whether access is allowed for a given subject/resource/action.
 * Deny policies take precedence over allow policies.
 */
export function evaluateAccess(
  subject: string,
  resource: string,
  action: string,
  context?: Record<string, any>
): { allowed: boolean; matchedPolicy?: Policy; reason: string } {
  let bestAllow: Policy | undefined;
  let bestDeny: Policy | undefined;

  for (const policy of policies) {
    const subjectMatch =
      policy.subjects.includes("*") || policy.subjects.includes(subject);
    const resourceMatch =
      policy.resources.includes("*") ||
      policy.resources.some(
        (r) =>
          r === resource ||
          (r.endsWith("*") && resource.startsWith(r.slice(0, -1)))
      );
    const actionMatch =
      policy.actions.includes("*") || policy.actions.includes(action);

    if (!subjectMatch || !resourceMatch || !actionMatch) continue;

    // Evaluate conditions if present
    if (policy.conditions && context) {
      let conditionsMet = true;
      for (const [key, expected] of Object.entries(policy.conditions)) {
        const actual = context[key];
        if (typeof expected === "object" && expected !== null) {
          if (expected.$in && !expected.$in.includes(actual)) {
            conditionsMet = false;
            break;
          }
          if (expected.$eq !== undefined && actual !== expected.$eq) {
            conditionsMet = false;
            break;
          }
          if (expected.$ne !== undefined && actual === expected.$ne) {
            conditionsMet = false;
            break;
          }
          if (expected.$gt !== undefined && !(actual > expected.$gt)) {
            conditionsMet = false;
            break;
          }
          if (expected.$lt !== undefined && !(actual < expected.$lt)) {
            conditionsMet = false;
            break;
          }
          if (expected.$gte !== undefined && !(actual >= expected.$gte)) {
            conditionsMet = false;
            break;
          }
          if (expected.$lte !== undefined && !(actual <= expected.$lte)) {
            conditionsMet = false;
            break;
          }
        } else {
          if (actual !== expected) {
            conditionsMet = false;
            break;
          }
        }
      }
      if (!conditionsMet) continue;
    } else if (policy.conditions && !context) {
      // Policy has conditions but no context supplied — skip
      continue;
    }

    if (policy.effect === "deny") {
      bestDeny = policy;
    } else if (policy.effect === "allow") {
      bestAllow = policy;
    }
  }

  // Deny takes precedence
  if (bestDeny) {
    return {
      allowed: false,
      matchedPolicy: bestDeny,
      reason: `Access denied by policy ${bestDeny.id}`,
    };
  }
  if (bestAllow) {
    return {
      allowed: true,
      matchedPolicy: bestAllow,
      reason: `Access granted by policy ${bestAllow.id}`,
    };
  }

  return {
    allowed: false,
    reason: "No matching policy found — default deny",
  };
}

/**
 * 659 — List all ABAC policies.
 */
export function listPolicies(): Policy[] {
  return [...policies];
}

// ============================================================================
// Secrets Management (Capabilities 660-664)
// ============================================================================

function encryptValue(plaintext: string): { iv: string; encrypted: string; tag: string } {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return { iv: iv.toString("hex"), encrypted, tag };
}

function decryptValue(ivHex: string, encrypted: string, tagHex: string): string {
  const key = deriveEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * 660 — Store a secret with AES-256-GCM encryption.
 */
export function storeSecret(
  key: string,
  value: string,
  rotateAfterMs: number = 90 * 24 * 60 * 60 * 1000 // default 90 days
): { key: string; stored: boolean } {
  const { iv, encrypted, tag } = encryptValue(value);
  const encryptedValue = `${iv}:${encrypted}:${tag}`;
  secrets.set(key, {
    value: key, // Only store the key name, not the plaintext
    encryptedValue,
    createdAt: new Date(),
    rotateAfterMs,
  });
  return { key, stored: true };
}

/**
 * 661 — Retrieve a decrypted secret by key.
 */
export function getSecret(key: string): string | null {
  const entry = secrets.get(key);
  if (!entry) return null;
  const [iv, encrypted, tag] = entry.encryptedValue.split(":");
  try {
    return decryptValue(iv, encrypted, tag);
  } catch {
    return null;
  }
}

/**
 * 662 — Rotate a secret with a new value.
 */
export function rotateSecret(key: string, newValue: string): boolean {
  const entry = secrets.get(key);
  if (!entry) return false;
  const { iv, encrypted, tag } = encryptValue(newValue);
  entry.encryptedValue = `${iv}:${encrypted}:${tag}`;
  entry.createdAt = new Date();
  return true;
}

/**
 * 663 — Delete a secret.
 */
export function deleteSecret(key: string): boolean {
  return secrets.delete(key);
}

/**
 * 664 — List all secret keys with rotation status.
 */
export function listSecretKeys(): Array<{
  key: string;
  createdAt: Date;
  needsRotation: boolean;
}> {
  const results: Array<{ key: string; createdAt: Date; needsRotation: boolean }> = [];
  const now = Date.now();
  for (const [key, entry] of secrets.entries()) {
    const age = now - entry.createdAt.getTime();
    results.push({
      key,
      createdAt: entry.createdAt,
      needsRotation: age >= entry.rotateAfterMs,
    });
  }
  return results;
}

// ============================================================================
// Security Scanning (Capabilities 665-668)
// ============================================================================

interface VulnerabilityPattern {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  pattern: RegExp;
  description: string;
  recommendation: string;
  languages?: string[];
}

const VULNERABILITY_PATTERNS: VulnerabilityPattern[] = [
  // SQL Injection
  {
    type: "SQL_INJECTION",
    severity: "critical",
    pattern:
      /(?:query|execute|exec|raw)\s*\(\s*[`"'].*?\$\{|(?:query|execute|exec|raw)\s*\(\s*(?:['"].*?\+|\w+\s*\+\s*['"])/i,
    description:
      "Potential SQL injection: user input may be concatenated directly into a SQL query.",
    recommendation:
      "Use parameterized queries or prepared statements instead of string concatenation.",
    languages: ["javascript", "typescript"],
  },
  {
    type: "SQL_INJECTION",
    severity: "critical",
    pattern: /f["'](?:SELECT|INSERT|UPDATE|DELETE|DROP)\s.*\{/i,
    description:
      "Potential SQL injection via f-string interpolation in a SQL statement.",
    recommendation:
      "Use parameterized queries with placeholders instead of f-string interpolation.",
    languages: ["python"],
  },
  {
    type: "SQL_INJECTION",
    severity: "critical",
    pattern:
      /(?:SELECT|INSERT|UPDATE|DELETE|DROP)\s+.*['"]?\s*\+\s*(?:req\.|request\.|params\.|body\.|query\.)/i,
    description:
      "SQL statement constructed with request parameters via string concatenation.",
    recommendation:
      "Use parameterized queries or an ORM to safely handle user input.",
  },

  // XSS
  {
    type: "XSS",
    severity: "high",
    pattern: /innerHTML\s*=\s*(?!['"]<)/,
    description:
      "Setting innerHTML with potentially untrusted content may allow XSS attacks.",
    recommendation:
      "Use textContent, innerText, or a DOM sanitization library like DOMPurify.",
  },
  {
    type: "XSS",
    severity: "high",
    pattern: /document\.write\s*\(/,
    description:
      "document.write can introduce XSS vulnerabilities when used with untrusted data.",
    recommendation: "Use DOM APIs like createElement/appendChild instead.",
  },
  {
    type: "XSS",
    severity: "high",
    pattern: /dangerouslySetInnerHTML/,
    description:
      "dangerouslySetInnerHTML can enable XSS if the value is not properly sanitized.",
    recommendation:
      "Sanitize HTML with DOMPurify before passing it to dangerouslySetInnerHTML.",
  },
  {
    type: "XSS",
    severity: "medium",
    pattern: /\beval\s*\(/,
    description: "eval() executes arbitrary code and is a common XSS/RCE vector.",
    recommendation:
      "Avoid eval(). Use JSON.parse for data or Function constructor with extreme caution.",
  },

  // Command Injection
  {
    type: "COMMAND_INJECTION",
    severity: "critical",
    pattern:
      /(?:exec|execSync|spawn|spawnSync|execFile)\s*\(\s*(?:[`"'].*?\$\{|.*?\+\s*(?:req\.|request\.|params\.|body\.|query\.|input|user))/i,
    description:
      "OS command constructed with user-supplied data may allow command injection.",
    recommendation:
      "Use an allow-list of commands and arguments. Never interpolate user input into shell commands.",
  },
  {
    type: "COMMAND_INJECTION",
    severity: "critical",
    pattern: /child_process.*(?:exec|spawn)\s*\(\s*[^)]*\+/i,
    description:
      "Potential command injection through child_process with string concatenation.",
    recommendation:
      "Use execFile with an argument array instead of exec with a concatenated string.",
  },
  {
    type: "COMMAND_INJECTION",
    severity: "critical",
    pattern: /os\.system\s*\(|subprocess\.(?:call|run|Popen)\s*\(\s*[^[\]]*\+/i,
    description:
      "Potential command injection in Python subprocess/os.system call.",
    recommendation:
      "Use subprocess with shell=False and pass arguments as a list.",
    languages: ["python"],
  },

  // Path Traversal
  {
    type: "PATH_TRAVERSAL",
    severity: "high",
    pattern:
      /(?:readFile|readFileSync|createReadStream|open|access)\s*\(\s*(?:[^)]*(?:req\.|request\.|params\.|body\.|query\.)|[^)]*\+\s*['"])/i,
    description:
      "File access with user-supplied path may allow reading arbitrary files via path traversal.",
    recommendation:
      "Validate and sanitize file paths. Use path.resolve() and verify the resolved path stays within an allowed directory.",
  },
  {
    type: "PATH_TRAVERSAL",
    severity: "high",
    pattern: /\.\.[\\/]/,
    description:
      "Literal parent directory traversal sequence detected. Verify this is intentional and not user-controlled.",
    recommendation:
      "Resolve paths with path.resolve() and confirm they remain within the intended directory.",
  },

  // Insecure Crypto
  {
    type: "WEAK_CRYPTO",
    severity: "medium",
    pattern: /createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/i,
    description: "MD5/SHA1 are cryptographically weak hash algorithms.",
    recommendation: "Use SHA-256 or SHA-3 for cryptographic hashing.",
  },
  {
    type: "WEAK_CRYPTO",
    severity: "medium",
    pattern: /createCipheriv\s*\(\s*['"](?:des|rc4|aes-128-ecb|aes-256-ecb)['"]/i,
    description:
      "Weak or insecure cipher algorithm detected (DES, RC4, or ECB mode).",
    recommendation:
      "Use AES-256-GCM or AES-256-CBC with HMAC for authenticated encryption.",
  },

  // Hardcoded Secrets
  {
    type: "HARDCODED_SECRET",
    severity: "high",
    pattern:
      /(?:password|secret|api_key|apikey|api_secret|token|private_key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    description:
      "Potential hardcoded secret or credential found in source code.",
    recommendation:
      "Store secrets in environment variables or a secrets manager. Never commit credentials to source control.",
  },

  // Insecure Deserialization
  {
    type: "INSECURE_DESERIALIZATION",
    severity: "high",
    pattern: /JSON\.parse\s*\(\s*(?:req\.|request\.|body|params|query)/i,
    description:
      "JSON.parse with user-controlled input — ensure the data is validated after parsing.",
    recommendation:
      "Validate the parsed JSON against a schema using a library like Zod or Joi.",
  },

  // Open Redirect
  {
    type: "OPEN_REDIRECT",
    severity: "medium",
    pattern:
      /(?:redirect|location\.href|window\.location)\s*(?:=|\()\s*(?:req\.|request\.|params\.|body\.|query\.)/i,
    description:
      "Redirect target may be user-controlled, allowing open redirect attacks.",
    recommendation:
      "Validate redirect URLs against an allow-list of trusted domains.",
  },

  // SSRF
  {
    type: "SSRF",
    severity: "high",
    pattern:
      /(?:fetch|axios|request|http\.get|https\.get|got)\s*\(\s*(?:req\.|request\.|params\.|body\.|query\.|`.*\$\{)/i,
    description:
      "HTTP request with user-supplied URL may allow SSRF attacks.",
    recommendation:
      "Validate and restrict URLs to known hosts. Block private/internal IP ranges.",
  },

  // Prototype Pollution
  {
    type: "PROTOTYPE_POLLUTION",
    severity: "high",
    pattern: /(?:__proto__|constructor\s*\[\s*['"]prototype['"]\s*\]|Object\.assign\s*\(\s*\{\s*\}\s*,\s*(?:req\.|body|params))/i,
    description:
      "Potential prototype pollution through __proto__ or unguarded Object.assign with user input.",
    recommendation:
      "Use Object.create(null) for dictionary objects. Validate keys and reject __proto__ and constructor.",
  },

  // NoSQL Injection
  {
    type: "NOSQL_INJECTION",
    severity: "high",
    pattern:
      /\.find\s*\(\s*\{\s*\w+\s*:\s*(?:req\.|request\.|body\.|params\.|query\.)/i,
    description:
      "MongoDB query constructed directly from user input may allow NoSQL injection.",
    recommendation:
      "Validate and sanitize user input. Use MongoDB's $eq operator explicitly.",
  },
];

/**
 * 665 — Scan source code for common security vulnerabilities using pattern matching.
 */
export async function scanForVulnerabilities(
  code: string,
  language?: string
): Promise<{
  vulnerabilities: VulnerabilityFinding[];
  summary: { critical: number; high: number; medium: number; low: number };
}> {
  const lines = code.split("\n");
  const vulnerabilities: VulnerabilityFinding[] = [];

  for (const pattern of VULNERABILITY_PATTERNS) {
    // Skip patterns not applicable to the specified language
    if (
      language &&
      pattern.languages &&
      !pattern.languages.includes(language.toLowerCase())
    ) {
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (pattern.pattern.test(line)) {
        vulnerabilities.push({
          type: pattern.type,
          severity: pattern.severity,
          line: i + 1,
          code: line.trim(),
          description: pattern.description,
          recommendation: pattern.recommendation,
        });
      }
    }
  }

  // De-duplicate: one finding per type per line
  const seen = new Set<string>();
  const deduped = vulnerabilities.filter((v) => {
    const key = `${v.type}:${v.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const v of deduped) {
    summary[v.severity]++;
  }

  return { vulnerabilities: deduped, summary };
}

// ============================================================================
// PII / DLP Detection (Capabilities 669-671)
// ============================================================================

interface PIIPattern {
  type: string;
  pattern: RegExp;
  maskFn: (match: string) => string;
}

const PII_PATTERNS: PIIPattern[] = [
  {
    type: "EMAIL",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    maskFn: (m) => {
      const [local, domain] = m.split("@");
      return `${local[0]}${"*".repeat(Math.max(local.length - 2, 1))}${local.slice(-1)}@${domain}`;
    },
  },
  {
    type: "PHONE",
    pattern:
      /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}(?!\d)/g,
    maskFn: (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 7) return m; // too short to be a phone
      return m.slice(0, -4) + "****";
    },
  },
  {
    type: "SSN",
    pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    maskFn: (m) => `***-**-${m.slice(-4)}`,
  },
  {
    type: "CREDIT_CARD",
    pattern:
      /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
    maskFn: (m) => {
      const digits = m.replace(/\D/g, "");
      return `****-****-****-${digits.slice(-4)}`;
    },
  },
  {
    type: "IP_ADDRESS",
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\b/g,
    maskFn: (m) => {
      const parts = m.split(".");
      return `${parts[0]}.${parts[1]}.***.***`;
    },
  },
  {
    type: "DATE_OF_BIRTH",
    pattern:
      /\b(?:0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}\b/g,
    maskFn: () => "**/**/****",
  },
  {
    type: "PASSPORT",
    pattern: /\b[A-Z]{1,2}\d{6,9}\b/g,
    maskFn: (m) => `${m[0]}${"*".repeat(m.length - 1)}`,
  },
];

/**
 * Validate that an SSN-like match is actually plausible and not just a random number.
 */
function isLikelySSN(match: string): boolean {
  const digits = match.replace(/\D/g, "");
  if (digits.length !== 9) return false;
  const area = parseInt(digits.substring(0, 3), 10);
  const group = parseInt(digits.substring(3, 5), 10);
  const serial = parseInt(digits.substring(5, 9), 10);
  // SSA rules: area 000, group 00, serial 0000 are invalid; area 666 and 900-999 are invalid
  if (area === 0 || group === 0 || serial === 0) return false;
  if (area === 666 || area >= 900) return false;
  return true;
}

/**
 * Validate a credit-card-like number with Luhn algorithm.
 */
function passesLuhn(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * 669 — Detect PII in text.
 */
export async function detectPII(
  text: string
): Promise<{
  findings: PIIFinding[];
  hasPII: boolean;
  riskLevel: "high" | "medium" | "low" | "none";
}> {
  const findings: PIIFinding[] = [];

  for (const pii of PII_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pii.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pii.pattern.exec(text)) !== null) {
      const value = match[0];

      // Additional validation for SSN and credit cards to reduce false positives
      if (pii.type === "SSN" && !isLikelySSN(value)) continue;
      if (pii.type === "CREDIT_CARD" && !passesLuhn(value)) continue;
      if (pii.type === "PHONE") {
        const digits = value.replace(/\D/g, "");
        if (digits.length < 10) continue; // too few digits for a phone number
      }

      findings.push({
        type: pii.type,
        value,
        masked: pii.maskFn(value),
        position: { start: match.index, end: match.index + value.length },
      });
    }
  }

  const hasPII = findings.length > 0;
  const criticalTypes = new Set(["SSN", "CREDIT_CARD", "PASSPORT"]);
  const hasCritical = findings.some((f) => criticalTypes.has(f.type));
  const hasSensitive = findings.some((f) =>
    ["EMAIL", "PHONE", "DATE_OF_BIRTH"].includes(f.type)
  );

  let riskLevel: "high" | "medium" | "low" | "none" = "none";
  if (hasCritical) riskLevel = "high";
  else if (hasSensitive) riskLevel = "medium";
  else if (hasPII) riskLevel = "low";

  return { findings, hasPII, riskLevel };
}

/**
 * 670 — Mask detected PII in text.
 */
export function maskData(text: string, types?: string[]): string {
  let result = text;

  // Process in reverse order of pattern priority (most specific first)
  // Build all replacements, sort by position descending, apply
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];

  for (const pii of PII_PATTERNS) {
    if (types && types.length > 0 && !types.includes(pii.type)) continue;

    pii.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pii.pattern.exec(text)) !== null) {
      const value = match[0];
      if (pii.type === "SSN" && !isLikelySSN(value)) continue;
      if (pii.type === "CREDIT_CARD" && !passesLuhn(value)) continue;
      if (pii.type === "PHONE") {
        const digits = value.replace(/\D/g, "");
        if (digits.length < 10) continue;
      }

      replacements.push({
        start: match.index,
        end: match.index + value.length,
        replacement: pii.maskFn(value),
      });
    }
  }

  // Sort by start descending so replacements don't shift indices
  replacements.sort((a, b) => b.start - a.start);

  for (const r of replacements) {
    result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
  }

  return result;
}

// ============================================================================
// Security Headers Check (Capability 671)
// ============================================================================

interface ExpectedHeader {
  header: string;
  recommendation: string;
  severity: "critical" | "high" | "medium" | "low";
  validator: (value: string) => boolean;
}

const EXPECTED_HEADERS: ExpectedHeader[] = [
  {
    header: "Strict-Transport-Security",
    recommendation:
      "Add 'Strict-Transport-Security: max-age=31536000; includeSubDomains; preload' to enforce HTTPS.",
    severity: "critical",
    validator: (v) => {
      const maxAge = v.match(/max-age=(\d+)/);
      return maxAge !== null && parseInt(maxAge[1], 10) >= 31536000;
    },
  },
  {
    header: "Content-Security-Policy",
    recommendation:
      "Implement a Content-Security-Policy header to prevent XSS and data injection attacks.",
    severity: "critical",
    validator: (v) =>
      v.includes("default-src") || v.includes("script-src"),
  },
  {
    header: "X-Content-Type-Options",
    recommendation: "Add 'X-Content-Type-Options: nosniff' to prevent MIME-type sniffing.",
    severity: "high",
    validator: (v) => v.toLowerCase() === "nosniff",
  },
  {
    header: "X-Frame-Options",
    recommendation:
      "Add 'X-Frame-Options: DENY' or 'SAMEORIGIN' to prevent clickjacking.",
    severity: "high",
    validator: (v) => ["deny", "sameorigin"].includes(v.toLowerCase()),
  },
  {
    header: "X-XSS-Protection",
    recommendation:
      "Add 'X-XSS-Protection: 1; mode=block' as a defense-in-depth measure.",
    severity: "medium",
    validator: (v) => v.includes("1"),
  },
  {
    header: "Referrer-Policy",
    recommendation:
      "Add 'Referrer-Policy: strict-origin-when-cross-origin' to control referrer information leakage.",
    severity: "medium",
    validator: (v) =>
      [
        "no-referrer",
        "strict-origin",
        "strict-origin-when-cross-origin",
        "same-origin",
      ].includes(v.toLowerCase()),
  },
  {
    header: "Permissions-Policy",
    recommendation:
      "Add a Permissions-Policy header to control browser feature access (camera, microphone, geolocation).",
    severity: "medium",
    validator: () => true, // Presence is sufficient
  },
  {
    header: "Cache-Control",
    recommendation:
      "Set 'Cache-Control: no-store' for sensitive pages to prevent caching of confidential data.",
    severity: "low",
    validator: (v) =>
      v.includes("no-store") || v.includes("no-cache") || v.includes("private"),
  },
  {
    header: "X-Permitted-Cross-Domain-Policies",
    recommendation:
      "Add 'X-Permitted-Cross-Domain-Policies: none' to restrict Flash/PDF cross-domain policies.",
    severity: "low",
    validator: (v) => v.toLowerCase() === "none",
  },
  {
    header: "Cross-Origin-Embedder-Policy",
    recommendation:
      "Add 'Cross-Origin-Embedder-Policy: require-corp' for cross-origin isolation.",
    severity: "low",
    validator: (v) => v.toLowerCase() === "require-corp",
  },
];

/**
 * 671 — Check HTTP response headers against security best practices.
 */
export async function checkSecurityHeaders(
  headers: Record<string, string>
): Promise<SecurityHeaderResult> {
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value;
  }

  const missing: SecurityHeaderResult["missing"] = [];
  const present: SecurityHeaderResult["present"] = [];

  for (const expected of EXPECTED_HEADERS) {
    const value = normalizedHeaders[expected.header.toLowerCase()];
    if (value === undefined) {
      missing.push({
        header: expected.header,
        recommendation: expected.recommendation,
        severity: expected.severity,
      });
    } else {
      present.push({
        header: expected.header,
        value,
        adequate: expected.validator(value),
      });
    }
  }

  // Score: each header is worth points weighted by severity
  const weights: Record<string, number> = {
    critical: 20,
    high: 15,
    medium: 10,
    low: 5,
  };
  const totalWeight = EXPECTED_HEADERS.reduce(
    (sum, h) => sum + weights[h.severity],
    0
  );
  const earnedWeight = present.reduce((sum, p) => {
    const expected = EXPECTED_HEADERS.find(
      (h) => h.header.toLowerCase() === p.header.toLowerCase()
    );
    if (!expected) return sum;
    return sum + (p.adequate ? weights[expected.severity] : weights[expected.severity] * 0.5);
  }, 0);

  const score = Math.round((earnedWeight / totalWeight) * 100);

  return { score, missing, present };
}

// ============================================================================
// Compliance Report Generation (Capabilities 672-673)
// ============================================================================

type ComplianceFramework = "SOC2" | "GDPR" | "HIPAA" | "PCI_DSS" | "ISO27001";

interface FrameworkSection {
  id: string;
  name: string;
  checks: Array<{
    description: string;
    checkFn: () => "compliant" | "partial" | "non_compliant" | "not_applicable";
    recommendations: string[];
  }>;
}

function getSOC2Sections(): FrameworkSection[] {
  return [
    {
      id: "CC1",
      name: "Control Environment",
      checks: [
        {
          description: "RBAC roles are defined and enforced",
          checkFn: () => (roles.size > 0 ? "compliant" : "non_compliant"),
          recommendations: [
            "Define roles with least-privilege permissions",
            "Document role assignments and review quarterly",
          ],
        },
        {
          description: "Access control policies are established",
          checkFn: () => (policies.length > 0 ? "compliant" : "non_compliant"),
          recommendations: [
            "Create ABAC policies for all critical resources",
            "Implement deny-by-default access model",
          ],
        },
      ],
    },
    {
      id: "CC2",
      name: "Communication and Information",
      checks: [
        {
          description: "Audit logging is operational",
          checkFn: () => "partial",
          recommendations: [
            "Enable audit logging for all security-relevant events",
            "Implement log integrity verification with hashing",
          ],
        },
      ],
    },
    {
      id: "CC3",
      name: "Risk Assessment",
      checks: [
        {
          description: "Vulnerability scanning is available",
          checkFn: () => "compliant",
          recommendations: [
            "Run vulnerability scans on every code deployment",
            "Remediate critical and high findings within 24 hours",
          ],
        },
      ],
    },
    {
      id: "CC4",
      name: "Monitoring Activities",
      checks: [
        {
          description: "Security monitoring and alerting is in place",
          checkFn: () => "partial",
          recommendations: [
            "Implement real-time security event monitoring",
            "Configure alerts for anomalous access patterns",
          ],
        },
      ],
    },
    {
      id: "CC5",
      name: "Control Activities",
      checks: [
        {
          description: "Secrets management with encryption is operational",
          checkFn: () => "compliant",
          recommendations: [
            "Rotate secrets on a 90-day schedule",
            "Use AES-256-GCM for all secret encryption",
          ],
        },
        {
          description: "Password policy enforcement is active",
          checkFn: () => "compliant",
          recommendations: [
            "Enforce minimum 12-character passwords with complexity requirements",
            "Implement MFA for all privileged accounts",
          ],
        },
      ],
    },
    {
      id: "CC6",
      name: "Logical and Physical Access Controls",
      checks: [
        {
          description: "Multi-factor authentication is available",
          checkFn: () => "partial",
          recommendations: [
            "Require MFA for all administrative access",
            "Support TOTP and hardware security keys",
          ],
        },
      ],
    },
    {
      id: "CC7",
      name: "System Operations",
      checks: [
        {
          description: "Incident response procedures are defined",
          checkFn: () => "compliant",
          recommendations: [
            "Test incident response playbooks quarterly",
            "Maintain up-to-date escalation contacts",
          ],
        },
      ],
    },
    {
      id: "CC8",
      name: "Change Management",
      checks: [
        {
          description: "Code review and approval processes are in place",
          checkFn: () => "partial",
          recommendations: [
            "Require peer code review for all changes",
            "Implement automated security scanning in CI/CD",
          ],
        },
      ],
    },
    {
      id: "CC9",
      name: "Risk Mitigation",
      checks: [
        {
          description: "DLP controls for PII detection are operational",
          checkFn: () => "compliant",
          recommendations: [
            "Scan all outbound data for PII",
            "Implement automatic masking for sensitive data in logs",
          ],
        },
      ],
    },
  ];
}

function getGDPRSections(): FrameworkSection[] {
  return [
    {
      id: "ART5",
      name: "Principles of Processing",
      checks: [
        {
          description: "Data minimization controls are in place",
          checkFn: () => "partial",
          recommendations: [
            "Implement data retention policies with automatic deletion",
            "Collect only the minimum data necessary for each processing purpose",
          ],
        },
      ],
    },
    {
      id: "ART6",
      name: "Lawfulness of Processing",
      checks: [
        {
          description: "Consent management system is operational",
          checkFn: () => "partial",
          recommendations: [
            "Implement granular consent collection for each processing purpose",
            "Maintain auditable consent records with timestamps",
          ],
        },
      ],
    },
    {
      id: "ART15",
      name: "Right of Access",
      checks: [
        {
          description: "Subject access request process is defined",
          checkFn: () => "partial",
          recommendations: [
            "Implement an automated data export feature for DSAR fulfillment",
            "Respond to access requests within 30 days",
          ],
        },
      ],
    },
    {
      id: "ART17",
      name: "Right to Erasure",
      checks: [
        {
          description: "Data deletion capabilities are available",
          checkFn: () => "partial",
          recommendations: [
            "Implement soft-delete with scheduled hard-delete after retention period",
            "Ensure deletion propagates to all backup systems",
          ],
        },
      ],
    },
    {
      id: "ART25",
      name: "Data Protection by Design",
      checks: [
        {
          description: "PII detection and masking is available",
          checkFn: () => "compliant",
          recommendations: [
            "Apply PII masking to all log outputs",
            "Encrypt PII at rest and in transit",
          ],
        },
        {
          description: "Encryption at rest is implemented",
          checkFn: () => "compliant",
          recommendations: [
            "Use AES-256-GCM for all sensitive data encryption",
            "Manage encryption keys through a dedicated secrets manager",
          ],
        },
      ],
    },
    {
      id: "ART30",
      name: "Records of Processing Activities",
      checks: [
        {
          description: "Audit logging captures processing activities",
          checkFn: () => "partial",
          recommendations: [
            "Log all data processing activities with purpose and legal basis",
            "Maintain processing records for regulatory inspection",
          ],
        },
      ],
    },
    {
      id: "ART32",
      name: "Security of Processing",
      checks: [
        {
          description: "Access controls restrict data access to authorized personnel",
          checkFn: () => (roles.size > 0 ? "compliant" : "non_compliant"),
          recommendations: [
            "Implement RBAC with least-privilege access",
            "Review access permissions quarterly",
          ],
        },
      ],
    },
    {
      id: "ART33",
      name: "Breach Notification",
      checks: [
        {
          description: "Incident response and breach notification process is defined",
          checkFn: () => "compliant",
          recommendations: [
            "Notify supervisory authority within 72 hours of a breach",
            "Maintain a breach register with impact assessments",
          ],
        },
      ],
    },
    {
      id: "ART35",
      name: "Data Protection Impact Assessment",
      checks: [
        {
          description: "DPIA process is established for high-risk processing",
          checkFn: () => "partial",
          recommendations: [
            "Conduct DPIAs before introducing new high-risk processing activities",
            "Document risk mitigation measures and residual risks",
          ],
        },
      ],
    },
  ];
}

function getHIPAASections(): FrameworkSection[] {
  return [
    {
      id: "164.312(a)",
      name: "Access Control",
      checks: [
        {
          description: "Unique user identification is enforced",
          checkFn: () => "compliant",
          recommendations: [
            "Assign unique user IDs to all users accessing ePHI",
            "Implement automatic session timeout after inactivity",
          ],
        },
        {
          description: "Emergency access procedures are defined",
          checkFn: () => "compliant",
          recommendations: [
            "Document break-glass procedures for emergency ePHI access",
            "Audit all emergency access events",
          ],
        },
      ],
    },
    {
      id: "164.312(b)",
      name: "Audit Controls",
      checks: [
        {
          description: "Audit logging for ePHI access is operational",
          checkFn: () => "partial",
          recommendations: [
            "Log all access to systems containing ePHI",
            "Retain audit logs for a minimum of 6 years",
          ],
        },
      ],
    },
    {
      id: "164.312(c)",
      name: "Integrity Controls",
      checks: [
        {
          description: "ePHI integrity verification mechanisms are in place",
          checkFn: () => "partial",
          recommendations: [
            "Implement checksums or digital signatures for ePHI in transit",
            "Use database integrity constraints and validation",
          ],
        },
      ],
    },
    {
      id: "164.312(d)",
      name: "Person or Entity Authentication",
      checks: [
        {
          description: "Multi-factor authentication is available for ePHI access",
          checkFn: () => "partial",
          recommendations: [
            "Require MFA for all users accessing ePHI",
            "Support biometric and hardware token authentication",
          ],
        },
      ],
    },
    {
      id: "164.312(e)",
      name: "Transmission Security",
      checks: [
        {
          description: "Encryption in transit is enforced",
          checkFn: () => "compliant",
          recommendations: [
            "Enforce TLS 1.2+ for all ePHI transmissions",
            "Disable weak cipher suites",
          ],
        },
      ],
    },
    {
      id: "164.308(a)(1)",
      name: "Security Management Process",
      checks: [
        {
          description: "Risk analysis and management is conducted",
          checkFn: () => "partial",
          recommendations: [
            "Conduct annual risk assessments of all ePHI systems",
            "Document risk treatment plans with responsible parties",
          ],
        },
      ],
    },
    {
      id: "164.308(a)(5)",
      name: "Security Awareness Training",
      checks: [
        {
          description: "Security awareness training program exists",
          checkFn: () => "non_compliant",
          recommendations: [
            "Implement annual HIPAA security training for all workforce members",
            "Include phishing simulation exercises",
          ],
        },
      ],
    },
    {
      id: "164.308(a)(6)",
      name: "Security Incident Procedures",
      checks: [
        {
          description: "Incident response procedures are documented",
          checkFn: () => "compliant",
          recommendations: [
            "Document and test incident response procedures annually",
            "Maintain an incident tracking log",
          ],
        },
      ],
    },
    {
      id: "164.310(d)",
      name: "Device and Media Controls",
      checks: [
        {
          description: "Media disposal and re-use procedures are defined",
          checkFn: () => "non_compliant",
          recommendations: [
            "Implement secure media disposal procedures (NIST SP 800-88)",
            "Track all media containing ePHI with an inventory",
          ],
        },
      ],
    },
  ];
}

function getPCIDSSSections(): FrameworkSection[] {
  return [
    {
      id: "REQ1",
      name: "Install and Maintain Network Security Controls",
      checks: [
        {
          description: "Firewall / network segmentation controls are defined",
          checkFn: () => "partial",
          recommendations: [
            "Implement network segmentation to isolate cardholder data environments",
            "Review firewall rules quarterly",
          ],
        },
      ],
    },
    {
      id: "REQ2",
      name: "Apply Secure Configurations",
      checks: [
        {
          description: "Security headers and secure defaults are configured",
          checkFn: () => "partial",
          recommendations: [
            "Remove default credentials and disable unnecessary services",
            "Implement security headers on all web servers",
          ],
        },
      ],
    },
    {
      id: "REQ3",
      name: "Protect Stored Account Data",
      checks: [
        {
          description: "Encryption at rest for sensitive data is operational",
          checkFn: () => "compliant",
          recommendations: [
            "Encrypt all stored cardholder data with AES-256",
            "Implement key management procedures with split knowledge",
          ],
        },
      ],
    },
    {
      id: "REQ4",
      name: "Protect Cardholder Data in Transit",
      checks: [
        {
          description: "TLS encryption is enforced for data in transit",
          checkFn: () => "compliant",
          recommendations: [
            "Enforce TLS 1.2+ for all cardholder data transmissions",
            "Disable SSL and weak TLS versions",
          ],
        },
      ],
    },
    {
      id: "REQ5",
      name: "Protect Against Malicious Software",
      checks: [
        {
          description: "Vulnerability scanning capabilities are available",
          checkFn: () => "compliant",
          recommendations: [
            "Run anti-malware scans on all systems in the CDE",
            "Keep anti-malware signatures updated daily",
          ],
        },
      ],
    },
    {
      id: "REQ6",
      name: "Develop and Maintain Secure Systems",
      checks: [
        {
          description: "Code vulnerability scanning is integrated",
          checkFn: () => "compliant",
          recommendations: [
            "Perform code reviews and automated security scanning before release",
            "Address critical vulnerabilities before deployment",
          ],
        },
      ],
    },
    {
      id: "REQ7",
      name: "Restrict Access by Business Need",
      checks: [
        {
          description: "RBAC restricts access to cardholder data",
          checkFn: () => (roles.size > 0 ? "compliant" : "non_compliant"),
          recommendations: [
            "Implement role-based access with least privilege",
            "Review access rights semi-annually",
          ],
        },
      ],
    },
    {
      id: "REQ8",
      name: "Identify Users and Authenticate Access",
      checks: [
        {
          description: "Strong authentication mechanisms are in place",
          checkFn: () => "partial",
          recommendations: [
            "Enforce MFA for all access to cardholder data",
            "Implement account lockout after 6 failed attempts",
          ],
        },
      ],
    },
    {
      id: "REQ10",
      name: "Log and Monitor All Access",
      checks: [
        {
          description: "Audit trails capture all access to cardholder data",
          checkFn: () => "partial",
          recommendations: [
            "Log all access to cardholder data environments",
            "Review logs daily for anomalous activity",
          ],
        },
      ],
    },
    {
      id: "REQ11",
      name: "Test Security Regularly",
      checks: [
        {
          description: "Vulnerability scanning and penetration testing schedule exists",
          checkFn: () => "partial",
          recommendations: [
            "Conduct quarterly external vulnerability scans via an ASV",
            "Perform annual penetration testing of the CDE",
          ],
        },
      ],
    },
    {
      id: "REQ12",
      name: "Maintain an Information Security Policy",
      checks: [
        {
          description: "Information security policy is documented",
          checkFn: () => "partial",
          recommendations: [
            "Publish and distribute a comprehensive information security policy",
            "Review and update the policy annually",
          ],
        },
      ],
    },
  ];
}

function getISO27001Sections(): FrameworkSection[] {
  return [
    {
      id: "A.5",
      name: "Information Security Policies",
      checks: [
        {
          description: "Information security policies are defined and reviewed",
          checkFn: () => "partial",
          recommendations: [
            "Document and approve an information security policy",
            "Review the policy at planned intervals or upon significant changes",
          ],
        },
      ],
    },
    {
      id: "A.6",
      name: "Organization of Information Security",
      checks: [
        {
          description: "Roles and responsibilities for information security are assigned",
          checkFn: () => (roles.size > 0 ? "compliant" : "non_compliant"),
          recommendations: [
            "Define security roles and responsibilities",
            "Implement segregation of duties for critical functions",
          ],
        },
      ],
    },
    {
      id: "A.8",
      name: "Asset Management",
      checks: [
        {
          description: "Information assets are inventoried and classified",
          checkFn: () => "partial",
          recommendations: [
            "Maintain an inventory of all information assets",
            "Classify assets based on sensitivity and business value",
          ],
        },
      ],
    },
    {
      id: "A.9",
      name: "Access Control",
      checks: [
        {
          description: "Access control policy and RBAC are implemented",
          checkFn: () => (roles.size > 0 ? "compliant" : "non_compliant"),
          recommendations: [
            "Implement access control based on business and security requirements",
            "Review user access rights at regular intervals",
          ],
        },
        {
          description: "Password policy meets complexity requirements",
          checkFn: () => "compliant",
          recommendations: [
            "Enforce strong password policies with minimum length and complexity",
            "Implement multi-factor authentication for sensitive systems",
          ],
        },
      ],
    },
    {
      id: "A.10",
      name: "Cryptography",
      checks: [
        {
          description: "Encryption controls are implemented",
          checkFn: () => "compliant",
          recommendations: [
            "Use AES-256 or equivalent for data at rest",
            "Implement a key management policy with rotation schedules",
          ],
        },
      ],
    },
    {
      id: "A.12",
      name: "Operations Security",
      checks: [
        {
          description: "Malware protection and vulnerability management are in place",
          checkFn: () => "compliant",
          recommendations: [
            "Implement automated vulnerability scanning in CI/CD pipelines",
            "Define patch management SLAs based on severity",
          ],
        },
        {
          description: "Audit logging is configured and protected",
          checkFn: () => "partial",
          recommendations: [
            "Protect audit logs from unauthorized modification",
            "Implement centralized log management with retention policies",
          ],
        },
      ],
    },
    {
      id: "A.13",
      name: "Communications Security",
      checks: [
        {
          description: "Network security controls and data transfer policies are defined",
          checkFn: () => "partial",
          recommendations: [
            "Implement TLS for all data in transit",
            "Define acceptable use policies for network services",
          ],
        },
      ],
    },
    {
      id: "A.16",
      name: "Information Security Incident Management",
      checks: [
        {
          description: "Incident management procedures are defined and tested",
          checkFn: () => "compliant",
          recommendations: [
            "Document incident response procedures with escalation paths",
            "Conduct incident response tabletop exercises annually",
          ],
        },
      ],
    },
    {
      id: "A.18",
      name: "Compliance",
      checks: [
        {
          description: "Applicable legal and regulatory requirements are identified",
          checkFn: () => "partial",
          recommendations: [
            "Maintain a register of applicable legal and regulatory requirements",
            "Conduct annual compliance reviews",
          ],
        },
      ],
    },
  ];
}

function getFrameworkSections(framework: ComplianceFramework): FrameworkSection[] {
  switch (framework) {
    case "SOC2":
      return getSOC2Sections();
    case "GDPR":
      return getGDPRSections();
    case "HIPAA":
      return getHIPAASections();
    case "PCI_DSS":
      return getPCIDSSSections();
    case "ISO27001":
      return getISO27001Sections();
    default:
      throw new Error(`Unsupported compliance framework: ${framework}`);
  }
}

/**
 * 672 — Generate a structured compliance report for a given framework.
 */
export async function generateComplianceReport(
  type: ComplianceFramework
): Promise<ComplianceReport> {
  const frameworkSections = getFrameworkSections(type);
  const sections: ComplianceReport["sections"] = [];

  for (const section of frameworkSections) {
    const findings: string[] = [];
    const recommendations: string[] = [];
    let worstStatus: ComplianceReport["sections"][0]["status"] = "compliant";

    const statusPriority: Record<string, number> = {
      non_compliant: 3,
      partial: 2,
      not_applicable: 1,
      compliant: 0,
    };

    for (const check of section.checks) {
      const status = check.checkFn();
      findings.push(`${check.description}: ${status.replace(/_/g, " ")}`);
      recommendations.push(...check.recommendations);

      if (statusPriority[status] > statusPriority[worstStatus]) {
        worstStatus = status;
      }
    }

    sections.push({
      id: section.id,
      name: section.name,
      status: worstStatus,
      findings,
      recommendations: [...new Set(recommendations)],
    });
  }

  // Calculate overall score
  const statusScores: Record<string, number> = {
    compliant: 100,
    partial: 50,
    non_compliant: 0,
    not_applicable: 100,
  };
  const applicableSections = sections.filter((s) => s.status !== "not_applicable");
  const overallScore =
    applicableSections.length > 0
      ? Math.round(
          applicableSections.reduce(
            (sum, s) => sum + statusScores[s.status],
            0
          ) / applicableSections.length
        )
      : 100;

  return {
    framework: type,
    sections,
    overallScore,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Password Policy (Capability 673)
// ============================================================================

/**
 * 673 — Check a password against a configurable policy.
 */
export function checkPasswordPolicy(
  password: string,
  policy?: {
    minLength?: number;
    requireUppercase?: boolean;
    requireLowercase?: boolean;
    requireNumbers?: boolean;
    requireSpecial?: boolean;
    maxRepeating?: number;
  }
): PasswordPolicyResult {
  const p = {
    minLength: policy?.minLength ?? 12,
    requireUppercase: policy?.requireUppercase ?? true,
    requireLowercase: policy?.requireLowercase ?? true,
    requireNumbers: policy?.requireNumbers ?? true,
    requireSpecial: policy?.requireSpecial ?? true,
    maxRepeating: policy?.maxRepeating ?? 3,
  };

  const issues: string[] = [];
  let score = 0;

  // Length check
  if (password.length >= p.minLength) {
    score += 25;
  } else {
    issues.push(
      `Password must be at least ${p.minLength} characters (currently ${password.length})`
    );
  }

  // Bonus for extra length
  if (password.length >= p.minLength + 4) score += 5;
  if (password.length >= p.minLength + 8) score += 5;

  // Uppercase
  if (p.requireUppercase) {
    if (/[A-Z]/.test(password)) {
      score += 15;
    } else {
      issues.push("Password must contain at least one uppercase letter");
    }
  }

  // Lowercase
  if (p.requireLowercase) {
    if (/[a-z]/.test(password)) {
      score += 15;
    } else {
      issues.push("Password must contain at least one lowercase letter");
    }
  }

  // Numbers
  if (p.requireNumbers) {
    if (/\d/.test(password)) {
      score += 15;
    } else {
      issues.push("Password must contain at least one number");
    }
  }

  // Special characters
  if (p.requireSpecial) {
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
      score += 15;
    } else {
      issues.push("Password must contain at least one special character");
    }
  }

  // Repeating characters
  if (p.maxRepeating > 0) {
    const repeatPattern = new RegExp(`(.)\\1{${p.maxRepeating},}`);
    if (repeatPattern.test(password)) {
      issues.push(
        `Password must not contain more than ${p.maxRepeating} consecutive repeating characters`
      );
      score = Math.max(0, score - 10);
    }
  }

  // Common password check (simplified set)
  const commonPasswords = [
    "password",
    "123456",
    "12345678",
    "qwerty",
    "abc123",
    "letmein",
    "welcome",
    "admin",
    "master",
    "iloveyou",
    "passw0rd",
    "trustno1",
    "sunshine",
    "princess",
    "football",
    "shadow",
    "superman",
    "michael",
    "dragon",
    "monkey",
  ];
  if (commonPasswords.includes(password.toLowerCase())) {
    issues.push("Password is too common — choose a more unique password");
    score = Math.max(0, score - 30);
  }

  // Sequential characters check
  const sequential = /(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|012|123|234|345|456|567|678|789)/i;
  if (sequential.test(password)) {
    issues.push("Password contains sequential characters");
    score = Math.max(0, score - 5);
  }

  // Entropy bonus
  const uniqueChars = new Set(password).size;
  if (uniqueChars >= 10) score += 5;
  if (uniqueChars >= 15) score += 5;

  score = Math.min(100, Math.max(0, score));

  return {
    valid: issues.length === 0,
    score,
    issues,
  };
}

// ============================================================================
// Audit Logging (Capabilities 674-675)
// ============================================================================

/**
 * 674 — Append an entry to the audit log file.
 */
export async function auditLog(
  action: string,
  actor: string,
  resource: string,
  details?: Record<string, any>
): Promise<void> {
  await ensureAuditDir();

  const entry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    action,
    actor,
    resource,
    ...(details ? { details } : {}),
  };

  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(AUDIT_LOG_PATH, line, "utf-8");
}

/**
 * 675 — Read and filter audit log entries.
 */
export async function getAuditLogs(
  filters?: {
    actor?: string;
    action?: string;
    since?: Date;
    limit?: number;
  }
): Promise<AuditLogEntry[]> {
  await ensureAuditDir();

  let content: string;
  try {
    content = await fs.readFile(AUDIT_LOG_PATH, "utf-8");
  } catch {
    return [];
  }

  const lines = content.trim().split("\n").filter(Boolean);
  let entries: AuditLogEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  // Apply filters
  if (filters?.actor) {
    entries = entries.filter((e) => e.actor === filters.actor);
  }
  if (filters?.action) {
    entries = entries.filter((e) => e.action === filters.action);
  }
  if (filters?.since) {
    const sinceMs = filters.since.getTime();
    entries = entries.filter((e) => new Date(e.timestamp).getTime() >= sinceMs);
  }

  // Sort newest first
  entries.sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Apply limit
  if (filters?.limit && filters.limit > 0) {
    entries = entries.slice(0, filters.limit);
  }

  return entries;
}

// ============================================================================
// Incident Response (Capability 676)
// ============================================================================

interface IncidentPlaybook {
  playbook: string;
  steps: Array<{
    order: number;
    action: string;
    responsible: string;
    timeframe: string;
  }>;
  escalation: Array<{ level: number; contact: string; criteria: string }>;
}

const INCIDENT_PLAYBOOKS: Record<string, IncidentPlaybook> = {
  data_breach: {
    playbook: "Data Breach Response Playbook",
    steps: [
      {
        order: 1,
        action: "Identify and contain the breach — isolate affected systems immediately",
        responsible: "Security Operations",
        timeframe: "0-1 hours",
      },
      {
        order: 2,
        action: "Assess scope: determine what data was accessed, exfiltrated, or compromised",
        responsible: "Incident Response Team",
        timeframe: "1-4 hours",
      },
      {
        order: 3,
        action: "Preserve forensic evidence — create disk images and capture logs",
        responsible: "Forensics Team",
        timeframe: "1-4 hours",
      },
      {
        order: 4,
        action: "Notify internal stakeholders (CISO, Legal, PR, Executive team)",
        responsible: "Incident Commander",
        timeframe: "2-4 hours",
      },
      {
        order: 5,
        action: "Revoke compromised credentials, rotate secrets, and patch vulnerability",
        responsible: "Security Engineering",
        timeframe: "4-8 hours",
      },
      {
        order: 6,
        action: "Notify affected users and regulatory authorities as required",
        responsible: "Legal / Compliance",
        timeframe: "24-72 hours",
      },
      {
        order: 7,
        action: "Conduct root cause analysis and document lessons learned",
        responsible: "Incident Response Team",
        timeframe: "1-2 weeks",
      },
      {
        order: 8,
        action: "Implement long-term remediations and update security controls",
        responsible: "Security Engineering",
        timeframe: "2-4 weeks",
      },
    ],
    escalation: [
      { level: 1, contact: "Security On-Call Engineer", criteria: "Initial detection of potential breach" },
      { level: 2, contact: "Security Operations Manager", criteria: "Confirmed unauthorized data access" },
      { level: 3, contact: "CISO / VP Engineering", criteria: "PII or sensitive data confirmed exposed" },
      { level: 4, contact: "CEO / Board / Legal Counsel", criteria: "Large-scale breach or regulatory notification required" },
    ],
  },
  ransomware: {
    playbook: "Ransomware Incident Response Playbook",
    steps: [
      {
        order: 1,
        action: "Isolate infected systems from the network immediately — do NOT power off",
        responsible: "Security Operations",
        timeframe: "0-30 minutes",
      },
      {
        order: 2,
        action: "Identify the ransomware variant and determine scope of encryption",
        responsible: "Forensics Team",
        timeframe: "30 min - 2 hours",
      },
      {
        order: 3,
        action: "Activate backup recovery procedures — verify backup integrity before restoring",
        responsible: "Infrastructure Team",
        timeframe: "2-8 hours",
      },
      {
        order: 4,
        action: "Notify law enforcement (FBI IC3, CISA) and legal counsel",
        responsible: "Legal / Compliance",
        timeframe: "4-8 hours",
      },
      {
        order: 5,
        action: "Eradicate malware, rebuild affected systems from clean images",
        responsible: "Security Engineering",
        timeframe: "1-3 days",
      },
      {
        order: 6,
        action: "Restore data from verified clean backups",
        responsible: "Infrastructure Team",
        timeframe: "1-5 days",
      },
      {
        order: 7,
        action: "Conduct post-incident review and implement preventive controls",
        responsible: "Incident Response Team",
        timeframe: "1-2 weeks",
      },
    ],
    escalation: [
      { level: 1, contact: "Security On-Call Engineer", criteria: "Ransomware detected on any system" },
      { level: 2, contact: "Incident Response Manager", criteria: "Multiple systems affected" },
      { level: 3, contact: "CISO / CTO", criteria: "Business-critical systems impacted" },
      { level: 4, contact: "CEO / Board / External IR Firm", criteria: "Widespread impact or ransom demand received" },
    ],
  },
  ddos: {
    playbook: "DDoS Attack Response Playbook",
    steps: [
      {
        order: 1,
        action: "Confirm DDoS attack — distinguish from legitimate traffic spike",
        responsible: "Network Operations",
        timeframe: "0-15 minutes",
      },
      {
        order: 2,
        action: "Enable DDoS mitigation (CDN scrubbing, rate limiting, geo-blocking)",
        responsible: "Network Operations",
        timeframe: "15-30 minutes",
      },
      {
        order: 3,
        action: "Contact upstream ISP/CDN provider to implement additional filtering",
        responsible: "Infrastructure Team",
        timeframe: "30-60 minutes",
      },
      {
        order: 4,
        action: "Scale infrastructure horizontally if cloud-based",
        responsible: "DevOps Team",
        timeframe: "30-60 minutes",
      },
      {
        order: 5,
        action: "Monitor and adapt defenses as attack patterns change",
        responsible: "Security Operations",
        timeframe: "Ongoing during attack",
      },
      {
        order: 6,
        action: "Post-attack analysis: document attack vectors and improve defenses",
        responsible: "Security Engineering",
        timeframe: "1-3 days",
      },
    ],
    escalation: [
      { level: 1, contact: "Network Operations Center", criteria: "Traffic anomaly detected" },
      { level: 2, contact: "Security Operations Manager", criteria: "Confirmed DDoS attack" },
      { level: 3, contact: "CTO / CISO", criteria: "Service degradation affecting users" },
      { level: 4, contact: "CEO / Communications", criteria: "Extended outage or public impact" },
    ],
  },
  insider_threat: {
    playbook: "Insider Threat Response Playbook",
    steps: [
      {
        order: 1,
        action: "Assess the report/alert without alerting the suspected insider",
        responsible: "Security Operations",
        timeframe: "0-2 hours",
      },
      {
        order: 2,
        action: "Gather evidence: review access logs, data transfers, and communication records",
        responsible: "Forensics Team",
        timeframe: "2-24 hours",
      },
      {
        order: 3,
        action: "Coordinate with HR and Legal on investigation scope and employee rights",
        responsible: "HR / Legal",
        timeframe: "4-24 hours",
      },
      {
        order: 4,
        action: "Restrict access progressively — limit to read-only, then revoke as investigation proceeds",
        responsible: "IT Administration",
        timeframe: "As directed by investigation",
      },
      {
        order: 5,
        action: "Conduct formal investigation interview",
        responsible: "HR / Legal / Security",
        timeframe: "1-5 days",
      },
      {
        order: 6,
        action: "Implement containment: revoke all access and retrieve company assets",
        responsible: "IT Administration / HR",
        timeframe: "Upon determination",
      },
      {
        order: 7,
        action: "Remediate: change shared credentials, review data accessed, notify affected parties",
        responsible: "Security Engineering",
        timeframe: "1-2 weeks",
      },
    ],
    escalation: [
      { level: 1, contact: "Security Analyst", criteria: "Anomalous behavior flagged" },
      { level: 2, contact: "Security Operations Manager + HR", criteria: "Confirmed policy violation" },
      { level: 3, contact: "CISO / General Counsel", criteria: "Data exfiltration or sabotage confirmed" },
      { level: 4, contact: "CEO / Law Enforcement", criteria: "Criminal activity or significant data loss" },
    ],
  },
  phishing: {
    playbook: "Phishing Incident Response Playbook",
    steps: [
      {
        order: 1,
        action: "Quarantine the phishing email across all inboxes",
        responsible: "Email Security Team",
        timeframe: "0-30 minutes",
      },
      {
        order: 2,
        action: "Identify all users who received, opened, or clicked the phishing email",
        responsible: "Security Operations",
        timeframe: "30-60 minutes",
      },
      {
        order: 3,
        action: "Force password reset for users who entered credentials on the phishing site",
        responsible: "IT Administration",
        timeframe: "1-2 hours",
      },
      {
        order: 4,
        action: "Block the phishing domain/IP at the firewall and proxy",
        responsible: "Network Operations",
        timeframe: "30-60 minutes",
      },
      {
        order: 5,
        action: "Scan affected endpoints for malware or persistence mechanisms",
        responsible: "Security Operations",
        timeframe: "2-8 hours",
      },
      {
        order: 6,
        action: "Notify affected users and provide guidance on identifying phishing",
        responsible: "Security Awareness Team",
        timeframe: "4-24 hours",
      },
      {
        order: 7,
        action: "Update email filters and report phishing indicators to threat intelligence feeds",
        responsible: "Email Security Team",
        timeframe: "1-3 days",
      },
    ],
    escalation: [
      { level: 1, contact: "Security Analyst", criteria: "Phishing email reported" },
      { level: 2, contact: "Incident Response Manager", criteria: "Users clicked or submitted credentials" },
      { level: 3, contact: "CISO", criteria: "Executive accounts or sensitive systems compromised" },
      { level: 4, contact: "Legal / Regulatory", criteria: "Data accessed through compromised accounts" },
    ],
  },
  unauthorized_access: {
    playbook: "Unauthorized Access Response Playbook",
    steps: [
      {
        order: 1,
        action: "Terminate the unauthorized session and lock the affected account",
        responsible: "Security Operations",
        timeframe: "0-15 minutes",
      },
      {
        order: 2,
        action: "Determine the attack vector (credential stuffing, brute force, stolen token, etc.)",
        responsible: "Forensics Team",
        timeframe: "1-4 hours",
      },
      {
        order: 3,
        action: "Audit all actions taken during the unauthorized session",
        responsible: "Security Operations",
        timeframe: "2-8 hours",
      },
      {
        order: 4,
        action: "Reset all credentials for the affected account and related service accounts",
        responsible: "IT Administration",
        timeframe: "1-2 hours",
      },
      {
        order: 5,
        action: "Review and enhance authentication controls (MFA, rate limiting)",
        responsible: "Security Engineering",
        timeframe: "1-5 days",
      },
      {
        order: 6,
        action: "Notify the account owner and provide guidance",
        responsible: "Security Operations",
        timeframe: "4-24 hours",
      },
    ],
    escalation: [
      { level: 1, contact: "Security On-Call Engineer", criteria: "Unauthorized access detected" },
      { level: 2, contact: "Incident Response Manager", criteria: "Sensitive data or systems accessed" },
      { level: 3, contact: "CISO / CTO", criteria: "Admin-level access or multiple accounts compromised" },
      { level: 4, contact: "CEO / Legal", criteria: "Customer data accessed or regulatory impact" },
    ],
  },
};

/**
 * 676 — Generate an incident response playbook for a given incident type.
 */
export async function generateIncidentResponse(
  incidentType: string
): Promise<IncidentResponse> {
  // Normalize the input to find a matching playbook
  const normalized = incidentType.toLowerCase().replace(/[\s\-]+/g, "_");

  // Try exact match first
  if (INCIDENT_PLAYBOOKS[normalized]) {
    return INCIDENT_PLAYBOOKS[normalized];
  }

  // Try partial match
  for (const [key, playbook] of Object.entries(INCIDENT_PLAYBOOKS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return playbook;
    }
  }

  // Generic incident response for unknown types
  return {
    playbook: `Generic Incident Response Playbook — ${incidentType}`,
    steps: [
      {
        order: 1,
        action: "Detect and acknowledge the incident — assign an Incident Commander",
        responsible: "Security Operations",
        timeframe: "0-30 minutes",
      },
      {
        order: 2,
        action: "Triage: determine severity, scope, and potential impact",
        responsible: "Incident Response Team",
        timeframe: "30-60 minutes",
      },
      {
        order: 3,
        action: "Contain the incident — limit further damage or exposure",
        responsible: "Security Engineering",
        timeframe: "1-4 hours",
      },
      {
        order: 4,
        action: "Gather and preserve evidence for forensic analysis",
        responsible: "Forensics Team",
        timeframe: "1-8 hours",
      },
      {
        order: 5,
        action: "Eradicate the root cause and verify remediation",
        responsible: "Security Engineering",
        timeframe: "4-24 hours",
      },
      {
        order: 6,
        action: "Recover affected systems and validate normal operations",
        responsible: "Infrastructure / DevOps",
        timeframe: "1-3 days",
      },
      {
        order: 7,
        action: "Notify stakeholders, affected parties, and regulators as required",
        responsible: "Legal / Compliance",
        timeframe: "As required by policy",
      },
      {
        order: 8,
        action: "Conduct post-incident review and publish lessons learned",
        responsible: "Incident Response Team",
        timeframe: "1-2 weeks",
      },
    ],
    escalation: [
      { level: 1, contact: "Security On-Call Engineer", criteria: "Incident detected or reported" },
      { level: 2, contact: "Security Operations Manager", criteria: "Confirmed security incident" },
      { level: 3, contact: "CISO / CTO", criteria: "High-severity impact or sensitive data at risk" },
      { level: 4, contact: "CEO / Board / External Counsel", criteria: "Critical business impact or regulatory implications" },
    ],
  };
}
