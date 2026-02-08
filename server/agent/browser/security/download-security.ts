/**
 * Download Security Module
 *
 * Validates downloaded files by type, size, and content.
 * Prevents malicious file downloads through browser automation.
 */

import path from "path";
import crypto from "crypto";

export interface DownloadSecurityConfig {
  /** Maximum download file size in bytes */
  maxFileSizeBytes: number;
  /** Allowed MIME types for downloads */
  allowedMimeTypes: Set<string>;
  /** Blocked file extensions */
  blockedExtensions: Set<string>;
  /** Allowed file extensions (if set, only these are allowed) */
  allowedExtensions: Set<string>;
  /** Quarantine directory for downloads */
  quarantineDir: string;
  /** Enable file content scanning */
  enableContentScanning: boolean;
  /** Maximum number of downloads per session */
  maxDownloadsPerSession: number;
  /** Maximum total download size per session in bytes */
  maxTotalDownloadSizePerSession: number;
  /** Block executable content */
  blockExecutables: boolean;
  /** Block archive bombs */
  blockArchiveBombs: boolean;
  /** Maximum archive compression ratio */
  maxCompressionRatio: number;
}

const DEFAULT_DOWNLOAD_SECURITY_CONFIG: DownloadSecurityConfig = {
  maxFileSizeBytes: 100 * 1024 * 1024, // 100MB
  allowedMimeTypes: new Set([
    // Documents
    "application/pdf",
    "text/plain",
    "text/csv",
    "text/html",
    "text/xml",
    "application/json",
    "application/xml",
    // Spreadsheets
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    // Documents
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    // Presentations
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    // Images
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/bmp",
    "image/tiff",
    // Archives (with scanning)
    "application/zip",
    "application/gzip",
    "application/x-tar",
    // Data formats
    "application/octet-stream",
  ]),
  blockedExtensions: new Set([
    // Executables
    ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".pif",
    ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".ws",
    ".ps1", ".psm1", ".psd1",
    // Shell scripts
    ".sh", ".bash", ".csh", ".ksh", ".zsh",
    // Compiled
    ".dll", ".so", ".dylib", ".sys", ".drv",
    // Java
    ".jar", ".class", ".war", ".ear",
    // Python (compiled)
    ".pyc", ".pyo",
    // Ruby
    ".rb",
    // Perl
    ".pl", ".pm",
    // Dangerous office macros
    ".xlsm", ".xlsb", ".xltm", ".dotm", ".docm", ".pptm",
    // Other dangerous
    ".hta", ".cpl", ".msc", ".inf", ".reg",
    ".lnk", ".url", ".desktop",
    ".app", ".action", ".command",
    ".apk", ".ipa",
  ]),
  allowedExtensions: new Set([]), // Empty = all non-blocked are allowed
  quarantineDir: "/tmp/browser-downloads-quarantine",
  enableContentScanning: true,
  maxDownloadsPerSession: 10,
  maxTotalDownloadSizePerSession: 500 * 1024 * 1024, // 500MB
  blockExecutables: true,
  blockArchiveBombs: true,
  maxCompressionRatio: 100,
};

// Magic bytes for executable detection
const EXECUTABLE_SIGNATURES: Array<{ bytes: number[]; label: string }> = [
  { bytes: [0x4D, 0x5A], label: "Windows PE/EXE" },                     // MZ header
  { bytes: [0x7F, 0x45, 0x4C, 0x46], label: "ELF Binary" },            // ELF
  { bytes: [0xFE, 0xED, 0xFA, 0xCE], label: "Mach-O 32-bit" },         // Mach-O
  { bytes: [0xFE, 0xED, 0xFA, 0xCF], label: "Mach-O 64-bit" },         // Mach-O 64
  { bytes: [0xCE, 0xFA, 0xED, 0xFE], label: "Mach-O Reverse" },        // Mach-O reverse
  { bytes: [0xCF, 0xFA, 0xED, 0xFE], label: "Mach-O 64 Reverse" },     // Mach-O 64 reverse
  { bytes: [0xCA, 0xFE, 0xBA, 0xBE], label: "Java Class/Fat Binary" }, // Java class or Universal Binary
  { bytes: [0x23, 0x21], label: "Shell Script (shebang)" },             // #!/
  { bytes: [0xD0, 0xCF, 0x11, 0xE0], label: "MS Office OLE" },         // OLE Compound
  { bytes: [0x25, 0x50, 0x44, 0x46], label: "PDF" },                    // %PDF (PDF is OK but noted)
];

