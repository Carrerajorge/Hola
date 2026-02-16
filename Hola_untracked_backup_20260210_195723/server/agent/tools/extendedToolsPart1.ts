/**
 * Extended Tools Part 1 — Capabilities 501-700
 * Terminal, Code/Dev, Containers/Infrastructure, Security/Compliance
 *
 * Registers ~52 tools across four categories, wired to real service
 * implementations where available, with inline stubs for services
 * that have not yet been created.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// ToolDefinition interface (mirrors agentManagementTools.ts)
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  schema: z.ZodObject<any>;
  execute: (params: any) => Promise<any>;
}

// ---------------------------------------------------------------------------
// Terminal Service — real service
// ---------------------------------------------------------------------------

import {
  createSession,
  getSession,
  listSessions,
  destroySession,
  executeCommand,
  isDangerousCommand,
  suggestCorrection,
  getCommandHistory,
  getSystemInfo,
  getProcessList,
  killProcess,
  gitStatus,
  gitDiff,
  gitLog,
  fileDiff,
  compressFiles,
  decompressFile,
  networkDiagnostics,
  viewLogs,
  grepFiles,
} from "../../services/terminalService";

// ---------------------------------------------------------------------------
// Security & Compliance Service — real service
// ---------------------------------------------------------------------------

import {
  createRole,
  deleteRole,
  assignPermission,
  removePermission,
  checkPermission,
  listRoles,
  createPolicy,
  evaluateAccess,
  listPolicies,
  storeSecret,
  getSecret,
  rotateSecret,
  deleteSecret,
  listSecretKeys,
  scanForVulnerabilities,
  detectPII,
  maskData,
  checkSecurityHeaders,
  generateComplianceReport,
  checkPasswordPolicy,
  auditLog,
  getAuditLogs,
  generateIncidentResponse,
} from "../../services/securityComplianceService";

// ---------------------------------------------------------------------------
// Code/Dev Tools Service — stub (service not yet created)
// ---------------------------------------------------------------------------

const codeDevStubs = {
  analyzeSyntax: async (code: string, language: string) => {
    const lines = code.split("\n");
    const issues: Array<{ line: number; message: string; severity: string }> = [];
    const bracketStack: Array<{ char: string; line: number }> = [];
    const openers: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
    const closers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Check unmatched brackets
      for (const ch of line) {
        if (openers[ch]) {
          bracketStack.push({ char: ch, line: i + 1 });
        } else if (closers[ch]) {
          const last = bracketStack.pop();
          if (!last || last.char !== closers[ch]) {
            issues.push({ line: i + 1, message: `Unmatched '${ch}'`, severity: "error" });
          }
        }
      }
      // Trailing whitespace
      if (/\s+$/.test(line) && line.trim().length > 0) {
        issues.push({ line: i + 1, message: "Trailing whitespace", severity: "warning" });
      }
      // Very long lines
      if (line.length > 120) {
        issues.push({ line: i + 1, message: `Line exceeds 120 characters (${line.length})`, severity: "info" });
      }
      // console.log / print statements
      if (/\bconsole\.(log|debug|info)\b/.test(line) || /\bprint\s*\(/.test(line)) {
        issues.push({ line: i + 1, message: "Debug statement found", severity: "warning" });
      }
    }
    for (const remaining of bracketStack) {
      issues.push({ line: remaining.line, message: `Unclosed '${remaining.char}'`, severity: "error" });
    }
    return {
      language,
      totalLines: lines.length,
      issues,
      summary: {
        errors: issues.filter((i) => i.severity === "error").length,
        warnings: issues.filter((i) => i.severity === "warning").length,
        info: issues.filter((i) => i.severity === "info").length,
      },
    };
  },

  lintCode: async (code: string, language: string, rules?: string[]) => {
    const lines = code.split("\n");
    const findings: Array<{ line: number; rule: string; message: string; severity: string }> = [];
    const activeRules = rules || [
      "no-var",
      "no-unused-vars",
      "no-console",
      "prefer-const",
      "eqeqeq",
      "no-eval",
      "no-empty",
      "no-debugger",
      "consistent-return",
      "no-magic-numbers",
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;

      if (activeRules.includes("no-var") && /\bvar\s+/.test(line)) {
        findings.push({ line: ln, rule: "no-var", message: "Use 'let' or 'const' instead of 'var'", severity: "warning" });
      }
      if (activeRules.includes("no-console") && /\bconsole\.\w+\s*\(/.test(line)) {
        findings.push({ line: ln, rule: "no-console", message: "Unexpected console statement", severity: "warning" });
      }
      if (activeRules.includes("no-eval") && /\beval\s*\(/.test(line)) {
        findings.push({ line: ln, rule: "no-eval", message: "eval() is a security risk", severity: "error" });
      }
      if (activeRules.includes("eqeqeq") && /[^!=]==[^=]/.test(line) && !/===/.test(line)) {
        findings.push({ line: ln, rule: "eqeqeq", message: "Use '===' instead of '=='", severity: "warning" });
      }
      if (activeRules.includes("no-debugger") && /\bdebugger\b/.test(line)) {
        findings.push({ line: ln, rule: "no-debugger", message: "Unexpected debugger statement", severity: "error" });
      }
      if (activeRules.includes("no-empty") && /\{\s*\}/.test(line) && !/=>/.test(line)) {
        findings.push({ line: ln, rule: "no-empty", message: "Empty block statement", severity: "warning" });
      }
      if (activeRules.includes("prefer-const") && /\blet\s+(\w+)\s*=/.test(line)) {
        const varName = line.match(/\blet\s+(\w+)\s*=/)?.[1];
        if (varName) {
          const restOfCode = lines.slice(i + 1).join("\n");
          const reassignPattern = new RegExp(`\\b${varName}\\s*=[^=]`);
          if (!reassignPattern.test(restOfCode)) {
            findings.push({ line: ln, rule: "prefer-const", message: `'${varName}' is never reassigned; use 'const'`, severity: "info" });
          }
        }
      }
    }

    return {
      language,
      rulesApplied: activeRules,
      findings,
      summary: {
        errors: findings.filter((f) => f.severity === "error").length,
        warnings: findings.filter((f) => f.severity === "warning").length,
        info: findings.filter((f) => f.severity === "info").length,
      },
      passed: findings.filter((f) => f.severity === "error").length === 0,
    };
  },

  formatCode: async (code: string, language: string, options?: { indentSize?: number; useTabs?: boolean; singleQuote?: boolean; trailingComma?: boolean; semicolons?: boolean }) => {
    const indent = options?.useTabs ? "\t" : " ".repeat(options?.indentSize || 2);
    let formatted = code;

    // Normalize line endings
    formatted = formatted.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    // Remove trailing whitespace from each line
    formatted = formatted.split("\n").map((l) => l.trimEnd()).join("\n");
    // Ensure single newline at end
    formatted = formatted.trimEnd() + "\n";
    // Collapse multiple blank lines
    formatted = formatted.replace(/\n{3,}/g, "\n\n");

    return {
      language,
      original: code,
      formatted,
      changes: formatted !== code ? "Formatting applied: trimmed whitespace, normalized line endings, collapsed blank lines" : "No changes needed",
    };
  },

  analyzeComplexity: async (code: string, language: string) => {
    const lines = code.split("\n");
    const functions: Array<{ name: string; line: number; cyclomaticComplexity: number; linesOfCode: number; parameters: number }> = [];
    const funcPattern = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>)|(\w+)\s*\([^)]*\)\s*\{)/;

    let currentFunc: { name: string; line: number; complexity: number; startLine: number; params: number } | null = null;
    let braceDepth = 0;
    let funcBraceStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const funcMatch = line.match(funcPattern);

      if (funcMatch && !currentFunc) {
        const name = funcMatch[1] || funcMatch[2] || funcMatch[3] || "anonymous";
        const paramMatch = line.match(/\(([^)]*)\)/);
        const params = paramMatch && paramMatch[1].trim() ? paramMatch[1].split(",").length : 0;
        currentFunc = { name, line: i + 1, complexity: 1, startLine: i, params };
        funcBraceStart = braceDepth;
      }

      // Count complexity decision points
      if (currentFunc) {
        if (/\bif\b/.test(line)) currentFunc.complexity++;
        if (/\belse\s+if\b/.test(line)) currentFunc.complexity++;
        if (/\bfor\b/.test(line)) currentFunc.complexity++;
        if (/\bwhile\b/.test(line)) currentFunc.complexity++;
        if (/\bcase\b/.test(line)) currentFunc.complexity++;
        if (/\bcatch\b/.test(line)) currentFunc.complexity++;
        if (/\?\?/.test(line)) currentFunc.complexity++;
        if (/\?\s*[^:]/.test(line) && /:\s*/.test(line)) currentFunc.complexity++;
        if (/&&|\|\|/.test(line)) currentFunc.complexity++;
      }

      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") {
          braceDepth--;
          if (currentFunc && braceDepth === funcBraceStart) {
            functions.push({
              name: currentFunc.name,
              line: currentFunc.line,
              cyclomaticComplexity: currentFunc.complexity,
              linesOfCode: i - currentFunc.startLine + 1,
              parameters: currentFunc.params,
            });
            currentFunc = null;
          }
        }
      }
    }

    const avgComplexity = functions.length > 0
      ? Math.round((functions.reduce((s, f) => s + f.cyclomaticComplexity, 0) / functions.length) * 10) / 10
      : 0;

    return {
      language,
      totalLines: lines.length,
      blankLines: lines.filter((l) => l.trim() === "").length,
      commentLines: lines.filter((l) => /^\s*(\/\/|#|\/\*|\*)/.test(l)).length,
      functions,
      averageComplexity: avgComplexity,
      highComplexityFunctions: functions.filter((f) => f.cyclomaticComplexity > 10),
      maintainabilityIndex: Math.max(0, Math.min(100, Math.round(171 - 5.2 * Math.log(avgComplexity || 1) - 0.23 * (functions.length || 1) - 16.2 * Math.log(lines.length || 1) + 50 * Math.sqrt(2.4 * (lines.filter((l) => /^\s*(\/\/|#|\/\*|\*)/.test(l)).length / (lines.length || 1)))))),
    };
  },

  detectDeadCode: async (code: string, language: string) => {
    const lines = code.split("\n");
    const deadCode: Array<{ line: number; type: string; name: string; reason: string }> = [];
    const definedFunctions = new Set<string>();
    const calledFunctions = new Set<string>();
    const definedVars = new Set<string>();
    const usedVars = new Set<string>();

    // Pass 1: collect definitions
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const funcDef = line.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/);
      if (funcDef) {
        definedFunctions.add(funcDef[1] || funcDef[2]);
      }
      const varDef = line.match(/(?:const|let|var)\s+(\w+)\s*=/);
      if (varDef && !funcDef) {
        definedVars.add(varDef[1]);
      }
    }

    // Pass 2: collect usage
    for (const line of lines) {
      for (const fn of definedFunctions) {
        const callPattern = new RegExp(`\\b${fn}\\s*\\(`, "g");
        if (callPattern.test(line) && !new RegExp(`function\\s+${fn}`).test(line) && !new RegExp(`(?:const|let|var)\\s+${fn}\\s*=`).test(line)) {
          calledFunctions.add(fn);
        }
      }
      for (const v of definedVars) {
        const usePattern = new RegExp(`\\b${v}\\b`, "g");
        const matches = line.match(usePattern);
        if (matches && matches.length > 0 && !new RegExp(`(?:const|let|var)\\s+${v}\\s*=`).test(line)) {
          usedVars.add(v);
        }
      }
    }

    // Pass 3: report unused
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const funcDef = line.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/);
      if (funcDef) {
        const name = funcDef[1] || funcDef[2];
        if (!calledFunctions.has(name) && !line.includes("export")) {
          deadCode.push({ line: i + 1, type: "function", name, reason: "Function is defined but never called" });
        }
      }
      const varDef = line.match(/(?:const|let|var)\s+(\w+)\s*=/);
      if (varDef && !funcDef) {
        const name = varDef[1];
        if (!usedVars.has(name) && !line.includes("export")) {
          deadCode.push({ line: i + 1, type: "variable", name, reason: "Variable is assigned but never used" });
        }
      }
      // Unreachable code after return
      if (/^\s*return\b/.test(line)) {
        const nextNonEmpty = lines.slice(i + 1).findIndex((l) => l.trim().length > 0 && l.trim() !== "}");
        if (nextNonEmpty === 0) {
          const nextLine = lines[i + 1];
          if (nextLine && nextLine.trim() !== "}" && nextLine.trim() !== "") {
            deadCode.push({ line: i + 2, type: "unreachable", name: nextLine.trim().substring(0, 50), reason: "Code after return statement is unreachable" });
          }
        }
      }
    }

    return {
      language,
      deadCode,
      totalItems: deadCode.length,
      byType: {
        functions: deadCode.filter((d) => d.type === "function").length,
        variables: deadCode.filter((d) => d.type === "variable").length,
        unreachable: deadCode.filter((d) => d.type === "unreachable").length,
      },
    };
  },

  analyzeDependencies: async (packageJson: string) => {
    let pkg: any;
    try {
      pkg = JSON.parse(packageJson);
    } catch {
      return { error: "Invalid package.json" };
    }
    const deps = Object.entries(pkg.dependencies || {}).map(([name, version]) => ({
      name,
      version: version as string,
      type: "production" as const,
    }));
    const devDeps = Object.entries(pkg.devDependencies || {}).map(([name, version]) => ({
      name,
      version: version as string,
      type: "development" as const,
    }));
    const allDeps = [...deps, ...devDeps];
    const outdatedHeuristic = allDeps.filter((d) => /^[\^~]?[01]\./.test(d.version));

    return {
      name: pkg.name || "unknown",
      version: pkg.version || "0.0.0",
      totalDependencies: deps.length,
      totalDevDependencies: devDeps.length,
      dependencies: deps,
      devDependencies: devDeps,
      possiblyOutdated: outdatedHeuristic,
      hasDuplicateDeps: new Set(allDeps.map((d) => d.name)).size < allDeps.length,
    };
  },

  generateTests: async (code: string, language: string, framework?: string) => {
    const testFramework = framework || (language === "python" ? "pytest" : "jest");
    const funcPattern = /(?:(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*\w+(?:<[^>]+>)?\s*)?=>)/g;
    const functions: Array<{ name: string; params: string[] }> = [];
    let match: RegExpExecArray | null;

    while ((match = funcPattern.exec(code)) !== null) {
      const name = match[1] || match[3];
      const paramStr = match[2] || match[4] || "";
      const params = paramStr
        .split(",")
        .map((p) => p.trim().split(/[:=]/)[0].trim())
        .filter(Boolean);
      if (name) functions.push({ name, params });
    }

    let testCode = "";
    if (testFramework === "jest") {
      testCode = `// Auto-generated test file\n\nimport { ${functions.map((f) => f.name).join(", ")} } from "./module";\n\n`;
      for (const fn of functions) {
        testCode += `describe("${fn.name}", () => {\n`;
        testCode += `  it("should be defined", () => {\n`;
        testCode += `    expect(${fn.name}).toBeDefined();\n`;
        testCode += `  });\n\n`;
        testCode += `  it("should return expected result with valid input", () => {\n`;
        testCode += `    // TODO: provide actual test values\n`;
        testCode += `    const result = ${fn.name}(${fn.params.map(() => "undefined").join(", ")});\n`;
        testCode += `    expect(result).toBeDefined();\n`;
        testCode += `  });\n\n`;
        testCode += `  it("should handle edge cases", () => {\n`;
        testCode += `    // TODO: test null, undefined, empty inputs\n`;
        testCode += `    expect(() => ${fn.name}(${fn.params.map(() => "null as any").join(", ")})).not.toThrow();\n`;
        testCode += `  });\n`;
        testCode += `});\n\n`;
      }
    } else {
      testCode = `# Auto-generated test file\n\nfrom module import ${functions.map((f) => f.name).join(", ")}\n\n`;
      for (const fn of functions) {
        testCode += `class Test${fn.name.charAt(0).toUpperCase() + fn.name.slice(1)}:\n`;
        testCode += `    def test_returns_value(self):\n`;
        testCode += `        result = ${fn.name}(${fn.params.map(() => "None").join(", ")})\n`;
        testCode += `        assert result is not None\n\n`;
        testCode += `    def test_handles_edge_cases(self):\n`;
        testCode += `        # TODO: add edge case tests\n`;
        testCode += `        pass\n\n`;
      }
    }

    return {
      framework: testFramework,
      language,
      functionsFound: functions.length,
      functions: functions.map((f) => f.name),
      generatedTests: testCode,
      testCount: functions.length * 3,
    };
  },

  generateAPIDocs: async (code: string, format?: string) => {
    const docFormat = format || "openapi";
    const routePattern = /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    const endpoints: Array<{ method: string; path: string; description: string }> = [];
    let routeMatch: RegExpExecArray | null;

    while ((routeMatch = routePattern.exec(code)) !== null) {
      endpoints.push({
        method: routeMatch[1].toUpperCase(),
        path: routeMatch[2],
        description: `${routeMatch[1].toUpperCase()} ${routeMatch[2]}`,
      });
    }

    if (docFormat === "openapi") {
      const paths: Record<string, any> = {};
      for (const ep of endpoints) {
        if (!paths[ep.path]) paths[ep.path] = {};
        paths[ep.path][ep.method.toLowerCase()] = {
          summary: ep.description,
          responses: {
            "200": { description: "Successful response" },
            "400": { description: "Bad request" },
            "500": { description: "Internal server error" },
          },
        };
      }
      return {
        format: "openapi",
        spec: {
          openapi: "3.0.3",
          info: { title: "API Documentation", version: "1.0.0" },
          paths,
        },
        endpointCount: endpoints.length,
      };
    }

    // Markdown format
    let markdown = "# API Documentation\n\n";
    for (const ep of endpoints) {
      markdown += `## ${ep.method} \`${ep.path}\`\n\n`;
      markdown += `${ep.description}\n\n`;
      markdown += `### Responses\n\n- **200** Successful response\n- **400** Bad request\n- **500** Internal server error\n\n---\n\n`;
    }

    return { format: "markdown", documentation: markdown, endpointCount: endpoints.length };
  },

  scaffoldCRUD: async (entityName: string, fields: Array<{ name: string; type: string; required?: boolean }>, language?: string) => {
    const lang = language || "typescript";
    const pascalName = entityName.charAt(0).toUpperCase() + entityName.slice(1);
    const camelName = entityName.charAt(0).toLowerCase() + entityName.slice(1);

    let code = "";
    if (lang === "typescript") {
      // Interface
      code += `export interface ${pascalName} {\n`;
      code += `  id: string;\n`;
      for (const f of fields) {
        code += `  ${f.name}${f.required === false ? "?" : ""}: ${f.type};\n`;
      }
      code += `  createdAt: Date;\n  updatedAt: Date;\n}\n\n`;

      // In-memory store
      code += `const ${camelName}Store = new Map<string, ${pascalName}>();\n\n`;

      // Create
      code += `export async function create${pascalName}(data: Omit<${pascalName}, "id" | "createdAt" | "updatedAt">): Promise<${pascalName}> {\n`;
      code += `  const id = crypto.randomUUID();\n`;
      code += `  const now = new Date();\n`;
      code += `  const entity: ${pascalName} = { id, ...data, createdAt: now, updatedAt: now };\n`;
      code += `  ${camelName}Store.set(id, entity);\n`;
      code += `  return entity;\n}\n\n`;

      // Read
      code += `export async function get${pascalName}(id: string): Promise<${pascalName} | null> {\n`;
      code += `  return ${camelName}Store.get(id) ?? null;\n}\n\n`;

      // List
      code += `export async function list${pascalName}s(): Promise<${pascalName}[]> {\n`;
      code += `  return Array.from(${camelName}Store.values());\n}\n\n`;

      // Update
      code += `export async function update${pascalName}(id: string, data: Partial<Omit<${pascalName}, "id" | "createdAt" | "updatedAt">>): Promise<${pascalName} | null> {\n`;
      code += `  const existing = ${camelName}Store.get(id);\n`;
      code += `  if (!existing) return null;\n`;
      code += `  const updated = { ...existing, ...data, updatedAt: new Date() };\n`;
      code += `  ${camelName}Store.set(id, updated);\n`;
      code += `  return updated;\n}\n\n`;

      // Delete
      code += `export async function delete${pascalName}(id: string): Promise<boolean> {\n`;
      code += `  return ${camelName}Store.delete(id);\n}\n`;
    } else {
      // Python scaffold
      code += `from dataclasses import dataclass, field\nfrom datetime import datetime\nfrom uuid import uuid4\nfrom typing import Optional, Dict, List\n\n`;
      code += `@dataclass\nclass ${pascalName}:\n    id: str = field(default_factory=lambda: str(uuid4()))\n`;
      for (const f of fields) {
        const pyType = f.type === "string" ? "str" : f.type === "number" ? "float" : f.type === "boolean" ? "bool" : "str";
        code += `    ${f.name}: ${f.required === false ? "Optional[" + pyType + "]" : pyType} = ${f.required === false ? "None" : '""' }\n`;
      }
      code += `    created_at: datetime = field(default_factory=datetime.utcnow)\n    updated_at: datetime = field(default_factory=datetime.utcnow)\n\n`;
      code += `_store: Dict[str, ${pascalName}] = {}\n\n`;
      code += `def create_${camelName}(**kwargs) -> ${pascalName}:\n    entity = ${pascalName}(**kwargs)\n    _store[entity.id] = entity\n    return entity\n\n`;
      code += `def get_${camelName}(id: str) -> Optional[${pascalName}]:\n    return _store.get(id)\n\n`;
      code += `def list_${camelName}s() -> List[${pascalName}]:\n    return list(_store.values())\n\n`;
      code += `def update_${camelName}(id: str, **kwargs) -> Optional[${pascalName}]:\n    entity = _store.get(id)\n    if not entity:\n        return None\n    for k, v in kwargs.items():\n        setattr(entity, k, v)\n    entity.updated_at = datetime.utcnow()\n    return entity\n\n`;
      code += `def delete_${camelName}(id: str) -> bool:\n    return _store.pop(id, None) is not None\n`;
    }

    return {
      entityName: pascalName,
      language: lang,
      generatedCode: code,
      operations: ["create", "read", "list", "update", "delete"],
      fieldCount: fields.length,
    };
  },

  generateMigration: async (tableName: string, columns: Array<{ name: string; type: string; nullable?: boolean; defaultValue?: string }>, dialect?: string) => {
    const db = dialect || "postgresql";
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const typeMap: Record<string, Record<string, string>> = {
      postgresql: { string: "VARCHAR(255)", number: "INTEGER", boolean: "BOOLEAN", text: "TEXT", date: "TIMESTAMP", float: "DECIMAL(10,2)", uuid: "UUID" },
      mysql: { string: "VARCHAR(255)", number: "INT", boolean: "TINYINT(1)", text: "TEXT", date: "DATETIME", float: "DECIMAL(10,2)", uuid: "CHAR(36)" },
      sqlite: { string: "TEXT", number: "INTEGER", boolean: "INTEGER", text: "TEXT", date: "TEXT", float: "REAL", uuid: "TEXT" },
    };
    const types = typeMap[db] || typeMap.postgresql;

    let up = `-- Migration: create_${tableName}\n-- Generated: ${new Date().toISOString()}\n-- Dialect: ${db}\n\n`;
    up += `CREATE TABLE IF NOT EXISTS ${tableName} (\n`;
    up += `  id ${types.uuid || "UUID"} PRIMARY KEY DEFAULT gen_random_uuid(),\n`;
    for (const col of columns) {
      const colType = types[col.type] || col.type.toUpperCase();
      let colDef = `  ${col.name} ${colType}`;
      if (col.nullable === false) colDef += " NOT NULL";
      if (col.defaultValue !== undefined) colDef += ` DEFAULT ${col.defaultValue}`;
      colDef += ",";
      up += colDef + "\n";
    }
    up += `  created_at TIMESTAMP NOT NULL DEFAULT NOW(),\n`;
    up += `  updated_at TIMESTAMP NOT NULL DEFAULT NOW()\n`;
    up += `);\n\n`;
    up += `CREATE INDEX idx_${tableName}_created_at ON ${tableName} (created_at);\n`;

    const down = `-- Rollback: drop_${tableName}\n\nDROP TABLE IF EXISTS ${tableName};\n`;

    return {
      name: `${timestamp}_create_${tableName}`,
      dialect: db,
      up,
      down,
      columnCount: columns.length + 3,
    };
  },

  renameSymbol: async (code: string, oldName: string, newName: string) => {
    const escapedOld = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escapedOld}\\b`, "g");
    const matches = code.match(pattern);
    const count = matches ? matches.length : 0;
    const result = code.replace(pattern, newName);
    return {
      oldName,
      newName,
      occurrences: count,
      renamed: result,
      changed: count > 0,
    };
  },

  extractFunction: async (code: string, startLine: number, endLine: number, functionName: string) => {
    const lines = code.split("\n");
    const extracted = lines.slice(startLine - 1, endLine);
    const indentMatch = extracted[0]?.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : "";

    // Detect variables used but not defined in the selection
    const varPattern = /\b([a-zA-Z_$][\w$]*)\b/g;
    const allVars = new Set<string>();
    const definedVars = new Set<string>();
    const keywords = new Set(["const", "let", "var", "function", "class", "if", "else", "for", "while", "return", "import", "export", "new", "this", "true", "false", "null", "undefined", "async", "await", "try", "catch", "throw", "typeof", "instanceof"]);

    for (const line of extracted) {
      let m: RegExpExecArray | null;
      const defMatch = line.match(/(?:const|let|var)\s+(\w+)/);
      if (defMatch) definedVars.add(defMatch[1]);
      while ((m = varPattern.exec(line)) !== null) {
        if (!keywords.has(m[1])) allVars.add(m[1]);
      }
    }

    const params = [...allVars].filter((v) => !definedVars.has(v) && v !== functionName);
    const extractedBody = extracted.map((l) => "  " + l.replace(/^\s*/, "")).join("\n");
    const newFunction = `${indent}function ${functionName}(${params.join(", ")}) {\n${extractedBody}\n${indent}}\n`;
    const callSite = `${indent}${functionName}(${params.join(", ")});`;

    // Reconstruct code
    const newLines = [...lines.slice(0, startLine - 1), callSite, ...lines.slice(endLine)];
    const newCode = newFunction + "\n" + newLines.join("\n");

    return {
      functionName,
      parameters: params,
      extractedLines: endLine - startLine + 1,
      newFunction,
      callSite,
      refactoredCode: newCode,
    };
  },

  detectAntipatterns: async (code: string, language: string) => {
    const lines = code.split("\n");
    const findings: Array<{ line: number; pattern: string; description: string; suggestion: string; severity: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ln = i + 1;

      // Callback hell (deeply nested callbacks)
      const callbackNesting = (line.match(/function\s*\(/g) || []).length;
      if (callbackNesting >= 2) {
        findings.push({ line: ln, pattern: "callback-hell", description: "Multiple nested callbacks detected", suggestion: "Refactor to use async/await or Promises", severity: "warning" });
      }
      // God function (too many params)
      const paramMatch = line.match(/function\s+\w+\s*\(([^)]+)\)/);
      if (paramMatch) {
        const paramCount = paramMatch[1].split(",").length;
        if (paramCount > 5) {
          findings.push({ line: ln, pattern: "too-many-params", description: `Function has ${paramCount} parameters`, suggestion: "Use an options object or builder pattern", severity: "warning" });
        }
      }
      // Magic numbers
      const magicMatch = line.match(/(?:===?|!==?|[+\-*/><]=?)\s*(\d{2,})\b/);
      if (magicMatch && !line.includes("const ") && !line.includes("let ") && !line.includes("//")) {
        findings.push({ line: ln, pattern: "magic-number", description: `Magic number ${magicMatch[1]} used inline`, suggestion: "Extract to a named constant", severity: "info" });
      }
      // TODO/FIXME/HACK comments
      if (/\/\/\s*(TODO|FIXME|HACK|XXX)\b/i.test(line)) {
        findings.push({ line: ln, pattern: "unresolved-marker", description: "Unresolved TODO/FIXME/HACK comment", suggestion: "Address or track in issue tracker", severity: "info" });
      }
      // Empty catch blocks
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
        findings.push({ line: ln, pattern: "empty-catch", description: "Empty catch block swallows errors silently", suggestion: "Log the error or rethrow", severity: "error" });
      }
      // String concatenation in SQL-like contexts
      if (/(?:query|execute)\s*\(.*\+/.test(line)) {
        findings.push({ line: ln, pattern: "sql-concatenation", description: "String concatenation in query — possible SQL injection", suggestion: "Use parameterized queries", severity: "error" });
      }
      // Deeply nested conditionals
      const leadingSpaces = line.search(/\S/);
      if (leadingSpaces >= 16 && /\bif\b/.test(line)) {
        findings.push({ line: ln, pattern: "deep-nesting", description: "Deeply nested conditional logic", suggestion: "Extract conditions into guard clauses or separate functions", severity: "warning" });
      }
      // Mutating function arguments
      if (/arguments\[/.test(line)) {
        findings.push({ line: ln, pattern: "arguments-mutation", description: "Direct access to arguments object", suggestion: "Use rest parameters (...args) instead", severity: "warning" });
      }
    }

    return {
      language,
      findings,
      totalFindings: findings.length,
      bySeverity: {
        error: findings.filter((f) => f.severity === "error").length,
        warning: findings.filter((f) => f.severity === "warning").length,
        info: findings.filter((f) => f.severity === "info").length,
      },
    };
  },

  generateGitHubActions: async (config: { name: string; language: string; nodeVersion?: string; pythonVersion?: string; testCommand?: string; buildCommand?: string; branches?: string[] }) => {
    const branches = config.branches || ["main", "develop"];
    const branchList = branches.map((b) => `'${b}'`).join(", ");

    let yaml = `name: ${config.name}\n\n`;
    yaml += `on:\n  push:\n    branches: [${branchList}]\n  pull_request:\n    branches: [${branchList}]\n\n`;
    yaml += `jobs:\n`;

    if (config.language === "typescript" || config.language === "javascript") {
      const nodeVersion = config.nodeVersion || "20";
      yaml += `  build-and-test:\n`;
      yaml += `    runs-on: ubuntu-latest\n`;
      yaml += `    strategy:\n      matrix:\n        node-version: [${nodeVersion}]\n\n`;
      yaml += `    steps:\n`;
      yaml += `      - uses: actions/checkout@v4\n\n`;
      yaml += `      - name: Use Node.js \${{ matrix.node-version }}\n`;
      yaml += `        uses: actions/setup-node@v4\n`;
      yaml += `        with:\n          node-version: \${{ matrix.node-version }}\n          cache: 'npm'\n\n`;
      yaml += `      - name: Install dependencies\n        run: npm ci\n\n`;
      yaml += `      - name: Lint\n        run: npm run lint --if-present\n\n`;
      yaml += `      - name: Type check\n        run: npm run typecheck --if-present\n\n`;
      yaml += `      - name: Test\n        run: ${config.testCommand || "npm test"}\n\n`;
      yaml += `      - name: Build\n        run: ${config.buildCommand || "npm run build"}\n`;
    } else if (config.language === "python") {
      const pythonVersion = config.pythonVersion || "3.11";
      yaml += `  build-and-test:\n`;
      yaml += `    runs-on: ubuntu-latest\n`;
      yaml += `    strategy:\n      matrix:\n        python-version: ['${pythonVersion}']\n\n`;
      yaml += `    steps:\n`;
      yaml += `      - uses: actions/checkout@v4\n\n`;
      yaml += `      - name: Set up Python \${{ matrix.python-version }}\n`;
      yaml += `        uses: actions/setup-python@v5\n`;
      yaml += `        with:\n          python-version: \${{ matrix.python-version }}\n\n`;
      yaml += `      - name: Install dependencies\n        run: |\n          python -m pip install --upgrade pip\n          pip install -r requirements.txt\n          pip install pytest flake8\n\n`;
      yaml += `      - name: Lint\n        run: flake8 .\n\n`;
      yaml += `      - name: Test\n        run: ${config.testCommand || "pytest"}\n`;
    } else {
      yaml += `  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - name: Build\n        run: ${config.buildCommand || "echo 'Add build command'"}\n      - name: Test\n        run: ${config.testCommand || "echo 'Add test command'"}\n`;
    }

    return {
      name: config.name,
      language: config.language,
      workflow: yaml,
      triggers: { push: branches, pullRequest: branches },
    };
  },

  generateChangelog: async (commits: Array<{ hash: string; message: string; date: string; author: string }>, version?: string) => {
    const ver = version || "Unreleased";
    const categories: Record<string, Array<{ hash: string; message: string; author: string }>> = {
      features: [],
      fixes: [],
      breaking: [],
      refactor: [],
      docs: [],
      chores: [],
      other: [],
    };

    for (const commit of commits) {
      const msg = commit.message.toLowerCase();
      const entry = { hash: commit.hash.slice(0, 7), message: commit.message, author: commit.author };

      if (/^feat[:(]|^feature[:(]|add\s/.test(msg)) categories.features.push(entry);
      else if (/^fix[:(]|^bugfix[:(]|^hotfix[:(]/.test(msg)) categories.fixes.push(entry);
      else if (/breaking\s*change|^break[:(]/.test(msg)) categories.breaking.push(entry);
      else if (/^refactor[:(]|^perf[:(]/.test(msg)) categories.refactor.push(entry);
      else if (/^docs?[:(]|^readme/.test(msg)) categories.docs.push(entry);
      else if (/^chore[:(]|^ci[:(]|^build[:(]|^deps?[:(]/.test(msg)) categories.chores.push(entry);
      else categories.other.push(entry);
    }

    let changelog = `# Changelog\n\n## [${ver}] - ${new Date().toISOString().slice(0, 10)}\n\n`;

    const sectionTitles: Record<string, string> = {
      breaking: "BREAKING CHANGES",
      features: "Features",
      fixes: "Bug Fixes",
      refactor: "Refactoring",
      docs: "Documentation",
      chores: "Chores",
      other: "Other Changes",
    };

    for (const [key, title] of Object.entries(sectionTitles)) {
      const items = categories[key];
      if (items.length > 0) {
        changelog += `### ${title}\n\n`;
        for (const item of items) {
          changelog += `- ${item.message} (\`${item.hash}\`) — ${item.author}\n`;
        }
        changelog += "\n";
      }
    }

    return {
      version: ver,
      changelog,
      stats: {
        total: commits.length,
        features: categories.features.length,
        fixes: categories.fixes.length,
        breaking: categories.breaking.length,
        other: commits.length - categories.features.length - categories.fixes.length - categories.breaking.length,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Containers / Infrastructure Service — stubs
// ---------------------------------------------------------------------------

const infraStubs = {
  generateDockerfile: async (config: { language: string; baseImage?: string; port?: number; entrypoint?: string; buildSteps?: string[] }) => {
    const defaults: Record<string, { base: string; port: number; entry: string; build: string[] }> = {
      node: { base: "node:20-alpine", port: 3000, entry: "node dist/index.js", build: ["npm ci", "npm run build"] },
      typescript: { base: "node:20-alpine", port: 3000, entry: "node dist/index.js", build: ["npm ci", "npm run build"] },
      python: { base: "python:3.11-slim", port: 8000, entry: "python -m uvicorn main:app --host 0.0.0.0 --port 8000", build: ["pip install --no-cache-dir -r requirements.txt"] },
      go: { base: "golang:1.22-alpine", port: 8080, entry: "./app", build: ["go mod download", "CGO_ENABLED=0 go build -o app ."] },
      rust: { base: "rust:1.77-slim", port: 8080, entry: "./target/release/app", build: ["cargo build --release"] },
      java: { base: "eclipse-temurin:21-jdk-alpine", port: 8080, entry: "java -jar target/app.jar", build: ["./mvnw package -DskipTests"] },
    };

    const d = defaults[config.language] || defaults.node;
    const base = config.baseImage || d.base;
    const port = config.port || d.port;
    const entrypoint = config.entrypoint || d.entry;
    const buildSteps = config.buildSteps || d.build;

    let dockerfile = `# syntax=docker/dockerfile:1\n\n`;
    dockerfile += `# ---- Build Stage ----\n`;
    dockerfile += `FROM ${base} AS builder\n`;
    dockerfile += `WORKDIR /app\n`;
    dockerfile += `COPY . .\n`;
    for (const step of buildSteps) {
      dockerfile += `RUN ${step}\n`;
    }
    dockerfile += `\n# ---- Production Stage ----\n`;
    dockerfile += `FROM ${base.replace("-sdk", "").replace("jdk", "jre")} AS production\n`;
    dockerfile += `WORKDIR /app\n`;
    dockerfile += `COPY --from=builder /app .\n`;
    dockerfile += `RUN addgroup -S appgroup && adduser -S appuser -G appgroup\n`;
    dockerfile += `USER appuser\n`;
    dockerfile += `EXPOSE ${port}\n`;
    dockerfile += `HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:${port}/health || exit 1\n`;
    dockerfile += `CMD [${entrypoint.split(" ").map((s) => `"${s}"`).join(", ")}]\n`;

    return { language: config.language, dockerfile, port, stages: ["builder", "production"] };
  },

  generateDockerCompose: async (services: Array<{ name: string; image?: string; build?: string; ports?: string[]; environment?: Record<string, string>; depends_on?: string[]; volumes?: string[] }>) => {
    let yaml = `version: '3.8'\n\nservices:\n`;
    const volumeSet = new Set<string>();

    for (const svc of services) {
      yaml += `  ${svc.name}:\n`;
      if (svc.build) yaml += `    build: ${svc.build}\n`;
      else if (svc.image) yaml += `    image: ${svc.image}\n`;
      if (svc.ports && svc.ports.length) {
        yaml += `    ports:\n`;
        for (const p of svc.ports) yaml += `      - '${p}'\n`;
      }
      if (svc.environment && Object.keys(svc.environment).length) {
        yaml += `    environment:\n`;
        for (const [k, v] of Object.entries(svc.environment)) yaml += `      ${k}: '${v}'\n`;
      }
      if (svc.depends_on && svc.depends_on.length) {
        yaml += `    depends_on:\n`;
        for (const dep of svc.depends_on) yaml += `      - ${dep}\n`;
      }
      if (svc.volumes && svc.volumes.length) {
        yaml += `    volumes:\n`;
        for (const vol of svc.volumes) {
          yaml += `      - ${vol}\n`;
          const named = vol.split(":")[0];
          if (!named.startsWith(".") && !named.startsWith("/")) volumeSet.add(named);
        }
      }
      yaml += `    restart: unless-stopped\n\n`;
    }

    if (volumeSet.size > 0) {
      yaml += `volumes:\n`;
      for (const v of volumeSet) yaml += `  ${v}:\n`;
    }

    return { compose: yaml, serviceCount: services.length, namedVolumes: [...volumeSet] };
  },

  analyzeDockerfile: async (dockerfile: string) => {
    const lines = dockerfile.split("\n");
    const issues: Array<{ line: number; severity: string; message: string; recommendation: string }> = [];
    let hasHealthcheck = false;
    let hasUser = false;
    let fromCount = 0;
    let lastFromBase = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const ln = i + 1;

      if (/^FROM\s+/i.test(line)) {
        fromCount++;
        lastFromBase = line.replace(/^FROM\s+/i, "").split(/\s/)[0];
        if (/:latest\b/.test(line) || !/:/.test(lastFromBase)) {
          issues.push({ line: ln, severity: "warning", message: "Using 'latest' or untagged base image", recommendation: "Pin a specific image tag for reproducible builds" });
        }
      }
      if (/^RUN\s+apt-get\s+install/i.test(line) && !/apt-get\s+update/.test(dockerfile.split("\n").slice(Math.max(0, i - 3), i + 1).join(" "))) {
        issues.push({ line: ln, severity: "warning", message: "apt-get install without preceding apt-get update", recommendation: "Combine: RUN apt-get update && apt-get install -y ..." });
      }
      if (/^RUN\s+pip\s+install/i.test(line) && !line.includes("--no-cache-dir")) {
        issues.push({ line: ln, severity: "info", message: "pip install without --no-cache-dir", recommendation: "Add --no-cache-dir to reduce image size" });
      }
      if (/^COPY\s+\.\s+\./i.test(line) && fromCount <= 1) {
        issues.push({ line: ln, severity: "warning", message: "COPY . . early in Dockerfile invalidates cache on any file change", recommendation: "Copy dependency files first, install, then copy source" });
      }
      if (/^HEALTHCHECK\b/i.test(line)) hasHealthcheck = true;
      if (/^USER\s+/i.test(line)) hasUser = true;
      if (/^EXPOSE\b/i.test(line) && !line.match(/\d+/)) {
        issues.push({ line: ln, severity: "info", message: "EXPOSE without a port number", recommendation: "Specify the port number: EXPOSE 8080" });
      }
      if (/^ADD\s+/i.test(line) && !line.includes("http") && !line.includes(".tar")) {
        issues.push({ line: ln, severity: "info", message: "Using ADD instead of COPY for local files", recommendation: "Use COPY for local files; ADD is for URLs and tar extraction" });
      }
    }

    if (!hasHealthcheck) {
      issues.push({ line: 0, severity: "warning", message: "No HEALTHCHECK instruction", recommendation: "Add a HEALTHCHECK for container orchestration" });
    }
    if (!hasUser) {
      issues.push({ line: 0, severity: "warning", message: "Running as root (no USER instruction)", recommendation: "Create and switch to a non-root user" });
    }

    return {
      totalLines: lines.length,
      stages: fromCount,
      baseImage: lastFromBase,
      hasHealthcheck,
      hasNonRootUser: hasUser,
      issues,
      score: Math.max(0, 100 - issues.filter((i) => i.severity === "error").length * 20 - issues.filter((i) => i.severity === "warning").length * 10 - issues.filter((i) => i.severity === "info").length * 3),
    };
  },

  generateK8sManifest: async (config: { name: string; image: string; replicas?: number; port?: number; namespace?: string; resources?: { cpuRequest?: string; cpuLimit?: string; memoryRequest?: string; memoryLimit?: string }; envVars?: Record<string, string> }) => {
    const ns = config.namespace || "default";
    const replicas = config.replicas || 2;
    const port = config.port || 8080;
    const res = config.resources || {};

    let manifest = `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${config.name}\n  namespace: ${ns}\n  labels:\n    app: ${config.name}\nspec:\n  replicas: ${replicas}\n  selector:\n    matchLabels:\n      app: ${config.name}\n  template:\n    metadata:\n      labels:\n        app: ${config.name}\n    spec:\n      containers:\n        - name: ${config.name}\n          image: ${config.image}\n          ports:\n            - containerPort: ${port}\n          resources:\n            requests:\n              cpu: '${res.cpuRequest || "100m"}'\n              memory: '${res.memoryRequest || "128Mi"}'\n            limits:\n              cpu: '${res.cpuLimit || "500m"}'\n              memory: '${res.memoryLimit || "512Mi"}'\n`;
    if (config.envVars && Object.keys(config.envVars).length) {
      manifest += `          env:\n`;
      for (const [k, v] of Object.entries(config.envVars)) {
        manifest += `            - name: ${k}\n              value: '${v}'\n`;
      }
    }
    manifest += `          livenessProbe:\n            httpGet:\n              path: /health\n              port: ${port}\n            initialDelaySeconds: 15\n            periodSeconds: 20\n          readinessProbe:\n            httpGet:\n              path: /ready\n              port: ${port}\n            initialDelaySeconds: 5\n            periodSeconds: 10\n`;

    // Service
    manifest += `---\napiVersion: v1\nkind: Service\nmetadata:\n  name: ${config.name}\n  namespace: ${ns}\nspec:\n  selector:\n    app: ${config.name}\n  ports:\n    - port: ${port}\n      targetPort: ${port}\n  type: ClusterIP\n`;

    return { name: config.name, namespace: ns, manifest, resourceTypes: ["Deployment", "Service"] };
  },

  generateHelmChart: async (config: { name: string; version?: string; appVersion?: string; description?: string }) => {
    const ver = config.version || "0.1.0";
    const appVer = config.appVersion || "1.0.0";
    const desc = config.description || `Helm chart for ${config.name}`;

    const chartYaml = `apiVersion: v2\nname: ${config.name}\ndescription: ${desc}\ntype: application\nversion: ${ver}\nappVersion: '${appVer}'\n`;

    const valuesYaml = `replicaCount: 2\n\nimage:\n  repository: ${config.name}\n  pullPolicy: IfNotPresent\n  tag: '${appVer}'\n\nservice:\n  type: ClusterIP\n  port: 80\n\ningress:\n  enabled: false\n  className: ''\n  annotations: {}\n  hosts:\n    - host: ${config.name}.local\n      paths:\n        - path: /\n          pathType: ImplementationSpecific\n  tls: []\n\nresources:\n  limits:\n    cpu: 500m\n    memory: 512Mi\n  requests:\n    cpu: 100m\n    memory: 128Mi\n\nautoscaling:\n  enabled: false\n  minReplicas: 2\n  maxReplicas: 10\n  targetCPUUtilizationPercentage: 80\n`;

    const helpersTPL = `{{/*\nExpand the name of the chart.\n*/}}\n{{- define "${config.name}.name" -}}\n{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}\n{{- end }}\n\n{{/*\nCreate chart name and version as used by the chart label.\n*/}}\n{{- define "${config.name}.chart" -}}\n{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}\n{{- end }}\n\n{{/*\nCommon labels\n*/}}\n{{- define "${config.name}.labels" -}}\nhelm.sh/chart: {{ include "${config.name}.chart" . }}\napp.kubernetes.io/name: {{ include "${config.name}.name" . }}\napp.kubernetes.io/instance: {{ .Release.Name }}\napp.kubernetes.io/version: {{ .Chart.AppVersion | quote }}\napp.kubernetes.io/managed-by: {{ .Release.Service }}\n{{- end }}\n`;

    return {
      name: config.name,
      files: {
        "Chart.yaml": chartYaml,
        "values.yaml": valuesYaml,
        "templates/_helpers.tpl": helpersTPL,
      },
      structure: [`${config.name}/`, `${config.name}/Chart.yaml`, `${config.name}/values.yaml`, `${config.name}/templates/`, `${config.name}/templates/_helpers.tpl`, `${config.name}/templates/deployment.yaml`, `${config.name}/templates/service.yaml`],
    };
  },

  generateK8sIngress: async (config: { name: string; host: string; serviceName: string; servicePort?: number; tlsEnabled?: boolean; ingressClass?: string; annotations?: Record<string, string> }) => {
    const port = config.servicePort || 80;
    const ingressClass = config.ingressClass || "nginx";
    const annotations = config.annotations || {};

    let manifest = `apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: ${config.name}-ingress\n  annotations:\n    kubernetes.io/ingress.class: '${ingressClass}'\n`;
    for (const [k, v] of Object.entries(annotations)) {
      manifest += `    ${k}: '${v}'\n`;
    }
    if (config.tlsEnabled) {
      manifest += `    cert-manager.io/cluster-issuer: letsencrypt-prod\n`;
    }
    manifest += `spec:\n`;
    if (config.tlsEnabled) {
      manifest += `  tls:\n    - hosts:\n        - ${config.host}\n      secretName: ${config.name}-tls\n`;
    }
    manifest += `  rules:\n    - host: ${config.host}\n      http:\n        paths:\n          - path: /\n            pathType: Prefix\n            backend:\n              service:\n                name: ${config.serviceName}\n                port:\n                  number: ${port}\n`;

    return { name: config.name, host: config.host, manifest, tlsEnabled: config.tlsEnabled || false };
  },

  generateTerraformMain: async (config: { provider: string; region?: string; resources: Array<{ type: string; name: string; properties?: Record<string, any> }> }) => {
    const region = config.region || "us-east-1";

    let tf = `# Terraform Configuration\n# Provider: ${config.provider}\n# Region: ${region}\n\nterraform {\n  required_version = ">= 1.0"\n  required_providers {\n`;

    if (config.provider === "aws") {
      tf += `    aws = {\n      source  = "hashicorp/aws"\n      version = "~> 5.0"\n    }\n`;
    } else if (config.provider === "gcp") {
      tf += `    google = {\n      source  = "hashicorp/google"\n      version = "~> 5.0"\n    }\n`;
    } else if (config.provider === "azure") {
      tf += `    azurerm = {\n      source  = "hashicorp/azurerm"\n      version = "~> 3.0"\n    }\n`;
    }

    tf += `  }\n}\n\n`;

    if (config.provider === "aws") {
      tf += `provider "aws" {\n  region = "${region}"\n}\n\n`;
    } else if (config.provider === "gcp") {
      tf += `provider "google" {\n  region = "${region}"\n}\n\n`;
    } else if (config.provider === "azure") {
      tf += `provider "azurerm" {\n  features {}\n}\n\n`;
    }

    for (const res of config.resources) {
      tf += `resource "${res.type}" "${res.name}" {\n`;
      if (res.properties) {
        for (const [k, v] of Object.entries(res.properties)) {
          if (typeof v === "string") tf += `  ${k} = "${v}"\n`;
          else if (typeof v === "number" || typeof v === "boolean") tf += `  ${k} = ${v}\n`;
          else tf += `  ${k} = ${JSON.stringify(v)}\n`;
        }
      }
      tf += `}\n\n`;
    }

    return { provider: config.provider, region, terraform: tf, resourceCount: config.resources.length };
  },

  generateNginxConfig: async (config: { serverName: string; upstream?: string; port?: number; sslEnabled?: boolean; locations?: Array<{ path: string; proxy?: string; root?: string; tryFiles?: string }> }) => {
    const port = config.port || 80;
    let nginx = "";

    if (config.upstream) {
      nginx += `upstream backend {\n  server ${config.upstream};\n  keepalive 32;\n}\n\n`;
    }

    if (config.sslEnabled) {
      nginx += `server {\n  listen 80;\n  server_name ${config.serverName};\n  return 301 https://$server_name$request_uri;\n}\n\n`;
      nginx += `server {\n  listen 443 ssl http2;\n  server_name ${config.serverName};\n\n`;
      nginx += `  ssl_certificate /etc/nginx/ssl/${config.serverName}.crt;\n`;
      nginx += `  ssl_certificate_key /etc/nginx/ssl/${config.serverName}.key;\n`;
      nginx += `  ssl_protocols TLSv1.2 TLSv1.3;\n`;
      nginx += `  ssl_ciphers HIGH:!aNULL:!MD5;\n`;
      nginx += `  ssl_prefer_server_ciphers on;\n\n`;
    } else {
      nginx += `server {\n  listen ${port};\n  server_name ${config.serverName};\n\n`;
    }

    nginx += `  # Security headers\n`;
    nginx += `  add_header X-Frame-Options "SAMEORIGIN" always;\n`;
    nginx += `  add_header X-Content-Type-Options "nosniff" always;\n`;
    nginx += `  add_header X-XSS-Protection "1; mode=block" always;\n`;
    nginx += `  add_header Referrer-Policy "strict-origin-when-cross-origin" always;\n\n`;

    nginx += `  # Gzip\n  gzip on;\n  gzip_types text/plain text/css application/json application/javascript text/xml;\n  gzip_min_length 1000;\n\n`;

    const locations = config.locations || [{ path: "/", proxy: config.upstream ? "http://backend" : undefined, root: config.upstream ? undefined : "/var/www/html", tryFiles: config.upstream ? undefined : "$uri $uri/ /index.html" }];

    for (const loc of locations) {
      nginx += `  location ${loc.path} {\n`;
      if (loc.proxy) {
        nginx += `    proxy_pass ${loc.proxy};\n`;
        nginx += `    proxy_http_version 1.1;\n`;
        nginx += `    proxy_set_header Upgrade $http_upgrade;\n`;
        nginx += `    proxy_set_header Connection 'upgrade';\n`;
        nginx += `    proxy_set_header Host $host;\n`;
        nginx += `    proxy_set_header X-Real-IP $remote_addr;\n`;
        nginx += `    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n`;
        nginx += `    proxy_set_header X-Forwarded-Proto $scheme;\n`;
        nginx += `    proxy_cache_bypass $http_upgrade;\n`;
      }
      if (loc.root) nginx += `    root ${loc.root};\n`;
      if (loc.tryFiles) nginx += `    try_files ${loc.tryFiles};\n`;
      nginx += `  }\n\n`;
    }

    nginx += `  # Static assets caching\n  location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {\n    expires 30d;\n    add_header Cache-Control "public, immutable";\n  }\n\n`;
    nginx += `  error_page 500 502 503 504 /50x.html;\n  location = /50x.html {\n    root /usr/share/nginx/html;\n  }\n}\n`;

    return { serverName: config.serverName, config: nginx, sslEnabled: config.sslEnabled || false };
  },

  describeNetworkArchitecture: async (config: { components: Array<{ name: string; type: string; subnet?: string }>; connections: Array<{ from: string; to: string; protocol?: string; port?: number }> }) => {
    let description = "# Network Architecture\n\n## Components\n\n";
    const subnets = new Map<string, string[]>();

    for (const comp of config.components) {
      const subnet = comp.subnet || "default";
      if (!subnets.has(subnet)) subnets.set(subnet, []);
      subnets.get(subnet)!.push(`${comp.name} (${comp.type})`);
      description += `- **${comp.name}** — Type: ${comp.type}${comp.subnet ? `, Subnet: ${comp.subnet}` : ""}\n`;
    }

    description += "\n## Subnet Layout\n\n";
    for (const [subnet, components] of subnets) {
      description += `### ${subnet}\n`;
      for (const c of components) description += `  - ${c}\n`;
      description += "\n";
    }

    description += "## Connections\n\n";
    for (const conn of config.connections) {
      description += `- ${conn.from} -> ${conn.to} (${conn.protocol || "TCP"}${conn.port ? ":" + conn.port : ""})\n`;
    }

    return {
      description,
      componentCount: config.components.length,
      connectionCount: config.connections.length,
      subnets: [...subnets.keys()],
    };
  },

  estimateCosts: async (resources: Array<{ type: string; provider: string; tier?: string; hours?: number }>) => {
    // Simplified cost estimator with rough hourly rates
    const rates: Record<string, Record<string, number>> = {
      "compute.small": { aws: 0.0116, gcp: 0.01, azure: 0.012 },
      "compute.medium": { aws: 0.0464, gcp: 0.04, azure: 0.045 },
      "compute.large": { aws: 0.0928, gcp: 0.08, azure: 0.09 },
      "database.small": { aws: 0.017, gcp: 0.015, azure: 0.018 },
      "database.medium": { aws: 0.068, gcp: 0.06, azure: 0.065 },
      "database.large": { aws: 0.272, gcp: 0.24, azure: 0.26 },
      "storage.standard": { aws: 0.023, gcp: 0.02, azure: 0.022 },
      "loadbalancer": { aws: 0.0225, gcp: 0.025, azure: 0.025 },
      "cdn": { aws: 0.085, gcp: 0.08, azure: 0.081 },
      "cache.small": { aws: 0.017, gcp: 0.015, azure: 0.016 },
      "cache.medium": { aws: 0.068, gcp: 0.06, azure: 0.065 },
    };

    const hoursPerMonth = 730;
    const items: Array<{ type: string; provider: string; hourlyRate: number; monthlyEstimate: number }> = [];
    let totalMonthly = 0;

    for (const res of resources) {
      const key = res.tier ? `${res.type}.${res.tier}` : res.type;
      const providerRates = rates[key] || rates[res.type + ".small"] || { aws: 0.05, gcp: 0.045, azure: 0.048 };
      const hourlyRate = providerRates[res.provider] || 0.05;
      const hours = res.hours || hoursPerMonth;
      const monthly = hourlyRate * hours;
      items.push({ type: key, provider: res.provider, hourlyRate, monthlyEstimate: Math.round(monthly * 100) / 100 });
      totalMonthly += monthly;
    }

    return {
      items,
      totalMonthly: Math.round(totalMonthly * 100) / 100,
      totalAnnual: Math.round(totalMonthly * 12 * 100) / 100,
      currency: "USD",
      disclaimer: "Estimates are approximate and based on simplified pricing models. Actual costs may vary.",
    };
  },
};

// ===========================================================================
// TOOLS ARRAY
// ===========================================================================

export const extendedToolsPart1: ToolDefinition[] = [

  // =========================================================================
  // TERMINAL TOOLS (15)
  // =========================================================================

  {
    name: "terminal_create_session",
    description: "Create a new terminal session with optional environment variables. Returns the session ID for subsequent commands.",
    category: "terminal",
    schema: z.object({
      env: z.record(z.string()).optional().describe("Optional environment variables to set in the session"),
    }),
    execute: async (params) => {
      const session = createSession(params.env);
      return {
        sessionId: session.id,
        cwd: session.cwd,
        createdAt: session.createdAt.toISOString(),
      };
    },
  },

  {
    name: "terminal_execute_command",
    description: "Execute a shell command within an existing terminal session. Blocks until the command completes or times out.",
    category: "terminal",
    schema: z.object({
      sessionId: z.string().describe("The terminal session ID"),
      command: z.string().min(1).max(2000).describe("The shell command to execute"),
      timeout: z.number().int().positive().max(300000).optional().describe("Timeout in milliseconds (default 30s, max 5min)"),
      cwd: z.string().optional().describe("Working directory override"),
    }),
    execute: async (params) => {
      return executeCommand(params.sessionId, params.command, {
        timeout: params.timeout,
        cwd: params.cwd,
      });
    },
  },

  {
    name: "terminal_check_dangerous",
    description: "Check whether a command is potentially dangerous before executing it. Returns whether the command is blocked and why.",
    category: "terminal",
    schema: z.object({
      command: z.string().min(1).describe("The command to evaluate"),
    }),
    execute: async (params) => {
      return isDangerousCommand(params.command);
    },
  },

  {
    name: "terminal_suggest_correction",
    description: "Given a failed command and its error output, suggest a correction or fix.",
    category: "terminal",
    schema: z.object({
      command: z.string().describe("The command that failed"),
      error: z.string().describe("The error message or stderr output"),
    }),
    execute: async (params) => {
      const suggestion = suggestCorrection(params.command, params.error);
      return {
        command: params.command,
        suggestion: suggestion || "No specific suggestion available. Review the error output carefully.",
        hasSuggestion: suggestion !== null,
      };
    },
  },

  {
    name: "terminal_system_info",
    description: "Retrieve system information including platform, architecture, CPU count, memory, uptime, and load average.",
    category: "terminal",
    schema: z.object({}),
    execute: async () => {
      return getSystemInfo();
    },
  },

  {
    name: "terminal_process_list",
    description: "List running processes with PID, name, CPU, and memory usage. Returns up to 50 processes sorted by memory.",
    category: "terminal",
    schema: z.object({}),
    execute: async () => {
      const processes = await getProcessList();
      return { count: processes.length, processes };
    },
  },

  {
    name: "terminal_kill_process",
    description: "Send a signal to a process by PID. Protected PIDs (0, 1, current process) are blocked.",
    category: "terminal",
    schema: z.object({
      pid: z.number().int().positive().describe("Process ID to signal"),
      signal: z.string().optional().describe("Signal to send (default: SIGTERM). Examples: SIGTERM, SIGKILL, SIGHUP"),
    }),
    execute: async (params) => {
      try {
        const killed = await killProcess(params.pid, params.signal);
        return { pid: params.pid, signal: params.signal || "SIGTERM", success: killed };
      } catch (err: any) {
        return { pid: params.pid, signal: params.signal || "SIGTERM", success: false, error: err.message };
      }
    },
  },

  {
    name: "terminal_git_status",
    description: "Run 'git status' in the specified or current working directory and return the output.",
    category: "terminal",
    schema: z.object({
      cwd: z.string().optional().describe("Directory to run git status in (default: current working directory)"),
    }),
    execute: async (params) => {
      const output = await gitStatus(params.cwd);
      return { output };
    },
  },

  {
    name: "terminal_git_diff",
    description: "Run 'git diff' to show unstaged changes in the specified or current working directory.",
    category: "terminal",
    schema: z.object({
      cwd: z.string().optional().describe("Directory to run git diff in"),
    }),
    execute: async (params) => {
      const output = await gitDiff(params.cwd);
      return { output };
    },
  },

  {
    name: "terminal_git_log",
    description: "Show recent git commit log (oneline format). Configurable number of entries.",
    category: "terminal",
    schema: z.object({
      count: z.number().int().min(1).max(200).optional().describe("Number of log entries (default: 10, max: 200)"),
      cwd: z.string().optional().describe("Directory to run git log in"),
    }),
    execute: async (params) => {
      const output = await gitLog(params.count, params.cwd);
      return { output };
    },
  },

  {
    name: "terminal_file_diff",
    description: "Compare two files using unified diff format and return the differences.",
    category: "terminal",
    schema: z.object({
      file1: z.string().describe("Path to the first file"),
      file2: z.string().describe("Path to the second file"),
    }),
    execute: async (params) => {
      const output = await fileDiff(params.file1, params.file2);
      return { output };
    },
  },

  {
    name: "terminal_compress",
    description: "Compress files into a tar.gz or zip archive.",
    category: "terminal",
    schema: z.object({
      files: z.array(z.string()).min(1).describe("Array of file/directory paths to compress"),
      outputPath: z.string().describe("Path for the output archive file"),
      format: z.enum(["tar.gz", "zip"]).optional().describe("Archive format (default: tar.gz)"),
    }),
    execute: async (params) => {
      const output = await compressFiles(params.files, params.outputPath, params.format);
      return { output, outputPath: params.outputPath };
    },
  },

  {
    name: "terminal_decompress",
    description: "Extract an archive (zip, tar.gz, tar.bz2, tar) to a target directory.",
    category: "terminal",
    schema: z.object({
      filePath: z.string().describe("Path to the archive file"),
      outputDir: z.string().optional().describe("Directory to extract to (default: same directory as archive)"),
    }),
    execute: async (params) => {
      const output = await decompressFile(params.filePath, params.outputDir);
      return { output };
    },
  },

  {
    name: "terminal_network_diagnostics",
    description: "Run network diagnostics: ping, traceroute, DNS lookup, or port check for a given host.",
    category: "terminal",
    schema: z.object({
      host: z.string().describe("Target host (for port check use host:port format)"),
      type: z.enum(["ping", "traceroute", "dns", "port"]).describe("Type of network diagnostic to run"),
    }),
    execute: async (params) => {
      const output = await networkDiagnostics(params.host, params.type);
      return { host: params.host, type: params.type, output };
    },
  },

  {
    name: "terminal_grep",
    description: "Search for a text pattern in files within a directory. Supports recursive search, case-insensitive mode, and file glob filtering.",
    category: "terminal",
    schema: z.object({
      pattern: z.string().describe("Search pattern (grep regex)"),
      directory: z.string().describe("Directory to search in"),
      recursive: z.boolean().optional().describe("Search recursively (default: true)"),
      ignoreCase: z.boolean().optional().describe("Case-insensitive search (default: false)"),
      fileGlob: z.string().optional().describe("File glob pattern to filter files (e.g. '*.ts')"),
    }),
    execute: async (params) => {
      const output = await grepFiles(params.pattern, params.directory, {
        recursive: params.recursive,
        ignoreCase: params.ignoreCase,
        fileGlob: params.fileGlob,
      });
      return { pattern: params.pattern, directory: params.directory, output };
    },
  },

  // =========================================================================
  // CODE / DEV TOOLS (15)
  // =========================================================================

  {
    name: "code_analyze_syntax",
    description: "Analyze source code for syntax issues including unmatched brackets, trailing whitespace, long lines, and debug statements.",
    category: "code",
    schema: z.object({
      code: z.string().describe("Source code to analyze"),
      language: z.string().describe("Programming language (e.g. typescript, python, javascript)"),
    }),
    execute: async (params) => {
      return codeDevStubs.analyzeSyntax(params.code, params.language);
    },
  },

  {
    name: "code_lint",
    description: "Lint source code against a set of configurable rules. Returns findings with severity and line numbers.",
    category: "code",
    schema: z.object({
      code: z.string().describe("Source code to lint"),
      language: z.string().describe("Programming language"),
      rules: z.array(z.string()).optional().describe("Specific lint rules to apply (default: standard set)"),
    }),
    execute: async (params) => {
      return codeDevStubs.lintCode(params.code, params.language, params.rules);
    },
  },

  {
    name: "code_format",
    description: "Format source code: normalize line endings, trim trailing whitespace, collapse blank lines.",
    category: "code",
    schema: z.object({
      code: z.string().describe("Source code to format"),
      language: z.string().describe("Programming language"),
      indentSize: z.number().int().min(1).max(8).optional().describe("Indent size in spaces (default: 2)"),
      useTabs: z.boolean().optional().describe("Use tabs instead of spaces (default: false)"),
      singleQuote: z.boolean().optional().describe("Prefer single quotes (default: false)"),
      trailingComma: z.boolean().optional().describe("Add trailing commas (default: false)"),
      semicolons: z.boolean().optional().describe("Require semicolons (default: true)"),
    }),
    execute: async (params) => {
      return codeDevStubs.formatCode(params.code, params.language, {
        indentSize: params.indentSize,
        useTabs: params.useTabs,
        singleQuote: params.singleQuote,
        trailingComma: params.trailingComma,
        semicolons: params.semicolons,
      });
    },
  },

  {
    name: "code_complexity",
    description: "Analyze code complexity: cyclomatic complexity per function, lines of code, comment density, and maintainability index.",
    category: "code",
    schema: z.object({
      code: z.string().describe("Source code to analyze"),
      language: z.string().describe("Programming language"),
    }),
    execute: async (params) => {
      return codeDevStubs.analyzeComplexity(params.code, params.language);
    },
  },

  {
    name: "code_dead_code",
    description: "Detect potentially dead code: unused functions, unused variables, and unreachable code after return statements.",
    category: "code",
    schema: z.object({
      code: z.string().describe("Source code to analyze"),
      language: z.string().describe("Programming language"),
    }),
    execute: async (params) => {
      return codeDevStubs.detectDeadCode(params.code, params.language);
    },
  },

  {
    name: "code_dependencies",
    description: "Analyze a package.json file: list production and dev dependencies, detect possibly outdated packages and duplicates.",
    category: "code",
    schema: z.object({
      packageJson: z.string().describe("The package.json content as a string"),
    }),
    execute: async (params) => {
      return codeDevStubs.analyzeDependencies(params.packageJson);
    },
  },

  {
    name: "code_generate_tests",
    description: "Generate test scaffolding for functions found in the provided source code. Supports Jest and pytest frameworks.",
    category: "code",
    schema: z.object({
      code: z.string().describe("Source code to generate tests for"),
      language: z.string().describe("Programming language"),
      framework: z.string().optional().describe("Test framework (jest, pytest). Default: auto-detected from language"),
    }),
    execute: async (params) => {
      return codeDevStubs.generateTests(params.code, params.language, params.framework);
    },
  },

  {
    name: "code_generate_api_docs",
    description: "Generate API documentation from Express/Fastify route definitions. Outputs OpenAPI 3.0 spec or Markdown.",
    category: "code",
    schema: z.object({
      code: z.string().describe("Source code containing route definitions"),
      format: z.enum(["openapi", "markdown"]).optional().describe("Output format (default: openapi)"),
    }),
    execute: async (params) => {
      return codeDevStubs.generateAPIDocs(params.code, params.format);
    },
  },

  {
    name: "code_scaffold_crud",
    description: "Generate complete CRUD (Create, Read, Update, Delete) boilerplate code for an entity with typed fields.",
    category: "code",
    schema: z.object({
      entityName: z.string().describe("Name of the entity (e.g. 'User', 'Product')"),
      fields: z.array(z.object({
        name: z.string(),
        type: z.string().describe("Field type: string, number, boolean, Date, etc."),
        required: z.boolean().optional().describe("Whether the field is required (default: true)"),
      })).min(1).describe("Entity fields"),
      language: z.enum(["typescript", "python"]).optional().describe("Target language (default: typescript)"),
    }),
    execute: async (params) => {
      return codeDevStubs.scaffoldCRUD(params.entityName, params.fields, params.language);
    },
  },

  {
    name: "code_generate_migration",
    description: "Generate a SQL database migration (up and down) for creating a table with typed columns.",
    category: "code",
    schema: z.object({
      tableName: z.string().describe("Name of the database table to create"),
      columns: z.array(z.object({
        name: z.string(),
        type: z.string().describe("Column type: string, number, boolean, text, date, float, uuid"),
        nullable: z.boolean().optional().describe("Allow NULL values (default: true)"),
        defaultValue: z.string().optional().describe("SQL default value expression"),
      })).min(1).describe("Table columns"),
      dialect: z.enum(["postgresql", "mysql", "sqlite"]).optional().describe("SQL dialect (default: postgresql)"),
    }),
    execute: async (params) => {
      return codeDevStubs.generateMigration(params.tableName, params.columns, params.dialect);
    },
  },

  {
    name: "code_rename_symbol",
    description: "Rename all occurrences of a symbol (variable, function, class) in source code using word-boundary matching.",
    category: "code",
    schema: z.object({
      code: z.string().describe("Source code to refactor"),
      oldName: z.string().describe("Current symbol name"),
      newName: z.string().describe("New symbol name"),
    }),
    execute: async (params) => {
      return codeDevStubs.renameSymbol(params.code, params.oldName, params.newName);
    },
  },

  {
    name: "code_extract_function",
    description: "Extract a range of lines into a new named function, automatically detecting required parameters from variable usage.",
    category: "code",
    schema: z.object({
      code: z.string().describe("Full source code"),
      startLine: z.number().int().min(1).describe("First line to extract (1-indexed)"),
      endLine: z.number().int().min(1).describe("Last line to extract (1-indexed)"),
      functionName: z.string().describe("Name for the new function"),
    }),
    execute: async (params) => {
      return codeDevStubs.extractFunction(params.code, params.startLine, params.endLine, params.functionName);
    },
  },

  {
    name: "code_detect_antipatterns",
    description: "Scan code for common anti-patterns: callback hell, magic numbers, empty catch blocks, deep nesting, TODO markers, and more.",
    category: "code",
    schema: z.object({
      code: z.string().describe("Source code to analyze"),
      language: z.string().describe("Programming language"),
    }),
    execute: async (params) => {
      return codeDevStubs.detectAntipatterns(params.code, params.language);
    },
  },

  {
    name: "code_github_actions",
    description: "Generate a GitHub Actions CI/CD workflow YAML for a project. Supports Node.js/TypeScript and Python.",
    category: "code",
    schema: z.object({
      name: z.string().describe("Workflow name"),
      language: z.enum(["typescript", "javascript", "python"]).describe("Project language"),
      nodeVersion: z.string().optional().describe("Node.js version (default: 20)"),
      pythonVersion: z.string().optional().describe("Python version (default: 3.11)"),
      testCommand: z.string().optional().describe("Custom test command"),
      buildCommand: z.string().optional().describe("Custom build command"),
      branches: z.array(z.string()).optional().describe("Branches to trigger on (default: [main, develop])"),
    }),
    execute: async (params) => {
      return codeDevStubs.generateGitHubActions(params);
    },
  },

  {
    name: "code_changelog",
    description: "Generate a structured changelog from an array of commit objects. Categorizes commits by type (features, fixes, breaking, etc.).",
    category: "code",
    schema: z.object({
      commits: z.array(z.object({
        hash: z.string(),
        message: z.string(),
        date: z.string(),
        author: z.string(),
      })).min(1).describe("Array of commit objects"),
      version: z.string().optional().describe("Version string (default: 'Unreleased')"),
    }),
    execute: async (params) => {
      return codeDevStubs.generateChangelog(params.commits, params.version);
    },
  },

  // =========================================================================
  // CONTAINERS / INFRASTRUCTURE TOOLS (10)
  // =========================================================================

  {
    name: "infra_generate_dockerfile",
    description: "Generate a multi-stage, security-hardened Dockerfile for a given language and configuration.",
    category: "infrastructure",
    schema: z.object({
      language: z.enum(["node", "typescript", "python", "go", "rust", "java"]).describe("Application language/runtime"),
      baseImage: z.string().optional().describe("Custom base Docker image"),
      port: z.number().int().optional().describe("Port to expose"),
      entrypoint: z.string().optional().describe("Container entrypoint command"),
      buildSteps: z.array(z.string()).optional().describe("Custom build steps (RUN commands)"),
    }),
    execute: async (params) => {
      return infraStubs.generateDockerfile(params);
    },
  },

  {
    name: "infra_docker_compose",
    description: "Generate a docker-compose.yml file from an array of service definitions with ports, volumes, and dependencies.",
    category: "infrastructure",
    schema: z.object({
      services: z.array(z.object({
        name: z.string(),
        image: z.string().optional().describe("Docker image (use this OR build)"),
        build: z.string().optional().describe("Build context path (use this OR image)"),
        ports: z.array(z.string()).optional().describe("Port mappings (e.g. '8080:80')"),
        environment: z.record(z.string()).optional().describe("Environment variables"),
        depends_on: z.array(z.string()).optional().describe("Service dependencies"),
        volumes: z.array(z.string()).optional().describe("Volume mounts"),
      })).min(1).describe("Service definitions"),
    }),
    execute: async (params) => {
      return infraStubs.generateDockerCompose(params.services);
    },
  },

  {
    name: "infra_analyze_dockerfile",
    description: "Analyze a Dockerfile for best-practice issues: untagged images, missing HEALTHCHECK, running as root, cache invalidation, and more.",
    category: "infrastructure",
    schema: z.object({
      dockerfile: z.string().describe("Dockerfile content to analyze"),
    }),
    execute: async (params) => {
      return infraStubs.analyzeDockerfile(params.dockerfile);
    },
  },

  {
    name: "infra_k8s_manifest",
    description: "Generate Kubernetes Deployment and Service manifests with health probes, resource limits, and optional environment variables.",
    category: "infrastructure",
    schema: z.object({
      name: z.string().describe("Application name"),
      image: z.string().describe("Container image (e.g. myapp:1.0.0)"),
      replicas: z.number().int().min(1).max(100).optional().describe("Number of replicas (default: 2)"),
      port: z.number().int().optional().describe("Container port (default: 8080)"),
      namespace: z.string().optional().describe("Kubernetes namespace (default: default)"),
      resources: z.object({
        cpuRequest: z.string().optional(),
        cpuLimit: z.string().optional(),
        memoryRequest: z.string().optional(),
        memoryLimit: z.string().optional(),
      }).optional().describe("Resource requests and limits"),
      envVars: z.record(z.string()).optional().describe("Environment variables"),
    }),
    execute: async (params) => {
      return infraStubs.generateK8sManifest(params);
    },
  },

  {
    name: "infra_helm_chart",
    description: "Generate a Helm chart scaffold with Chart.yaml, values.yaml, and template helpers.",
    category: "infrastructure",
    schema: z.object({
      name: z.string().describe("Chart name"),
      version: z.string().optional().describe("Chart version (default: 0.1.0)"),
      appVersion: z.string().optional().describe("Application version (default: 1.0.0)"),
      description: z.string().optional().describe("Chart description"),
    }),
    execute: async (params) => {
      return infraStubs.generateHelmChart(params);
    },
  },

  {
    name: "infra_k8s_ingress",
    description: "Generate a Kubernetes Ingress manifest with optional TLS, custom annotations, and ingress class configuration.",
    category: "infrastructure",
    schema: z.object({
      name: z.string().describe("Application name"),
      host: z.string().describe("Hostname for the ingress rule (e.g. api.example.com)"),
      serviceName: z.string().describe("Backend service name"),
      servicePort: z.number().int().optional().describe("Backend service port (default: 80)"),
      tlsEnabled: z.boolean().optional().describe("Enable TLS with cert-manager (default: false)"),
      ingressClass: z.string().optional().describe("Ingress class (default: nginx)"),
      annotations: z.record(z.string()).optional().describe("Additional annotations"),
    }),
    execute: async (params) => {
      return infraStubs.generateK8sIngress(params);
    },
  },

  {
    name: "infra_terraform_main",
    description: "Generate a Terraform main.tf configuration file with provider setup and resource definitions for AWS, GCP, or Azure.",
    category: "infrastructure",
    schema: z.object({
      provider: z.enum(["aws", "gcp", "azure"]).describe("Cloud provider"),
      region: z.string().optional().describe("Cloud region (default: us-east-1)"),
      resources: z.array(z.object({
        type: z.string().describe("Terraform resource type (e.g. aws_instance, google_compute_instance)"),
        name: z.string().describe("Resource name"),
        properties: z.record(z.any()).optional().describe("Resource properties"),
      })).min(1).describe("Resources to define"),
    }),
    execute: async (params) => {
      return infraStubs.generateTerraformMain(params);
    },
  },

  {
    name: "infra_nginx_config",
    description: "Generate an Nginx server configuration with reverse proxy, SSL, gzip, security headers, and static asset caching.",
    category: "infrastructure",
    schema: z.object({
      serverName: z.string().describe("Server name / domain"),
      upstream: z.string().optional().describe("Upstream backend address (e.g. localhost:3000)"),
      port: z.number().int().optional().describe("Listen port (default: 80)"),
      sslEnabled: z.boolean().optional().describe("Enable SSL configuration (default: false)"),
      locations: z.array(z.object({
        path: z.string(),
        proxy: z.string().optional(),
        root: z.string().optional(),
        tryFiles: z.string().optional(),
      })).optional().describe("Custom location blocks"),
    }),
    execute: async (params) => {
      return infraStubs.generateNginxConfig(params);
    },
  },

  {
    name: "infra_network_architecture",
    description: "Describe a network architecture from components and connections. Generates a structured Markdown overview with subnet layout.",
    category: "infrastructure",
    schema: z.object({
      components: z.array(z.object({
        name: z.string(),
        type: z.string().describe("Component type (e.g. web-server, database, cache, load-balancer)"),
        subnet: z.string().optional().describe("Subnet or network zone"),
      })).min(1).describe("Network components"),
      connections: z.array(z.object({
        from: z.string(),
        to: z.string(),
        protocol: z.string().optional().describe("Protocol (default: TCP)"),
        port: z.number().int().optional().describe("Port number"),
      })).describe("Connections between components"),
    }),
    execute: async (params) => {
      return infraStubs.describeNetworkArchitecture(params);
    },
  },

  {
    name: "infra_cost_estimate",
    description: "Estimate monthly cloud infrastructure costs based on resource types and providers. Returns itemized and total estimates in USD.",
    category: "infrastructure",
    schema: z.object({
      resources: z.array(z.object({
        type: z.enum(["compute", "database", "storage", "loadbalancer", "cdn", "cache"]).describe("Resource type"),
        provider: z.enum(["aws", "gcp", "azure"]).describe("Cloud provider"),
        tier: z.enum(["small", "medium", "large", "standard"]).optional().describe("Resource tier (default: small)"),
        hours: z.number().optional().describe("Monthly hours (default: 730 = 24/7)"),
      })).min(1).describe("Resources to estimate"),
    }),
    execute: async (params) => {
      return infraStubs.estimateCosts(params.resources);
    },
  },

  // =========================================================================
  // SECURITY / COMPLIANCE TOOLS (12)
  // =========================================================================

  {
    name: "security_create_role",
    description: "Create a new RBAC role with a set of permissions. Role names must be unique.",
    category: "security",
    schema: z.object({
      name: z.string().describe("Unique role name"),
      permissions: z.array(z.string()).min(1).describe("Permissions to assign (e.g. 'documents.read', 'users.*')"),
      description: z.string().optional().describe("Human-readable role description"),
    }),
    execute: async (params) => {
      try {
        const role = createRole(params.name, params.permissions, params.description);
        return { success: true, role };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  },

  {
    name: "security_check_permission",
    description: "Check whether a role has a specific permission. Supports wildcard permissions (e.g. 'documents.*' matches 'documents.read').",
    category: "security",
    schema: z.object({
      roleName: z.string().describe("Name of the role to check"),
      permission: z.string().describe("Permission to check (e.g. 'documents.read')"),
    }),
    execute: async (params) => {
      const hasPermission = checkPermission(params.roleName, params.permission);
      return { roleName: params.roleName, permission: params.permission, allowed: hasPermission };
    },
  },

  {
    name: "security_evaluate_access",
    description: "Evaluate ABAC (Attribute-Based Access Control) policies for a subject/resource/action combination. Deny policies take precedence.",
    category: "security",
    schema: z.object({
      subject: z.string().describe("The subject requesting access (user or role identifier)"),
      resource: z.string().describe("The resource being accessed"),
      action: z.string().describe("The action being performed (e.g. read, write, delete)"),
      context: z.record(z.any()).optional().describe("Additional context for condition evaluation"),
    }),
    execute: async (params) => {
      return evaluateAccess(params.subject, params.resource, params.action, params.context);
    },
  },

  {
    name: "security_store_secret",
    description: "Store a secret value encrypted with AES-256-GCM. Optionally set a rotation period.",
    category: "security",
    schema: z.object({
      key: z.string().describe("Secret key/name"),
      value: z.string().describe("Secret value to encrypt and store"),
      rotateAfterDays: z.number().int().positive().optional().describe("Days after which the secret should be rotated (default: 90)"),
    }),
    execute: async (params) => {
      const rotateMs = params.rotateAfterDays
        ? params.rotateAfterDays * 24 * 60 * 60 * 1000
        : undefined;
      return storeSecret(params.key, params.value, rotateMs);
    },
  },

  {
    name: "security_list_secrets",
    description: "List all stored secret keys with their creation dates and rotation status. Does not expose secret values.",
    category: "security",
    schema: z.object({}),
    execute: async () => {
      const keys = listSecretKeys();
      return { count: keys.length, secrets: keys };
    },
  },

  {
    name: "security_scan_vulnerabilities",
    description: "Scan source code for common security vulnerabilities: SQL injection, XSS, command injection, path traversal, hardcoded secrets, and more.",
    category: "security",
    schema: z.object({
      code: z.string().describe("Source code to scan"),
      language: z.string().optional().describe("Programming language for targeted pattern matching"),
    }),
    execute: async (params) => {
      return scanForVulnerabilities(params.code, params.language);
    },
  },

  {
    name: "security_detect_pii",
    description: "Detect personally identifiable information (PII) in text: emails, phone numbers, SSNs, credit cards, IP addresses, dates of birth, and passport numbers.",
    category: "security",
    schema: z.object({
      text: z.string().describe("Text to scan for PII"),
    }),
    execute: async (params) => {
      return detectPII(params.text);
    },
  },

  {
    name: "security_mask_data",
    description: "Mask detected PII in text, replacing sensitive values with redacted versions. Optionally filter by PII type.",
    category: "security",
    schema: z.object({
      text: z.string().describe("Text containing PII to mask"),
      types: z.array(z.string()).optional().describe("PII types to mask (e.g. ['EMAIL', 'SSN']). Default: all types"),
    }),
    execute: async (params) => {
      const masked = maskData(params.text, params.types);
      return { original: params.text, masked };
    },
  },

  {
    name: "security_check_headers",
    description: "Evaluate HTTP response headers against security best practices (HSTS, CSP, X-Frame-Options, etc.) and return a score with recommendations.",
    category: "security",
    schema: z.object({
      headers: z.record(z.string()).describe("HTTP response headers as key-value pairs"),
    }),
    execute: async (params) => {
      return checkSecurityHeaders(params.headers);
    },
  },

  {
    name: "security_compliance_report",
    description: "Generate a structured compliance report for a regulatory framework: SOC2, GDPR, HIPAA, PCI_DSS, or ISO27001.",
    category: "security",
    schema: z.object({
      framework: z.enum(["SOC2", "GDPR", "HIPAA", "PCI_DSS", "ISO27001"]).describe("Compliance framework"),
    }),
    execute: async (params) => {
      return generateComplianceReport(params.framework as any);
    },
  },

  {
    name: "security_password_check",
    description: "Evaluate a password against a configurable security policy: length, complexity, common passwords, sequential characters, and entropy.",
    category: "security",
    schema: z.object({
      password: z.string().describe("Password to evaluate"),
      minLength: z.number().int().min(6).max(128).optional().describe("Minimum length (default: 12)"),
      requireUppercase: z.boolean().optional().describe("Require uppercase letters (default: true)"),
      requireLowercase: z.boolean().optional().describe("Require lowercase letters (default: true)"),
      requireNumbers: z.boolean().optional().describe("Require numeric digits (default: true)"),
      requireSpecial: z.boolean().optional().describe("Require special characters (default: true)"),
      maxRepeating: z.number().int().optional().describe("Max consecutive repeating characters (default: 3)"),
    }),
    execute: async (params) => {
      return checkPasswordPolicy(params.password, {
        minLength: params.minLength,
        requireUppercase: params.requireUppercase,
        requireLowercase: params.requireLowercase,
        requireNumbers: params.requireNumbers,
        requireSpecial: params.requireSpecial,
        maxRepeating: params.maxRepeating,
      });
    },
  },

  {
    name: "security_audit_log",
    description: "Write an entry to the security audit log and optionally retrieve filtered audit log entries.",
    category: "security",
    schema: z.object({
      mode: z.enum(["write", "read"]).describe("'write' to append a log entry, 'read' to query the log"),
      action: z.string().optional().describe("Action performed (required for write)"),
      actor: z.string().optional().describe("Actor performing the action (required for write)"),
      resource: z.string().optional().describe("Resource affected (required for write)"),
      details: z.record(z.any()).optional().describe("Additional details (for write mode)"),
      filterActor: z.string().optional().describe("Filter by actor (for read mode)"),
      filterAction: z.string().optional().describe("Filter by action type (for read mode)"),
      sinceHours: z.number().optional().describe("Only return entries from the last N hours (for read mode)"),
      limit: z.number().int().positive().optional().describe("Maximum entries to return (for read mode)"),
    }),
    execute: async (params) => {
      if (params.mode === "write") {
        if (!params.action || !params.actor || !params.resource) {
          return { success: false, error: "action, actor, and resource are required for write mode" };
        }
        await auditLog(params.action, params.actor, params.resource, params.details);
        return { success: true, logged: { action: params.action, actor: params.actor, resource: params.resource } };
      }

      // Read mode
      const since = params.sinceHours
        ? new Date(Date.now() - params.sinceHours * 3600000)
        : undefined;
      const entries = await getAuditLogs({
        actor: params.filterActor,
        action: params.filterAction,
        since,
        limit: params.limit,
      });
      return { count: entries.length, entries };
    },
  },
];
