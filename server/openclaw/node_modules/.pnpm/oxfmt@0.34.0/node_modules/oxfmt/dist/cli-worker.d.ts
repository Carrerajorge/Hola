import { t as Options } from "./index-BNhsnuYk.js";

//#region src-js/libs/apis.d.ts
type FormatEmbeddedCodeParam = {
  code: string;
  options: Options;
};
/**
 * Format xxx-in-js code snippets
 *
 * @returns Formatted code snippet
 * TODO: In the future, this should return `Doc` instead of string,
 * otherwise, we cannot calculate `printWidth` correctly.
 */
declare function formatEmbeddedCode({
  code,
  options
}: FormatEmbeddedCodeParam): Promise<string>;
type FormatFileParam = {
  code: string;
  options: Options;
};
/**
 * Format non-js file
 *
 * @returns Formatted code
 */
declare function formatFile({
  code,
  options
}: FormatFileParam): Promise<string>;
interface SortTailwindClassesArgs {
  classes: string[];
  options: {
    filepath?: string;
    tailwindStylesheet?: string;
    tailwindConfig?: string;
    tailwindPreserveWhitespace?: boolean;
    tailwindPreserveDuplicates?: boolean;
  };
}
/**
 * Process Tailwind CSS classes found in JS/TS files in batch.
 * @param args - Object containing classes and options (filepath is in options.filepath)
 * @returns Array of sorted class strings (same order/length as input)
 */
declare function sortTailwindClasses({
  classes,
  options
}: SortTailwindClassesArgs): Promise<string[]>;
//#endregion
export { formatEmbeddedCode, formatFile, sortTailwindClasses };