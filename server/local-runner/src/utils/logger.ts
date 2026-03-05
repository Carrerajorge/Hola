import fs from "fs-extra";
import path from "path";
import { AuditLogger } from "../types";

export function createLogger(logFilePath: string): AuditLogger {
  const resolved = path.resolve(logFilePath);
  fs.ensureDirSync(path.dirname(resolved));

  return {
    info(payload: Record<string, unknown>) {
      writeLine(resolved, "info", payload);
    },
    error(payload: Record<string, unknown>) {
      writeLine(resolved, "error", payload);
    },
  };
}

function writeLine(filePath: string, level: "info" | "error", payload: Record<string, unknown>): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    ...payload,
  };
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf-8");
}
