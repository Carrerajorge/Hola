import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DOMPurify before importing the module
vi.mock("dompurify", () => {
  type HookCallback = (...args: unknown[]) => void;
  const hooks: Record<string, HookCallback[]> = {};
  return {
    default: {
      sanitize: vi.fn((html: string, _config?: unknown) => {
        // Minimal mock: strip <script> tags and event handlers for testing
        return html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
      }),
      addHook: vi.fn((hookName: string, cb: HookCallback) => {
        if (!hooks[hookName]) hooks[hookName] = [];
        hooks[hookName].push(cb);
      }),
    },
  };
});

import {
  sanitizeHtml,
  sanitizeMarkdown,
  sanitizeText,
  sanitizeUrl,
  sanitizeJson,
  sanitizeFileName,
  containsDangerousContent,
} from "@/lib/sanitizer";

describe("sanitizeHtml", () => {
  it("returns empty string for empty/falsy input", () => {
    expect(sanitizeHtml("")).toBe("");
    expect(sanitizeHtml(null as unknown as string)).toBe("");
    expect(sanitizeHtml(undefined as unknown as string)).toBe("");
  });

  it("passes HTML through DOMPurify sanitize", () => {
    const result = sanitizeHtml("<p>Hello</p>");
    expect(result).toContain("<p>Hello</p>");
  });

  it("removes script tags via DOMPurify", () => {
    const result = sanitizeHtml('<p>Safe</p><script>alert("xss")</script>');
    expect(result).not.toContain("<script>");
    expect(result).toContain("<p>Safe</p>");
  });

  it("strips event handler attributes via DOMPurify", () => {
    const result = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(result).not.toContain("onerror");
  });
});

describe("sanitizeMarkdown", () => {
  it("returns empty string for empty input", () => {
    expect(sanitizeMarkdown("")).toBe("");
    expect(sanitizeMarkdown(null as unknown as string)).toBe("");
  });

  it("removes script tags from markdown", () => {
    const input = 'Some text <script>alert("xss")</script> more text';
    const result = sanitizeMarkdown(input);
    expect(result).not.toContain("<script>");
    expect(result).toContain("Some text");
    expect(result).toContain("more text");
  });

  it("removes inline event handlers", () => {
    const input = '<div onclick="steal()">Click</div>';
    const result = sanitizeMarkdown(input);
    expect(result).not.toMatch(/onclick/i);
  });

  it("replaces javascript: URLs with blocked:", () => {
    const input = '[click me](javascript:alert(1))';
    const result = sanitizeMarkdown(input);
    expect(result).not.toMatch(/javascript:/i);
    expect(result).toContain("blocked:");
  });

  it("replaces vbscript: URLs with blocked:", () => {
    const input = '<a href="vbscript:run">link</a>';
    const result = sanitizeMarkdown(input);
    expect(result).not.toMatch(/vbscript:/i);
    expect(result).toContain("blocked:");
  });

  it("replaces data:text/html with blocked:", () => {
    const input = '<a href="data:text/html,<script>alert(1)</script>">x</a>';
    const result = sanitizeMarkdown(input);
    expect(result).not.toMatch(/data:text\/html/i);
    expect(result).toContain("blocked:");
  });

  it("preserves normal markdown content", () => {
    const input = "# Heading\n\n- item 1\n- item 2";
    expect(sanitizeMarkdown(input)).toBe(input);
  });
});

