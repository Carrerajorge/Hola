import fs from "fs-extra";
import { Plan, PlanStep } from "../types";

export async function loadPlan(filePath: string): Promise<Plan> {
  const raw = await fs.readFile(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in plan file: ${filePath}`);
  }
  return validatePlan(parsed);
}

function validatePlan(input: unknown): Plan {
  if (!input || typeof input !== "object") {
    throw new Error("Plan must be an object");
  }
  const candidate = input as Record<string, unknown>;
  if (!candidate.runId || typeof candidate.runId !== "string") {
    throw new Error("Plan.runId is required and must be a string");
  }
  if (!Array.isArray(candidate.steps) || candidate.steps.length === 0) {
    throw new Error("Plan.steps must be a non-empty array");
  }

  const steps = candidate.steps.map(validateStep);

  const plan: Plan = {
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
    plan.metadata = candidate.metadata as Record<string, unknown>;
  }

  return plan;
}

function validateStep(step: unknown): PlanStep {
  if (!step || typeof step !== "object") {
    throw new Error("Each step must be an object");
  }

  const candidate = step as Record<string, unknown>;
  if (!candidate.id || typeof candidate.id !== "string") {
    throw new Error("Step.id is required and must be a string");
  }
  if (!candidate.type || typeof candidate.type !== "string") {
    throw new Error(`Step.type is required for step '${candidate.id}'`);
  }
  if (!candidate.args || typeof candidate.args !== "object") {
    throw new Error(`Step.args must be an object for step '${candidate.id}'`);
  }

  const result: PlanStep = {
    id: candidate.id,
    type: candidate.type as PlanStep["type"],
    args: candidate.args as Record<string, unknown>,
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
