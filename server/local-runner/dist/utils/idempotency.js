"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRunDir = getRunDir;
exports.getResultsPath = getResultsPath;
exports.ensureRunDir = ensureRunDir;
exports.acquireRunLock = acquireRunLock;
exports.releaseRunLock = releaseRunLock;
exports.loadRunResults = loadRunResults;
exports.persistStepResult = persistStepResult;
const fs_extra_1 = __importDefault(require("fs-extra"));
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
function getRunDir(workspace, runId) {
    return path_1.default.join(workspace, ".iliagpt", "runs", runId);
}
function getResultsPath(workspace, runId) {
    return path_1.default.join(getRunDir(workspace, runId), "results.json");
}
async function ensureRunDir(workspace, runId) {
    const runDir = getRunDir(workspace, runId);
    await fs_extra_1.default.ensureDir(runDir);
    return runDir;
}
async function acquireRunLock(workspace, runId) {
    const runDir = await ensureRunDir(workspace, runId);
    const lockPath = path_1.default.join(runDir, "lock");
    try {
        const handle = await fs_1.promises.open(lockPath, "wx");
        await handle.writeFile(JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString(),
        }, null, 2), "utf-8");
        await handle.close();
        return { path: lockPath };
    }
    catch (error) {
        const err = error;
        if (err.code === "EEXIST") {
            throw new Error(`runId '${runId}' is currently locked by another process`);
        }
        throw error;
    }
}
async function releaseRunLock(lock) {
    if (!lock?.path) {
        return;
    }
    await fs_extra_1.default.remove(lock.path);
}
async function loadRunResults(workspace, runId) {
    const file = getResultsPath(workspace, runId);
    if (!(await fs_extra_1.default.pathExists(file))) {
        return { steps: {} };
    }
    return (await fs_extra_1.default.readJson(file));
}
async function persistStepResult(workspace, runId, stepId, result) {
    const file = getResultsPath(workspace, runId);
    await fs_extra_1.default.ensureDir(path_1.default.dirname(file));
    const existing = await loadRunResults(workspace, runId);
    existing.steps[stepId] = {
        result,
        updatedAt: new Date().toISOString(),
    };
    await fs_extra_1.default.writeJson(file, existing, { spaces: 2 });
}
