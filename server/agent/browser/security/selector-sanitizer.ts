/**
 * Selector Sanitization Module
 *
 * Prevents CSS/XPath selector injection attacks in browser automation.
 * Validates and sanitizes selectors before they are used in page.querySelector,
 * page.click, page.fill, and similar operations.
 */

export interface SelectorSanitizerConfig {
  /** Maximum selector string length */
  maxSelectorLength: number;
  /** Allow XPath selectors */
  allowXPath: boolean;
  /** Allow text-based selectors */
  allowTextSelectors: boolean;
  /** Allow Playwright-specific selectors (data-testid, role, etc.) */
  allowPlaywrightSelectors: boolean;
  /** Block selectors targeting sensitive elements */
  blockSensitiveSelectors: boolean;
}

const DEFAULT_SELECTOR_SANITIZER_CONFIG: SelectorSanitizerConfig = {
  maxSelectorLength: 1000,
  allowXPath: true,
  allowTextSelectors: true,
  allowPlaywrightSelectors: true,
  blockSensitiveSelectors: true,
};

// Patterns that indicate selector injection attempts
const INJECTION_PATTERNS = [
  // JavaScript execution via CSS
  /expression\s*\(/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  // URL-based attacks
  /url\s*\(\s*['"]?\s*javascript/i,
  /url\s*\(\s*['"]?\s*data:/i,
  // Import attacks
  /@import/i,
  // Behavior/binding attacks (IE-specific but still dangerous)
  /behavior\s*:/i,
  /-moz-binding/i,
  // HTML injection within selectors
  /<script/i,
  /<\/script/i,
  /<img/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /<svg/i,
  /<math/i,
  /on\w+\s*=/i, // Event handlers: onclick=, onerror=, etc.
  // XSS payloads
  /&#x?[\da-f]+;/i, // HTML entities
  /%[0-9a-f]{2}/i, // URL encoding (when not expected)
];

// Sensitive element selectors that should be blocked
const SENSITIVE_SELECTORS = [
  // Password fields
  /input\[type=['"]?password['"]?\]/i,
  /\[type=['"]?password['"]?\]/i,
  // Credit card fields
  /input\[name\*=['"]?card['"]?\]/i,
  /input\[name\*=['"]?cc['"]?\]/i,
  /input\[autocomplete\*=['"]?cc-/i,
  /\[autocomplete=['"]?cc-number['"]?\]/i,
  /\[autocomplete=['"]?cc-csc['"]?\]/i,
  /\[autocomplete=['"]?cc-exp['"]?\]/i,
  // SSN fields
  /input\[name\*=['"]?ssn['"]?\]/i,
  /input\[name\*=['"]?social['"]?\]/i,
  // Token/secret fields
  /input\[name\*=['"]?token['"]?\]/i,
  /input\[name\*=['"]?secret['"]?\]/i,
  /input\[name\*=['"]?api.?key['"]?\]/i,
];

export interface SelectorValidationResult {
  valid: boolean;
  reason?: string;
  sanitizedSelector?: string;
  selectorType: "css" | "xpath" | "text" | "playwright" | "unknown";
  warnings: string[];
}

export class SelectorSanitizer {
  private config: SelectorSanitizerConfig;

  constructor(config: Partial<SelectorSanitizerConfig> = {}) {
    this.config = { ...DEFAULT_SELECTOR_SANITIZER_CONFIG, ...config };
  }

  /**
   * Validate and sanitize a selector string
   */
  validate(selector: string): SelectorValidationResult {
    const warnings: string[] = [];

    // 1. Basic validation
    if (!selector || typeof selector !== "string") {
      return {
        valid: false,
        reason: "Selector must be a non-empty string",
        selectorType: "unknown",
        warnings: [],
      };
    }

    // 2. Length check
    if (selector.length > this.config.maxSelectorLength) {
      return {
        valid: false,
        reason: `Selector exceeds maximum length of ${this.config.maxSelectorLength} characters`,
        selectorType: "unknown",
        warnings: [],
      };
    }

    // 3. Determine selector type
    const selectorType = this.detectSelectorType(selector);

    // 4. Check if selector type is allowed
    if (selectorType === "xpath" && !this.config.allowXPath) {
      return {
        valid: false,
        reason: "XPath selectors are not allowed",
        selectorType,
        warnings: [],
      };
    }

    if (selectorType === "text" && !this.config.allowTextSelectors) {
      return {
        valid: false,
        reason: "Text-based selectors are not allowed",
        selectorType,
        warnings: [],
      };
    }

    if (selectorType === "playwright" && !this.config.allowPlaywrightSelectors) {
      return {
        valid: false,
        reason: "Playwright-specific selectors are not allowed",
        selectorType,
        warnings: [],
      };
    }

    // 5. Check for injection patterns
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(selector)) {
        return {
          valid: false,
          reason: `Selector contains potentially dangerous pattern: ${pattern.source}`,
          selectorType,
          warnings: [],
        };
      }
    }

    // 6. Check for sensitive element targeting
    if (this.config.blockSensitiveSelectors) {
      for (const pattern of SENSITIVE_SELECTORS) {
        if (pattern.test(selector)) {
          return {
            valid: false,
            reason: "Selector targets a sensitive form element (password, credit card, etc.)",
            selectorType,
            warnings: [],
          };
        }
      }
    }

    // 7. Check for null bytes (common injection technique)
    if (selector.includes("\0") || selector.includes("\x00")) {
      return {
        valid: false,
        reason: "Selector contains null bytes",
        selectorType,
        warnings: [],
      };
    }

    // 8. Check for control characters
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(selector)) {
      return {
        valid: false,
        reason: "Selector contains control characters",
        selectorType,
        warnings: [],
      };
    }

    // 9. Sanitize the selector
    const sanitized = this.sanitize(selector, selectorType);

    return {
      valid: true,
      sanitizedSelector: sanitized,
      selectorType,
      warnings,
    };
  }

  /**
   * Detect the type of selector
   */
  private detectSelectorType(selector: string): SelectorValidationResult["selectorType"] {
    if (selector.startsWith("//") || selector.startsWith("xpath=")) {
      return "xpath";
    }
    if (selector.startsWith("text=") || selector.startsWith('"') || selector.startsWith("'")) {
      return "text";
    }
    if (
      selector.startsWith("data-testid=") ||
      selector.startsWith("role=") ||
      selector.startsWith("aria-") ||
      selector.startsWith("css=") ||
      selector.startsWith("id=") ||
      selector.startsWith("data-test=")
    ) {
      return "playwright";
    }
    return "css";
  }

  /**
   * Sanitize a selector based on its type
   */
  private sanitize(selector: string, type: string): string {
    // Remove any trailing/leading whitespace
    let sanitized = selector.trim();

    // For CSS selectors, escape special characters in attribute values
    if (type === "css") {
      sanitized = this.sanitizeCssSelector(sanitized);
    }

    return sanitized;
  }

  /**
   * Sanitize a CSS selector
   */
  private sanitizeCssSelector(selector: string): string {
    // Replace any unescaped backslashes that aren't part of valid CSS escapes
    // Valid CSS escapes: \XX (hex) or \char
    let result = selector;

    // Remove any comments (should not appear in selectors)
    result = result.replace(/\/\*[\s\S]*?\*\//g, "");

    return result;
  }

  /**
   * Escape a string for safe use in a CSS selector attribute value
   */
  static escapeAttributeValue(value: string): string {
    return value.replace(/['"\\\n\r\t]/g, (char) => {
      switch (char) {
        case "'": return "\\'";
        case '"': return '\\"';
        case "\\": return "\\\\";
        case "\n": return "\\n";
        case "\r": return "\\r";
        case "\t": return "\\t";
        default: return char;
      }
    });
  }

  /**
   * Escape a string for safe use in a CSS selector (general)
   */
  static escapeSelector(value: string): string {
    // CSS.escape polyfill
    return value.replace(/([^\w-])/g, "\\$1");
  }

  /**
   * Safely build a selector for targeting an element by attribute value
   */
  static buildAttributeSelector(
    tag: string,
    attribute: string,
    value: string
  ): string {
    const safeTag = tag.replace(/[^a-zA-Z0-9-]/g, "");
    const safeAttr = attribute.replace(/[^a-zA-Z0-9-_]/g, "");
    const safeValue = SelectorSanitizer.escapeAttributeValue(value);

    if (!safeTag || !safeAttr) {
      throw new Error("Invalid tag or attribute name");
    }

    return `${safeTag}[${safeAttr}="${safeValue}"]`;
  }
}

export const selectorSanitizer = new SelectorSanitizer();