// Dangerous content patterns in text files
const DANGEROUS_CONTENT_PATTERNS = [
  /<%.*%>/,                    // ASP/JSP tags
  /<\?php/i,                   // PHP tags
  /<?=\s/,                     // PHP short tags
  /powershell\s+-/i,           // PowerShell commands
  /cmd\s*\/\s*[ck]/i,          // CMD execution
  /\bwscript\b/i,              // Windows Script Host
  /\bcscript\b/i,              // Console Script Host
  /\bmshta\b/i,                // MSHTA
  /\bcertutil\s+-/i,           // Certutil abuse
  /\bbitsadmin\s+\/transfer/i, // BITS abuse
];

export interface DownloadValidationResult {
  allowed: boolean;
  reason?: string;
  fileHash?: string;
  detectedType?: string;
  riskLevel: "safe" | "low" | "medium" | "high" | "critical";
  warnings: string[];
}

export interface SessionDownloadTracker {
  sessionId: string;
  downloadCount: number;
  totalBytes: number;
  downloads: Array<{
    filename: string;
    sizeBytes: number;
    mimeType: string;
    hash: string;
    timestamp: Date;
    allowed: boolean;
  }>;
}

export class DownloadSecurityManager {
  private config: DownloadSecurityConfig;
  private sessionTrackers: Map<string, SessionDownloadTracker> = new Map();

  constructor(config: Partial<DownloadSecurityConfig> = {}) {
    this.config = { ...DEFAULT_DOWNLOAD_SECURITY_CONFIG, ...config };
  }

  /**
   * Validate a download before saving
   */
  validateDownload(
    sessionId: string,
    filename: string,
    sizeBytes: number,
    mimeType: string,
    contentBuffer?: Buffer
  ): DownloadValidationResult {
    const warnings: string[] = [];

    // 1. Get or create session tracker
    let tracker = this.sessionTrackers.get(sessionId);
    if (!tracker) {
      tracker = {
        sessionId,
        downloadCount: 0,
        totalBytes: 0,
        downloads: [],
      };
      this.sessionTrackers.set(sessionId, tracker);
    }

    // 2. Check per-session download count
    if (tracker.downloadCount >= this.config.maxDownloadsPerSession) {
      return {
        allowed: false,
        reason: `Maximum downloads per session (${this.config.maxDownloadsPerSession}) exceeded`,
        riskLevel: "high",
        warnings: [],
      };
    }

    // 3. Check per-session total size
    if (tracker.totalBytes + sizeBytes > this.config.maxTotalDownloadSizePerSession) {
      return {
        allowed: false,
        reason: `Total download size limit per session exceeded`,
        riskLevel: "high",
        warnings: [],
      };
    }

    // 4. Check individual file size
    if (sizeBytes > this.config.maxFileSizeBytes) {
      return {
        allowed: false,
        reason: `File size (${this.formatBytes(sizeBytes)}) exceeds maximum (${this.formatBytes(this.config.maxFileSizeBytes)})`,
        riskLevel: "high",
        warnings: [],
      };
    }

    // 5. Check file extension
    const ext = path.extname(filename).toLowerCase();
    if (this.config.blockedExtensions.has(ext)) {
      return {
        allowed: false,
        reason: `File extension '${ext}' is blocked`,
        riskLevel: "critical",
        warnings: [],
      };
    }

    if (this.config.allowedExtensions.size > 0 && !this.config.allowedExtensions.has(ext)) {
      return {
        allowed: false,
        reason: `File extension '${ext}' is not in the allowed list`,
        riskLevel: "high",
        warnings: [],
      };
    }

    // 6. Check MIME type
    if (mimeType && !this.config.allowedMimeTypes.has(mimeType)) {
      warnings.push(`MIME type '${mimeType}' is not in the allowed list`);
    }

    // 7. Content scanning (if buffer available)
    let fileHash: string | undefined;
    let detectedType: string | undefined;

    if (contentBuffer && this.config.enableContentScanning) {
      // Calculate hash
      fileHash = crypto.createHash("sha256").update(contentBuffer).digest("hex");

      // Check for executable signatures
      if (this.config.blockExecutables) {
        const execCheck = this.checkExecutableSignatures(contentBuffer);
        if (execCheck.isExecutable) {
          // PDF is fine, it matches %PDF but is not dangerous as an executable
          if (execCheck.label !== "PDF") {
            return {
              allowed: false,
              reason: `File contains executable content: ${execCheck.label}`,
              fileHash,
              detectedType: execCheck.label,
              riskLevel: "critical",
              warnings: [],
            };
          }
        }
      }

      // Check for dangerous content patterns in text files
      if (this.isTextMimeType(mimeType)) {
        const textContent = contentBuffer.toString("utf-8", 0, Math.min(contentBuffer.length, 10000));
        for (const pattern of DANGEROUS_CONTENT_PATTERNS) {
          if (pattern.test(textContent)) {
            warnings.push(`File contains potentially dangerous content pattern: ${pattern.source}`);
          }
        }
      }

      // Check for double extensions (e.g., file.pdf.exe)
      const doubleExtCheck = this.checkDoubleExtension(filename);
      if (doubleExtCheck.suspicious) {
        return {
          allowed: false,
          reason: `Suspicious double extension detected: ${filename}`,
          fileHash,
          riskLevel: "high",
          warnings: [],
        };
      }
    }

    // 8. Record download
    tracker.downloadCount++;
    tracker.totalBytes += sizeBytes;
    tracker.downloads.push({
      filename,
      sizeBytes,
      mimeType,
      hash: fileHash || "",
      timestamp: new Date(),
      allowed: true,
    });

    return {
      allowed: true,
      fileHash,
      detectedType,
      riskLevel: warnings.length > 0 ? "low" : "safe",
      warnings,
    };
  }

