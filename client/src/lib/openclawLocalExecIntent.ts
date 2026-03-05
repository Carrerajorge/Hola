const OPENCLAW_TOOL_RE = /\bopenclaw_[a-z0-9_]+\b/i;
const EXECUTION_VERB_RE = /\b(?:ejecuta|ejecutar|run|execute|usa|usar|invoca|invoke|prueba|test)\b/i;
const BARE_OPENCLAW_COMMAND_RE = /^openclaw_[a-z0-9_]+(?:\s+\{[\s\S]*\})?$/i;
const STRICT_AUDIT_HINT_RE = /\b(?:solo|only|exactamente|exactly|obligatoria|obligatorio|auditoria|auditor[ií]a|audit|tarea)\b/i;
const STEP_STYLE_RE = /(?:^|\s)(?:\d+\)|\d+\.)/;

export function isOpenClawLocalExecIntent(input: string): boolean {
  const text = String(input || "").trim();
  if (!text) return false;

  if (BARE_OPENCLAW_COMMAND_RE.test(text)) return true;

  const mentionsOpenClawTool = OPENCLAW_TOOL_RE.test(text);
  const hasExecutionVerb = EXECUTION_VERB_RE.test(text);
  if (!mentionsOpenClawTool) return false;

  if (hasExecutionVerb) return true;

  // Accept strict audit prompts that reference a concrete tool even without explicit run verb.
  if (STRICT_AUDIT_HINT_RE.test(text)) return true;

  // Accept step-by-step prompts that include an OpenClaw tool token.
  if (STEP_STYLE_RE.test(text)) return true;

  return false;
}
