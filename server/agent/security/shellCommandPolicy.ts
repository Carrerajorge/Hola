export type DangerousMatch = { reason: string; pattern: RegExp };

const VALID_SHELL_SANDBOX_MODES = new Set(["host", "docker", "runner"]);

// High-risk shell command patterns.
// Requirement alignment: allow execution, but require explicit confirmation for destructive operations.
export const SHELL_DANGEROUS_PATTERNS: DangerousMatch[] = [
  // Match any rm invocation that includes both -r and -f flags (combined or separate: -rf, -fr, -r -f, etc.).
  { pattern: /\brm\b[\s\S]*-\S*r\S*f/i, reason: "rm -rf" },
  { pattern: /\bmkfs(\.|\s)/i, reason: "mkfs" },
  { pattern: /\bdd\b\s+if=/i, reason: "dd if=" },
  { pattern: />\s*\/dev\//i, reason: "> /dev/*" },
  { pattern: /\bsudo\b/i, reason: "sudo" },
  { pattern: /\bchmod\b\s+777\b/i, reason: "chmod 777" },
  { pattern: /\b(curl|wget)\b.*\|\s*sh\b/i, reason: "curl|sh / wget|sh" },
  { pattern: /\b(shutdown|reboot)\b/i, reason: "shutdown/reboot" },
];

export function getDangerousShellMatch(command: string): DangerousMatch | null {
  const cmd = String(command || "");
  for (const d of SHELL_DANGEROUS_PATTERNS) {
    if (d.pattern.test(cmd)) return d;
  }
  return null;
}

function normalizeShellSandboxMode(value: string | undefined): "host" | "docker" | "runner" | undefined {
  const normalized = String(value || "").toLowerCase().trim();
  if (!VALID_SHELL_SANDBOX_MODES.has(normalized)) {
    return undefined;
  }
  return normalized as "host" | "docker" | "runner";
}

export function resolveDefaultShellSandboxMode(env: NodeJS.ProcessEnv = process.env): "host" | "docker" | "runner" {
  const configuredDefault = normalizeShellSandboxMode(env.SHELL_COMMAND_SANDBOX_MODE_DEFAULT);
  if (configuredDefault) return configuredDefault;

  if ((env.NODE_ENV || "").toLowerCase() === "production") return "runner";

  return "host";
}

export function getShellSandboxMode(): "host" | "docker" | "runner" {
  const explicit = normalizeShellSandboxMode(process.env.SHELL_COMMAND_SANDBOX_MODE);
  if (explicit) return explicit;

  return resolveDefaultShellSandboxMode();
}
