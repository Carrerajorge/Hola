import { t as Options } from "./index-BNhsnuYk.js";

//#region src-js/bindings.d.ts
interface ErrorLabel {
  message: string | null;
  start: number;
  end: number;
}
interface OxcError {
  severity: Severity;
  message: string;
  labels: Array<ErrorLabel>;
  helpMessage: string | null;
  codeframe: string | null;
}
declare const enum Severity {
  Error = 'Error',
  Warning = 'Warning',
  Advice = 'Advice'
}
interface FormatResult {
  /** The formatted code. */
  code: string;
  /** Parse and format errors. */
  errors: Array<OxcError>;
}
interface TextToDocResult {
  /** The formatted code. */
  doc: string;
  /** Parse and format errors. */
  errors: Array<OxcError>;
}
//#endregion
//#region src-js/index.d.ts
/**
 * Format the given source text according to the specified options.
 */
declare function format(fileName: string, sourceText: string, options?: FormatOptions): Promise<FormatResult>;
/**
 * Format a JS/TS snippet for Prettier `textToDoc()` plugin flow.
 */
declare function jsTextToDoc(fileName: string, sourceText: string, oxfmtPluginOptionsJson: string, parentContext: string): Promise<TextToDocResult>;
/**
 * Configuration options for the `format()` API.
 */
type FormatOptions = Pick<Options, "useTabs" | "tabWidth" | "singleQuote" | "jsxSingleQuote" | "quoteProps" | "trailingComma" | "semi" | "arrowParens" | "bracketSpacing" | "bracketSameLine" | "objectWrap" | "singleAttributePerLine" | "embeddedLanguageFormatting" | "proseWrap" | "htmlWhitespaceSensitivity" | "vueIndentScriptAndStyle"> & {
  /** Which end of line characters to apply. (Default: `"lf"`) */endOfLine?: "lf" | "crlf" | "cr"; /** The line length that the printer will wrap on. (Default: `100`) */
  printWidth?: number; /** Whether to insert a final newline at the end of the file. (Default: `true`) */
  insertFinalNewline?: boolean; /** Experimental: Sort import statements. Disabled by default. */
  experimentalSortImports?: SortImportsOptions; /** Experimental: Sort `package.json` keys. (Default: `true`) */
  experimentalSortPackageJson?: boolean;
  /**
   * Experimental: Enable Tailwind CSS class sorting in JSX class/className attributes.
   * (Default: disabled)
   */
  experimentalTailwindcss?: TailwindcssOptions;
} & Record<string, unknown>;
/**
 * Configuration options for sort imports.
 */
type SortImportsOptions = {
  /** Partition imports by newlines. (Default: `false`) */partitionByNewline?: boolean; /** Partition imports by comments. (Default: `false`) */
  partitionByComment?: boolean; /** Sort side-effect imports. (Default: `false`) */
  sortSideEffects?: boolean; /** Sort order. (Default: `"asc"`) */
  order?: "asc" | "desc"; /** Ignore case when sorting. (Default: `true`) */
  ignoreCase?: boolean; /** Add newlines between import groups. (Default: `true`) */
  newlinesBetween?: boolean; /** Prefixes to identify internal imports. (Default: `["~/", "@/"]`) */
  internalPattern?: string[];
  /**
   * Groups configuration for organizing imports.
   * Each array element represents a group, and multiple group names in the same array are treated as one.
   * Accepts `string`, `string[]`, or `{ newlinesBetween: boolean }` marker objects.
   * Marker objects override the global `newlinesBetween` setting for the boundary between the adjacent groups.
   */
  groups?: (string | string[] | {
    newlinesBetween: boolean;
  })[]; /** Define custom groups for matching specific imports. */
  customGroups?: {
    groupName: string;
    elementNamePattern?: string[];
    selector?: string;
    modifiers?: string[];
  }[];
};
/**
 * Configuration options for Tailwind CSS class sorting.
 * See https://github.com/tailwindlabs/prettier-plugin-tailwindcss#options
 */
type TailwindcssOptions = {
  /** Path to Tailwind config file (v3). e.g., `"./tailwind.config.js"` */config?: string; /** Path to Tailwind stylesheet (v4). e.g., `"./src/app.css"` */
  stylesheet?: string;
  /**
   * List of custom function names whose arguments should be sorted.
   * e.g., `["clsx", "cva", "tw"]` (Default: `[]`)
   */
  functions?: string[];
  /**
   * List of additional HTML/JSX attributes to sort (beyond `class` and `className`).
   * e.g., `["myClassProp", ":class"]` (Default: `[]`)
   */
  attributes?: string[]; /** Preserve whitespace around classes. (Default: `false`) */
  preserveWhitespace?: boolean; /** Preserve duplicate classes. (Default: `false`) */
  preserveDuplicates?: boolean;
};
//#endregion
export { FormatOptions, SortImportsOptions, TailwindcssOptions, format, jsTextToDoc };