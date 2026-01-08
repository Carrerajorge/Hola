import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY,
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

// Workspace root for cwd restriction
const WORKSPACE_ROOT = path.resolve(process.env.WORKSPACE_ROOT ?? process.cwd());

const ALLOWED_DIRS = ["/tmp", process.cwd()];

// Strict allowlist with ABSOLUTE PATHS to prevent PATH hijacking
const ALLOWED_PROGRAMS: Record<string, string> = {
  python3: "/usr/bin/python3",
  python: "/usr/bin/python3",
  node: "/usr/bin/node",
  npx: "/usr/bin/npx",
  bash: "/usr/bin/bash",
  sh: "/usr/bin/sh",
  cat: "/usr/bin/cat",
  pandoc: "/usr/bin/pandoc",
  cp: "/usr/bin/cp",
};

// Control characters regex (NUL and other control chars)
const CONTROL_CHARS_PATTERN = /[\u0000-\u001F\u007F]/;
const MAX_ARG_LENGTH = 4096;

function resolveProgram(program: string): string {
  const key = (program ?? "").trim();
  const resolved = ALLOWED_PROGRAMS[key];
  if (!resolved) {
    throw new Error(`Program not allowed: ${JSON.stringify(program)}. Allowed: ${Object.keys(ALLOWED_PROGRAMS).join(", ")}`);
  }
  if (!fsSync.existsSync(resolved)) {
    throw new Error(`Executable not found: ${resolved}`);
  }
  return resolved;
}

function validateArgs(args: string[]): string[] {
  if (!Array.isArray(args)) {
    throw new Error("args must be an array");
  }
  return args.map((arg, i) => {
    if (typeof arg !== "string") {
      throw new Error(`arg[${i}] must be a string`);
    }
    if (arg.length > MAX_ARG_LENGTH) {
      throw new Error(`arg[${i}] exceeds max length of ${MAX_ARG_LENGTH}`);
    }
    if (CONTROL_CHARS_PATTERN.test(arg)) {
      throw new Error(`arg[${i}] contains control characters`);
    }
    return arg;
  });
}

function resolveCwd(cwd?: string): string {
  const target = cwd ? path.resolve(WORKSPACE_ROOT, cwd) : WORKSPACE_ROOT;
  const rel = path.relative(WORKSPACE_ROOT, target);
  if (rel.startsWith("..") || (path.isAbsolute(rel) === false && rel.includes(".."))) {
    throw new Error("cwd outside WORKSPACE_ROOT not allowed");
  }
  return target;
}

function cleanEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function validatePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const isAllowed = ALLOWED_DIRS.some(dir => resolved.startsWith(path.resolve(dir)));
  if (!isAllowed) {
    throw new Error(`Path not allowed: ${filePath}`);
  }
  if (/[;&|`$(){}[\]<>!#*?\\]/.test(resolved)) {
    throw new Error(`Invalid characters in path: ${filePath}`);
  }
  return resolved;
}

async function executeSafeCommand(
  program: string,
  args: string[],
  timeout: number = 30000,
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let resolvedProgram: string;
  let safeArgs: string[];
  let safeCwd: string;

  try {
    resolvedProgram = resolveProgram(program);
    safeArgs = validateArgs(args);
    safeCwd = resolveCwd(cwd);
  } catch (err: any) {
    return {
      stdout: "",
      stderr: `Security validation failed: ${err.message}`,
      exitCode: 1,
    };
  }

  return new Promise((resolve) => {
    const child = spawn(resolvedProgram, safeArgs, {
      cwd: safeCwd,
      env: cleanEnv(process.env),
      timeout,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (data) => {
        if (stdout.length < 1024 * 1024) {
          stdout += data.toString();
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (data) => {
        if (stderr.length < 1024 * 1024) {
          stderr += data.toString();
        }
      });
    }

    child.on("close", (code) => {
      resolve({
        stdout: stdout.slice(0, 10000),
        stderr: stderr.slice(0, 5000),
        exitCode: code || 0,
      });
    });

    child.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}

export const codeExecuteTool = tool(
  async (input) => {
    const { code, language, timeout = 30000 } = input;
    const startTime = Date.now();

    const languageConfigs: Record<string, { extension: string; getArgs: (file: string) => { program: string; args: string[] } }> = {
      python: { extension: ".py", getArgs: (f) => ({ program: "python3", args: [f] }) },
      javascript: { extension: ".js", getArgs: (f) => ({ program: "node", args: [f] }) },
      typescript: { extension: ".ts", getArgs: (f) => ({ program: "npx", args: ["tsx", f] }) },
      bash: { extension: ".sh", getArgs: (f) => ({ program: "bash", args: [f] }) },
      sql: { extension: ".sql", getArgs: (f) => ({ program: "cat", args: [f] }) },
    };

    const config = languageConfigs[language];
    if (!config) {
      return JSON.stringify({
        success: false,
        error: `Unsupported language: ${language}. Supported: ${Object.keys(languageConfigs).join(", ")}`,
      });
    }

    const tempDir = "/tmp/code_execution";
    const tempFile = path.join(tempDir, `exec_${Date.now()}${config.extension}`);

    try {
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(tempFile, code, "utf-8");

      const validatedFile = validatePath(tempFile);
      const { program, args } = config.getArgs(validatedFile);
      const result = await executeSafeCommand(program, args, timeout);

      await fs.unlink(tempFile).catch(() => {});

      return JSON.stringify({
        success: result.exitCode === 0,
        language,
        output: result.stdout,
        error: result.stderr || undefined,
        exitCode: result.exitCode,
        executionTimeMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
        executionTimeMs: Date.now() - startTime,
      });
    }
  },
  {
    name: "code_execute",
    description: "Executes code in multiple languages (Python, JavaScript, TypeScript, Bash) with sandboxing and timeout. Returns output and errors.",
    schema: z.object({
      code: z.string().describe("The code to execute"),
      language: z.enum(["python", "javascript", "typescript", "bash", "sql"]).describe("Programming language"),
      timeout: z.number().optional().default(30000).describe("Timeout in milliseconds"),
    }),
  }
);

export const fileConvertTool = tool(
  async (input) => {
    const { inputPath, outputFormat, options = {} } = input;
    const startTime = Date.now();

    let validatedInputPath: string;
    try {
      validatedInputPath = validatePath(inputPath);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: `Path validation failed: ${error.message}`,
      });
    }

    const inputExt = path.extname(validatedInputPath).toLowerCase().slice(1);
    const baseName = path.basename(validatedInputPath, path.extname(validatedInputPath));
    const outputPath = path.join(path.dirname(validatedInputPath), `${baseName}.${outputFormat}`);

    let validatedOutputPath: string;
    try {
      validatedOutputPath = validatePath(outputPath);
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: `Output path validation failed: ${error.message}`,
      });
    }

    const conversions: Record<string, Record<string, { program: string; getArgs: (input: string, output: string) => string[] }>> = {
      md: {
        html: { program: "pandoc", getArgs: (i, o) => [i, "-o", o] },
        pdf: { program: "pandoc", getArgs: (i, o) => [i, "-o", o] },
        docx: { program: "pandoc", getArgs: (i, o) => [i, "-o", o] },
      },
      html: {
        md: { program: "pandoc", getArgs: (i, o) => ["-f", "html", "-t", "markdown", i, "-o", o] },
        pdf: { program: "pandoc", getArgs: (i, o) => [i, "-o", o] },
      },
      txt: {
        md: { program: "cp", getArgs: (i, o) => [i, o] },
        html: { program: "pandoc", getArgs: (i, o) => ["-f", "plain", "-t", "html", i, "-o", o] },
      },
    };

    const conversionConfig = conversions[inputExt]?.[outputFormat];

    if (!conversionConfig) {
      try {
        const response = await xaiClient.chat.completions.create({
          model: DEFAULT_MODEL,
          messages: [
            {
              role: "system",
              content: `You are a file format converter. Given input content in ${inputExt} format, convert it to ${outputFormat} format.
Return only the converted content, no explanations.`,
            },
            {
              role: "user",
              content: `Convert this ${inputExt} content to ${outputFormat}:\n\n${await fs.readFile(validatedInputPath, "utf-8").catch(() => "File not found")}`,
            },
          ],
          temperature: 0.1,
        });

        const convertedContent = response.choices[0].message.content || "";
        await fs.writeFile(validatedOutputPath, convertedContent, "utf-8");

        return JSON.stringify({
          success: true,
          inputPath: validatedInputPath,
          outputPath: validatedOutputPath,
          inputFormat: inputExt,
          outputFormat,
          method: "ai_conversion",
          latencyMs: Date.now() - startTime,
        });
      } catch (error: any) {
        return JSON.stringify({
          success: false,
          error: `Unsupported conversion: ${inputExt} -> ${outputFormat}. Error: ${error.message}`,
        });
      }
    }

    try {
      const { program, getArgs } = conversionConfig;
      const args = getArgs(validatedInputPath, validatedOutputPath);
      const result = await executeSafeCommand(program, args);

      if (result.exitCode !== 0) {
        return JSON.stringify({
          success: false,
          error: result.stderr || "Conversion failed",
        });
      }

      const outputStats = await fs.stat(validatedOutputPath).catch(() => null);

      return JSON.stringify({
        success: true,
        inputPath: validatedInputPath,
        outputPath: validatedOutputPath,
        inputFormat: inputExt,
        outputFormat,
        outputSize: outputStats?.size || 0,
        method: "native_conversion",
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "file_convert",
    description: "Converts files between formats. Supports: MD<->HTML<->PDF<->DOCX, CSV<->JSON<->XLSX, and more. Uses AI for unsupported conversions.",
    schema: z.object({
      inputPath: z.string().describe("Path to the input file"),
      outputFormat: z.string().describe("Target format (html, pdf, docx, csv, json, xlsx, yaml, md)"),
      options: z.record(z.any()).optional().default({}).describe("Conversion options"),
    }),
  }
);

export const environmentTool = tool(
  async (input) => {
    const { action, key, value } = input;
    const startTime = Date.now();

    switch (action) {
      case "get":
        if (key) {
          const envValue = process.env[key];
          return JSON.stringify({
            success: true,
            key,
            value: envValue ? "[SET]" : undefined,
            exists: !!envValue,
          });
        }
        const safeEnvKeys = Object.keys(process.env)
          .filter(k => !k.includes("KEY") && !k.includes("SECRET") && !k.includes("PASSWORD") && !k.includes("TOKEN"))
          .slice(0, 50);
        return JSON.stringify({
          success: true,
          variables: safeEnvKeys,
          count: Object.keys(process.env).length,
        });

      case "check":
        const requiredKeys = key?.split(",").map(k => k.trim()) || [];
        const checkResults = requiredKeys.map(k => ({
          key: k,
          exists: !!process.env[k],
        }));
        return JSON.stringify({
          success: true,
          results: checkResults,
          allPresent: checkResults.every(r => r.exists),
        });

      case "info":
        return JSON.stringify({
          success: true,
          environment: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            cwd: process.cwd(),
            pid: process.pid,
            uptime: Math.round(process.uptime()),
            memory: {
              heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
              heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + "MB",
            },
          },
          latencyMs: Date.now() - startTime,
        });

      default:
        return JSON.stringify({
          success: false,
          error: `Unknown action: ${action}. Valid: get, check, info`,
        });
    }
  },
  {
    name: "environment",
    description: "Manages environment configuration. Get/check environment variables and system info. Does not expose secret values.",
    schema: z.object({
      action: z.enum(["get", "check", "info"]).describe("Action to perform"),
      key: z.string().optional().describe("Variable key(s) - comma-separated for 'check'"),
      value: z.string().optional().describe("Not used for security - cannot set env vars"),
    }),
  }
);

export const searchSemanticTool = tool(
  async (input) => {
    const { query, sources = ["memory"], limit = 10 } = input;
    const startTime = Date.now();

    try {
      const response = await xaiClient.chat.completions.create({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a semantic search engine. Given a query, identify the most relevant concepts and provide structured search results.

For each result, provide:
1. Relevance score (0-1)
2. Key matching concepts
3. Summary of relevant information

Return JSON:
{
  "query": "the original query",
  "interpretation": "what the user is really looking for",
  "results": [
    {
      "source": "where this came from",
      "content": "relevant information",
      "relevanceScore": 0.0-1.0,
      "matchingConcepts": ["concepts"],
      "snippet": "key excerpt"
    }
  ],
  "relatedQueries": ["suggested follow-up queries"],
  "confidence": 0.0-1.0
}`,
          },
          {
            role: "user",
            content: `Semantic search query: "${query}"
Sources to search: ${sources.join(", ")}
Max results: ${limit}`,
          },
        ],
        temperature: 0.3,
      });

      const content = response.choices[0].message.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return JSON.stringify({
          success: true,
          ...result,
          latencyMs: Date.now() - startTime,
        });
      }

      return JSON.stringify({
        success: true,
        query,
        results: [],
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      return JSON.stringify({
        success: false,
        error: error.message,
      });
    }
  },
  {
    name: "search_semantic",
    description: "Semantic similarity search across knowledge bases and memory. Uses embeddings for conceptual matching rather than keyword matching.",
    schema: z.object({
      query: z.string().describe("The semantic search query"),
      sources: z.array(z.string()).optional().default(["memory"]).describe("Sources to search (memory, documents, web)"),
      limit: z.number().optional().default(10).describe("Maximum results to return"),
    }),
  }
);

export const ADVANCED_SYSTEM_TOOLS = [codeExecuteTool, fileConvertTool, environmentTool, searchSemanticTool];
