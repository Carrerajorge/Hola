import fs from "fs-extra";
import { promises as fsp } from "fs";
import path from "path";
import { RunResults, StepResult } from "../types";

export interface RunLock {
  path: string;
}

export function getRunDir(workspace: string, runId: string): string {
  return path.join(workspace, ".iliagpt", "runs", runId);
}

export function getResultsPath(workspace: string, runId: string): string {
  return path.join(getRunDir(workspace, runId), "results.json");
}

export async function ensureRunDir(workspace: string, runId: string): Promise<string> {
  const runDir = getRunDir(workspace, runId);
  await fs.ensureDir(runDir);
  return runDir;
}

export async function acquireRunLock(workspace: string, runId: string): Promise<RunLock> {
  const runDir = await ensureRunDir(workspace, runId);
  const lockPath = path.join(runDir, "lock");

  try {
    const handle = await fsp.open(lockPath, "wx");
    await handle.writeFile(
      JSON.stringify(
        {
          pid: process.pid,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
    await handle.close();
    return { path: lockPath };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") {
      throw new Error(`runId '${runId}' is currently locked by another process`);
    }
    throw error;
  }
}

export async function releaseRunLock(lock: RunLock): Promise<void> {
  if (!lock?.path) {
    return;
  }
  await fs.remove(lock.path);
}

export async function loadRunResults(workspace: string, runId: string): Promise<RunResults> {
  const file = getResultsPath(workspace, runId);
  if (!(await fs.pathExists(file))) {
    return { steps: {} };
  }
  return (await fs.readJson(file)) as RunResults;
}

export async function persistStepResult(
  workspace: string,
  runId: string,
  stepId: string,
  result: StepResult,
): Promise<void> {
  const file = getResultsPath(workspace, runId);
  await fs.ensureDir(path.dirname(file));
  const existing = await loadRunResults(workspace, runId);
  existing.steps[stepId] = {
    result,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeJson(file, existing, { spaces: 2 });
}
