/**
 * Document Generation Module — Public API
 *
 * V2 (recommended): Use DocumentCompilerV2 + DocumentIR for deterministic,
 * failsafe document generation with design tokens, component contracts,
 * layout engine, preflight validation, and graceful degradation.
 *
 * V1 (legacy): DocumentCompiler + spec-based generation still available.
 */

/* ================================================================== */
/*  V2 — Deterministic Compiler Architecture                           */
/* ================================================================== */

// Entry point
export { DocumentCompilerV2, getDefaultCompilerV2 } from "./documentCompilerV2";
export type { CompilerV2Output } from "./documentCompilerV2";

// Intermediate Representation (IR)
export { DocumentIRSchema, parseDocumentIR, createMinimalIR } from "./documentIR";
export type {
  DocumentIR,
  SectionIR,
  BlockIR,
  OutputFormat,
} from "./documentIR";

// Design Tokens V2
export {
  DesignTokensV2Schema,
  resolveTokens,
  applyVariant,
  THEME_PRESETS_V2,
} from "./designTokens";
export type { DesignTokensV2, TextStyle, TableStyle, ChartStyle } from "./designTokens";

// Component Registry
export {
  COMPONENT_CONTRACTS,
  normalizeBlock,
  isComponentSupported,
  resolveTextStyleForBlock,
  getFallbackChain,
} from "./componentRegistry";
export type { ComponentContract } from "./componentRegistry";

// Layout Engine V2
export { LayoutEngineV2 } from "./layoutEngineV2";
export type { SlideLayout, PageLayout, LayoutBox as LayoutBoxV2 } from "./layoutEngineV2";

// Preflight Validator
export { PreflightValidator } from "./preflightValidator";
export type { PreflightReport, PreflightIssue, Severity } from "./preflightValidator";

// Graceful Degradation
export { DegradationEngine } from "./gracefulDegradation";
export type { DegradationManifest, DegradationEntry } from "./gracefulDegradation";

// Format Compilers
export { DocxCompiler, XlsxCompiler, PptxCompiler } from "./compilers";

/* ================================================================== */
/*  V1 — Legacy API (preserved for backward compatibility)             */
/* ================================================================== */

export { DocumentCompiler, getDefaultCompiler } from "./compiler";
export type { CompilerInput, CompilerTextInput, CompilerOutput, CompilerFormat } from "./compiler";

export { DocumentEngine, LayoutEngine, DesignTokensSchema } from "./documentEngine";
export type {
  DesignTokens,
  PresentationSpec,
  DocumentSpec,
  WorkbookSpec,
  LayoutBox,
} from "./documentEngine";

export { resolveTheme, THEMES } from "./themes";

export {
  markdownToDocSpec,
  csvToWorkbookSpec,
  jsonToPresentationSpec,
  markdownToPresentationSpec,
} from "./textToSpec";

export {
  PresentationValidator,
  DocumentValidator,
  WorkbookValidator,
} from "./documentValidators";
export type { ValidationResult, ValidationIssue } from "./documentValidators";
