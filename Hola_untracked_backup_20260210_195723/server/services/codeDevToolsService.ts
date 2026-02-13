/**
 * Code & Dev Tools Service
 * Capabilities 551-600: LSP, linting, refactoring, testing, CI/CD
 */

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import { llmGateway } from "../lib/llmGateway";

const execAsync = promisify(exec);

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractFunctionNames(code: string, language: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  const patterns: RegExp[] =
    language === "python"
      ? [/def\s+([a-zA-Z_]\w*)\s*\(/g]
      : [
          /function\s+([a-zA-Z_$][\w$]*)\s*\(/g,
          /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/g,
          /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*function/g,
          /(?:public|private|protected|static|async)\s+([a-zA-Z_$][\w$]*)\s*\(/g,
          /^\s*([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/gm,
        ];

  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(code)) !== null) {
      const name = m[1];
      if (!seen.has(name) && !["if", "for", "while", "switch", "catch", "constructor"].includes(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

function generateJestTests(code: string, functions: string[]): string {
  const lines: string[] = [
    `// Auto-generated Jest tests`,
    `// Review and adjust assertions for your specific use case`,
    ``,
  ];

  const hasDefault = /export\s+default/.test(code);
  const moduleName = "module";

  if (hasDefault) {
    lines.push(`import ${moduleName} from './module';`);
  } else {
    const exported = functions.filter((f) => {
      const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${f}\\b`);
      return re.test(code);
    });
    if (exported.length > 0) {
      lines.push(`import { ${exported.join(", ")} } from './module';`);
    }
  }

  lines.push(``);

  for (const fn of functions) {
    const isAsync = new RegExp(`async\\s+(?:function\\s+)?${fn}\\b`).test(code);

    const paramMatch = code.match(new RegExp(`${fn}\\s*\\(([^)]*)\\)`));
    const params = paramMatch?.[1]?.trim() || "";
    const paramNames = params
      .split(",")
      .map((p) => p.split(":")[0].split("=")[0].trim())
      .filter(Boolean);

    lines.push(`describe('${fn}', () => {`);

    lines.push(`  it('should be defined', () => {`);
    lines.push(`    expect(${fn}).toBeDefined();`);
    lines.push(`  });`);
    lines.push(``);

    if (isAsync) {
      lines.push(`  it('should resolve without throwing', async () => {`);
      if (paramNames.length > 0) {
        for (const p of paramNames) {
          lines.push(`    const ${p} = undefined; // TODO: provide test value`);
        }
        lines.push(`    await expect(${fn}(${paramNames.join(", ")})).resolves.toBeDefined();`);
      } else {
        lines.push(`    await expect(${fn}()).resolves.toBeDefined();`);
      }
      lines.push(`  });`);
    } else {
      lines.push(`  it('should return expected result', () => {`);
      if (paramNames.length > 0) {
        for (const p of paramNames) {
          lines.push(`    const ${p} = undefined; // TODO: provide test value`);
        }
        lines.push(`    const result = ${fn}(${paramNames.join(", ")});`);
      } else {
        lines.push(`    const result = ${fn}();`);
      }
      lines.push(`    expect(result).toBeDefined();`);
      lines.push(`  });`);
    }

    lines.push(``);
    lines.push(`  it('should handle edge cases', ${isAsync ? "async " : ""}() => {`);
    lines.push(`    // TODO: add edge case tests`);
    lines.push(`  });`);

    lines.push(`});`);
    lines.push(``);
  }

  return lines.join("\n");
}

function generatePytestTests(code: string, functions: string[]): string {
  const lines: string[] = [
    `# Auto-generated pytest tests`,
    `# Review and adjust assertions for your specific use case`,
    ``,
    `import pytest`,
    `# from module import ${functions.join(", ")}`,
    ``,
  ];

  for (const fn of functions) {
    const isAsync = new RegExp(`async\\s+def\\s+${fn}\\b`).test(code);

    const paramMatch = code.match(new RegExp(`def\\s+${fn}\\s*\\(([^)]*)\\)`));
    const params = paramMatch?.[1]?.trim() || "";
    const paramNames = params
      .split(",")
      .map((p) => p.split(":")[0].split("=")[0].trim())
      .filter((p) => p && p !== "self" && p !== "cls");

    if (isAsync) {
      lines.push(`@pytest.mark.asyncio`);
      lines.push(`async def test_${fn}_returns():`);
      lines.push(`    """Test that ${fn} returns without error."""`);
      if (paramNames.length > 0) {
        for (const p of paramNames) {
          lines.push(`    ${p} = None  # TODO: provide test value`);
        }
        lines.push(`    result = await ${fn}(${paramNames.join(", ")})`);
      } else {
        lines.push(`    result = await ${fn}()`);
      }
      lines.push(`    assert result is not None`);
    } else {
      lines.push(`def test_${fn}_returns():`);
      lines.push(`    """Test that ${fn} returns without error."""`);
      if (paramNames.length > 0) {
        for (const p of paramNames) {
          lines.push(`    ${p} = None  # TODO: provide test value`);
        }
        lines.push(`    result = ${fn}(${paramNames.join(", ")})`);
      } else {
        lines.push(`    result = ${fn}()`);
      }
      lines.push(`    assert result is not None`);
    }
    lines.push(``);

    lines.push(`def test_${fn}_edge_cases():`);
    lines.push(`    """Test edge cases for ${fn}."""`);
    lines.push(`    # TODO: add edge case tests`);
    lines.push(`    pass`);
    lines.push(``);
  }

  return lines.join("\n");
}

function countNesting(code: string): number {
  let max = 0;
  let current = 0;
  for (const ch of code) {
    if (ch === "{") {
      current++;
      if (current > max) max = current;
    } else if (ch === "}") {
      current = Math.max(0, current - 1);
    }
  }
  return max;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Code Analysis (551-560) ────────────────────────────────────────────────

export async function analyzeSyntax(
  code: string,
  language: string
): Promise<{
  valid: boolean;
  errors: Array<{ line: number; column: number; message: string; severity: string }>;
  warnings: Array<{ line: number; column: number; message: string }>;
}> {
  const errors: Array<{ line: number; column: number; message: string; severity: string }> = [];
  const warnings: Array<{ line: number; column: number; message: string }> = [];
  const lines = code.split("\n");

  if (language === "javascript" || language === "typescript") {
    // Bracket/paren/brace matching
    const stack: Array<{ char: string; line: number; col: number }> = [];
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const closers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let inString: string | null = null;
      let escaped = false;
      for (let j = 0; j < line.length; j++) {
        const ch = line[j];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (inString) {
          if (ch === inString) inString = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          inString = ch;
          continue;
        }
        if (pairs[ch]) {
          stack.push({ char: ch, line: i + 1, col: j + 1 });
        } else if (closers[ch]) {
          const top = stack.pop();
          if (!top) {
            errors.push({ line: i + 1, column: j + 1, message: `Unexpected '${ch}'`, severity: "error" });
          } else if (top.char !== closers[ch]) {
            errors.push({
              line: i + 1,
              column: j + 1,
              message: `Mismatched '${ch}', expected closing for '${top.char}' opened at line ${top.line}`,
              severity: "error",
            });
          }
        }
      }
    }
    for (const s of stack) {
      errors.push({
        line: s.line,
        column: s.col,
        message: `Unclosed '${s.char}'`,
        severity: "error",
      });
    }

    // Try Function constructor parse for JS
    if (language === "javascript") {
      try {
        new Function(code);
      } catch (e: any) {
        const lineMatch = e.message?.match(/\((\d+):(\d+)\)/);
        errors.push({
          line: lineMatch ? parseInt(lineMatch[1], 10) : 1,
          column: lineMatch ? parseInt(lineMatch[2], 10) : 1,
          message: e.message || "Syntax error",
          severity: "error",
        });
      }
    }

    // Common issues
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\bvar\b/.test(line)) {
        warnings.push({ line: i + 1, column: line.indexOf("var") + 1, message: "Use 'const' or 'let' instead of 'var'" });
      }
      if (/===?\s*undefined\s*===?/.test(line)) {
        warnings.push({ line: i + 1, column: 1, message: "Prefer typeof check for undefined" });
      }
      if (/;\s*;/.test(line)) {
        warnings.push({ line: i + 1, column: line.indexOf(";;") + 1, message: "Double semicolon" });
      }
    }
  } else if (language === "python") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "" || line.trim().startsWith("#")) continue;

      const indent = line.length - line.trimStart().length;
      if (indent % 4 !== 0 && indent % 2 !== 0) {
        warnings.push({ line: i + 1, column: 1, message: "Inconsistent indentation" });
      }

      if (/:\s*$/.test(line.trim())) {
        const next = lines[i + 1];
        if (next !== undefined && next.trim() !== "" && (next.length - next.trimStart().length) <= indent) {
          errors.push({ line: i + 2, column: 1, message: "Expected indented block after ':'", severity: "error" });
        }
      }

      // Unclosed strings
      const singleQuotes = (line.match(/(?<!\\)'/g) || []).length;
      const doubleQuotes = (line.match(/(?<!\\)"/g) || []).length;
      const tripleS = (line.match(/'''/g) || []).length;
      const tripleD = (line.match(/"""/g) || []).length;
      if (tripleS === 0 && singleQuotes % 2 !== 0) {
        errors.push({ line: i + 1, column: 1, message: "Unclosed string literal", severity: "error" });
      }
      if (tripleD === 0 && doubleQuotes % 2 !== 0) {
        errors.push({ line: i + 1, column: 1, message: "Unclosed string literal", severity: "error" });
      }
    }
  } else {
    // Generic bracket matching for other languages
    const stack: Array<{ char: string; line: number }> = [];
    const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const closers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
    for (let i = 0; i < lines.length; i++) {
      for (let j = 0; j < lines[i].length; j++) {
        const ch = lines[i][j];
        if (pairs[ch]) stack.push({ char: ch, line: i + 1 });
        else if (closers[ch]) {
          const top = stack.pop();
          if (!top || top.char !== closers[ch]) {
            errors.push({ line: i + 1, column: j + 1, message: `Mismatched '${ch}'`, severity: "error" });
          }
        }
      }
    }
    for (const s of stack) {
      errors.push({ line: s.line, column: 1, message: `Unclosed '${s.char}'`, severity: "error" });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export async function lintCode(
  code: string,
  language: string
): Promise<{
  issues: Array<{
    line: number;
    column: number;
    rule: string;
    message: string;
    severity: "error" | "warning" | "info";
    fixable: boolean;
  }>;
  summary: { errors: number; warnings: number; infos: number };
}> {
  const issues: Array<{
    line: number;
    column: number;
    rule: string;
    message: string;
    severity: "error" | "warning" | "info";
    fixable: boolean;
  }> = [];
  const lines = code.split("\n");

  interface LintRule {
    id: string;
    pattern: RegExp;
    message: string;
    severity: "error" | "warning" | "info";
    fixable: boolean;
    languages: string[];
  }

  const rules: LintRule[] = [
    { id: "no-var", pattern: /\bvar\s+/, message: "Unexpected var, use let or const instead", severity: "warning", fixable: true, languages: ["javascript", "typescript"] },
    { id: "no-console", pattern: /\bconsole\.(log|debug|info)\s*\(/, message: "Unexpected console statement", severity: "warning", fixable: false, languages: ["javascript", "typescript"] },
    { id: "no-alert", pattern: /\balert\s*\(/, message: "Unexpected alert statement", severity: "warning", fixable: false, languages: ["javascript", "typescript"] },
    { id: "no-debugger", pattern: /\bdebugger\b/, message: "Unexpected debugger statement", severity: "error", fixable: true, languages: ["javascript", "typescript"] },
    { id: "no-eval", pattern: /\beval\s*\(/, message: "eval() is dangerous and should be avoided", severity: "error", fixable: false, languages: ["javascript", "typescript"] },
    { id: "eqeqeq", pattern: /[^!=]==[^=]/, message: "Expected '===' and instead saw '=='", severity: "warning", fixable: true, languages: ["javascript", "typescript"] },
    { id: "no-trailing-spaces", pattern: /\s+$/, message: "Trailing whitespace", severity: "info", fixable: true, languages: ["javascript", "typescript", "python", "java", "go", "rust", "c", "cpp"] },
    { id: "no-multiple-empty-lines", pattern: /^\s*$/, message: "Multiple consecutive empty lines", severity: "info", fixable: true, languages: ["javascript", "typescript", "python"] },
    { id: "prefer-const", pattern: /\blet\s+([a-zA-Z_$][\w$]*)\s*=\s*[^;]+;\s*$/, message: "Prefer const for variables that are never reassigned", severity: "info", fixable: true, languages: ["javascript", "typescript"] },
    { id: "no-unused-expression", pattern: /^\s*[a-zA-Z_$][\w$.]*\s*;\s*$/, message: "Expression statement has no effect", severity: "warning", fixable: false, languages: ["javascript", "typescript"] },
    { id: "no-any", pattern: /:\s*any\b/, message: "Unexpected any type, specify a more precise type", severity: "warning", fixable: false, languages: ["typescript"] },
    { id: "no-magic-numbers", pattern: /(?<![.\w])(?:[2-9]\d{2,}|[1-9]\d{3,})(?![.\w])/, message: "Avoid magic numbers, extract to a named constant", severity: "info", fixable: false, languages: ["javascript", "typescript", "python", "java"] },
    // Python-specific
    { id: "py-no-bare-except", pattern: /\bexcept\s*:/, message: "Do not use bare except, catch specific exceptions", severity: "warning", fixable: false, languages: ["python"] },
    { id: "py-no-star-import", pattern: /from\s+\S+\s+import\s+\*/, message: "Avoid wildcard imports", severity: "warning", fixable: false, languages: ["python"] },
    { id: "py-no-mutable-default", pattern: /def\s+\w+\s*\([^)]*=\s*(\[\]|\{\})\s*[,)]/, message: "Do not use mutable default arguments", severity: "error", fixable: false, languages: ["python"] },
    { id: "py-line-length", pattern: /.{120,}/, message: "Line exceeds 120 characters", severity: "info", fixable: false, languages: ["python"] },
  ];

  const applicableRules = rules.filter((r) => r.languages.includes(language));

  let prevEmpty = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isEmpty = line.trim() === "";

    for (const rule of applicableRules) {
      if (rule.id === "no-multiple-empty-lines") {
        if (isEmpty && prevEmpty) {
          issues.push({ line: i + 1, column: 1, rule: rule.id, message: rule.message, severity: rule.severity, fixable: rule.fixable });
        }
        continue;
      }

      // Skip prefer-const if the variable is reassigned later
      if (rule.id === "prefer-const") {
        const match = line.match(/\blet\s+([a-zA-Z_$][\w$]*)\s*=/);
        if (match) {
          const varName = match[1];
          const rest = lines.slice(i + 1).join("\n");
          const reassigned = new RegExp(`\\b${varName}\\s*(?:[+\\-*/%]?=|\\+\\+|--)`, "m").test(rest);
          if (!reassigned) {
            issues.push({ line: i + 1, column: line.indexOf("let") + 1, rule: rule.id, message: rule.message, severity: rule.severity, fixable: rule.fixable });
          }
        }
        continue;
      }

      const match = rule.pattern.exec(line);
      if (match) {
        issues.push({ line: i + 1, column: match.index + 1, rule: rule.id, message: rule.message, severity: rule.severity, fixable: rule.fixable });
      }
    }

    prevEmpty = isEmpty;
  }

  const summary = {
    errors: issues.filter((i) => i.severity === "error").length,
    warnings: issues.filter((i) => i.severity === "warning").length,
    infos: issues.filter((i) => i.severity === "info").length,
  };

  return { issues, summary };
}

export async function formatCode(
  code: string,
  language: string,
  options?: {
    tabWidth?: number;
    useTabs?: boolean;
    singleQuote?: boolean;
    semicolons?: boolean;
  }
): Promise<{ formatted: string; changes: number }> {
  const tabWidth = options?.tabWidth ?? 2;
  const useTabs = options?.useTabs ?? false;
  const singleQuote = options?.singleQuote ?? true;
  const semicolons = options?.semicolons ?? true;
  const indent = useTabs ? "\t" : " ".repeat(tabWidth);

  let changes = 0;
  let lines = code.split("\n");

  // Trim trailing whitespace
  lines = lines.map((line) => {
    const trimmed = line.replace(/\s+$/, "");
    if (trimmed !== line) changes++;
    return trimmed;
  });

  // Remove multiple consecutive blank lines
  const cleaned: string[] = [];
  let prevBlank = false;
  for (const line of lines) {
    const isBlank = line.trim() === "";
    if (isBlank && prevBlank) {
      changes++;
      continue;
    }
    cleaned.push(line);
    prevBlank = isBlank;
  }
  lines = cleaned;

  if (language === "javascript" || language === "typescript") {
    lines = lines.map((line) => {
      let modified = line;

      // Normalize indentation (replace leading tabs/spaces)
      const content = modified.trimStart();
      const leading = modified.length - content.length;
      if (leading > 0) {
        const currentIndent = modified.substring(0, leading);
        let level: number;
        if (/^\t+$/.test(currentIndent)) {
          level = currentIndent.length;
        } else {
          level = Math.round(leading / tabWidth);
        }
        const newIndent = indent.repeat(level);
        if (newIndent !== currentIndent) {
          modified = newIndent + content;
          changes++;
        }
      }

      // Quote style
      if (singleQuote) {
        const replaced = modified.replace(/(?<!\\)"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, inner) => {
          if (inner.includes("'")) return match;
          return `'${inner}'`;
        });
        if (replaced !== modified) changes++;
        modified = replaced;
      } else {
        const replaced = modified.replace(/(?<!\\)'([^'\\]*(?:\\.[^'\\]*)*)'/g, (match, inner) => {
          if (inner.includes('"')) return match;
          return `"${inner}"`;
        });
        if (replaced !== modified) changes++;
        modified = replaced;
      }

      // Semicolons: add if missing on statement lines
      const trimmedLine = modified.trim();
      if (semicolons) {
        if (
          trimmedLine.length > 0 &&
          !trimmedLine.endsWith(";") &&
          !trimmedLine.endsWith("{") &&
          !trimmedLine.endsWith("}") &&
          !trimmedLine.endsWith(",") &&
          !trimmedLine.endsWith("(") &&
          !trimmedLine.startsWith("//") &&
          !trimmedLine.startsWith("/*") &&
          !trimmedLine.startsWith("*") &&
          !trimmedLine.startsWith("import ") &&
          !trimmedLine.startsWith("export ") &&
          !trimmedLine.startsWith("if") &&
          !trimmedLine.startsWith("else") &&
          !trimmedLine.startsWith("for") &&
          !trimmedLine.startsWith("while") &&
          !trimmedLine.startsWith("switch") &&
          !trimmedLine.startsWith("case") &&
          !trimmedLine.startsWith("default:") &&
          !trimmedLine.startsWith("class ") &&
          !trimmedLine.startsWith("function ") &&
          !trimmedLine.startsWith("async ") &&
          !trimmedLine.startsWith("return") &&
          /^(?:const|let|var|this\.|[a-zA-Z_$][\w$.]*\s*(?:=|\(|\.))/.test(trimmedLine)
        ) {
          const indentPart = modified.substring(0, modified.length - modified.trimStart().length);
          modified = indentPart + trimmedLine + ";";
          changes++;
        }
      }

      return modified;
    });

    // Ensure blank line before functions
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        i > 0 &&
        /^\s*(?:export\s+)?(?:async\s+)?function\b/.test(line) &&
        lines[i - 1].trim() !== ""
      ) {
        result.push("");
        changes++;
      }
      result.push(line);
    }
    lines = result;
  }

  // Ensure file ends with newline
  const formatted = lines.join("\n").replace(/\n*$/, "\n");
  if (!code.endsWith("\n")) changes++;

  return { formatted, changes };
}

export async function analyzeComplexity(code: string): Promise<{
  cyclomaticComplexity: number;
  linesOfCode: number;
  functions: number;
  classes: number;
  imports: number;
  exports: number;
  maxNesting: number;
  recommendations: string[];
}> {
  const lines = code.split("\n");
  const nonEmpty = lines.filter((l) => l.trim() !== "" && !l.trim().startsWith("//") && !l.trim().startsWith("#"));

  // Cyclomatic complexity: count decision points
  let complexity = 1; // base path
  const decisionPatterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bwhile\s*\(/g,
    /\bfor\s*\(/g,
    /\bfor\s+/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\b\?\?/g,
    /\?\s*[^:]/g, // ternary
    /&&/g,
    /\|\|/g,
  ];

  for (const pattern of decisionPatterns) {
    const matches = code.match(pattern);
    if (matches) complexity += matches.length;
  }

  // Avoid double-counting `else if` via the `if` pattern
  const elseIfCount = (code.match(/\belse\s+if\s*\(/g) || []).length;
  complexity -= elseIfCount; // already counted by `if` pattern

  const functionCount = (code.match(/(?:function\s+\w+|=>\s*\{|def\s+\w+)/g) || []).length;
  const classCount = (code.match(/\bclass\s+\w+/g) || []).length;
  const importCount = (code.match(/(?:^|\n)\s*(?:import\s+|from\s+\S+\s+import)/g) || []).length;
  const exportCount = (code.match(/\bexport\s+(?:default\s+)?(?:function|class|const|let|var|async|interface|type|enum)/g) || []).length;
  const maxNesting = countNesting(code);

  const recommendations: string[] = [];
  if (complexity > 20) recommendations.push("Cyclomatic complexity is very high (>20). Consider decomposing into smaller functions.");
  else if (complexity > 10) recommendations.push("Cyclomatic complexity is moderate (>10). Consider simplifying conditional logic.");
  if (maxNesting > 4) recommendations.push(`Maximum nesting depth is ${maxNesting}. Consider early returns or extracting nested blocks.`);
  if (nonEmpty.length > 300) recommendations.push("File is long (>300 lines). Consider splitting into multiple modules.");
  if (functionCount > 20) recommendations.push("Many functions in one file. Consider grouping related functions into separate modules.");
  if (importCount > 15) recommendations.push("Many imports. This module may have too many dependencies.");

  return {
    cyclomaticComplexity: complexity,
    linesOfCode: nonEmpty.length,
    functions: functionCount,
    classes: classCount,
    imports: importCount,
    exports: exportCount,
    maxNesting,
    recommendations,
  };
}

export async function detectDeadCode(
  code: string,
  language: string
): Promise<{
  unusedVariables: string[];
  unusedFunctions: string[];
  unusedImports: string[];
  unreachableCode: Array<{ line: number; reason: string }>;
}> {
  const lines = code.split("\n");
  const isJSTS = language === "javascript" || language === "typescript";
  const isPython = language === "python";

  // Detect declared variables
  const declaredVars = new Set<string>();
  const declaredFunctions = new Set<string>();
  const importedNames = new Set<string>();

  if (isJSTS) {
    // Variables
    const varPattern = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*[=:;]/g;
    let m: RegExpExecArray | null;
    while ((m = varPattern.exec(code)) !== null) declaredVars.add(m[1]);

    // Destructured variables
    const destructPattern = /(?:const|let|var)\s+\{([^}]+)\}/g;
    while ((m = destructPattern.exec(code)) !== null) {
      m[1].split(",").forEach((part) => {
        const name = part.split(":").pop()!.trim().split("=")[0].trim();
        if (name) declaredVars.add(name);
      });
    }

    // Functions
    const fnPattern = /function\s+([a-zA-Z_$][\w$]*)/g;
    while ((m = fnPattern.exec(code)) !== null) declaredFunctions.add(m[1]);

    // Imports
    const importNamedPattern = /import\s+\{([^}]+)\}\s+from/g;
    while ((m = importNamedPattern.exec(code)) !== null) {
      m[1].split(",").forEach((part) => {
        const name = part.split(" as ").pop()!.trim();
        if (name) importedNames.add(name);
      });
    }
    const importDefaultPattern = /import\s+([a-zA-Z_$][\w$]*)\s+from/g;
    while ((m = importDefaultPattern.exec(code)) !== null) importedNames.add(m[1]);
  } else if (isPython) {
    const pyVarPattern = /^(\s*)([a-zA-Z_]\w*)\s*=/gm;
    let m: RegExpExecArray | null;
    while ((m = pyVarPattern.exec(code)) !== null) declaredVars.add(m[2]);

    const pyFnPattern = /def\s+([a-zA-Z_]\w*)/g;
    while ((m = pyFnPattern.exec(code)) !== null) declaredFunctions.add(m[1]);

    const pyImportPattern = /from\s+\S+\s+import\s+(.+)/g;
    while ((m = pyImportPattern.exec(code)) !== null) {
      m[1].split(",").forEach((part) => {
        const name = part.split(" as ").pop()!.trim();
        if (name) importedNames.add(name);
      });
    }
    const pyImportSimple = /^import\s+(\w+)/gm;
    while ((m = pyImportSimple.exec(code)) !== null) importedNames.add(m[1]);
  }

  // Check usage: a name is "used" if it appears in the code beyond its declaration
  function isUsed(name: string): boolean {
    // Count occurrences: must appear more than once (declaration + at least one use)
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "g");
    const matches = code.match(re);
    return (matches?.length ?? 0) > 1;
  }

  const unusedVariables = [...declaredVars].filter((v) => !isUsed(v) && !v.startsWith("_"));
  const unusedFunctions = [...declaredFunctions].filter((f) => !isUsed(f) && !f.startsWith("_"));
  const unusedImports = [...importedNames].filter((i) => !isUsed(i));

  // Detect unreachable code
  const unreachableCode: Array<{ line: number; reason: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (/^(return|throw)\b/.test(trimmed) && !trimmed.endsWith("{")) {
      // Check if next non-empty line exists in the same block
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (next === "") continue;
        if (next === "}" || next === "}" + ";") break;
        if (next.startsWith("case ") || next.startsWith("default:")) break;
        if (next.startsWith("//") || next.startsWith("/*") || next.startsWith("*")) continue;

        unreachableCode.push({
          line: j + 1,
          reason: `Code after '${trimmed.split(/\s/)[0]}' statement at line ${i + 1}`,
        });
        break;
      }
    }
  }

  return { unusedVariables, unusedFunctions, unusedImports, unreachableCode };
}

export async function analyzeDependencies(packageJsonPath: string): Promise<{
  total: number;
  production: number;
  development: number;
  outdated: Array<{ name: string; current: string; latest: string }>;
  vulnerabilities: Array<{ name: string; severity: string; description: string }>;
  unused: string[];
  duplicates: string[];
}> {
  let pkgJson: any;
  try {
    const raw = await fs.readFile(packageJsonPath, "utf-8");
    pkgJson = JSON.parse(raw);
  } catch {
    throw new Error(`Cannot read or parse ${packageJsonPath}`);
  }

  const deps = Object.entries(pkgJson.dependencies || {}) as [string, string][];
  const devDeps = Object.entries(pkgJson.devDependencies || {}) as [string, string][];
  const allDeps = [...deps, ...devDeps];

  // Try npm audit
  const vulnerabilities: Array<{ name: string; severity: string; description: string }> = [];
  const dir = path.dirname(packageJsonPath);
  try {
    const { stdout } = await execAsync("npm audit --json 2>/dev/null", { cwd: dir, timeout: 30000 });
    const audit = JSON.parse(stdout);
    const vulns = audit.vulnerabilities || {};
    for (const [name, info] of Object.entries(vulns) as [string, any][]) {
      vulnerabilities.push({
        name,
        severity: info.severity || "unknown",
        description: info.via?.[0]?.title || info.via?.[0] || "Vulnerability detected",
      });
    }
  } catch {
    // npm audit not available or failed - that is fine
  }

  // Try npm outdated
  const outdated: Array<{ name: string; current: string; latest: string }> = [];
  try {
    const { stdout } = await execAsync("npm outdated --json 2>/dev/null", { cwd: dir, timeout: 30000 });
    const outdatedData = JSON.parse(stdout || "{}");
    for (const [name, info] of Object.entries(outdatedData) as [string, any][]) {
      if (info.current && info.latest && info.current !== info.latest) {
        outdated.push({ name, current: info.current, latest: info.latest });
      }
    }
  } catch {
    // npm outdated not available or failed
  }

  // Check for duplicate packages (same base name with different scopes)
  const duplicates: string[] = [];
  const seen = new Map<string, string[]>();
  allDeps.forEach(([name]) => {
    const base = name.replace(/^@[^/]+\//, "");
    if (!seen.has(base)) seen.set(base, []);
    seen.get(base)!.push(name);
  });
  for (const [, names] of seen) {
    if (names.length > 1) duplicates.push(names.join(", "));
  }

  // Try to detect unused dependencies by scanning source files
  const unused: string[] = [];
  try {
    const srcDir = path.join(dir, "src");
    const serverDir = path.join(dir, "server");

    let sourceCode = "";
    for (const searchDir of [srcDir, serverDir, dir]) {
      try {
        await fs.access(searchDir);
        const { stdout } = await execAsync(
          `find "${searchDir}" -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" | head -100 | xargs cat 2>/dev/null`,
          { cwd: dir, timeout: 15000, maxBuffer: 5 * 1024 * 1024 }
        );
        sourceCode += stdout;
      } catch {
        // directory does not exist or find failed
      }
    }

    if (sourceCode.length > 0) {
      for (const [name] of deps) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const importPattern = new RegExp(`(?:from\\s+['"]${escaped}|require\\s*\\(\\s*['"]${escaped})`, "m");
        if (!importPattern.test(sourceCode)) {
          unused.push(name);
        }
      }
    }
  } catch {
    // unused detection failed
  }

  return {
    total: allDeps.length,
    production: deps.length,
    development: devDeps.length,
    outdated,
    vulnerabilities,
    unused,
    duplicates,
  };
}

export async function analyzeBundle(directory: string): Promise<{
  totalSize: string;
  files: Array<{ path: string; size: string; percentage: number }>;
  recommendations: string[];
}> {
  let totalBytes = 0;
  const fileEntries: Array<{ path: string; sizeBytes: number }> = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        try {
          const stat = await fs.stat(full);
          totalBytes += stat.size;
          fileEntries.push({ path: path.relative(directory, full), sizeBytes: stat.size });
        } catch {
          // skip inaccessible files
        }
      }
    }
  }

  await walk(directory);

  fileEntries.sort((a, b) => b.sizeBytes - a.sizeBytes);
  const top = fileEntries.slice(0, 30);

  const files = top.map((f) => ({
    path: f.path,
    size: formatBytes(f.sizeBytes),
    percentage: totalBytes > 0 ? Math.round((f.sizeBytes / totalBytes) * 10000) / 100 : 0,
  }));

  const recommendations: string[] = [];
  const largeFiles = fileEntries.filter((f) => f.sizeBytes > 500 * 1024);
  if (largeFiles.length > 0) {
    recommendations.push(`${largeFiles.length} file(s) exceed 500KB. Consider code splitting or lazy loading.`);
  }

  const mapFiles = fileEntries.filter((f) => f.path.endsWith(".map"));
  if (mapFiles.length > 0) {
    const mapSize = mapFiles.reduce((s, f) => s + f.sizeBytes, 0);
    recommendations.push(`Source maps account for ${formatBytes(mapSize)}. Ensure they are not deployed to production.`);
  }

  const imageFiles = fileEntries.filter((f) => /\.(png|jpg|jpeg|gif|svg|bmp|webp)$/i.test(f.path));
  if (imageFiles.length > 0) {
    const imgSize = imageFiles.reduce((s, f) => s + f.sizeBytes, 0);
    if (imgSize > 1024 * 1024) {
      recommendations.push(`Images total ${formatBytes(imgSize)}. Consider compressing or using WebP format.`);
    }
  }

  if (totalBytes > 5 * 1024 * 1024) {
    recommendations.push("Total bundle size exceeds 5MB. Consider tree-shaking and removing unused dependencies.");
  }

  return { totalSize: formatBytes(totalBytes), files, recommendations };
}

// ─── Code Generation (561-570) ──────────────────────────────────────────────

export async function generateUnitTests(
  code: string,
  language: string,
  framework?: string
): Promise<{
  testCode: string;
  testCount: number;
  coveredFunctions: string[];
}> {
  const functions = extractFunctionNames(code, language);
  const testFramework =
    framework || (language === "typescript" || language === "javascript" ? "jest" : "pytest");

  let testCode: string;
  if (testFramework === "jest" || testFramework === "vitest" || testFramework === "mocha") {
    testCode = generateJestTests(code, functions);
  } else if (testFramework === "pytest" || testFramework === "unittest") {
    testCode = generatePytestTests(code, functions);
  } else {
    testCode = generateJestTests(code, functions);
  }

  return { testCode, testCount: functions.length * 2, coveredFunctions: functions };
}

export async function generateApiDocs(
  code: string,
  _language: string
): Promise<{
  endpoints: Array<{
    method: string;
    path: string;
    description: string;
    parameters: Array<{ name: string; type: string; required: boolean }>;
    responses: Array<{ status: number; description: string }>;
  }>;
  openApiSpec: object;
}> {
  const endpoints: Array<{
    method: string;
    path: string;
    description: string;
    parameters: Array<{ name: string; type: string; required: boolean }>;
    responses: Array<{ status: number; description: string }>;
  }> = [];

  // Match Express-style route definitions
  const routePatterns = [
    /(?:router|app)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\.(get|post|put|patch|delete)/g,
  ];

  for (const pattern of routePatterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(code)) !== null) {
      const method = (m[1] || m[2]).toUpperCase();
      const routePath = m[2] || m[1];

      // Extract path parameters
      const pathParams: Array<{ name: string; type: string; required: boolean }> = [];
      const paramPattern = /:(\w+)/g;
      let pm: RegExpExecArray | null;
      while ((pm = paramPattern.exec(routePath)) !== null) {
        pathParams.push({ name: pm[1], type: "string", required: true });
      }

      // Try to find query/body parameters from nearby code
      const afterRoute = code.substring(m.index, m.index + 500);
      const bodyParams: Array<{ name: string; type: string; required: boolean }> = [];
      const bodyMatch = afterRoute.match(/req\.body\.(\w+)/g);
      if (bodyMatch) {
        for (const b of bodyMatch) {
          const name = b.replace("req.body.", "");
          bodyParams.push({ name, type: "string", required: true });
        }
      }
      const queryMatch = afterRoute.match(/req\.query\.(\w+)/g);
      if (queryMatch) {
        for (const q of queryMatch) {
          const name = q.replace("req.query.", "");
          pathParams.push({ name, type: "string", required: false });
        }
      }

      // Detect response status codes
      const responses: Array<{ status: number; description: string }> = [];
      const statusMatches = afterRoute.match(/\.status\((\d{3})\)/g);
      if (statusMatches) {
        for (const sm of statusMatches) {
          const status = parseInt(sm.match(/\d+/)![0], 10);
          responses.push({
            status,
            description: status < 400 ? "Success" : status < 500 ? "Client error" : "Server error",
          });
        }
      }
      if (responses.length === 0) {
        responses.push({ status: 200, description: "Success" });
      }

      // Look for JSDoc comment above route
      const beforeRoute = code.substring(Math.max(0, m.index - 300), m.index);
      const jsdocMatch = beforeRoute.match(/\/\*\*\s*([\s\S]*?)\*\/\s*$/);
      const description = jsdocMatch
        ? jsdocMatch[1]
            .replace(/\n\s*\*/g, "")
            .replace(/@\w+[^\n]*/g, "")
            .trim()
        : `${method} ${routePath}`;

      endpoints.push({
        method,
        path: routePath,
        description,
        parameters: [...pathParams, ...bodyParams],
        responses,
      });
    }
  }

  // Generate OpenAPI 3.0 spec
  const paths: Record<string, any> = {};
  for (const ep of endpoints) {
    const oaPath = ep.path.replace(/:(\w+)/g, "{$1}");
    if (!paths[oaPath]) paths[oaPath] = {};

    const pathParams = ep.parameters.filter((p) => ep.path.includes(`:${p.name}`));
    const bodyParams = ep.parameters.filter((p) => !ep.path.includes(`:${p.name}`));

    const operation: any = {
      summary: ep.description,
      parameters: pathParams.map((p) => ({
        name: p.name,
        in: "path",
        required: p.required,
        schema: { type: p.type },
      })),
      responses: Object.fromEntries(
        ep.responses.map((r) => [r.status.toString(), { description: r.description }])
      ),
    };

    if (bodyParams.length > 0 && ["POST", "PUT", "PATCH"].includes(ep.method)) {
      operation.requestBody = {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: Object.fromEntries(bodyParams.map((p) => [p.name, { type: p.type }])),
              required: bodyParams.filter((p) => p.required).map((p) => p.name),
            },
          },
        },
      };
    }

    paths[oaPath][ep.method.toLowerCase()] = operation;
  }

  const openApiSpec = {
    openapi: "3.0.0",
    info: { title: "API Documentation", version: "1.0.0" },
    paths,
  };

  return { endpoints, openApiSpec };
}

export async function scaffoldCrud(
  entityName: string,
  fields: Array<{ name: string; type: string; required?: boolean }>
): Promise<{
  model: string;
  router: string;
  service: string;
  migration: string;
}> {
  const pascal = entityName.charAt(0).toUpperCase() + entityName.slice(1);
  const camel = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  const snake = entityName.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
  const table = snake + "s";

  const tsType = (t: string): string => {
    switch (t.toLowerCase()) {
      case "string":
      case "text":
      case "varchar":
        return "string";
      case "number":
      case "int":
      case "integer":
      case "float":
      case "decimal":
        return "number";
      case "boolean":
      case "bool":
        return "boolean";
      case "date":
      case "datetime":
      case "timestamp":
        return "Date";
      default:
        return "string";
    }
  };

  const sqlType = (t: string): string => {
    switch (t.toLowerCase()) {
      case "string":
      case "varchar":
        return "VARCHAR(255)";
      case "text":
        return "TEXT";
      case "number":
      case "int":
      case "integer":
        return "INTEGER";
      case "float":
      case "decimal":
        return "DECIMAL(10,2)";
      case "boolean":
      case "bool":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "datetime":
      case "timestamp":
        return "TIMESTAMP";
      default:
        return "VARCHAR(255)";
    }
  };

  // Model
  const fieldDefs = fields.map((f) => `  ${f.name}${f.required === false ? "?" : ""}: ${tsType(f.type)};`).join("\n");
  const model = `export interface ${pascal} {
  id: number;
${fieldDefs}
  createdAt: Date;
  updatedAt: Date;
}

export interface Create${pascal}Input {
${fields.map((f) => `  ${f.name}${f.required === false ? "?" : ""}: ${tsType(f.type)};`).join("\n")}
}

export interface Update${pascal}Input {
${fields.map((f) => `  ${f.name}?: ${tsType(f.type)};`).join("\n")}
}
`;

  // Service
  const service = `import type { ${pascal}, Create${pascal}Input, Update${pascal}Input } from './${camel}Model';
import { db } from '../db';

export async function getAll${pascal}s(): Promise<${pascal}[]> {
  const result = await db.query('SELECT * FROM ${table} ORDER BY created_at DESC');
  return result.rows;
}

export async function get${pascal}ById(id: number): Promise<${pascal} | null> {
  const result = await db.query('SELECT * FROM ${table} WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function create${pascal}(input: Create${pascal}Input): Promise<${pascal}> {
  const fields = [${fields.map((f) => `'${f.name}'`).join(", ")}];
  const values = [${fields.map((f) => `input.${f.name}`).join(", ")}];
  const placeholders = values.map((_, i) => \`$\${i + 1}\`).join(', ');
  const result = await db.query(
    \`INSERT INTO ${table} (\${fields.join(', ')}) VALUES (\${placeholders}) RETURNING *\`,
    values
  );
  return result.rows[0];
}

export async function update${pascal}(id: number, input: Update${pascal}Input): Promise<${pascal} | null> {
  const entries = Object.entries(input).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return get${pascal}ById(id);
  const sets = entries.map(([k], i) => \`\${k} = $\${i + 2}\`).join(', ');
  const values = [id, ...entries.map(([, v]) => v)];
  const result = await db.query(
    \`UPDATE ${table} SET \${sets}, updated_at = NOW() WHERE id = $1 RETURNING *\`,
    values
  );
  return result.rows[0] || null;
}

export async function delete${pascal}(id: number): Promise<boolean> {
  const result = await db.query('DELETE FROM ${table} WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
`;

  // Router
  const router = `import { Router, type Request, type Response } from 'express';
import { getAll${pascal}s, get${pascal}ById, create${pascal}, update${pascal}, delete${pascal} } from './${camel}Service';

const router = Router();

router.get('/${table}', async (_req: Request, res: Response) => {
  try {
    const items = await getAll${pascal}s();
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/${table}/:id', async (req: Request, res: Response) => {
  try {
    const item = await get${pascal}ById(Number(req.params.id));
    if (!item) return res.status(404).json({ error: '${pascal} not found' });
    res.json(item);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/${table}', async (req: Request, res: Response) => {
  try {
    const item = await create${pascal}(req.body);
    res.status(201).json(item);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/${table}/:id', async (req: Request, res: Response) => {
  try {
    const item = await update${pascal}(Number(req.params.id), req.body);
    if (!item) return res.status(404).json({ error: '${pascal} not found' });
    res.json(item);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/${table}/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await delete${pascal}(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: '${pascal} not found' });
    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
`;

  // Migration
  const colDefs = fields
    .map((f) => {
      let def = `  ${f.name} ${sqlType(f.type)}`;
      if (f.required !== false) def += " NOT NULL";
      return def;
    })
    .join(",\n");

  const migration = `-- Migration: Create ${table} table
-- Generated at ${new Date().toISOString()}

CREATE TABLE IF NOT EXISTS ${table} (
  id SERIAL PRIMARY KEY,
${colDefs},
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_${table}_created_at ON ${table} (created_at);
`;

  return { model, router, service, migration };
}

export async function generateMigration(
  tableName: string,
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    defaultValue?: string;
    unique?: boolean;
  }>,
  dialect?: string
): Promise<string> {
  const d = dialect?.toLowerCase() || "postgresql";
  const timestamp = new Date().toISOString();

  const mapType = (type: string): string => {
    const t = type.toLowerCase();
    if (d === "mysql") {
      switch (t) {
        case "string":
        case "varchar":
          return "VARCHAR(255)";
        case "text":
          return "TEXT";
        case "integer":
        case "int":
        case "number":
          return "INT";
        case "bigint":
          return "BIGINT";
        case "float":
        case "decimal":
          return "DECIMAL(10,2)";
        case "boolean":
        case "bool":
          return "TINYINT(1)";
        case "date":
          return "DATE";
        case "datetime":
        case "timestamp":
          return "DATETIME";
        case "json":
          return "JSON";
        case "uuid":
          return "CHAR(36)";
        default:
          return type.toUpperCase();
      }
    }
    if (d === "sqlite") {
      switch (t) {
        case "string":
        case "varchar":
        case "text":
        case "uuid":
          return "TEXT";
        case "integer":
        case "int":
        case "number":
        case "bigint":
          return "INTEGER";
        case "float":
        case "decimal":
          return "REAL";
        case "boolean":
        case "bool":
          return "INTEGER";
        case "date":
        case "datetime":
        case "timestamp":
          return "TEXT";
        case "json":
          return "TEXT";
        default:
          return "TEXT";
      }
    }
    // PostgreSQL
    switch (t) {
      case "string":
      case "varchar":
        return "VARCHAR(255)";
      case "text":
        return "TEXT";
      case "integer":
      case "int":
      case "number":
        return "INTEGER";
      case "bigint":
        return "BIGINT";
      case "float":
        return "REAL";
      case "decimal":
        return "DECIMAL(10,2)";
      case "boolean":
      case "bool":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "datetime":
      case "timestamp":
        return "TIMESTAMP";
      case "json":
        return "JSONB";
      case "uuid":
        return "UUID";
      default:
        return type.toUpperCase();
    }
  };

  const autoIncrement =
    d === "mysql" ? "INT AUTO_INCREMENT PRIMARY KEY" : d === "sqlite" ? "INTEGER PRIMARY KEY AUTOINCREMENT" : "SERIAL PRIMARY KEY";

  const colDefs = columns.map((col) => {
    let def = `  ${col.name} ${mapType(col.type)}`;
    if (col.nullable === false || col.nullable === undefined) def += " NOT NULL";
    if (col.unique) def += " UNIQUE";
    if (col.defaultValue !== undefined) def += ` DEFAULT ${col.defaultValue}`;
    return def;
  });

  const lines = [
    `-- Migration: Create ${tableName}`,
    `-- Dialect: ${d}`,
    `-- Generated at ${timestamp}`,
    ``,
    `CREATE TABLE IF NOT EXISTS ${tableName} (`,
    `  id ${autoIncrement},`,
    colDefs.join(",\n") + ",",
    d === "mysql"
      ? `  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,`
      : d === "sqlite"
        ? `  created_at TEXT NOT NULL DEFAULT (datetime('now')),`
        : `  created_at TIMESTAMP NOT NULL DEFAULT NOW(),`,
    d === "mysql"
      ? `  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
      : d === "sqlite"
        ? `  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
        : `  updated_at TIMESTAMP NOT NULL DEFAULT NOW()`,
    `);`,
    ``,
  ];

  // Add indexes for unique columns
  for (const col of columns) {
    if (col.unique) {
      lines.push(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${tableName}_${col.name} ON ${tableName} (${col.name});`);
    }
  }

  lines.push(`CREATE INDEX IF NOT EXISTS idx_${tableName}_created_at ON ${tableName} (created_at);`);
  lines.push(``);

  // Down migration
  lines.push(`-- Down migration:`);
  lines.push(`-- DROP TABLE IF EXISTS ${tableName};`);
  lines.push(``);

  return lines.join("\n");
}

// ─── Refactoring (571-580) ──────────────────────────────────────────────────

export async function renameSymbol(
  code: string,
  oldName: string,
  newName: string
): Promise<{
  refactored: string;
  replacements: number;
}> {
  // We need a word-boundary rename that avoids renaming inside strings and comments
  const lines = code.split("\n");
  let replacements = 0;
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "g");

  const result = lines.map((line) => {
    // Skip full-line comments
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) return line;

    // Simple approach: split on string delimiters, only replace outside strings
    let inString: string | null = null;
    let output = "";
    let current = "";

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const prev = i > 0 ? line[i - 1] : "";

      if (inString) {
        current += ch;
        if (ch === inString && prev !== "\\") {
          output += current;
          current = "";
          inString = null;
        }
      } else {
        if (ch === '"' || ch === "'" || ch === "`") {
          // Flush current segment with replacements
          const replaced = current.replace(re, () => {
            replacements++;
            return newName;
          });
          output += replaced;
          current = ch;
          inString = ch;
        } else if (ch === "/" && line[i + 1] === "/") {
          // Rest of line is comment
          const replaced = current.replace(re, () => {
            replacements++;
            return newName;
          });
          output += replaced + line.substring(i);
          return output;
        } else {
          current += ch;
        }
      }
    }

    // Flush remaining
    if (inString) {
      output += current;
    } else {
      const replaced = current.replace(re, () => {
        replacements++;
        return newName;
      });
      output += replaced;
    }

    return output;
  });

  return { refactored: result.join("\n"), replacements };
}

export async function extractFunction(
  code: string,
  startLine: number,
  endLine: number,
  functionName: string
): Promise<{
  refactored: string;
  extractedFunction: string;
}> {
  const lines = code.split("\n");
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);

  const extractedLines = lines.slice(start, end);
  const extractedCode = extractedLines.join("\n");

  // Detect variables used in the extracted code that are declared before it
  const beforeCode = lines.slice(0, start).join("\n");
  const afterCode = lines.slice(end).join("\n");

  const varDeclPattern = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)/g;
  const declaredBefore = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = varDeclPattern.exec(beforeCode)) !== null) declaredBefore.add(m[1]);

  // Find which of those are referenced in extracted code
  const params: string[] = [];
  for (const varName of declaredBefore) {
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(extractedCode)) {
      params.push(varName);
    }
  }

  // Find variables declared in extracted code used after it
  const declaredInExtract = new Set<string>();
  const varPatternExtract = /(?:const|let|var)\s+([a-zA-Z_$][\w$]*)/g;
  while ((m = varPatternExtract.exec(extractedCode)) !== null) declaredInExtract.add(m[1]);

  const returnVars: string[] = [];
  for (const varName of declaredInExtract) {
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(afterCode)) {
      returnVars.push(varName);
    }
  }

  // Determine indent
  const indent = extractedLines[0]?.match(/^(\s*)/)?.[1] || "";

  // Build extracted function
  const paramList = params.join(", ");
  let returnStatement = "";
  if (returnVars.length === 1) {
    returnStatement = `\n${indent}  return ${returnVars[0]};`;
  } else if (returnVars.length > 1) {
    returnStatement = `\n${indent}  return { ${returnVars.join(", ")} };`;
  }

  const extractedFunction = `function ${functionName}(${paramList}) {
${extractedLines.map((l) => "  " + l).join("\n")}${returnStatement}
}`;

  // Build call site
  let callSite: string;
  if (returnVars.length === 0) {
    callSite = `${indent}${functionName}(${paramList});`;
  } else if (returnVars.length === 1) {
    callSite = `${indent}const ${returnVars[0]} = ${functionName}(${paramList});`;
  } else {
    callSite = `${indent}const { ${returnVars.join(", ")} } = ${functionName}(${paramList});`;
  }

  const refactored =
    [...lines.slice(0, start), callSite, ...lines.slice(end), "", extractedFunction].join("\n");

  return { refactored, extractedFunction };
}

export async function detectAntiPatterns(
  code: string,
  language: string
): Promise<{
  patterns: Array<{
    name: string;
    description: string;
    location: string;
    suggestion: string;
    severity: "high" | "medium" | "low";
  }>;
}> {
  const patterns: Array<{
    name: string;
    description: string;
    location: string;
    suggestion: string;
    severity: "high" | "medium" | "low";
  }> = [];

  const lines = code.split("\n");
  const isJSTS = language === "javascript" || language === "typescript";
  const isPython = language === "python";

  interface AntiPatternRule {
    name: string;
    pattern: RegExp;
    description: string;
    suggestion: string;
    severity: "high" | "medium" | "low";
    languages: string[];
  }

  const rules: AntiPatternRule[] = [
    { name: "Callback Hell", pattern: /\(\s*(?:function|=>)[\s\S]{0,50}\(\s*(?:function|=>)[\s\S]{0,50}\(\s*(?:function|=>)/, description: "Deeply nested callbacks detected", suggestion: "Refactor using async/await or Promises", severity: "high", languages: ["javascript", "typescript"] },
    { name: "God Function", pattern: /(?:function\s+\w+|=>)\s*\{/, description: "", suggestion: "Break into smaller, single-responsibility functions", severity: "high", languages: ["javascript", "typescript", "python"] },
    { name: "Magic String", pattern: /===?\s*['"][a-zA-Z]{3,}['"]/, description: "Hardcoded string comparison detected", suggestion: "Extract to a named constant or enum", severity: "low", languages: ["javascript", "typescript"] },
    { name: "Nested Ternary", pattern: /\?[^:]+\?[^:]+:/, description: "Nested ternary expressions reduce readability", suggestion: "Use if/else or extract to a helper function", severity: "medium", languages: ["javascript", "typescript"] },
    { name: "Type Assertion Abuse", pattern: /as\s+any\b/, description: "Casting to 'any' defeats TypeScript type safety", suggestion: "Use proper type narrowing or generic types", severity: "medium", languages: ["typescript"] },
    { name: "Empty Catch", pattern: /catch\s*\([^)]*\)\s*\{\s*\}/, description: "Empty catch block silently swallows errors", suggestion: "At minimum, log the error or re-throw", severity: "high", languages: ["javascript", "typescript"] },
    { name: "Promise Constructor Anti-pattern", pattern: /new\s+Promise\s*\(\s*(?:async|function)/, description: "Wrapping async in new Promise is unnecessary", suggestion: "Return the async result directly", severity: "medium", languages: ["javascript", "typescript"] },
    { name: "Sequential Awaits", pattern: /await\s+\w+[\s\S]{0,30}await\s+\w+/, description: "Sequential awaits may slow execution", suggestion: "Use Promise.all() for independent async operations", severity: "low", languages: ["javascript", "typescript"] },
    // Python
    { name: "Global Variable Mutation", pattern: /^\s*global\s+\w+/m, description: "Using global keyword couples function to module state", suggestion: "Pass values as parameters and return results", severity: "medium", languages: ["python"] },
    { name: "Bare Except", pattern: /except\s*:/, description: "Bare except catches all exceptions including KeyboardInterrupt", suggestion: "Catch specific exception types", severity: "high", languages: ["python"] },
    { name: "Mutable Default Argument", pattern: /def\s+\w+\s*\([^)]*=\s*(\[\]|\{\}|set\(\))\s*[,)]/, description: "Mutable default arguments are shared across calls", suggestion: "Use None as default and create inside the function", severity: "high", languages: ["python"] },
  ];

  const applicableRules = rules.filter((r) => r.languages.includes(language));

  for (let i = 0; i < lines.length; i++) {
    for (const rule of applicableRules) {
      if (rule.name === "God Function") continue; // handled separately below
      if (rule.pattern.test(lines[i])) {
        patterns.push({
          name: rule.name,
          description: rule.description,
          location: `Line ${i + 1}`,
          suggestion: rule.suggestion,
          severity: rule.severity,
        });
      }
    }
  }

  // God Function detection: find functions longer than 50 lines
  if (isJSTS) {
    const fnStarts = [
      /(?:async\s+)?function\s+(\w+)/g,
      /(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/g,
    ];

    for (const pattern of fnStarts) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(code)) !== null) {
        const name = m[1];
        const startIdx = m.index;
        const startLine = code.substring(0, startIdx).split("\n").length;

        // Count lines until matching brace
        let braceCount = 0;
        let foundOpen = false;
        let endLine = startLine;
        for (let i = startLine - 1; i < lines.length; i++) {
          for (const ch of lines[i]) {
            if (ch === "{") {
              braceCount++;
              foundOpen = true;
            }
            if (ch === "}") braceCount--;
          }
          if (foundOpen && braceCount === 0) {
            endLine = i + 1;
            break;
          }
        }

        const length = endLine - startLine;
        if (length > 50) {
          patterns.push({
            name: "God Function",
            description: `Function '${name}' is ${length} lines long`,
            location: `Lines ${startLine}-${endLine}`,
            suggestion: "Break into smaller, single-responsibility functions",
            severity: length > 100 ? "high" : "medium",
          });
        }
      }
    }
  }

  if (isPython) {
    const pyFnPattern = /def\s+(\w+)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = pyFnPattern.exec(code)) !== null) {
      const name = m[1];
      const startIdx = m.index;
      const startLine = code.substring(0, startIdx).split("\n").length;
      const startIndent = lines[startLine - 1].length - lines[startLine - 1].trimStart().length;

      let endLine = startLine;
      for (let i = startLine; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === "") continue;
        const indent = line.length - line.trimStart().length;
        if (indent <= startIndent && i > startLine) {
          endLine = i;
          break;
        }
        endLine = i + 1;
      }

      const length = endLine - startLine;
      if (length > 50) {
        patterns.push({
          name: "God Function",
          description: `Function '${name}' is ${length} lines long`,
          location: `Lines ${startLine}-${endLine}`,
          suggestion: "Break into smaller, single-responsibility functions",
          severity: length > 100 ? "high" : "medium",
        });
      }
    }
  }

  return { patterns };
}

// ─── CI/CD (581-590) ────────────────────────────────────────────────────────

export async function generateGitHubActions(config: {
  language: string;
  framework?: string;
  tests?: boolean;
  deploy?: string;
  nodeVersion?: string;
}): Promise<string> {
  const nodeVersion = config.nodeVersion || "20";
  const hasTests = config.tests !== false;

  const lines: string[] = [
    `name: CI`,
    ``,
    `on:`,
    `  push:`,
    `    branches: [main]`,
    `  pull_request:`,
    `    branches: [main]`,
    ``,
    `jobs:`,
  ];

  if (config.language === "javascript" || config.language === "typescript" || config.language === "node") {
    lines.push(
      `  build:`,
      `    runs-on: ubuntu-latest`,
      `    strategy:`,
      `      matrix:`,
      `        node-version: [${nodeVersion}]`,
      ``,
      `    steps:`,
      `      - uses: actions/checkout@v4`,
      ``,
      `      - name: Setup Node.js`,
      `        uses: actions/setup-node@v4`,
      `        with:`,
      `          node-version: \${{ matrix.node-version }}`,
      `          cache: 'npm'`,
      ``,
      `      - name: Install dependencies`,
      `        run: npm ci`,
      ``
    );

    if (config.language === "typescript") {
      lines.push(
        `      - name: Type check`,
        `        run: npx tsc --noEmit`,
        ``
      );
    }

    lines.push(
      `      - name: Lint`,
      `        run: npm run lint --if-present`,
      ``
    );

    if (hasTests) {
      lines.push(
        `      - name: Run tests`,
        `        run: npm test`,
        ``
      );
    }

    lines.push(
      `      - name: Build`,
      `        run: npm run build --if-present`,
      ``
    );
  } else if (config.language === "python") {
    const pythonVersion = config.nodeVersion || "3.11";
    lines.push(
      `  build:`,
      `    runs-on: ubuntu-latest`,
      `    strategy:`,
      `      matrix:`,
      `        python-version: ["${pythonVersion}"]`,
      ``,
      `    steps:`,
      `      - uses: actions/checkout@v4`,
      ``,
      `      - name: Setup Python`,
      `        uses: actions/setup-python@v5`,
      `        with:`,
      `          python-version: \${{ matrix.python-version }}`,
      ``,
      `      - name: Install dependencies`,
      `        run: |`,
      `          python -m pip install --upgrade pip`,
      `          pip install -r requirements.txt`,
      `          pip install flake8 pytest`,
      ``,
      `      - name: Lint`,
      `        run: flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics`,
      ``
    );

    if (hasTests) {
      lines.push(
        `      - name: Run tests`,
        `        run: pytest`,
        ``
      );
    }
  } else if (config.language === "go") {
    lines.push(
      `  build:`,
      `    runs-on: ubuntu-latest`,
      ``,
      `    steps:`,
      `      - uses: actions/checkout@v4`,
      ``,
      `      - name: Setup Go`,
      `        uses: actions/setup-go@v5`,
      `        with:`,
      `          go-version: 'stable'`,
      ``,
      `      - name: Build`,
      `        run: go build -v ./...`,
      ``
    );

    if (hasTests) {
      lines.push(
        `      - name: Test`,
        `        run: go test -v ./...`,
        ``
      );
    }
  } else if (config.language === "rust") {
    lines.push(
      `  build:`,
      `    runs-on: ubuntu-latest`,
      ``,
      `    steps:`,
      `      - uses: actions/checkout@v4`,
      ``,
      `      - name: Setup Rust`,
      `        uses: actions-rs/toolchain@v1`,
      `        with:`,
      `          toolchain: stable`,
      ``,
      `      - name: Build`,
      `        run: cargo build --verbose`,
      ``
    );

    if (hasTests) {
      lines.push(
        `      - name: Test`,
        `        run: cargo test --verbose`,
        ``
      );
    }
  }

  // Deploy step
  if (config.deploy === "vercel") {
    lines.push(
      `  deploy:`,
      `    needs: build`,
      `    runs-on: ubuntu-latest`,
      `    if: github.ref == 'refs/heads/main'`,
      ``,
      `    steps:`,
      `      - uses: actions/checkout@v4`,
      ``,
      `      - name: Deploy to Vercel`,
      `        uses: amondnet/vercel-action@v25`,
      `        with:`,
      `          vercel-token: \${{ secrets.VERCEL_TOKEN }}`,
      `          vercel-org-id: \${{ secrets.VERCEL_ORG_ID }}`,
      `          vercel-project-id: \${{ secrets.VERCEL_PROJECT_ID }}`,
      `          vercel-args: '--prod'`,
      ``
    );
  } else if (config.deploy === "docker") {
    lines.push(
      `  deploy:`,
      `    needs: build`,
      `    runs-on: ubuntu-latest`,
      `    if: github.ref == 'refs/heads/main'`,
      ``,
      `    steps:`,
      `      - uses: actions/checkout@v4`,
      ``,
      `      - name: Login to Docker Hub`,
      `        uses: docker/login-action@v3`,
      `        with:`,
      `          username: \${{ secrets.DOCKER_USERNAME }}`,
      `          password: \${{ secrets.DOCKER_PASSWORD }}`,
      ``,
      `      - name: Build and push`,
      `        uses: docker/build-push-action@v5`,
      `        with:`,
      `          push: true`,
      `          tags: \${{ secrets.DOCKER_USERNAME }}/app:latest`,
      ``
    );
  } else if (config.deploy === "aws") {
    lines.push(
      `  deploy:`,
      `    needs: build`,
      `    runs-on: ubuntu-latest`,
      `    if: github.ref == 'refs/heads/main'`,
      ``,
      `    steps:`,
      `      - uses: actions/checkout@v4`,
      ``,
      `      - name: Configure AWS Credentials`,
      `        uses: aws-actions/configure-aws-credentials@v4`,
      `        with:`,
      `          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}`,
      `          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}`,
      `          aws-region: us-east-1`,
      ``,
      `      - name: Deploy`,
      `        run: |`,
      `          # Add your AWS deploy commands here`,
      `          echo "Deploying to AWS..."`,
      ``
    );
  }

  return lines.join("\n");
}

export async function generateDockerfile(config: {
  language: string;
  framework?: string;
  nodeVersion?: string;
  port?: number;
  multiStage?: boolean;
}): Promise<string> {
  const port = config.port || 3000;

  if (config.language === "javascript" || config.language === "typescript" || config.language === "node") {
    const nodeVersion = config.nodeVersion || "20";
    const isTS = config.language === "typescript";

    if (config.multiStage !== false) {
      return `# Stage 1: Build
FROM node:${nodeVersion}-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
${isTS ? "RUN npm run build\n" : ""}
# Stage 2: Production
FROM node:${nodeVersion}-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 appuser

COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev

${isTS ? "COPY --from=builder /app/dist ./dist" : "COPY --from=builder /app ."}

USER appuser

EXPOSE ${port}

${isTS ? `CMD ["node", "dist/index.js"]` : `CMD ["node", "index.js"]`}
`;
    }

    return `FROM node:${nodeVersion}-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
${isTS ? "\nRUN npm run build\n" : ""}
EXPOSE ${port}

${isTS ? `CMD ["node", "dist/index.js"]` : `CMD ["node", "index.js"]`}
`;
  }

  if (config.language === "python") {
    const pythonVersion = config.nodeVersion || "3.11";
    const framework = config.framework || "flask";

    return `FROM python:${pythonVersion}-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1

RUN addgroup --system appgroup && \\
    adduser --system --ingroup appgroup appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

USER appuser

EXPOSE ${port}

${framework === "django" ? `CMD ["gunicorn", "--bind", "0.0.0.0:${port}", "config.wsgi:application"]` : framework === "fastapi" ? `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${port}"]` : `CMD ["gunicorn", "--bind", "0.0.0.0:${port}", "app:app"]`}
`;
  }

  if (config.language === "go") {
    if (config.multiStage !== false) {
      return `# Stage 1: Build
FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server .

# Stage 2: Production
FROM alpine:3.19

RUN adduser -D -g '' appuser

COPY --from=builder /app/server /server

USER appuser

EXPOSE ${port}

CMD ["/server"]
`;
    }

    return `FROM golang:1.22-alpine

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o server .

EXPOSE ${port}

CMD ["./server"]
`;
  }

  if (config.language === "rust") {
    return `# Stage 1: Build
FROM rust:1.75 AS builder

WORKDIR /app

COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -f target/release/deps/app*

COPY . .
RUN cargo build --release

# Stage 2: Production
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

RUN useradd -m appuser

COPY --from=builder /app/target/release/app /usr/local/bin/app

USER appuser

EXPOSE ${port}

CMD ["app"]
`;
  }

  // Generic fallback
  return `FROM ubuntu:22.04

WORKDIR /app

COPY . .

EXPOSE ${port}

CMD ["echo", "Configure your start command"]
`;
}

export async function generateChangelog(gitLog: string): Promise<{
  changelog: string;
  version: string;
  categories: { features: string[]; fixes: string[]; breaking: string[]; other: string[] };
}> {
  const logLines = gitLog.split("\n").filter((l) => l.trim().length > 0);

  const features: string[] = [];
  const fixes: string[] = [];
  const breaking: string[] = [];
  const other: string[] = [];

  for (const line of logLines) {
    const cleaned = line.replace(/^[\s*-]+/, "").trim();
    if (!cleaned) continue;

    // Parse conventional commit format: type(scope): description
    const conventionalMatch = cleaned.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)/);

    if (conventionalMatch) {
      const [, type, scope, isBreaking, description] = conventionalMatch;
      const prefix = scope ? `**${scope}**: ` : "";
      const entry = `${prefix}${description}`;

      if (isBreaking) {
        breaking.push(entry);
      } else if (type === "feat" || type === "feature") {
        features.push(entry);
      } else if (type === "fix" || type === "bugfix") {
        fixes.push(entry);
      } else if (type === "breaking" || type === "BREAKING") {
        breaking.push(entry);
      } else {
        other.push(entry);
      }
    } else {
      // Heuristic classification
      const lower = cleaned.toLowerCase();
      if (/\b(add|feat|feature|implement|new|introduce)\b/.test(lower)) {
        features.push(cleaned);
      } else if (/\b(fix|bug|patch|resolve|repair|correct)\b/.test(lower)) {
        fixes.push(cleaned);
      } else if (/\b(break|breaking|deprecat|remov)\b/.test(lower)) {
        breaking.push(cleaned);
      } else {
        other.push(cleaned);
      }
    }
  }

  // Determine version bump suggestion
  let version: string;
  if (breaking.length > 0) {
    version = "major";
  } else if (features.length > 0) {
    version = "minor";
  } else {
    version = "patch";
  }

  // Build changelog
  const sections: string[] = [];
  const date = new Date().toISOString().split("T")[0];
  sections.push(`# Changelog`);
  sections.push(``);
  sections.push(`## [Unreleased] - ${date}`);
  sections.push(``);
  sections.push(`Suggested version bump: **${version}**`);
  sections.push(``);

  if (breaking.length > 0) {
    sections.push(`### Breaking Changes`);
    for (const item of breaking) sections.push(`- ${item}`);
    sections.push(``);
  }

  if (features.length > 0) {
    sections.push(`### Features`);
    for (const item of features) sections.push(`- ${item}`);
    sections.push(``);
  }

  if (fixes.length > 0) {
    sections.push(`### Bug Fixes`);
    for (const item of fixes) sections.push(`- ${item}`);
    sections.push(``);
  }

  if (other.length > 0) {
    sections.push(`### Other Changes`);
    for (const item of other) sections.push(`- ${item}`);
    sections.push(``);
  }

  return {
    changelog: sections.join("\n"),
    version,
    categories: { features, fixes, breaking, other },
  };
}

// ─── LLM-Powered Analysis (591-600) ─────────────────────────────────────────

async function llmExtract<T>(systemPrompt: string, userInput: string, requestId: string): Promise<T> {
  const res = await llmGateway.chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userInput },
    ],
    {
      requestId,
      temperature: 0,
      maxTokens: 2000,
      enableFallback: true,
    }
  );

  let raw = (res.content || "").trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(raw) as T;
}

export async function reviewCode(
  code: string,
  language: string
): Promise<{
  summary: string;
  issues: Array<{
    line: number;
    severity: "critical" | "warning" | "suggestion";
    message: string;
    fix?: string;
  }>;
  score: number;
}> {
  const systemPrompt = `You are an expert code reviewer. Analyze the given code and provide a detailed review.
Return ONLY a JSON object:
{
  "summary": "brief overall assessment",
  "issues": [
    { "line": 1, "severity": "critical|warning|suggestion", "message": "description", "fix": "suggested fix (optional)" }
  ],
  "score": 0-100
}
No markdown, no commentary.`;

  return llmExtract(
    systemPrompt,
    `Review this ${language} code:\n\n${code.substring(0, 6000)}`,
    `review_${Date.now()}`
  );
}

export async function explainCode(
  code: string,
  language: string
): Promise<{
  explanation: string;
  concepts: string[];
  complexity: string;
}> {
  const systemPrompt = `You are an expert programmer and educator. Explain the given code clearly.
Return ONLY a JSON object:
{
  "explanation": "detailed plain-English explanation of what the code does",
  "concepts": ["concept1", "concept2"],
  "complexity": "time and space complexity if applicable"
}
No markdown, no commentary.`;

  return llmExtract(
    systemPrompt,
    `Explain this ${language} code:\n\n${code.substring(0, 6000)}`,
    `explain_${Date.now()}`
  );
}

export async function suggestRefactoring(
  code: string,
  language: string
): Promise<{
  suggestions: Array<{
    title: string;
    description: string;
    before: string;
    after: string;
    impact: "high" | "medium" | "low";
  }>;
}> {
  const systemPrompt = `You are a senior software architect specializing in clean code and refactoring.
Analyze the code and suggest refactoring improvements.
Return ONLY a JSON object:
{
  "suggestions": [
    {
      "title": "refactoring name",
      "description": "why this refactoring helps",
      "before": "short code snippet showing current pattern",
      "after": "short code snippet showing improved pattern",
      "impact": "high|medium|low"
    }
  ]
}
No markdown, no commentary.`;

  return llmExtract(
    systemPrompt,
    `Suggest refactoring for this ${language} code:\n\n${code.substring(0, 6000)}`,
    `refactor_${Date.now()}`
  );
}

export async function convertCode(
  code: string,
  fromLanguage: string,
  toLanguage: string
): Promise<{
  converted: string;
  notes: string[];
}> {
  const systemPrompt = `You are an expert polyglot programmer. Convert code between programming languages accurately.
Return ONLY a JSON object:
{
  "converted": "the converted code as a string",
  "notes": ["any important differences or caveats"]
}
No markdown, no commentary. The "converted" field must contain the actual code as a string.`;

  return llmExtract(
    systemPrompt,
    `Convert this ${fromLanguage} code to ${toLanguage}:\n\n${code.substring(0, 6000)}`,
    `convert_${Date.now()}`
  );
}

export async function generateRegex(
  description: string,
  testCases?: Array<{ input: string; shouldMatch: boolean }>
): Promise<{
  pattern: string;
  flags: string;
  explanation: string;
  testResults?: Array<{ input: string; expected: boolean; actual: boolean; passed: boolean }>;
}> {
  let prompt = `Generate a regex pattern: ${description}`;
  if (testCases && testCases.length > 0) {
    prompt += `\n\nTest cases:\n${testCases.map((t) => `- "${t.input}" should ${t.shouldMatch ? "match" : "NOT match"}`).join("\n")}`;
  }

  const systemPrompt = `You are a regex expert. Generate a regular expression based on the description.
Return ONLY a JSON object:
{
  "pattern": "the regex pattern without delimiters",
  "flags": "regex flags (e.g. gi)",
  "explanation": "plain English explanation of what the regex matches"
}
No markdown, no commentary.`;

  const result = await llmExtract<{ pattern: string; flags: string; explanation: string }>(
    systemPrompt,
    prompt,
    `regex_${Date.now()}`
  );

  // Test against provided cases
  let testResults: Array<{ input: string; expected: boolean; actual: boolean; passed: boolean }> | undefined;
  if (testCases && testCases.length > 0) {
    try {
      const re = new RegExp(result.pattern, result.flags);
      testResults = testCases.map((tc) => {
        const actual = re.test(tc.input);
        return { input: tc.input, expected: tc.shouldMatch, actual, passed: actual === tc.shouldMatch };
      });
    } catch {
      // Regex compilation failed; skip test results
    }
  }

  return { ...result, testResults };
}
