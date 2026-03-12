export interface PriorToolStepResult {
  stepIndex: number;
  toolName: string;
  success: boolean;
  output: unknown;
  error?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function enrichToolExecutionInput(
  toolName: string,
  input: unknown,
  stepResults: PriorToolStepResult[],
): Record<string, unknown> {
  const safeInput =
    input && typeof input === "object" && !Array.isArray(input)
      ? { ...(input as Record<string, unknown>) }
      : {};

  if (String(toolName || "").trim() !== "fetch_url") {
    return safeInput;
  }

  if (isNonEmptyString(safeInput.url)) {
    return safeInput;
  }

  if (safeInput._dependencyResults || safeInput._completedResults || safeInput.previousResults) {
    return safeInput;
  }

  const successfulSteps = (stepResults || []).filter(
    (stepResult) => stepResult && stepResult.success,
  );

  if (successfulSteps.length === 0) {
    return safeInput;
  }

  const dependencyResults = Object.fromEntries(
    successfulSteps.map((stepResult) => [
      `step_${stepResult.stepIndex + 1}`,
      {
        stepIndex: stepResult.stepIndex,
        toolName: stepResult.toolName,
        success: stepResult.success,
        output: stepResult.output,
        error: stepResult.error ?? null,
      },
    ]),
  );

  return {
    ...safeInput,
    _dependencyResults: dependencyResults,
    _completedResults: dependencyResults,
    previousResults: successfulSteps.map((stepResult) => ({
      stepIndex: stepResult.stepIndex,
      toolName: stepResult.toolName,
      success: stepResult.success,
      output: stepResult.output,
      error: stepResult.error ?? null,
    })),
  };
}