describe("sanitizeText", () => {
  it("returns empty string for falsy input", () => {
    expect(sanitizeText("")).toBe("");
    expect(sanitizeText(null as unknown as string)).toBe("");
  });

  it("escapes HTML special characters", () => {
    expect(sanitizeText("<b>bold</b>")).toBe("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("escapes ampersands", () => {
    expect(sanitizeText("a & b")).toBe("a &amp; b");
  });

  it("escapes double quotes", () => {
    expect(sanitizeText('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes single quotes", () => {
    expect(sanitizeText("it's")).toBe("it&#039;s");
  });

  it("handles multiple special characters together", () => {
    const result = sanitizeText('<img src="x" onerror="alert(\'xss\')">');
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).toContain("&lt;");
    expect(result).toContain("&gt;");
    expect(result).toContain("&quot;");
    expect(result).toContain("&#039;");
  });
});

describe("sanitizeUrl", () => {
  it("returns empty string for falsy input", () => {
    expect(sanitizeUrl("")).toBe("");
    expect(sanitizeUrl(null as unknown as string)).toBe("");
  });

  it("blocks javascript: protocol", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
  });

  it("blocks vbscript: protocol", () => {
    expect(sanitizeUrl("vbscript:Run()")).toBe("");
  });

  it("blocks data: protocol", () => {
    expect(sanitizeUrl("data:text/html,<script>alert(1)</script>")).toBe("");
  });

  it("blocks file: protocol", () => {
    expect(sanitizeUrl("file:///etc/passwd")).toBe("");
  });

  it("blocks encoded javascript: protocol", () => {
    expect(sanitizeUrl("javascript%3Aalert(1)")).toBe("");
  });

  it("allows https URLs unchanged", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
  });

  it("allows http URLs unchanged", () => {
    expect(sanitizeUrl("http://example.com/path")).toBe("http://example.com/path");
  });

  it("allows mailto: protocol", () => {
    expect(sanitizeUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
  });

  it("allows tel: protocol", () => {
    expect(sanitizeUrl("tel:+1234567890")).toBe("tel:+1234567890");
  });

  it("allows relative URLs starting with /", () => {
    expect(sanitizeUrl("/api/data")).toBe("/api/data");
  });

  it("allows relative URLs starting with #", () => {
    expect(sanitizeUrl("#section")).toBe("#section");
  });

  it("prepends https:// to bare domain names", () => {
    expect(sanitizeUrl("example.com")).toBe("https://example.com");
  });
});

describe("sanitizeJson", () => {
  it("returns '{}' for falsy input", () => {
    expect(sanitizeJson("")).toBe("{}");
    expect(sanitizeJson(null as unknown as string)).toBe("{}");
  });

  it("returns '{}' for invalid JSON", () => {
    expect(sanitizeJson("not json")).toBe("{}");
    expect(sanitizeJson("{broken")).toBe("{}");
  });

  it("normalizes valid JSON by re-stringifying", () => {
    const input = '{"a":1, "b" : 2}';
    const result = sanitizeJson(input);
    expect(result).toBe('{"a":1,"b":2}');
  });

  it("handles arrays", () => {
    expect(sanitizeJson("[1,2,3]")).toBe("[1,2,3]");
  });

  it("strips prototype pollution attempts via parse/stringify", () => {
    const input = '{"__proto__":{"polluted":true},"safe":"value"}';
    const result = JSON.parse(sanitizeJson(input));
    expect(result.safe).toBe("value");
  });
});

describe("sanitizeFileName", () => {
  it("returns 'unnamed' for falsy input", () => {
    expect(sanitizeFileName("")).toBe("unnamed");
    expect(sanitizeFileName(null as unknown as string)).toBe("unnamed");
  });

  it("removes path traversal sequences", () => {
    expect(sanitizeFileName("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFileName("../../etc/passwd")).not.toContain("/");
  });

  it("removes backslashes", () => {
    expect(sanitizeFileName("folder\\file.txt")).not.toContain("\\");
  });

  it("removes null bytes", () => {
    expect(sanitizeFileName("file\0.txt")).toBe("file.txt");
  });

  it("replaces dangerous characters with underscore", () => {
    const result = sanitizeFileName('file<>:"|?*.txt');
    expect(result).not.toMatch(/[<>:"|?*]/);
    expect(result).toContain("_");
  });

  it("truncates to 255 characters", () => {
    const longName = "a".repeat(300) + ".txt";
    const result = sanitizeFileName(longName);
    expect(result.length).toBeLessThanOrEqual(255);
  });

  it("returns 'unnamed' if all characters are stripped", () => {
    expect(sanitizeFileName("   ")).toBe("unnamed");
  });

  it("preserves valid file names", () => {
    expect(sanitizeFileName("document.pdf")).toBe("document.pdf");
    expect(sanitizeFileName("my-file_v2.txt")).toBe("my-file_v2.txt");
  });
});

describe("containsDangerousContent", () => {
  it("returns false for falsy input", () => {
    expect(containsDangerousContent("")).toBe(false);
    expect(containsDangerousContent(null as unknown as string)).toBe(false);
  });

  it("detects script tags", () => {
    expect(containsDangerousContent("<script src='evil.js'>")).toBe(true);
  });

  it("detects javascript: protocol", () => {
    expect(containsDangerousContent("javascript:alert(1)")).toBe(true);
  });

  it("detects vbscript: protocol", () => {
    expect(containsDangerousContent("vbscript:run")).toBe(true);
  });

  it("detects event handler attributes", () => {
    expect(containsDangerousContent('onerror="alert(1)"')).toBe(true);
    expect(containsDangerousContent("onclick =handler()")).toBe(true);
  });

  it("detects data:text/html", () => {
    expect(containsDangerousContent("data:text/html,foo")).toBe(true);
  });

  it("detects CSS expression()", () => {
    expect(containsDangerousContent("background: expression(alert(1))")).toBe(true);
  });

  it("returns false for safe content", () => {
    expect(containsDangerousContent("Hello world")).toBe(false);
    expect(containsDangerousContent("<p>Paragraph</p>")).toBe(false);
    expect(containsDangerousContent("https://example.com")).toBe(false);
  });
});
