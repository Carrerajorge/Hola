"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPlan = loadPlan;
const fs_extra_1 = __importDefault(require("fs-extra"));
async function loadPlan(filePath) {
    const raw = await fs_extra_1.default.readFile(filePath, "utf-8");
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error(`Invalid JSON in plan file: ${filePath}`);
    }
    return validatePlan(parsed);
}
function validatePlan(input) {
    if (!input || typeof input !== "object") {
        throw new Error("Plan must be an object");
    }
    const candidate = input;
    if (!candidate.runId || typeof candidate.runId !== "string") {
        throw new Error("Plan.runId is required and must be a string");
    }
    if (!Array.isArray(candidate.steps) || candidate.steps.length === 0) {
        throw new Error("Plan.steps must be a non-empty array");
    }
    const steps = candidate.steps.map(validateStep);
    const plan = {
        runId: candidate.runId,
        steps,
    };
    if (candidate.workspace && typeof candidate.workspace === "string") {
        plan.workspace = candidate.workspace;
    }
    if (candidate.user && typeof candidate.user === "string") {
        plan.user = candidate.user;
    }
    if (candidate.metadata && typeof candidate.metadata === "object") {
        plan.metadata = candidate.metadata;
    }
    return plan;
}
function validateStep(step) {
    if (!step || typeof step !== "object") {
        throw new Error("Each step must be an object");
    }
    const candidate = step;
    if (!candidate.id || typeof candidate.id !== "string") {
        throw new Error("Step.id is required and must be a string");
    }
    if (!candidate.type || typeof candidate.type !== "string") {
        throw new Error(`Step.type is required for step '${candidate.id}'`);
    }
    if (!candidate.args || typeof candidate.args !== "object") {
        throw new Error(`Step.args must be an object for step '${candidate.id}'`);
    }
    const result = {
        id: candidate.id,
        type: candidate.type,
        args: candidate.args,
    };
    if (typeof candidate.retries === "number") {
        result.retries = candidate.retries;
    }
    if (typeof candidate.confirm === "boolean") {
        result.confirm = candidate.confirm;
    }
    if (typeof candidate.name === "string") {
        result.name = candidate.name;
    }
    return result;
}
