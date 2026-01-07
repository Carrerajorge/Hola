import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const SANDBOX_DIR = "/tmp/python_sandbox";
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_MEMORY_MB = 512;
const MAX_CPU_TIME_SECONDS = 60;

export interface ExecutePythonCodeParams {
  code: string;
  filePath: string;
  sheetName: string;
  timeoutMs?: number;
}

export interface ExecutePythonCodeResult {
  success: boolean;
  output?: any;
  error?: string;
  executionTimeMs: number;
}

export interface SandboxOutput {
  tables: Array<{ name: string; data: any[] }>;
  metrics: Record<string, any>;
  charts: any[];
  logs: string[];
  summary: string;
}

function ensureSandboxDirectory(): void {
  if (!fs.existsSync(SANDBOX_DIR)) {
    fs.mkdirSync(SANDBOX_DIR, { recursive: true, mode: 0o700 });
  }
}

function generateTempFilePath(extension: string = ".py"): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString("hex");
  return path.join(SANDBOX_DIR, `sandbox_${timestamp}_${random}${extension}`);
}

function buildWrapperCode(userCode: string, filePath: string, sheetName: string): string {
  const escapedFilePath = filePath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const escapedSheetName = sheetName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  
  return `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import sys
import resource
import signal

# Set resource limits for security
def set_resource_limits():
    # Limit CPU time to ${MAX_CPU_TIME_SECONDS} seconds
    resource.setrlimit(resource.RLIMIT_CPU, (${MAX_CPU_TIME_SECONDS}, ${MAX_CPU_TIME_SECONDS}))
    # Limit memory to ${MAX_MEMORY_MB}MB
    memory_bytes = ${MAX_MEMORY_MB} * 1024 * 1024
    try:
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
    except (ValueError, OSError):
        pass  # May not be available on all systems
    # Allow limited subprocesses for pandas internals (e.g., numexpr)
    resource.setrlimit(resource.RLIMIT_NPROC, (10, 10))
    # Limit file size creation to 10MB
    resource.setrlimit(resource.RLIMIT_FSIZE, (10 * 1024 * 1024, 10 * 1024 * 1024))

try:
    set_resource_limits()
except Exception as e:
    # Resource limits may not be available on all systems
    pass

# Handle timeout gracefully
def timeout_handler(signum, frame):
    raise TimeoutError("Execution time limit exceeded")

signal.signal(signal.SIGALRM, timeout_handler)
signal.alarm(${MAX_CPU_TIME_SECONDS})

try:
    import pandas as pd
    import numpy as np
    from datetime import datetime
    import math

    # Set pandas display options
    pd.set_option('display.max_columns', None)
    pd.set_option('display.max_rows', None)
    pd.set_option('display.width', None)

    # Structured output container
    _output = {"tables": [], "metrics": {}, "charts": [], "logs": [], "summary": ""}

    def register_table(name, df):
        """Register a DataFrame as a named table in the output."""
        if isinstance(df, pd.DataFrame):
            _output["tables"].append({
                "name": str(name),
                "data": df.to_dict(orient='records')
            })
        elif isinstance(df, pd.Series):
            _output["tables"].append({
                "name": str(name),
                "data": df.to_frame().to_dict(orient='records')
            })
        else:
            _output["tables"].append({
                "name": str(name),
                "data": [{"value": df}]
            })

    def register_metric(name, value):
        """Register a named metric in the output."""
        if isinstance(value, (np.integer, np.floating)):
            value = value.item()
        elif isinstance(value, np.ndarray):
            value = value.tolist()
        elif pd.isna(value):
            value = None
        _output["metrics"][str(name)] = value

    def register_chart(chart_config):
        """Register a chart configuration in the output."""
        _output["charts"].append(chart_config)

    def log(message):
        """Add a log message to the output."""
        _output["logs"].append(str(message))

    def set_summary(text):
        """Set the summary text for the analysis."""
        _output["summary"] = str(text)

    # File and sheet configuration
    file_path = '${escapedFilePath}'
    sheet_name = '${escapedSheetName}'

    # USER CODE STARTS HERE
${userCode}
    # USER CODE ENDS HERE

    # Output results as JSON
    def serialize_output(obj):
        """Custom JSON serializer for numpy and pandas types."""
        if isinstance(obj, (np.integer,)):
            return int(obj)
        elif isinstance(obj, (np.floating,)):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, pd.Timestamp):
            return obj.isoformat()
        elif isinstance(obj, datetime):
            return obj.isoformat()
        elif pd.isna(obj):
            return None
        return str(obj)

    print(json.dumps(_output, default=serialize_output, ensure_ascii=False))

except Exception as e:
    import traceback
    error_output = {
        "tables": [],
        "metrics": {},
        "charts": [],
        "logs": [f"Error: {str(e)}"],
        "summary": f"Execution failed: {str(e)}",
        "_error": True,
        "_error_message": str(e),
        "_traceback": traceback.format_exc()
    }
    print(json.dumps(error_output, ensure_ascii=False))
    sys.exit(1)
finally:
    signal.alarm(0)  # Cancel the alarm
`;
}

function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`[PythonSandbox] Failed to cleanup temp file ${filePath}:`, error);
  }
}

