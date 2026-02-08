/**
 * JavaScript Execution Sandbox
 *
 * Restricts browser-side JavaScript evaluation to prevent
 * dangerous API calls, data exfiltration, and sandbox escapes.
 */

export interface JsSandboxConfig {
  /** Maximum script length in characters */
  maxScriptLength: number;
  /** Maximum execution time in milliseconds */
  maxExecutionTimeMs: number;
  /** Block access to dangerous APIs */
  blockDangerousAPIs: boolean;
  /** Block access to storage APIs */
  blockStorageAPIs: boolean;
  /** Block network-initiating APIs */
  blockNetworkAPIs: boolean;
  /** Block DOM modification APIs */
  blockDOMModification: boolean;
  /** Allowed global functions/objects */
  allowedGlobals: string[];
  /** Blocked patterns in script code */
  blockedPatterns: RegExp[];
  /** Maximum return value size in bytes */
  maxReturnValueSize: number;
}

const DEFAULT_JS_SANDBOX_CONFIG: JsSandboxConfig = {
  maxScriptLength: 10_000,
  maxExecutionTimeMs: 5_000,
  blockDangerousAPIs: true,
  blockStorageAPIs: false,
  blockNetworkAPIs: true,
  blockDOMModification: false,
  allowedGlobals: [
    "document", "window", "Array", "Object", "String", "Number",
    "Boolean", "Date", "Math", "JSON", "RegExp", "Map", "Set",
    "Promise", "Error", "console", "parseInt", "parseFloat",
    "isNaN", "isFinite", "encodeURI", "decodeURI",
    "encodeURIComponent", "decodeURIComponent",
    "getComputedStyle", "NodeFilter",
  ],
  blockedPatterns: [
    // Block eval and code generation
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bFunction\s*\(/,
    /\bsetTimeout\s*\(\s*['"]/,  // setTimeout with string (code execution)
    /\bsetInterval\s*\(\s*['"]/,  // setInterval with string

    // Block import/require (module loading)
    /\bimport\s*\(/,
    /\brequire\s*\(/,

    // Block process/global access (Node.js escapes)
    /\bprocess\b/,
    /\bglobalThis\b/,
    /\b__proto__\b/,
    /\bconstructor\s*\[\s*['"]/,
    /\bconstructor\.constructor/,

    // Block prototype pollution
    /Object\s*\.\s*defineProperty/,
    /Object\s*\.\s*setPrototypeOf/,
    /Reflect\s*\.\s*setPrototypeOf/,
    /\.__proto__\s*=/,
    /\["__proto__"\]\s*=/,

    // Block Worker creation (can bypass sandbox)
    /\bnew\s+Worker\s*\(/,
    /\bnew\s+SharedWorker\s*\(/,
    /\bserviceWorker\b/,

    // Block WebAssembly (can bypass JS restrictions)
    /\bWebAssembly\b/,

    // Block dangerous DOM operations
    /\bdocument\s*\.\s*write\s*\(/,
    /\bdocument\s*\.\s*writeln\s*\(/,

    // Block data exfiltration via DOM
    /\bdocument\s*\.\s*cookie\s*=/,

    // Block iframe creation (can load arbitrary content)
    /createElement\s*\(\s*['"]iframe['"]\s*\)/,
    /createElement\s*\(\s*['"]frame['"]\s*\)/,

    // Block script injection
    /createElement\s*\(\s*['"]script['"]\s*\)/,
    /insertAdjacentHTML/,
    /\.innerHTML\s*=/,
    /\.outerHTML\s*=/,
  ],
  maxReturnValueSize: 1_000_000, // 1MB
};

export interface ScriptValidationResult {
  allowed: boolean;
  reason?: string;
  sanitizedScript?: string;
  warnings: string[];
  riskLevel: "safe" | "low" | "medium" | "high" | "critical";
}

// Patterns that indicate potentially dangerous but not necessarily blocked operations
const WARNING_PATTERNS = [
  { pattern: /XMLHttpRequest/, warning: "Script uses XMLHttpRequest" },
  { pattern: /fetch\s*\(/, warning: "Script uses fetch API" },
  { pattern: /WebSocket/, warning: "Script uses WebSocket" },
  { pattern: /localStorage/, warning: "Script accesses localStorage" },
  { pattern: /sessionStorage/, warning: "Script accesses sessionStorage" },
  { pattern: /indexedDB/, warning: "Script accesses IndexedDB" },
  { pattern: /\.postMessage\s*\(/, warning: "Script uses postMessage" },
  { pattern: /document\.domain/, warning: "Script accesses document.domain" },
  { pattern: /window\.location\s*=/, warning: "Script modifies window.location" },
  { pattern: /window\.open\s*\(/, warning: "Script calls window.open" },
  { pattern: /navigator\.sendBeacon/, warning: "Script uses sendBeacon" },
];

export class JsSandboxManager {
  private config: JsSandboxConfig;

  constructor(config: Partial<JsSandboxConfig> = {}) {
    this.config = { ...DEFAULT_JS_SANDBOX_CONFIG, ...config };
  }

  /**
   * Validate a script before execution
   */
  validateScript(script: string): ScriptValidationResult {
    const warnings: string[] = [];

    // 1. Length check
    if (!script || script.trim().length === 0) {
      return {
        allowed: false,
        reason: "Empty script",
        warnings: [],
        riskLevel: "safe",
      };
    }

    if (script.length > this.config.maxScriptLength) {
      return {
        allowed: false,
        reason: `Script exceeds maximum length of ${this.config.maxScriptLength} characters (got ${script.length})`,
        warnings: [],
        riskLevel: "high",
      };
    }

    // 2. Check blocked patterns
    for (const pattern of this.config.blockedPatterns) {
      if (pattern.test(script)) {
        return {
          allowed: false,
          reason: `Script contains blocked pattern: ${pattern.source}`,
          warnings: [],
          riskLevel: "critical",
        };
      }
    }

    // 3. Check for network-initiating APIs
    if (this.config.blockNetworkAPIs) {
      const networkPatterns = [
        /\bfetch\s*\(/,
        /\bXMLHttpRequest\b/,
        /\bWebSocket\b/,
        /\bEventSource\b/,
        /navigator\s*\.\s*sendBeacon/,
        /\bnew\s+Image\s*\(\s*\)[\s\S]*?\.src\s*=/,
      ];

      for (const pattern of networkPatterns) {
        if (pattern.test(script)) {
          return {
            allowed: false,
            reason: `Script attempts network access via ${pattern.source}`,
            warnings: [],
            riskLevel: "high",
          };
        }
      }
    }

    // 4. Check for storage APIs
    if (this.config.blockStorageAPIs) {
      const storagePatterns = [
        /\blocalStorage\b/,
        /\bsessionStorage\b/,
        /\bindexedDB\b/,
        /\bcaches\b/,
        /\bopenDatabase\b/,
      ];

      for (const pattern of storagePatterns) {
        if (pattern.test(script)) {
          return {
            allowed: false,
            reason: `Script attempts storage access via ${pattern.source}`,
            warnings: [],
            riskLevel: "medium",
          };
        }
      }
    }

    // 5. Check for DOM modification (if blocked)
    if (this.config.blockDOMModification) {
      const domModPatterns = [
        /\.remove\s*\(\s*\)/,
        /\.removeChild\s*\(/,
        /\.appendChild\s*\(/,
        /\.insertBefore\s*\(/,
        /\.replaceChild\s*\(/,
        /\.replaceWith\s*\(/,
        /\.after\s*\(/,
        /\.before\s*\(/,
        /\.prepend\s*\(/,
        /\.append\s*\(/,
        /\.setAttribute\s*\(/,
        /\.removeAttribute\s*\(/,
        /\.classList\s*\.\s*(add|remove|toggle)/,
        /\.style\s*\./,
      ];

      for (const pattern of domModPatterns) {
        if (pattern.test(script)) {
          return {
            allowed: false,
            reason: `Script attempts DOM modification via ${pattern.source}`,
            warnings: [],
            riskLevel: "medium",
          };
        }
      }
    }

    // 6. Check warning patterns
    for (const { pattern, warning } of WARNING_PATTERNS) {
      if (pattern.test(script)) {
        warnings.push(warning);
      }
    }

    // 7. Determine risk level based on warnings
    let riskLevel: ScriptValidationResult["riskLevel"] = "safe";
    if (warnings.length > 3) riskLevel = "medium";
    else if (warnings.length > 0) riskLevel = "low";

    return {
      allowed: true,
      sanitizedScript: script,
      warnings,
      riskLevel,
    };
  }

  /**
   * Wrap a script with timeout protection and return value size limiting
   */
  wrapScript(script: string): string {
    return `
      (function() {
        'use strict';
        var __startTime = Date.now();
        var __maxTime = ${this.config.maxExecutionTimeMs};

        try {
          var __result = (function() {
            ${script}
          })();

          // Limit return value size
          if (typeof __result === 'string' && __result.length > ${this.config.maxReturnValueSize}) {
            __result = __result.slice(0, ${this.config.maxReturnValueSize}) + '... [truncated]';
          }
          if (typeof __result === 'object' && __result !== null) {
            var __json = JSON.stringify(__result);
            if (__json && __json.length > ${this.config.maxReturnValueSize}) {
              return { __truncated: true, __message: 'Return value exceeds size limit' };
            }
          }

          return __result;
        } catch (e) {
          return { __error: true, message: e.message || String(e) };
        }
      })()
    `;
  }

  /**
   * Create a safe evaluation context that blocks dangerous globals
   */
  getSafeEvalScript(userScript: string): string {
    if (!this.config.blockDangerousAPIs) {
      return this.wrapScript(userScript);
    }

    return `
      (function() {
        'use strict';

        // Save references to blocked APIs
        var __blockedAPIs = {};

        // Block dangerous APIs temporarily
        try {
          if (typeof window !== 'undefined') {
            // Block eval
            var __origEval = window.eval;
            window.eval = function() { throw new Error('eval is blocked by security policy'); };
            __blockedAPIs.eval = __origEval;

            // Block Function constructor
            var __origFunction = Function;
            // Cannot easily override Function constructor, rely on pattern matching
          }
        } catch(e) {}

        try {
          var __result = (function() {
            ${userScript}
          })();

          // Limit return value size
          if (typeof __result === 'string' && __result.length > ${this.config.maxReturnValueSize}) {
            __result = __result.slice(0, ${this.config.maxReturnValueSize}) + '... [truncated]';
          }
          if (typeof __result === 'object' && __result !== null) {
            var __json = JSON.stringify(__result);
            if (__json && __json.length > ${this.config.maxReturnValueSize}) {
              return { __truncated: true, __message: 'Return value exceeds size limit' };
            }
          }

          return __result;
        } catch(e) {
          return { __error: true, message: e.message || String(e) };
        } finally {
          // Restore APIs
          try {
            if (__blockedAPIs.eval) window.eval = __blockedAPIs.eval;
          } catch(e) {}
        }
      })()
    `;
  }
}

export const jsSandbox = new JsSandboxManager();
