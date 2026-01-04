import * as path from "path";
import * as crypto from "crypto";
import { SecurityAnalysis, SecurityAction, ThreatLevel, PathSecurityResult, SecurityStats } from "./types";

interface BlockedEntry {
  command: string;
  reason: string;
  timestamp: string;
  commandHash: string;
}

export class SecurityGuard {
  private sandboxRoot: string;
  private criticalPatterns: RegExp[];
  private mediumPatterns: RegExp[];
  private blockedHistory: BlockedEntry[] = [];
  private stats: { totalChecks: number; blocked: number; warned: number; allowed: number } = {
    totalChecks: 0,
    blocked: 0,
    warned: 0,
    allowed: 0,
  };

  private static readonly CRITICAL_BLOCKED_PATTERNS = [
    /rm\s+(-[rfv]+\s+)*\/?$/i,
    /rm\s+(-[rfv]+\s+)*\/\*/i,
    /rm\s+(-[rfv]+\s+)*\/home/i,
    /rm\s+(-[rfv]+\s+)*\/etc/i,
    /rm\s+(-[rfv]+\s+)*\/var/i,
    /rm\s+(-[rfv]+\s+)*\/usr/i,
    /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/i,
    /mkfs\./i,
    /dd\s+if=\/dev\/zero/i,
    /dd\s+if=\/dev\/random\s+of=\/dev\/sd/i,
    /wipefs/i,
    /grub-install/i,
    /update-grub/i,
    /insmod/i,
    /rmmod/i,
    /modprobe\s+(-r\s+)?/i,
    /chmod\s+(-R\s+)?777\s+\//i,
    /chmod\s+(-R\s+)?000\s+\//i,
    /chown\s+(-R\s+)?\w+:\w+\s+\//i,
    /curl\s+.*\|\s*(bash|sh|python)/i,
    /wget\s+.*\|\s*(bash|sh|python)/i,
    /eval\s*\(/i,
    /exec\s*\(/i,
    /xmrig/i,
    /minerd/i,
    /stratum\+tcp:\/\//i,
  ];

  private static readonly MEDIUM_RISK_PATTERNS = [
    /sudo\s+/i,
    /su\s+-/i,
    /passwd/i,
    /useradd/i,
    /userdel/i,
    /shutdown/i,
    /reboot/i,
    /halt/i,
    /poweroff/i,
    /init\s+\d/i,
    /systemctl\s+(stop|disable|mask)/i,
    /kill\s+-9\s+-1/i,
    /killall/i,
    /pkill\s+-9/i,
  ];

  private static readonly SAFE_COMMANDS = new Set([
    "ls", "pwd", "cd", "cat", "head", "tail", "less", "more",
    "echo", "printf", "date", "cal", "whoami", "hostname",
    "uname", "uptime", "free", "df", "du", "top", "htop",
    "ps", "pgrep", "which", "whereis", "locate", "find",
    "grep", "egrep", "fgrep", "sed", "awk", "cut", "sort",
    "uniq", "wc", "tr", "tee", "xargs",
    "mkdir", "touch", "cp", "mv", "file", "stat",
    "tar", "gzip", "gunzip", "zip", "unzip", "bzip2",
    "python", "python3", "pip", "pip3", "node", "npm", "npx",
    "git", "curl", "wget", "ssh", "scp", "rsync",
    "vim", "nano", "code", "clear", "history", "alias",
    "export", "env", "printenv", "source", "man", "help",
  ]);

  private static readonly DANGEROUS_EXTENSIONS = new Set([
    ".exe", ".bat", ".cmd", ".com", ".msi",
    ".vbs", ".vbe", ".jse", ".ws", ".wsf",
    ".scr", ".pif", ".application", ".gadget",
    ".hta", ".cpl", ".msc", ".jar",
  ]);

  private static readonly PROTECTED_DIRECTORIES = new Set([
    "/", "/bin", "/sbin", "/usr", "/lib", "/lib64",
    "/boot", "/etc", "/var", "/root", "/proc", "/sys",
    "/dev", "/run", "/snap", "/opt",
  ]);

  constructor(sandboxRoot?: string) {
    this.sandboxRoot = sandboxRoot || path.join(process.cwd(), "sandbox_workspace");
    this.criticalPatterns = SecurityGuard.CRITICAL_BLOCKED_PATTERNS;
    this.mediumPatterns = SecurityGuard.MEDIUM_RISK_PATTERNS;
  }

  analyzeCommand(command: string): SecurityAnalysis {
    this.stats.totalChecks++;
    command = command.trim();

    if (!command) {
      return {
        command,
        isSafe: true,
        threatLevel: "safe",
        action: "allow",
        matchedRules: [],
        warnings: [],
      };
    }

    const matchedRules: string[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < this.criticalPatterns.length; i++) {
      if (this.criticalPatterns[i].test(command)) {
        matchedRules.push(`CRITICAL_${i}`);
        this.stats.blocked++;
        this.logBlocked(command, `Matched critical pattern: ${SecurityGuard.CRITICAL_BLOCKED_PATTERNS[i]}`);
        return {
          command,
          isSafe: false,
          threatLevel: "critical",
          action: "log_and_block",
          matchedRules,
          warnings: ["Comando bloqueado: potencialmente destructivo"],
        };
      }
    }

    for (let i = 0; i < this.mediumPatterns.length; i++) {
      if (this.mediumPatterns[i].test(command)) {
        matchedRules.push(`MEDIUM_${i}`);
        warnings.push(`Precaución: patrón de riesgo detectado`);
      }
    }

    const baseCommand = command.split(/\s+/)[0] || "";
    if (SecurityGuard.SAFE_COMMANDS.has(baseCommand) && matchedRules.length === 0) {
      this.stats.allowed++;
      return {
        command,
        isSafe: true,
        threatLevel: "safe",
        action: "allow",
        matchedRules: [],
        warnings: [],
      };
    }

    if (matchedRules.length > 0) {
      this.stats.warned++;
      return {
        command,
        isSafe: false,
        threatLevel: "medium",
        action: "require_confirmation",
        matchedRules,
        warnings,
      };
    }

    this.stats.allowed++;
    return {
      command,
      isSafe: true,
      threatLevel: "low",
      action: "allow",
      matchedRules: [],
      warnings: ["Comando no reconocido, ejecutando con precaución"],
    };
  }

  validatePath(filePath: string): PathSecurityResult {
    try {
      let resolvedPath: string;
      if (path.isAbsolute(filePath)) {
        resolvedPath = path.resolve(filePath);
      } else {
        resolvedPath = path.resolve(this.sandboxRoot, filePath);
      }

      for (const protected_ of SecurityGuard.PROTECTED_DIRECTORIES) {
        if (
          resolvedPath === protected_ ||
          (resolvedPath.startsWith(protected_ + "/") && !resolvedPath.startsWith(this.sandboxRoot))
        ) {
          return {
            path: filePath,
            isAllowed: false,
            isWithinSandbox: false,
            resolvedPath,
            reason: `Directorio protegido del sistema: ${protected_}`,
          };
        }
      }

      const isWithinSandbox = resolvedPath.startsWith(this.sandboxRoot);

      return {
        path: filePath,
        isAllowed: isWithinSandbox,
        isWithinSandbox,
        resolvedPath,
        reason: isWithinSandbox ? "" : "Ruta fuera del sandbox permitido",
      };
    } catch (error) {
      return {
        path: filePath,
        isAllowed: false,
        isWithinSandbox: false,
        reason: `Error al validar ruta: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  sanitizeInput(userInput: string): string {
    const dangerousChars = [";", "|", "&", "`", "$", "(", ")", "{", "}", "<", ">", "\\", "\n", "\r"];
    let sanitized = userInput;
    for (const char of dangerousChars) {
      sanitized = sanitized.split(char).join(`\\${char}`);
    }
    return sanitized;
  }

  checkFileExtension(filename: string): { safe: boolean; reason: string } {
    const ext = path.extname(filename).toLowerCase();
    if (SecurityGuard.DANGEROUS_EXTENSIONS.has(ext)) {
      return { safe: false, reason: `Extensión de archivo peligrosa: ${ext}` };
    }
    return { safe: true, reason: "" };
  }

  private logBlocked(command: string, reason: string): void {
    const entry: BlockedEntry = {
      command,
      reason,
      timestamp: new Date().toISOString(),
      commandHash: crypto.createHash("sha256").update(command).digest("hex").substring(0, 16),
    };
    this.blockedHistory.push(entry);
    console.warn(`[SecurityGuard] Comando bloqueado:`, entry);
  }

  getStats(): SecurityStats {
    return {
      ...this.stats,
      blockedHistoryCount: this.blockedHistory.length,
      sandboxRoot: this.sandboxRoot,
    };
  }

  getSandboxRoot(): string {
    return this.sandboxRoot;
  }

  getBlockedHistory(): BlockedEntry[] {
    return [...this.blockedHistory];
  }
}