async function executePythonProcess(
  scriptPath: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let killed = false;
    let resolved = false;

    const pythonProcess: ChildProcess = spawn("python3", [scriptPath], {
      cwd: SANDBOX_DIR,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONHASHSEED: "0",
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false, // Explicit: prevent command injection
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        killed = true;
        pythonProcess.kill("SIGKILL");
      }
    }, timeoutMs);

    pythonProcess.stdout?.on("data", (data: Buffer) => {
      stdout.push(data.toString());
    });

    pythonProcess.stderr?.on("data", (data: Buffer) => {
      stderr.push(data.toString());
    });

    pythonProcess.on("close", (exitCode: number | null) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        resolve({
          stdout: stdout.join(""),
          stderr: stderr.join(""),
          exitCode: killed ? -1 : exitCode,
        });
      }
    });

    pythonProcess.on("error", (error: Error) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        resolve({
          stdout: stdout.join(""),
          stderr: `Process error: ${error.message}`,
          exitCode: -1,
        });
      }
    });
  });
}

function parseJsonOutput(stdout: string): { parsed: any; error?: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { parsed: null, error: "No output from Python script" };
  }

  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1];

  try {
    const parsed = JSON.parse(lastLine);
    return { parsed };
  } catch (e) {
    try {
      const parsed = JSON.parse(trimmed);
      return { parsed };
    } catch (e2) {
      return {
        parsed: null,
        error: `Failed to parse JSON output: ${(e2 as Error).message}. Output: ${trimmed.slice(0, 500)}`,
      };
    }
  }
}

export async function executePythonCode(
  params: ExecutePythonCodeParams
): Promise<ExecutePythonCodeResult> {
  const { code, filePath, sheetName, timeoutMs = DEFAULT_TIMEOUT_MS } = params;
  const startTime = Date.now();

  ensureSandboxDirectory();

  const scriptPath = generateTempFilePath(".py");
  const wrappedCode = buildWrapperCode(code, filePath, sheetName);

  try {
    fs.writeFileSync(scriptPath, wrappedCode, { encoding: "utf-8", mode: 0o600 });

    const { stdout, stderr, exitCode } = await executePythonProcess(scriptPath, timeoutMs);
    const executionTimeMs = Date.now() - startTime;

    if (exitCode === -1) {
      return {
        success: false,
        error: "Execution timed out or was terminated",
        executionTimeMs,
      };
    }

    const { parsed, error: parseError } = parseJsonOutput(stdout);

    if (parseError) {
      return {
        success: false,
        error: parseError + (stderr ? `\nStderr: ${stderr}` : ""),
        executionTimeMs,
      };
    }

    if (parsed && parsed._error) {
      return {
        success: false,
        error: parsed._error_message || "Unknown execution error",
        output: {
          logs: parsed.logs || [],
          traceback: parsed._traceback,
        },
        executionTimeMs,
      };
    }

    return {
      success: true,
      output: parsed,
      executionTimeMs,
    };
  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    return {
      success: false,
      error: `Sandbox execution error: ${(error as Error).message}`,
      executionTimeMs,
    };
  } finally {
    cleanupTempFile(scriptPath);
  }
}

export async function initializeSandbox(): Promise<void> {
  ensureSandboxDirectory();
  console.log(`[PythonSandbox] Sandbox directory initialized at ${SANDBOX_DIR}`);
}

export function validateCodeBeforeExecution(code: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const dangerousPatterns = [
    { pattern: /import\s+os\b/, message: "Import of 'os' module is not allowed" },
    { pattern: /from\s+os\s+import/, message: "Import from 'os' module is not allowed" },
    { pattern: /import\s+subprocess\b/, message: "Import of 'subprocess' module is not allowed" },
    { pattern: /from\s+subprocess\s+import/, message: "Import from 'subprocess' module is not allowed" },
    { pattern: /import\s+shutil\b/, message: "Import of 'shutil' module is not allowed" },
    { pattern: /from\s+shutil\s+import/, message: "Import from 'shutil' module is not allowed" },
    { pattern: /import\s+socket\b/, message: "Import of 'socket' module is not allowed" },
    { pattern: /from\s+socket\s+import/, message: "Import from 'socket' module is not allowed" },
    { pattern: /import\s+urllib\b/, message: "Import of 'urllib' module is not allowed" },
    { pattern: /from\s+urllib\s+import/, message: "Import from 'urllib' module is not allowed" },
    { pattern: /import\s+requests\b/, message: "Import of 'requests' module is not allowed" },
    { pattern: /from\s+requests\s+import/, message: "Import from 'requests' module is not allowed" },
    { pattern: /import\s+http\b/, message: "Import of 'http' module is not allowed" },
    { pattern: /from\s+http\s+import/, message: "Import from 'http' module is not allowed" },
    { pattern: /\beval\s*\(/, message: "Use of 'eval()' is not allowed" },
    { pattern: /\bexec\s*\(/, message: "Use of 'exec()' is not allowed" },
    { pattern: /\bcompile\s*\(/, message: "Use of 'compile()' is not allowed" },
    { pattern: /__import__\s*\(/, message: "Use of '__import__()' is not allowed" },
    { pattern: /open\s*\([^)]*['"][wa]\+?['"]/, message: "Opening files in write mode is not allowed" },
    { pattern: /\.\s*__class__/, message: "Access to '__class__' is not allowed" },
    { pattern: /\.\s*__bases__/, message: "Access to '__bases__' is not allowed" },
    { pattern: /\.\s*__subclasses__/, message: "Access to '__subclasses__' is not allowed" },
    { pattern: /\.\s*__globals__/, message: "Access to '__globals__' is not allowed" },
  ];

  for (const { pattern, message } of dangerousPatterns) {
    if (pattern.test(code)) {
      errors.push(message);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export const pythonSandbox = {
  executePythonCode,
  initializeSandbox,
  validateCodeBeforeExecution,
};

export default pythonSandbox;
