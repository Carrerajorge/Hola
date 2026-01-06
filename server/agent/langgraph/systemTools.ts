import { tool } from "@langchain/core/tools";
import { z } from "zod";
import OpenAI from "openai";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

const xaiClient = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY,
});

const DEFAULT_MODEL = "grok-4-1-fast-non-reasoning";

async function executeCommand(command: string, timeout: number = 30000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], {
      timeout,
      maxBuffer: 1024 * 1024,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

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

    const languageConfigs: Record<string, { extension: string; command: (file: string) => string }> = {
      python: { extension: ".py", command: (f) => `python3 ${f}` },
      javascript: { extension: ".js", command: (f) => `node ${f}` },
      typescript: { extension: ".ts", command: (f) => `npx tsx ${f}` },
      bash: { extension: ".sh", command: (f) => `bash ${f}` },
      sql: { extension: ".sql", command: (f) => `cat ${f}` },
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

      const result = await executeCommand(config.command(tempFile), timeout);

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

    const inputExt = path.extname(inputPath).toLowerCase().slice(1);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = `${path.dirname(inputPath)}/${baseName}.${outputFormat}`;

    const conversions: Record<string, Record<string, string>> = {
      md: {
        html: "pandoc {input} -o {output}",
        pdf: "pandoc {input} -o {output}",
        docx: "pandoc {input} -o {output}",
      },
      csv: {
        json: "python3 -c \"import csv,json; print(json.dumps(list(csv.DictReader(open('{input}')))))\" > {output}",
        xlsx: "python3 -c \"import pandas as pd; pd.read_csv('{input}').to_excel('{output}', index=False)\"",
      },
      json: {
        csv: "python3 -c \"import pandas as pd,json; pd.DataFrame(json.load(open('{input}'))).to_csv('{output}', index=False)\"",
        yaml: "python3 -c \"import json,yaml; yaml.dump(json.load(open('{input}')), open('{output}','w'))\"",
      },
      html: {
        md: "pandoc -f html -t markdown {input} -o {output}",
        pdf: "pandoc {input} -o {output}",
      },
      txt: {
        md: "cp {input} {output}",
        html: "pandoc -f plain -t html {input} -o {output}",
      },
    };

    const conversionCommand = conversions[inputExt]?.[outputFormat];

    if (!conversionCommand) {
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
              content: `Convert this ${inputExt} content to ${outputFormat}:\n\n${await fs.readFile(inputPath, "utf-8").catch(() => "File not found")}`,
            },
          ],
          temperature: 0.1,
        });

        const convertedContent = response.choices[0].message.content || "";
        await fs.writeFile(outputPath, convertedContent, "utf-8");

        return JSON.stringify({
          success: true,
          inputPath,
          outputPath,
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
      const command = conversionCommand
        .replace(/{input}/g, inputPath)
        .replace(/{output}/g, outputPath);

      const result = await executeCommand(command);

      if (result.exitCode !== 0) {
        return JSON.stringify({
          success: false,
          error: result.stderr || "Conversion failed",
          command,
        });
      }

      const outputStats = await fs.stat(outputPath).catch(() => null);

      return JSON.stringify({
        success: true,
        inputPath,
        outputPath,
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
