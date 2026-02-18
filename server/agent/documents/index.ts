/**
 * Document Generation Module — Public API
 *
 * Two compiler versions available:
 *   - v1 (DocumentCompiler): Original pipeline, still operational
 *   - v2 (DocumentCompilerV2): Enhanced pipeline with unified tokens,
 *     component registry, preflight validation, layout guardrails,
 *     and graceful degradation
 *
 * New code should prefer v2 via getDefaultCompilerV2().
 */

// === V1 Compiler (backward-compatible) ===
export { DocumentCompiler, getDefaultCompiler } from "./compiler";
export type { CompilerInput, CompilerTextInput, CompilerOutput, CompilerFormat } from "./compiler";

// === V2 Compiler (robust pipeline) ===
export { DocumentCompilerV2, getDefaultCompilerV2 } from "./compilerV2";
export type { CompilerV2Input, CompilerV2TextInput, CompilerV2Output, CompilerV2Format } from "./compilerV2";

// === Document Engine (core renderer) ===
export { DocumentEngine, LayoutEngine, DesignTokensSchema } from "./documentEngine";
export type {
  DesignTokens,
  PresentationSpec,
  DocumentSpec,
  WorkbookSpec,
  LayoutBox,
} from "./documentEngine";

// === Unified Design Tokens (v2) ===
export {
  UnifiedDesignTokensSchema,
  resolveUnifiedTheme,
  extractBaseTokens,
  UNIFIED_THEMES,
} from "./designTokens";
export type { UnifiedDesignTokens } from "./designTokens";

// === Component Registry ===
export {
  buildComponent,
  getSafeFallback,
  enforceTextConstraints,
  enforceListConstraints,
  enforceTableConstraints,
  DEFAULT_CONSTRAINTS,
  COMPONENT_TYPES,
} from "./componentRegistry";
export type {
  ComponentType,
  ComponentDescriptor,
  ComponentConstraints,
  ConstraintResult,
} from "./componentRegistry";

// === Layout Guardrails ===
export {
  computeSlideLayout,
  autoFitText,
  splitBullets,
  splitTable,
  computePageBreaks,
} from "./layoutGuardrails";
export type {
  TextFitResult,
  SplitResult,
  LayoutDecision,
  SlideLayoutResult,
} from "./layoutGuardrails";

// === Preflight Validator ===
export { PreflightValidator } from "./preflightValidator";
export type { PreflightResult, PreflightIssue, PreflightSeverity } from "./preflightValidator";

// === Graceful Degradation ===
export {
  DegradationManager,
  generateFallbackDocument,
} from "./gracefulDegradation";
export type { DegradationLog, DegradationEvent } from "./gracefulDegradation";

// === Themes (v1 compat + v2) ===
export { resolveTheme, THEMES } from "./themes";

// === Text-to-Spec Adapters ===
export {
  markdownToDocSpec,
  csvToWorkbookSpec,
  jsonToPresentationSpec,
  markdownToPresentationSpec,
} from "./textToSpec";

// === Validators ===
export {
  PresentationValidator,
  DocumentValidator,
  WorkbookValidator,
} from "./documentValidators";
export type { ValidationResult, ValidationIssue } from "./documentValidators";