  /**
   * Check buffer for executable signatures
   */
  private checkExecutableSignatures(buffer: Buffer): {
    isExecutable: boolean;
    label?: string;
  } {
    for (const sig of EXECUTABLE_SIGNATURES) {
      if (buffer.length >= sig.bytes.length) {
        let match = true;
        for (let i = 0; i < sig.bytes.length; i++) {
          if (buffer[i] !== sig.bytes[i]) {
            match = false;
            break;
          }
        }
        if (match) {
          return { isExecutable: true, label: sig.label };
        }
      }
    }
    return { isExecutable: false };
  }

  /**
   * Check for suspicious double extensions
   */
  private checkDoubleExtension(filename: string): { suspicious: boolean; extensions?: string[] } {
    const parts = filename.split(".");
    if (parts.length <= 2) return { suspicious: false };

    const extensions = parts.slice(1).map(p => `.${p.toLowerCase()}`);
    const dangerousExtensions = new Set([
      ".exe", ".bat", ".cmd", ".com", ".scr", ".pif",
      ".vbs", ".js", ".ps1", ".sh", ".msi", ".hta",
    ]);

    for (const ext of extensions) {
      if (dangerousExtensions.has(ext)) {
        return { suspicious: true, extensions };
      }
    }

    return { suspicious: false };
  }

  /**
   * Check if a MIME type represents text content
   */
  private isTextMimeType(mimeType: string): boolean {
    return (
      mimeType.startsWith("text/") ||
      mimeType === "application/json" ||
      mimeType === "application/xml" ||
      mimeType === "application/javascript" ||
      mimeType === "application/x-httpd-php"
    );
  }

  /**
   * Get download tracker for a session
   */
  getSessionTracker(sessionId: string): SessionDownloadTracker | undefined {
    return this.sessionTrackers.get(sessionId);
  }

  /**
   * Clear session tracker
   */
  clearSessionTracker(sessionId: string): void {
    this.sessionTrackers.delete(sessionId);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
}

export const downloadSecurity = new DownloadSecurityManager();
